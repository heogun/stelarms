// STELARMS 토너먼트 운영 모듈.
//
// 캐주얼 방(`Room`)과 분리된 참가자 허브다. 3라운드 스위스 → 4강 → 결승을
// 운영하고, 각 경기 전에 삼습일사(3명 픽 → 상대 1명 밴 → 2명 덱)를 강제한다.
// 게임 판정 자체는 기존 엔진(`createMatch`/`applyAction`)을 그대로 쓴다.

import {
  applyAction,
  createMatch as createGame,
  hashState,
  isRuleError,
  toPlayerView,
} from "../src/engine";
import type { Action, GameState, PlayerId } from "../src/engine";
import { resolveDeckChoice } from "../src/net/deckChoice";
import type { ResolvedDeck } from "../src/net/deckChoice";
import {
  MAX_NAME_LENGTH,
  ROOM_CODE_LENGTH,
} from "../src/net/protocol";
import type {
  ServerMessage,
  TournamentBracketMatchView,
  TournamentMatchPlayer,
  TournamentPlayerView,
  TournamentSelfMatchView,
  TournamentView,
} from "../src/net/protocol";
import {
  TOURNAMENT_MAX_PLAYERS,
  TOURNAMENT_MATCH_MS,
  TOURNAMENT_MIN_PLAYERS,
  TOURNAMENT_PREP_MS,
  TOURNAMENT_SWISS_ROUNDS,
  pairSwiss,
  resolveTournamentPair,
  semifinalPairs,
  stageLabel,
  tournamentStandings,
  validateTournamentDeck,
  validateTournamentPicks,
} from "../src/net/tournament";
import type {
  StandingInput,
  TournamentDraftStage,
  TournamentPhase,
  TournamentStage,
} from "../src/net/tournament";
import { defaultAction } from "./defaultAction";

/* ────────────────────────────── 설정 ────────────────────────────── */

const TURN_MS = Number(process.env.STELARMS_TURN_MS ?? 90_000);
const TOURNAMENT_IDLE_MS = 3 * 60 * 60_000;
const TOURNAMENT_MAX_MS = 6 * 60 * 60_000;
const TOURNAMENT_ALL_GONE_MS = 30 * 60_000;
const MAX_TOURNAMENTS = 500;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface SocketClient {
  id: string;
  ws: {
    send(data: string): void;
    close(code?: number, reason?: string): void;
  };
}

interface Participant {
  id: string;
  token: string;
  name: string;
  client: SocketClient | null;
  connected: boolean;
  disconnectedAt: number | null;
  seed: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  opponents: string[];
  withdrawn: boolean;
}

interface DraftState {
  stage: TournamentDraftStage;
  picks: [string[] | null, string[] | null];
  bans: [string | null, string | null];
  pairs: [[string, string] | null, [string, string] | null];
  decks: [ResolvedDeck | null, ResolvedDeck | null];
}

interface TournamentMatch {
  id: string;
  stage: TournamentStage;
  round: number;
  seats: [string | null, string | null];
  draft: DraftState;
  state: GameState | null;
  hash: string;
  seq: number;
  actions: { seat: PlayerId; action: unknown; hash: string }[];
  done: boolean;
  winnerId: string | null;
  resultReason: string | null;
  deadline: number | null;
  prepDeadline: number | null;
  gameDeadline: number | null;
  prepTimer: ReturnType<typeof setTimeout> | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  gameTimer: ReturnType<typeof setTimeout> | null;
}

interface Tournament {
  code: string;
  hostId: string;
  phase: TournamentPhase;
  round: number;
  participants: Participant[];
  matches: TournamentMatch[];
  activeIds: string[];
  createdAt: number;
  lastActivity: number;
  championId: string | null;
  championName: string | null;
  nextMatchSeq: number;
}

interface ClientEntry {
  tournament: Tournament;
  participantId: string;
}

const tournaments = new Map<string, Tournament>();
const clientIndex = new Map<string, ClientEntry>();

/* ────────────────────────────── 유틸 ────────────────────────────── */

import { encodeServer } from "../src/net/codec";
function send(client: SocketClient, message: ServerMessage): void {
  try {
    client.ws.send(encodeServer(message));
  } catch {
    // 닫힌 소켓은 close 핸들러가 정리한다.
  }
}

function sendError(client: SocketClient, code: string, message: string): void {
  send(client, { type: "error", code, message });
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "플레이어";
  const name = [...raw]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || "플레이어";
}

function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code) ? code : null;
}

function newTournamentCode(): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
    const code = [...bytes].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
    if (!tournaments.has(code)) return code;
  }
  throw new Error("대회 코드를 생성할 수 없습니다.");
}

function participantById(tournament: Tournament, id: string): Participant | null {
  return tournament.participants.find((participant) => participant.id === id) ?? null;
}

function participantAt(tournament: Tournament, match: TournamentMatch, seat: PlayerId): Participant | null {
  const id = match.seats[seat];
  return id ? participantById(tournament, id) : null;
}

function seatOf(match: TournamentMatch, participantId: string): PlayerId | null {
  if (match.seats[0] === participantId) return 0;
  if (match.seats[1] === participantId) return 1;
  return null;
}

