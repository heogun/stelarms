// 토너먼트 공용 규칙.
//
// 서버와 클라이언트가 같은 스위스 페어링·순위·삼습일사 규칙을 쓰도록
// 순수 함수만 둔다. 네트워크/엔진 상태에 의존하지 않는다.

import { validateCustomDeck, type CustomDeckInput } from "../data/customDeck";
import { stellaById } from "../data/stellas";

export const TOURNAMENT_MIN_PLAYERS = 4;
export const TOURNAMENT_MAX_PLAYERS = 8;
export const TOURNAMENT_SWISS_ROUNDS = 3;
export const TOURNAMENT_MATCH_MS = 25 * 60_000;
export const TOURNAMENT_PREP_MS = 5 * 60_000;

export type TournamentStage = "swiss" | "semifinal" | "final";
export type TournamentPhase = "lobby" | "swiss" | "semifinal" | "final" | "done";
export type TournamentDraftStage = "pick" | "ban" | "deck" | "game" | "done";

/** 스위스 순위 계산에 필요한 최소 입력. */
export interface StandingInput {
  id: string;
  name: string;
  seed: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  opponents: string[];
  withdrawn: boolean;
}

export interface StandingEntry extends StandingInput {
  points: number;
  buchholz: number;
}

export interface SwissPairing {
  a: string;
  b: string | null;
}

function compareStanding(a: StandingEntry, b: StandingEntry): number {
  if (a.withdrawn !== b.withdrawn) return a.withdrawn ? 1 : -1;
  if (a.points !== b.points) return b.points - a.points;
  if (a.buchholz !== b.buchholz) return b.buchholz - a.buchholz;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.draws !== b.draws) return b.draws - a.draws;
  if (a.seed !== b.seed) return a.seed - b.seed;
  return a.name.localeCompare(b.name, "ko");
}

/**
 * 승 3점·무 1점·부전승 3점. 부흐홀츠는 상대들의 현재 점수 합이다.
 * 탈퇴자는 순위표 맨 아래로 보내고 4강 후보에서 제외한다.
 */
export function tournamentStandings(players: StandingInput[]): StandingEntry[] {
  const base = players.map((player) => ({
    ...player,
    opponents: [...new Set(player.opponents)],
    points: player.wins * 3 + player.draws + player.byes * 3,
    buchholz: 0,
  }));
  const pointsById = new Map(base.map((player) => [player.id, player.points]));
  for (const player of base) {
    player.buchholz = player.opponents.reduce(
      (sum, opponentId) => sum + (pointsById.get(opponentId) ?? 0),
      0,
    );
  }
  return base.sort(compareStanding);
}

/**
 * 현재 순위대로 인접 페어링하되, 이미 만난 상대는 가능한 한 피한다.
 * 홀수면 마지막 한 명이 부전승(b = null)이 된다.
 */
export function pairSwiss(players: StandingInput[]): SwissPairing[] {
  const remaining = tournamentStandings(players).filter((player) => !player.withdrawn);
  const pairs: SwissPairing[] = [];

  // 홀수면 아직 부전승을 받지 않은 최하위 참가자를 우선 부전승으로 보낸다.
  let bye: StandingEntry | null = null;
  if (remaining.length % 2 === 1) {
    bye =
      [...remaining].reverse().find((player) => player.byes === 0) ??
      remaining[remaining.length - 1] ??
      null;
    if (bye) remaining.splice(remaining.indexOf(bye), 1);
  }

  while (remaining.length > 0) {
    const a = remaining.shift();
    if (!a) break;
    let index = remaining.findIndex((candidate) => !a.opponents.includes(candidate.id));
    if (index < 0) index = 0;
    const [b] = remaining.splice(index, 1);
    pairs.push({ a: a.id, b: b?.id ?? null });
  }

  if (bye) pairs.push({ a: bye.id, b: null });
  return pairs;
}

/** 4강 시드 배치: 1-4, 2-3. */
export function semifinalPairs(players: StandingInput[]): [{ a: string; b: string }, { a: string; b: string }] | null {
  const active = tournamentStandings(players).filter((player) => !player.withdrawn);
  if (active.length < 4) return null;
  const [first, second, third, fourth] = active;
  return [
    { a: first.id, b: fourth.id },
    { a: second.id, b: third.id },
  ];
}

export type PickResult =
  | { ok: true; picks: string[] }
  | { ok: false; error: string };

/** 삼습일사 1단계: 서로 다른 스텔라 정확히 3명. */
export function validateTournamentPicks(value: unknown): PickResult {
  if (!Array.isArray(value) || value.length !== 3) {
    return { ok: false, error: "스텔라를 정확히 3명 골라야 합니다." };
  }
  if (!value.every((id): id is string => typeof id === "string")) {
    return { ok: false, error: "스텔라 ID가 올바르지 않습니다." };
  }
  if (new Set(value).size !== 3) {
    return { ok: false, error: "같은 스텔라를 두 번 고를 수 없습니다." };
  }
  for (const id of value) {
    if (!stellaById[id]) return { ok: false, error: `알 수 없는 스텔라입니다: ${id}` };
  }
  return { ok: true, picks: [...value] };
}

export type BanResult =
  | { ok: true; pair: [string, string] }
  | { ok: false; error: string };

/**
 * 삼습일사 2단계. `ban`은 상대의 3명 중 하나다.
 * 남은 두 명이 최종 스텔라 쌍이 된다.
 */
export function resolveTournamentPair(picks: string[], ban: string): BanResult {
  if (picks.length !== 3 || new Set(picks).size !== 3) {
    return { ok: false, error: "상대의 스텔라 선택이 올바르지 않습니다." };
  }
  if (!picks.includes(ban)) {
    return { ok: false, error: "상대가 고른 3명 중 하나를 제외해야 합니다." };
  }
  const pair = picks.filter((id) => id !== ban);
  if (pair.length !== 2) {
    return { ok: false, error: "최종 스텔라 2명을 정할 수 없습니다." };
  }
  return { ok: true, pair: [pair[0], pair[1]] };
}

export type TournamentDeckResult =
  | { ok: true; deck: CustomDeckInput }
  | { ok: false; error: string };

/** 최종 2명으로 만든 7+3 덱인지 확인한다. 스텔라 순서는 자유. */
export function validateTournamentDeck(value: unknown, pair: [string, string]): TournamentDeckResult {
  const result = validateCustomDeck(value);
  if (!result.ok) return result;
  const chosen = new Set([result.deck.mainId, result.deck.partnerId]);
  if (chosen.size !== 2 || !chosen.has(pair[0]) || !chosen.has(pair[1])) {
    return { ok: false, error: "남은 스텔라 2명으로만 덱을 구성할 수 있습니다." };
  }
  return result;
}

/** 한 참가자의 현재 라운드 표시용 이름. */
export function stageLabel(stage: TournamentStage, round: number): string {
  if (stage === "swiss") return `스위스 ${round}라운드`;
  if (stage === "semifinal") return "4강";
  return "결승";
}