function activeMatchFor(tournament: Tournament, participantId: string): TournamentMatch | null {
  for (const id of tournament.activeIds) {
    const match = tournament.matches.find((item) => item.id === id);
    if (match && !match.done && seatOf(match, participantId) !== null) return match;
  }
  return null;
}

function activeTournamentFor(client: SocketClient): ClientEntry | null {
  return clientIndex.get(client.id) ?? null;
}

function rotateHost(tournament: Tournament): void {
  if (participantById(tournament, tournament.hostId)?.withdrawn) {
    const next = tournament.participants.find((participant) => !participant.withdrawn);
    tournament.hostId = next?.id ?? "";
  } else if (!participantById(tournament, tournament.hostId)) {
    const next = tournament.participants.find((participant) => !participant.withdrawn);
    tournament.hostId = next?.id ?? "";
  }
}

/* ────────────────────────────── 뷰 ────────────────────────────── */

function publicMatchView(
  tournament: Tournament,
  match: TournamentMatch,
): TournamentBracketMatchView {
  const seatView = (seat: PlayerId): TournamentMatchPlayer | null => {
    const participant = participantAt(tournament, match, seat);
    return participant ? { id: participant.id, name: participant.name } : null;
  };
  const winner = match.winnerId ? participantById(tournament, match.winnerId) : null;
  return {
    id: match.id,
    stage: match.stage,
    round: match.round,
    label: stageLabel(match.stage, match.round),
    seats: [seatView(0), seatView(1)],
    winnerId: match.winnerId,
    winnerName: winner?.name ?? null,
    status: match.done ? "done" : match.state ? "playing" : "draft",
    bye: !match.seats[1],
    resultReason: match.resultReason,
  };
}

function selfMatchView(
  tournament: Tournament,
  match: TournamentMatch,
  seat: PlayerId,
): TournamentSelfMatchView {
  const foeSeat = seat === 0 ? 1 : 0;
  const opponent = participantAt(tournament, match, foeSeat);
  const draft = match.draft;
  const picksRevealed = draft.stage !== "pick";
  const bansRevealed = draft.stage === "deck" || draft.stage === "game" || draft.stage === "done";
  const ownDeck = draft.decks[seat];
  return {
    id: match.id,
    stage: match.stage,
    round: match.round,
    label: stageLabel(match.stage, match.round),
    seat,
    opponent: opponent
      ? { id: opponent.id, name: opponent.name, connected: opponent.connected }
      : null,
    status: draft.stage,
    picks: {
      own: draft.picks[seat],
      foe: picksRevealed ? draft.picks[foeSeat] : null,
    },
    bans: {
      own: draft.bans[seat],
      foe: bansRevealed ? draft.bans[foeSeat] : null,
    },
    pairs: {
      own: draft.pairs[seat],
      foe: bansRevealed ? draft.pairs[foeSeat] : null,
    },
    decks: {
      own: ownDeck
        ? { name: ownDeck.name, mainId: ownDeck.mainId, partnerId: ownDeck.partnerId }
        : null,
      foeReady: Boolean(draft.decks[foeSeat]),
    },
    prepDeadline:
      draft.stage === "pick" || draft.stage === "ban" || draft.stage === "deck"
        ? match.prepDeadline
        : null,
    gameDeadline: draft.stage === "game" ? match.gameDeadline : null,
    result: match.done
      ? { winnerId: match.winnerId, reason: match.resultReason ?? "" }
      : null,
  };
}

function buildTournamentView(tournament: Tournament, selfId: string): TournamentView {
  const standings = tournamentStandings(tournament.participants);
  const standingById = new Map(standings.map((entry) => [entry.id, entry]));
  const playerView = (participant: Participant): TournamentPlayerView => {
    const standing = standingById.get(participant.id);
    return {
      id: participant.id,
      name: participant.name,
      connected: participant.connected,
      host: participant.id === tournament.hostId,
      withdrawn: participant.withdrawn,
      wins: standing?.wins ?? participant.wins,
      losses: standing?.losses ?? participant.losses,
      draws: standing?.draws ?? participant.draws,
      byes: standing?.byes ?? participant.byes,
      points: standing?.points ?? 0,
      buchholz: standing?.buchholz ?? 0,
    };
  };
  const selfMatch = activeMatchFor(tournament, selfId);
  return {
    code: tournament.code,
    token: participantById(tournament, selfId)?.token ?? "",
    selfId,
    hostId: tournament.hostId,
    phase: tournament.phase,
    round: tournament.round,
    minPlayers: TOURNAMENT_MIN_PLAYERS,
    maxPlayers: TOURNAMENT_MAX_PLAYERS,
    players: tournament.participants.map(playerView),
    standings: standings.map((standing) => {
      const participant = participantById(tournament, standing.id);
      return participant
        ? playerView(participant)
        : {
            id: standing.id,
            name: standing.name,
            connected: false,
            host: false,
            withdrawn: standing.withdrawn,
            wins: standing.wins,
            losses: standing.losses,
            draws: standing.draws,
            byes: standing.byes,
            points: standing.points,
            buchholz: standing.buchholz,
          };
    }),
    matches: tournament.matches.map((match) => publicMatchView(tournament, match)),
    selfMatch: selfMatch ? selfMatchView(tournament, selfMatch, seatOf(selfMatch, selfId) ?? 0) : null,
    championId: tournament.championId,
    championName: tournament.championName,
  };
}



function sendTournament(tournament: Tournament, participant: Participant): void {
  if (!participant.client) return;
  send(participant.client, {
    type: "tournament",
    tournament: buildTournamentView(tournament, participant.id),
  });
}

function broadcastTournament(tournament: Tournament): void {
  for (const participant of tournament.participants) sendTournament(tournament, participant);
}

function sendMatchState(tournament: Tournament, match: TournamentMatch): void {
  if (!match.state) return;
  for (const seat of [0, 1] as const) {
    const participant = participantAt(tournament, match, seat);
    if (!participant?.client) continue;
    send(participant.client, {
      type: "tstate",
      matchId: match.id,
      view: toPlayerView(match.state, seat),
      hash: match.hash,
      seq: match.seq,
      deadline: match.deadline,
    });
  }
}

function broadcastMatchState(tournament: Tournament, match: TournamentMatch): void {
  sendMatchState(tournament, match);
}

/* ────────────────────────────── 타이머 ────────────────────────────── */

function actorOf(state: GameState): PlayerId {
  return state.pending ? state.pending.player : state.turn;
}

function clearMatchTimers(match: TournamentMatch): void {
  if (match.prepTimer) clearTimeout(match.prepTimer);
  if (match.turnTimer) clearTimeout(match.turnTimer);
  if (match.gameTimer) clearTimeout(match.gameTimer);
  match.prepTimer = null;
  match.turnTimer = null;
  match.gameTimer = null;
  match.prepDeadline = null;
  match.deadline = null;
  match.gameDeadline = null;
}

function refreshTurnTimer(tournament: Tournament, match: TournamentMatch): void {
  if (match.turnTimer) {
    clearTimeout(match.turnTimer);
    match.turnTimer = null;
  }
  match.deadline = null;
  if (match.done || !match.state || match.state.phase === "gameover") return;
  const actor = actorOf(match.state);
  const participant = participantAt(tournament, match, actor);
  if (!participant?.connected) return;
  match.deadline = Date.now() + TURN_MS;
  match.turnTimer = setTimeout(() => onTurnTimeout(tournament, match), TURN_MS);
}

function armPrepTimer(tournament: Tournament, match: TournamentMatch): void {
  if (match.prepTimer) clearTimeout(match.prepTimer);
  match.prepTimer = null;
  match.prepDeadline = null;
  if (match.done) return;
  if (
    match.draft.stage !== "pick" &&
    match.draft.stage !== "ban" &&
    match.draft.stage !== "deck"
  ) {
    return;
  }
  match.prepDeadline = Date.now() + TOURNAMENT_PREP_MS;
  match.prepTimer = setTimeout(() => onPrepTimeout(tournament, match), TOURNAMENT_PREP_MS);
}

function winnerOnBracketDraw(tournament: Tournament, match: TournamentMatch): string | null {
  const a = participantAt(tournament, match, 0);
  const b = participantAt(tournament, match, 1);
  if (!a) return b?.id ?? null;
  if (!b) return a.id;
  if (a.withdrawn !== b.withdrawn) return a.withdrawn ? b.id : a.id;
  return a.seed <= b.seed ? a.id : b.id;
}

function onPrepTimeout(tournament: Tournament, match: TournamentMatch): void {
  match.prepTimer = null;
  if (match.done) return;
  const stage = match.draft.stage;
  if (stage !== "pick" && stage !== "ban" && stage !== "deck") return;
  const missing: PlayerId[] = [];
  for (const seat of [0, 1] as const) {
    if (!participantAt(tournament, match, seat)) continue;
    if (stage === "pick" && match.draft.picks[seat] === null) missing.push(seat);
    if (stage === "ban" && match.draft.bans[seat] === null) missing.push(seat);
    if (stage === "deck" && match.draft.decks[seat] === null) missing.push(seat);
  }
  if (missing.length === 0) return;
  if (missing.length === 2) {
    finishMatch(
      tournament,
      match,
      match.stage === "swiss" ? null : winnerOnBracketDraw(tournament, match),
      "준비 시간 초과",
    );
    return;
  }
  const loserSeat = missing[0];
  const winner = participantAt(tournament, match, loserSeat === 0 ? 1 : 0);
  finishMatch(tournament, match, winner?.id ?? null, "준비 시간 초과");
}

function onGameTimeout(tournament: Tournament, match: TournamentMatch): void {
  match.gameTimer = null;
  if (match.done || !match.state) return;
  const a = match.state.players[0];
  const b = match.state.players[1];
  let winnerSeat: PlayerId | null = null;
  if (a.life > b.life) winnerSeat = 0;
  if (b.life > a.life) winnerSeat = 1;
  if (winnerSeat === null) {
    if (match.stage === "swiss") {
      finishMatch(tournament, match, null, "경기 시간 초과 · 무승부");
      return;
    }
    const fallback = winnerOnBracketDraw(tournament, match);
    finishMatch(tournament, match, fallback, "경기 시간 초과 · 시드 우선");
    return;
  }
  const winner = participantAt(tournament, match, winnerSeat);
  finishMatch(tournament, match, winner?.id ?? null, "경기 시간 초과 · 라이프 우선");
}

function onTurnTimeout(tournament: Tournament, match: TournamentMatch): void {
  match.turnTimer = null;
  if (match.done || !match.state || match.state.phase === "gameover") return;
  const actor = actorOf(match.state);
  const participant = participantAt(tournament, match, actor);
  if (!participant?.connected) {
    refreshTurnTimer(tournament, match);
    return;
  }
  const action = defaultAction(match.state, actor);
  if (action && applyTournamentAction(tournament, match, actor, action)) return;
  if (applyTournamentAction(tournament, match, actor, { type: "surrender" })) return;
  match.deadline = Date.now() + 5_000;
  match.turnTimer = setTimeout(() => onTurnTimeout(tournament, match), 5_000);
}

/* ────────────────────────────── 경기 진행 ────────────────────────────── */

function applyTournamentAction(
  tournament: Tournament,
  match: TournamentMatch,
  seat: PlayerId,
  action: Action,
): boolean {
  if (!match.state || match.done) return false;
  try {
    const next = applyAction(match.state, seat, action);
    match.state = next;
    match.seq += 1;
    match.hash = hashState(next);
    match.actions.push({ seat, action, hash: match.hash });
    if (match.actions.length > 4_000) {
      match.actions.splice(0, match.actions.length - 4_000);
    }
    tournament.lastActivity = Date.now();
    refreshTurnTimer(tournament, match);
    broadcastMatchState(tournament, match);
    if (next.phase === "gameover") {
      let winnerId: string | null = null;
      if (next.winner !== null && next.winner !== "draw") {
        winnerId = participantAt(tournament, match, next.winner)?.id ?? null;
      }
      if (winnerId === null && match.stage !== "swiss") {
        winnerId = winnerOnBracketDraw(tournament, match);
      }
      finishMatch(
        tournament,
        match,
        winnerId,
        next.winner === null || next.winner === "draw" ? "무승부" : "게임 종료",
      );
    }
    return true;
  } catch (error) {
    const participant = participantAt(tournament, match, seat);
    if (isRuleError(error)) {
      if (participant?.client) sendError(participant.client, error.code, error.message);
    } else {
      console.error(`[tournament ${tournament.code}] engine error`, error);
      if (participant?.client) {
        sendError(participant.client, "internal", "서버 내부 오류가 발생했습니다.");
      }
    }
    return false;
  }
}

function finishMatch(
  tournament: Tournament,
  match: TournamentMatch,
  winnerId: string | null,
  reason: string,
): void {
  if (match.done) return;
  match.done = true;
  match.winnerId = winnerId;
  match.resultReason = reason;
  clearMatchTimers(match);
  const a = participantAt(tournament, match, 0);
  const b = participantAt(tournament, match, 1);
  if (a && b) {
    if (match.stage === "swiss") {
      a.opponents.push(b.id);
      b.opponents.push(a.id);
    }
    if (winnerId === a.id) {
      a.wins += 1;
      b.losses += 1;
    } else if (winnerId === b.id) {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
    }
  }
  tournament.lastActivity = Date.now();
  broadcastTournament(tournament);
  maybeAdvanceTournament(tournament);
}

function startGame(tournament: Tournament, match: TournamentMatch): void {
  const a = participantAt(tournament, match, 0);
  const b = participantAt(tournament, match, 1);
  const pairA = match.draft.pairs[0];
  const pairB = match.draft.pairs[1];
  const deckA = match.draft.decks[0];
  const deckB = match.draft.decks[1];
  if (!a || !b || !pairA || !pairB || !deckA || !deckB) {
    finishMatch(tournament, match, null, "경기 준비 실패");
    return;
  }
  if (match.prepTimer) clearTimeout(match.prepTimer);
  match.prepTimer = null;
  match.prepDeadline = null;
  match.draft.stage = "game";
  try {
    const state = createGame({
      seed: `${tournament.code}:${match.id}:${crypto.randomUUID()}`,
      players: [
        {
          name: a.name,
          stellas: pairA,
          deck: [...deckA.normals],
          specials: [...deckA.specials],
        },
        {
          name: b.name,
          stellas: pairB,
          deck: [...deckB.normals],
          specials: [...deckB.specials],
        },
      ],
    });
    match.state = state;
    match.hash = hashState(state);
    match.seq = 1;
    match.actions = [];
    match.gameDeadline = Date.now() + TOURNAMENT_MATCH_MS;
    match.gameTimer = setTimeout(() => onGameTimeout(tournament, match), TOURNAMENT_MATCH_MS);
    tournament.lastActivity = Date.now();
    refreshTurnTimer(tournament, match);
    broadcastTournament(tournament);
    broadcastMatchState(tournament, match);
  } catch (error) {
    if (isRuleError(error)) {
      finishMatch(tournament, match, null, error.message);
    } else {
      console.error(`[tournament ${tournament.code}] start failed`, error);
      finishMatch(tournament, match, null, "경기를 시작할 수 없습니다.");
    }
  }
}

function createMatch(
  tournament: Tournament,
  stage: TournamentStage,
  round: number,
  aId: string,
  bId: string | null,
): TournamentMatch {
  const id = `m${tournament.nextMatchSeq}`;
  tournament.nextMatchSeq += 1;
  const match: TournamentMatch = {
    id,
    stage,
    round,
    seats: [aId, bId],
    draft: {
      stage: "pick",
      picks: [null, null],
      bans: [null, null],
      pairs: [null, null],
      decks: [null, null],
    },
    state: null,
    hash: "",
    seq: 0,
    actions: [],
    done: false,
    winnerId: null,
    resultReason: null,
    deadline: null,
    prepDeadline: null,
    gameDeadline: null,
    prepTimer: null,
    turnTimer: null,
    gameTimer: null,
  };
  tournament.matches.push(match);
  if (bId === null) {
    match.done = true;
    match.winnerId = aId;
    match.resultReason = "부전승";
    match.draft.stage = "done";
    const a = participantById(tournament, aId);
    if (a && stage === "swiss") a.byes += 1;
  } else {
    armPrepTimer(tournament, match);
  }
  return match;
}

function activeStandings(tournament: Tournament): StandingInput[] {
  return tournament.participants.filter((participant) => !participant.withdrawn);
}

function createSwissRound(tournament: Tournament, round: number): void {
  tournament.phase = "swiss";
  tournament.round = round;
  tournament.activeIds = [];
  const pairings = pairSwiss(activeStandings(tournament));
  for (const pairing of pairings) {
    const match = createMatch(tournament, "swiss", round, pairing.a, pairing.b);
    tournament.activeIds.push(match.id);
  }
  tournament.lastActivity = Date.now();
  broadcastTournament(tournament);
  maybeAdvanceTournament(tournament);
}

function finishTournament(tournament: Tournament, championId: string | null): void {
  tournament.phase = "done";
  tournament.championId = championId;
  tournament.championName = championId
    ? (participantById(tournament, championId)?.name ?? null)
    : null;
  tournament.activeIds = [];
  for (const match of tournament.matches) clearMatchTimers(match);
  tournament.lastActivity = Date.now();
  broadcastTournament(tournament);
}

function startSemifinals(tournament: Tournament): void {
  const standings = tournamentStandings(tournament.participants).filter(
    (entry) => !entry.withdrawn,
  );
  if (standings.length >= 4) {
    const pairs = semifinalPairs(tournament.participants);
    if (!pairs) {
      finishTournament(tournament, standings[0]?.id ?? null);
      return;
    }
    tournament.phase = "semifinal";
    tournament.round = TOURNAMENT_SWISS_ROUNDS + 1;
    tournament.activeIds = [];
    for (const pair of pairs) {
      const match = createMatch(tournament, "semifinal", tournament.round, pair.a, pair.b);
      tournament.activeIds.push(match.id);
    }
  } else if (standings.length === 3) {
    tournament.phase = "semifinal";
    tournament.round = TOURNAMENT_SWISS_ROUNDS + 1;
    tournament.activeIds = [];
    const bye = createMatch(tournament, "semifinal", tournament.round, standings[0].id, null);
    tournament.activeIds.push(bye.id);
    const match = createMatch(
      tournament,
      "semifinal",
      tournament.round,
      standings[1].id,
      standings[2].id,
    );
    tournament.activeIds.push(match.id);
  } else if (standings.length === 2) {
    tournament.phase = "final";
    tournament.round = TOURNAMENT_SWISS_ROUNDS + 2;
    tournament.activeIds = [];
    const match = createMatch(
      tournament,
      "final",
      tournament.round,
      standings[0].id,
      standings[1].id,
    );
    tournament.activeIds.push(match.id);
  } else {
    finishTournament(tournament, standings[0]?.id ?? null);
    return;
  }
  tournament.lastActivity = Date.now();
  broadcastTournament(tournament);
  maybeAdvanceTournament(tournament);
}

function startFinal(tournament: Tournament): void {
  const semifinals = tournament.activeIds
    .map((id) => tournament.matches.find((match) => match.id === id))
    .filter((match): match is TournamentMatch => Boolean(match));
  const winners: string[] = [];
  for (const match of semifinals) {
    const winnerId = match.winnerId ?? winnerOnBracketDraw(tournament, match);
    if (winnerId && !winners.includes(winnerId)) winners.push(winnerId);
  }
  if (winners.length < 2) {
    finishTournament(tournament, winners[0] ?? null);
    return;
  }
  tournament.phase = "final";
  tournament.round = TOURNAMENT_SWISS_ROUNDS + 2;
  tournament.activeIds = [];
  const match = createMatch(
    tournament,
    "final",
    tournament.round,
    winners[0],
    winners[1],
  );
  tournament.activeIds.push(match.id);
  tournament.lastActivity = Date.now();
  broadcastTournament(tournament);
  maybeAdvanceTournament(tournament);
}

function maybeAdvanceTournament(tournament: Tournament): void {
  if (tournament.phase === "lobby" || tournament.phase === "done") return;
  if (tournament.activeIds.length === 0) return;
  const active = tournament.activeIds
    .map((id) => tournament.matches.find((match) => match.id === id))
    .filter((match): match is TournamentMatch => Boolean(match));
  if (active.some((match) => !match.done)) return;

  if (tournament.phase === "swiss") {
    if (tournament.round < TOURNAMENT_SWISS_ROUNDS) {
      createSwissRound(tournament, tournament.round + 1);
      return;
    }
    startSemifinals(tournament);
    return;
  }
  if (tournament.phase === "semifinal") {
    startFinal(tournament);
    return;
  }
  if (tournament.phase === "final") {
    const final = active[0] ?? null;
    const championId = final?.winnerId ?? (final ? winnerOnBracketDraw(tournament, final) : null);
    finishTournament(tournament, championId);
  }
}

/* ────────────────────────────── 참가/재접속 ────────────────────────────── */

function bindParticipant(
  tournament: Tournament,
  participant: Participant,
  client: SocketClient,
): void {
  if (participant.client && participant.client.id !== client.id) {
    const old = participant.client;
    clientIndex.delete(old.id);
    sendError(old, "session-replaced", "다른 곳에서 같은 대회 좌석에 접속했습니다.");
    try {
      old.ws.close(4001, "session replaced");
    } catch {
      // ignore
    }
  }
  participant.client = client;
  participant.connected = true;
  participant.disconnectedAt = null;
  clientIndex.set(client.id, { tournament, participantId: participant.id });
  const match = activeMatchFor(tournament, participant.id);
  if (match) {
    refreshTurnTimer(tournament, match);
    broadcastMatchState(tournament, match);
  }
}

function addParticipant(tournament: Tournament, client: SocketClient, name: unknown): Participant {
  const participant: Participant = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    name: sanitizeName(name),
    client: null,
    connected: true,
    disconnectedAt: null,
    seed: tournament.participants.length,
    wins: 0,
    losses: 0,
    draws: 0,
    byes: 0,
    opponents: [],
    withdrawn: false,
  };
  tournament.participants.push(participant);
  bindParticipant(tournament, participant, client);
  return participant;
}

export function createTournament(client: SocketClient, rawName: unknown): void {
  if (clientIndex.has(client.id)) {
    sendError(client, "already-in-tournament", "이미 대회에 참가하고 있습니다.");
    return;
  }
  if (tournaments.size >= MAX_TOURNAMENTS) {
    sendError(client, "server-full", "대회가 너무 많습니다. 잠시 후 다시 시도하세요.");
    return;
  }
  const code = newTournamentCode();
  const tournament: Tournament = {
    code,
    hostId: "",
    phase: "lobby",
    round: 0,
    participants: [],
    matches: [],
    activeIds: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    championId: null,
    championName: null,
    nextMatchSeq: 1,
  };
  const host = addParticipant(tournament, client, rawName as string);
  tournament.hostId = host.id;
  tournaments.set(code, tournament);
  sendTournament(tournament, host);
}

export function joinTournament(
  client: SocketClient,
  rawCode: unknown,
  rawName: unknown,
): void {
  if (clientIndex.has(client.id)) {
    sendError(client, "already-in-tournament", "이미 대회에 참가하고 있습니다.");
    return;
  }
  const code = normalizeCode(rawCode);
  if (!code) {
    sendError(client, "bad-tournament", "대회 코드는 6자리입니다.");
    return;
  }
  const tournament = tournaments.get(code);
  if (!tournament) {
    sendError(client, "tournament-not-found", "대회를 찾을 수 없습니다.");
    return;
  }
  if (tournament.phase !== "lobby") {
    sendError(client, "tournament-started", "이미 시작한 대회입니다. 재접속은 토큰으로만 가능합니다.");
    return;
  }
  if (tournament.participants.length >= TOURNAMENT_MAX_PLAYERS) {
    sendError(client, "tournament-full", "대회 정원이 가득 찼습니다.");
    return;
  }
  const participant = addParticipant(tournament, client, rawName);
  tournament.lastActivity = Date.now();
  sendTournament(tournament, participant);
  broadcastTournament(tournament);
}

export function resumeTournament(
  client: SocketClient,
  rawCode: unknown,
  rawToken: unknown,
): void {
  if (clientIndex.has(client.id)) {
    sendError(client, "already-in-tournament", "이미 대회에 참가하고 있습니다.");
    return;
  }
  if (typeof rawToken !== "string" || rawToken.length > 128) {
    sendError(client, "bad-token", "재접속 토큰이 올바르지 않습니다.");
    return;
  }
  const code = normalizeCode(rawCode);
  if (!code) {
    sendError(client, "bad-tournament", "대회 코드가 올바르지 않습니다.");
    return;
  }
  const tournament = tournaments.get(code);
  if (!tournament) {
    sendError(client, "tournament-not-found", "대회를 찾을 수 없습니다.");
    return;
  }
  const participant = tournament.participants.find((item) => item.token === rawToken);
  if (!participant) {
    sendError(client, "bad-token", "대회 재접속 토큰이 만료되었습니다.");
    return;
  }
  bindParticipant(tournament, participant, client);
  tournament.lastActivity = Date.now();
  sendTournament(tournament, participant);
  const match = activeMatchFor(tournament, participant.id);
  if (match) sendMatchState(tournament, match);
  broadcastTournament(tournament);
}

export function startTournament(client: SocketClient): void {
  const entry = activeTournamentFor(client);
  if (!entry) {
    sendError(client, "no-tournament", "대회에 참가하지 않았습니다.");
    return;
  }
  const { tournament, participantId } = entry;
  if (tournament.hostId !== participantId) {
    sendError(client, "not-host", "대회장만 시작할 수 있습니다.");
    return;
  }
  if (tournament.phase !== "lobby") {
    sendError(client, "tournament-started", "이미 시작한 대회입니다.");
    return;
  }
  if (
    tournament.participants.length < TOURNAMENT_MIN_PLAYERS ||
    tournament.participants.length > TOURNAMENT_MAX_PLAYERS
  ) {
    sendError(
      client,
      "not-ready",
      `참가자가 ${TOURNAMENT_MIN_PLAYERS}~${TOURNAMENT_MAX_PLAYERS}명이어야 합니다.`,
    );
    return;
  }
  if (tournament.participants.some((participant) => !participant.connected)) {
    sendError(client, "not-ready", "모든 참가자가 연결되어야 시작할 수 있습니다.");
    return;
  }
  tournament.lastActivity = Date.now();
  createSwissRound(tournament, 1);
}

export function tournamentPick(client: SocketClient, rawStellas: unknown): void {
  const entry = activeTournamentFor(client);
  if (!entry) {
    sendError(client, "no-tournament", "대회에 참가하지 않았습니다.");
    return;
  }
  const match = activeMatchFor(entry.tournament, entry.participantId);
  if (!match) {
    sendError(client, "no-match", "진행 중인 경기가 없습니다.");
    return;
  }
  const seat = seatOf(match, entry.participantId);
  if (seat === null) return;
  if (match.draft.stage !== "pick") {
    sendError(client, "wrong-phase", "지금은 스텔라를 고를 단계가 아닙니다.");
    return;
  }
  if (match.draft.picks[seat]) {
    sendError(client, "already-picked", "이미 스텔라를 제출했습니다.");
    return;
  }
  const result = validateTournamentPicks(rawStellas);
  if (!result.ok) {
    sendError(client, "bad-pick", result.error);
    return;
  }
  match.draft.picks[seat] = result.picks;
  entry.tournament.lastActivity = Date.now();
  if (match.draft.picks[0] && match.draft.picks[1]) {
    match.draft.stage = "ban";
    armPrepTimer(entry.tournament, match);
  }
  broadcastTournament(entry.tournament);
}

export function tournamentBan(client: SocketClient, rawStellaId: unknown): void {
  const entry = activeTournamentFor(client);
  if (!entry) {
    sendError(client, "no-tournament", "대회에 참가하지 않았습니다.");
    return;
  }
  const match = activeMatchFor(entry.tournament, entry.participantId);
  if (!match) {
    sendError(client, "no-match", "진행 중인 경기가 없습니다.");
    return;
  }
  const seat = seatOf(match, entry.participantId);
  if (seat === null) return;
  if (match.draft.stage !== "ban") {
    sendError(client, "wrong-phase", "지금은 밴 단계가 아닙니다.");
    return;
  }
  if (match.draft.bans[seat]) {
    sendError(client, "already-banned", "이미 밴을 제출했습니다.");
    return;
  }
  if (typeof rawStellaId !== "string") {
    sendError(client, "bad-ban", "밴할 스텔라가 올바르지 않습니다.");
    return;
  }
  const foePicks = match.draft.picks[seat === 0 ? 1 : 0];
  if (!foePicks) {
    sendError(client, "not-ready", "상대의 스텔라 선택을 기다리는 중입니다.");
    return;
  }
  const opponentBan = resolveTournamentPair(foePicks, rawStellaId);
  if (!opponentBan.ok) {
    sendError(client, "bad-ban", opponentBan.error);
    return;
  }
  match.draft.bans[seat] = rawStellaId;
  entry.tournament.lastActivity = Date.now();
  if (match.draft.bans[0] && match.draft.bans[1]) {
    const picks0 = match.draft.picks[0];
    const picks1 = match.draft.picks[1];
    if (picks0 && picks1) {
      const pair0 = resolveTournamentPair(picks0, match.draft.bans[1]);
      const pair1 = resolveTournamentPair(picks1, match.draft.bans[0]);
      if (pair0.ok && pair1.ok) {
        match.draft.pairs = [pair0.pair, pair1.pair];
        match.draft.stage = "deck";
        armPrepTimer(entry.tournament, match);
      }
    }
  }
  broadcastTournament(entry.tournament);
}

export function tournamentDeck(client: SocketClient, rawDeck: unknown): void {
  const entry = activeTournamentFor(client);
  if (!entry) {
    sendError(client, "no-tournament", "대회에 참가하지 않았습니다.");
    return;
  }
  const match = activeMatchFor(entry.tournament, entry.participantId);
  if (!match) {
    sendError(client, "no-match", "진행 중인 경기가 없습니다.");
    return;
  }
  const seat = seatOf(match, entry.participantId);
  if (seat === null) return;
  if (match.draft.stage !== "deck") {
    sendError(client, "wrong-phase", "지금은 덱을 제출할 단계가 아닙니다.");
    return;
  }
  if (match.draft.decks[seat]) {
    sendError(client, "already-decked", "이미 덱을 제출했습니다.");
    return;
  }
  const pair = match.draft.pairs[seat];
  if (!pair) {
    sendError(client, "not-ready", "최종 스텔라 2명이 아직 정해지지 않았습니다.");
    return;
  }
  const validated = validateTournamentDeck(rawDeck, pair);
  if (!validated.ok) {
    sendError(client, "bad-deck", validated.error);
    return;
  }
  const resolved = resolveDeckChoice({ kind: "custom", deck: validated.deck });
  if (!resolved.ok) {
    sendError(client, "bad-deck", resolved.error);
    return;
  }
  match.draft.decks[seat] = resolved.deck;
  entry.tournament.lastActivity = Date.now();
  if (match.draft.decks[0] && match.draft.decks[1]) {
    startGame(entry.tournament, match);
    return;
  }
  broadcastTournament(entry.tournament);
}

export function tournamentAction(client: SocketClient, action: unknown): void {
  const entry = activeTournamentFor(client);
  if (!entry) {
    sendError(client, "no-tournament", "대회에 참가하지 않았습니다.");
    return;
  }
  const match = activeMatchFor(entry.tournament, entry.participantId);
  if (!match) {
    sendError(client, "no-match", "진행 중인 경기가 없습니다.");
    return;
  }
  const seat = seatOf(match, entry.participantId);
  if (seat === null) return;
  if (match.draft.stage !== "game" || !match.state) {
    sendError(client, "not-started", "아직 게임이 시작되지 않았습니다.");
    return;
  }
  if (match.state.phase === "gameover") {
    sendError(client, "game-over", "이미 끝난 경기입니다.");
    return;
  }
  applyTournamentAction(entry.tournament, match, seat, action as Action);
}

export function leaveTournament(client: SocketClient): void {
  const entry = activeTournamentFor(client);
  if (!entry) {
    sendError(client, "no-tournament", "대회에 참가하지 않았습니다.");
    return;
  }
  const { tournament, participantId } = entry;
  const participant = participantById(tournament, participantId);
  if (!participant) {
    clientIndex.delete(client.id);
    return;
  }
  clientIndex.delete(client.id);
  participant.client = null;
  participant.connected = false;
  participant.disconnectedAt = Date.now();

  if (tournament.phase === "lobby" || tournament.phase === "done") {
    tournament.participants = tournament.participants.filter((item) => item.id !== participantId);
    participant.token = "";
    rotateHost(tournament);
    if (tournament.participants.length === 0) {
      for (const match of tournament.matches) clearMatchTimers(match);
      tournaments.delete(tournament.code);
      return;
    }
    tournament.lastActivity = Date.now();
    broadcastTournament(tournament);
    return;
  }

  // 진행 중 이탈은 현재 경기 기권 + 이후 라운드 제외.
  participant.withdrawn = true;
  participant.token = "";
  const match = activeMatchFor(tournament, participantId);
  rotateHost(tournament);
  if (match) {
    const foeSeat = seatOf(match, participantId) === 0 ? 1 : 0;
    const foe = participantAt(tournament, match, foeSeat);
    finishMatch(
      tournament,
      match,
      foe?.id ?? (match.stage === "swiss" ? null : winnerOnBracketDraw(tournament, match)),
      "기권",
    );
  } else {
    tournament.lastActivity = Date.now();
    broadcastTournament(tournament);
    maybeAdvanceTournament(tournament);
  }
}

export function detachTournamentClient(clientId: string): void {
  const entry = clientIndex.get(clientId);
  if (!entry) return;
  clientIndex.delete(clientId);
  const { tournament, participantId } = entry;
  const participant = participantById(tournament, participantId);
  if (!participant || participant.client?.id !== clientId) return;
  participant.client = null;
  participant.connected = false;
  participant.disconnectedAt = Date.now();
  tournament.lastActivity = Date.now();
  const match = activeMatchFor(tournament, participantId);
  if (match) {
    refreshTurnTimer(tournament, match);
    broadcastMatchState(tournament, match);
  }
  broadcastTournament(tournament);
}

export function isInTournament(clientId: string): boolean {
  return clientIndex.has(clientId);
}

export function tournamentCount(): number {
  return tournaments.size;
}

export function sweepTournaments(now: number): void {
  for (const [code, tournament] of tournaments) {
    const idle = now - tournament.lastActivity;
    const allGone = tournament.participants.every((participant) => !participant.connected);
    if (
      idle > TOURNAMENT_IDLE_MS ||
      now - tournament.createdAt > TOURNAMENT_MAX_MS ||
      (allGone && idle > TOURNAMENT_ALL_GONE_MS)
    ) {
      for (const match of tournament.matches) clearMatchTimers(match);
      for (const participant of tournament.participants) {
        if (participant.client) {
          sendError(participant.client, "tournament-expired", "대회가 만료되었습니다.");
          try {
            participant.client.ws.close(4000, "tournament expired");
          } catch {
            // ignore
          }
          clientIndex.delete(participant.client.id);
        }
        participant.token = "";
      }
      tournaments.delete(code);
    }
  }
}
