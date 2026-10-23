// 토너먼트 허브: 참가자 로비, 삼습일사 드래프트, 순위표·브래킷.

import { useMemo, useState } from "react";
import {
  cardsByStella,
  decks,
  stellaById,
  stellas,
  type Card,
} from "../../data";
import {
  CUSTOM_DECK_NAME_MAX,
  type CustomDeckInput,
} from "../../data/customDeck";
import type {
  TournamentSelfMatchView,
  TournamentView,
} from "../../net/protocol";
import type { Online } from "../../net/useOnline";
import {
  TOURNAMENT_MAX_PLAYERS,
  TOURNAMENT_MATCH_MS,
  TOURNAMENT_MIN_PLAYERS,
  TOURNAMENT_PREP_MS,
  TOURNAMENT_SWISS_ROUNDS,
  validateTournamentDeck,
} from "../../net/tournament";
import { CardView } from "../CardView";
import { readCustomDraft } from "./deckStorage";
import { useCountdown } from "./viewUtils";

const PHASE_LABEL: Record<TournamentView["phase"], string> = {
  lobby: "참가 접수",
  swiss: "스위스",
  semifinal: "4강",
  final: "결승",
  done: "종료",
};

function stellaName(id: string): string {
  return stellaById[id]?.name ?? id;
}

function samePair(a: string, b: string, pair: [string, string]): boolean {
  return new Set([a, b]).size === 2 && new Set([a, b, pair[0], pair[1]]).size === 2;
}

function clock(seconds: number | null): string {
  if (seconds === null) return "—";
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function PairLabel({ pair }: { pair: [string, string] | null }) {
  if (!pair) return <span className="muted">미정</span>;
  return (
    <span>
      {stellaName(pair[0])} <span className="muted">+</span> {stellaName(pair[1])}
    </span>
  );
}

function copyCode(code: string): void {
  void navigator.clipboard?.writeText(code);
}

export function TournamentHub({
  online,
  tournament,
}: {
  online: Online;
  tournament: TournamentView;
}) {
  const self = tournament.players.find((player) => player.id === tournament.selfId);
  const isHost = tournament.hostId === tournament.selfId;
  const [copied, setCopied] = useState(false);
  const connectedCount = tournament.players.filter((player) => player.connected).length;
  const canStart =
    isHost &&
    tournament.players.length >= TOURNAMENT_MIN_PLAYERS &&
    tournament.players.length <= TOURNAMENT_MAX_PLAYERS &&
    connectedCount === tournament.players.length;

  const leave = () => {
    if (tournament.phase !== "lobby" && tournament.phase !== "done") {
      const ok = window.confirm(
        "대회에서 나가면 현재 경기가 기권 처리되고 이후 라운드에서 제외됩니다. 나갈까요?",
      );
      if (!ok) return;
    }
    online.leave();
  };

  const copy = () => {
    copyCode(tournament.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="tournament">
      <header className="tournament__head">
        <div>
          <p className="room__eyebrow">토너먼트 코드</p>
          <div className="room__code">
            <strong>{tournament.code}</strong>
            <button type="button" className="btn btn--tiny" onClick={copy}>
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
          <p className="tournament__phase">
            {PHASE_LABEL[tournament.phase]}
            {tournament.phase === "swiss" && ` · ${tournament.round}/${TOURNAMENT_SWISS_ROUNDS}라운드`}
            {tournament.phase === "done" && tournament.championName
              ? ` · 우승 ${tournament.championName}`
              : ""}
          </p>
        </div>
        <div className="tournament__head-right">
          <span className="room__status">
            <span className={`dot ${online.connected ? "dot--on" : "dot--off"}`} />
            {online.connected ? "연결됨" : "재접속 중…"}
          </span>
          <span className="tournament__self">
            {self?.name ?? "참가자"} · {self?.points ?? 0}점
          </span>
          <button type="button" className="btn btn--tiny" onClick={leave}>
            {tournament.phase === "lobby" || tournament.phase === "done" ? "나가기" : "기권"}
          </button>
        </div>
      </header>

      {online.error && (
        <p className="play__error" role="alert">
          {online.error.message}
          <button type="button" onClick={online.clearError}>
            닫기
          </button>
        </p>
      )}

      {tournament.phase === "lobby" ? (
        <TournamentLobby
          tournament={tournament}
          isHost={isHost}
          canStart={canStart}
          connectedCount={connectedCount}
          start={online.startTournament}
        />
      ) : (
        <>
          {tournament.phase === "done" && (
            <section className="tournament__champion">
              <p className="room__eyebrow">CHAMPION</p>
              <h2>{tournament.championName ?? "우승자 없음"}</h2>
              <p className="muted">3라운드 스위스 · 4강 · 결승 종료</p>
            </section>
          )}

          {tournament.selfMatch && <DraftPanel online={online} match={tournament.selfMatch} />}

          {!tournament.selfMatch && tournament.phase !== "done" && (
            <section className="tournament__waiting">
              <h3>다른 경기 결과를 기다리는 중</h3>
              <p className="muted">
                현재 라운드가 끝나면 다음 대진이 자동으로 만들어집니다. 브래킷과 순위표는
                실시간으로 갱신됩니다.
              </p>
            </section>
          )}

          <TournamentBracket tournament={tournament} />
        </>
      )}
    </div>
  );
}

function TournamentLobby({
  tournament,
  isHost,
  canStart,
  connectedCount,
  start,
}: {
  tournament: TournamentView;
  isHost: boolean;
  canStart: boolean;
  connectedCount: number;
  start: () => void;
}) {
  const empty = Math.max(0, TOURNAMENT_MAX_PLAYERS - tournament.players.length);
  return (
    <>
      <section className="tournament__rules">
        <h3>대회 진행</h3>
        <ol>
          <li>
            <b>{TOURNAMENT_MIN_PLAYERS}~{TOURNAMENT_MAX_PLAYERS}명</b>이 모이면 대회장이 시작합니다.
          </li>
          <li>
            <b>3라운드 스위스</b> 후 상위 4명이 <b>4강 → 결승</b>을 치릅니다. 승 3점·무 1점.
          </li>
          <li>
            매 경기 전 <b>삼습일사</b>: 스텔라 3명 선택 → 상대가 1명 밴 → 남은 2명으로 7+3 덱.
          </li>
          <li>
            준비 제한 {TOURNAMENT_PREP_MS / 60_000}분, 경기 제한{" "}
            {TOURNAMENT_MATCH_MS / 60_000}분. 시간 초과 시 라이프가 높은 쪽이 승리합니다.
          </li>
        </ol>
      </section>

      <section className="tournament__players">
        <header className="tournament__section-head">
          <h3>참가자 {tournament.players.length}/{TOURNAMENT_MAX_PLAYERS}</h3>
          <span className="muted">{connectedCount}명 연결</span>
        </header>
        <div className="tournament__player-grid">
          {tournament.players.map((player, index) => (
            <div
              key={player.id}
              className={`tournament-player ${player.id === tournament.selfId ? "tournament-player--self" : ""} ${player.withdrawn ? "tournament-player--out" : ""}`}
            >
              <span className="tournament-player__seed">{index + 1}</span>
              <span className="tournament-player__name">{player.name}</span>
              {player.host && <span className="badge">대회장</span>}
              {player.id === tournament.selfId && <span className="badge badge--me">나</span>}
              <span className={`dot ${player.connected ? "dot--on" : "dot--off"}`} />
            </div>
          ))}
          {Array.from({ length: empty }, (_, index) => (
            <div key={`empty-${index}`} className="tournament-player tournament-player--empty">
              <span className="tournament-player__seed">-</span>
              <span className="tournament-player__name">대기 중</span>
            </div>
          ))}
        </div>
      </section>

      <section className="tournament__start">
        {isHost ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canStart}
              onClick={start}
            >
              {tournament.players.length < TOURNAMENT_MIN_PLAYERS
                ? `참가자 ${TOURNAMENT_MIN_PLAYERS}명 이상 필요`
                : connectedCount < tournament.players.length
                  ? "모든 참가자 연결 대기"
                  : "대회 시작"}
            </button>
            <p className="muted">
              시작하면 3라운드 스위스 대진이 자동으로 만들어집니다. 시작 후에는 참가할 수
              없습니다.
            </p>
          </>
        ) : (
          <p className="room__wait">
            대회장이 시작하기를 기다리는 중… ({tournament.players.length}/
            {TOURNAMENT_MAX_PLAYERS})
          </p>
        )}
      </section>
    </>
  );
}

function DraftPanel({ online, match }: { online: Online; match: TournamentSelfMatchView }) {
  const prep = useCountdown(match.prepDeadline);
  const game = useCountdown(match.gameDeadline);
  return (
    <section className="draft">
      <header className="draft__head">
        <div>
          <p className="room__eyebrow">{match.label} · 삼습일사</p>
          <h3>
            vs {match.opponent?.name ?? "상대"}
            {match.opponent && !match.opponent.connected && (
              <span className="muted"> (연결 끊김)</span>
            )}
          </h3>
        </div>
        <div className="draft__clock">
          {match.status === "game" ? (
            <>
              <span>경기 제한</span>
              <b>{clock(game)}</b>
            </>
          ) : (
            <>
              <span>준비 제한</span>
              <b>{clock(prep)}</b>
            </>
          )}
        </div>
      </header>

      {match.status === "pick" && <PickStep online={online} match={match} />}
      {match.status === "ban" && <BanStep online={online} match={match} />}
      {match.status === "deck" && <DeckStep online={online} match={match} />}
      {match.status === "done" && (
        <p className="draft__result">
          결과: {match.result?.reason ?? "종료"}
          {match.result?.winnerId === null ? " · 무승부" : ""}
        </p>
      )}
    </section>
  );
}

function PickStep({ online, match }: { online: Online; match: TournamentSelfMatchView }) {
  const submitted = match.picks.own;
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="draft__body">
      <div className="draft__step">
        <b>1. 스텔라 3명 선택</b>
        <span className="muted">
          {submitted ? "제출 완료 · 상대 선택 대기" : `${selected.length}/3 선택`}
        </span>
      </div>
      {submitted ? (
        <div className="draft__pair-list">
          {submitted.map((id) => (
            <span key={id} className="draft__stella draft__stella--locked">
              {stellaName(id)}
            </span>
          ))}
        </div>
      ) : (
        <>
          <div className="draft__stella-grid">
            {stellas.map((stella) => {
              const on = selected.includes(stella.id);
              return (
                <button
                  key={stella.id}
                  type="button"
                  className={`draft__stella ${on ? "draft__stella--on" : ""}`}
                  style={{ ["--stella-color" as string]: stella.color }}
                  onClick={() =>
                    setSelected((prev) =>
                      on
                        ? prev.filter((id) => id !== stella.id)
                        : prev.length >= 3
                          ? prev
                          : [...prev, stella.id],
                    )
                  }
                >
                  <strong>{stella.name}</strong>
                  <span>{stella.mainRange} · {stella.signature}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selected.length !== 3}
            onClick={() => online.pickStellas(selected)}
          >
            스텔라 3명 제출
          </button>
        </>
      )}
      {!submitted && match.picks.foe && (
        <p className="muted">상대가 먼저 제출했습니다. 상대 선택은 밴 단계에서 공개됩니다.</p>
      )}
    </div>
  );
}

function BanStep({ online, match }: { online: Online; match: TournamentSelfMatchView }) {
  const submitted = match.bans.own;
  const foe = match.picks.foe;
  return (
    <div className="draft__body">
      <div className="draft__step">
        <b>2. 상대의 3명 중 1명 밴</b>
        <span className="muted">{submitted ? "제출 완료" : "밴할 스텔라를 고르세요"}</span>
      </div>
      <div className="draft__own-picks">
        <span className="muted">내 선택</span>
        <div className="draft__pair-list">
          {match.picks.own?.map((id) => (
            <span key={id} className="draft__stella draft__stella--locked">
              {stellaName(id)}
            </span>
          ))}
        </div>
      </div>
      {submitted ? (
        <p className="muted">
          {stellaName(submitted)} 밴 제출 완료. 상대 밴과 최종 조합을 기다리는 중…
        </p>
      ) : (
        <div className="draft__ban-grid">
          {foe?.map((id) => (
            <button
              key={id}
              type="button"
              className="draft__stella draft__stella--ban"
              onClick={() => online.banStella(id)}
            >
              <strong>{stellaName(id)}</strong>
              <span>이 스텔라 밴</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeckStep({ online, match }: { online: Online; match: TournamentSelfMatchView }) {
  if (match.decks.own) {
    return (
      <div className="draft__body">
        <div className="draft__step">
          <b>3. 7+3 덱 제출 완료</b>
          <span className="muted">{match.decks.foeReady ? "곧 경기가 시작됩니다." : "상대 덱 대기"}</span>
        </div>
        <p>
          내 최종 조합: <PairLabel pair={match.pairs.own} />
        </p>
        <p className="muted">상대 최종 조합: <PairLabel pair={match.pairs.foe} /></p>
      </div>
    );
  }
  const pair = match.pairs.own;
  if (!pair) return <p className="muted">최종 조합을 계산하는 중…</p>;
  return (
    <div className="draft__body">
      <div className="draft__step">
        <b>3. 남은 2명으로 7+3 덱 구성</b>
        <span className="muted">상대 조합: <PairLabel pair={match.pairs.foe} /></span>
      </div>
      <TournamentDeckEditor pair={pair} submit={online.submitTournamentDeck} />
    </div>
  );
}

function TournamentDeckEditor({
  pair,
  submit,
}: {
  pair: [string, string];
  submit: (deck: CustomDeckInput) => void;
}) {
  const initial = useMemo(() => {
    const draft = readCustomDraft();
    if (!draft || !samePair(draft.mainId, draft.partnerId, pair)) return null;
    return draft;
  }, [pair]);
  const [name, setName] = useState(initial?.name ?? "대회 덱");
  const [normals, setNormals] = useState<string[]>(initial?.normals ?? []);
  const [specials, setSpecials] = useState<string[]>(initial?.specials ?? []);
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const cards: Card[] = [];
    for (const id of pair) {
      for (const card of cardsByStella(id)) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        cards.push(card);
      }
    }
    return cards;
  }, [pair]);
  const selected = new Set([...normals, ...specials]);
  const validation = validateTournamentDeck(
    { name, mainId: pair[0], partnerId: pair[1], normals, specials },
    pair,
  );
  const matchingPresets = decks.filter(
    (deck) => samePair(deck.mainId, deck.partnerId, pair),
  );

  const toggle = (card: Card) => {
    const list = card.kind === "normal" ? normals : specials;
    const setList = card.kind === "normal" ? setNormals : setSpecials;
    const limit = card.kind === "normal" ? 7 : 3;
    if (list.includes(card.id)) {
      setList(list.filter((id) => id !== card.id));
    } else if (list.length < limit) {
      setList([...list, card.id]);
    }
  };

  const load = (deck: (typeof decks)[number]) => {
    setName(deck.name);
    setNormals([...deck.normals]);
    setSpecials([...deck.specials]);
  };

  return (
    <div className="tournament-deck">
      <div className="tournament-deck__bar">
        <label className="field">
          <span>덱 이름</span>
          <input
            value={name}
            maxLength={CUSTOM_DECK_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="tournament-deck__counts">
          <span className={normals.length === 7 ? "ok" : "bad"}>통상 {normals.length}/7</span>
          <span className={specials.length === 3 ? "ok" : "bad"}>비장 {specials.length}/3</span>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!validation.ok}
          onClick={() => validation.ok && submit(validation.deck)}
        >
          덱 제출
        </button>
      </div>
      {matchingPresets.length > 0 && (
        <div className="tournament-deck__presets">
          <span className="muted">이 조합의 추천 덱:</span>
          {matchingPresets.map((deck) => (
            <button key={deck.id} type="button" className="deck-chip" onClick={() => load(deck)}>
              {deck.name}
            </button>
          ))}
        </div>
      )}
      {!validation.ok && <p className="warn">{validation.error}</p>}
      <details className="tournament-deck__pool" open>
        <summary>카드 풀 · {stellaName(pair[0])} + {stellaName(pair[1])}</summary>
        <div className="card-grid">
          {pool.map((card) => (
            <div key={card.id} className="builder__slot">
              <CardView card={card} selected={selected.has(card.id)} onClick={() => toggle(card)} />
            </div>
          ))}
        </div>
      </details>
      <div className="tournament-deck__lists">
        <div>
          <b>통상패</b>
          <ul>
            {normals.map((id) => (
              <li key={id}>{pool.find((card) => card.id === id)?.name ?? id}</li>
            ))}
          </ul>
        </div>
        <div>
          <b>비장패</b>
          <ul>
            {specials.map((id) => (
              <li key={id}>{pool.find((card) => card.id === id)?.name ?? id}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TournamentBracket({ tournament }: { tournament: TournamentView }) {
  const swiss = tournament.matches.filter((match) => match.stage === "swiss");
  const semifinals = tournament.matches.filter((match) => match.stage === "semifinal");
  const final = tournament.matches.find((match) => match.stage === "final");
  return (
    <div className="bracket-layout">
      <section className="standings">
        <header className="tournament__section-head">
          <h3>순위표</h3>
          <span className="muted">승 3 · 무 1 · 부전승 3</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>참가자</th>
              <th>전적</th>
              <th>승점</th>
              <th>부흐</th>
            </tr>
          </thead>
          <tbody>
            {tournament.standings.map((player, index) => (
              <tr
                key={player.id}
                className={`${index < 4 ? "standings__cut" : ""} ${player.id === tournament.selfId ? "standings__self" : ""} ${player.withdrawn ? "standings__out" : ""}`}
              >
                <td>{index + 1}</td>
                <td>
                  {player.name}
                  {player.host && <span className="badge">대회장</span>}
                  {player.withdrawn && <span className="muted"> 기권</span>}
                </td>
                <td>
                  {player.wins}-{player.losses}-{player.draws}
                </td>
                <td>{player.points}</td>
                <td>{player.buchholz}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted standings__note">상위 4명이 4강에 진출합니다.</p>
      </section>

      <section className="bracket">
        <header className="tournament__section-head">
          <h3>브래킷</h3>
          <span className="muted">3라운드 스위스 → 4강 → 결승</span>
        </header>
        {[1, 2, 3].map((round) => {
          const matches = swiss.filter((match) => match.round === round);
          return (
            <div key={round} className="bracket__round">
              <h4>스위스 {round}라운드</h4>
              {matches.length === 0 ? (
                <p className="muted">대기</p>
              ) : (
                matches.map((match) => <MatchRow key={match.id} match={match} tournament={tournament} />)
              )}
            </div>
          );
        })}
        {(semifinals.length > 0 || tournament.phase === "semifinal") && (
          <div className="bracket__round">
            <h4>4강</h4>
            {semifinals.length === 0 ? (
              <p className="muted">대기</p>
            ) : (
              semifinals.map((match) => (
                <MatchRow key={match.id} match={match} tournament={tournament} />
              ))
            )}
          </div>
        )}
        {(final || tournament.phase === "final" || tournament.phase === "done") && (
          <div className="bracket__round bracket__round--final">
            <h4>결승</h4>
            {final ? (
              <MatchRow match={final} tournament={tournament} />
            ) : (
              <p className="muted">대기</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function MatchRow({
  match,
  tournament,
}: {
  match: TournamentView["matches"][number];
  tournament: TournamentView;
}) {
  const a = match.seats[0];
  const b = match.seats[1];
  const status =
    match.status === "done"
      ? match.bye
        ? "부전승"
        : match.winnerName
          ? `승자 ${match.winnerName}`
          : "무승부"
      : match.status === "playing"
        ? "경기 중"
        : "삼습일사";
  return (
    <div className={`bracket-match ${match.status === "playing" ? "bracket-match--live" : ""}`}>
      <span className={match.winnerId && a?.id === match.winnerId ? "bracket-match--win" : ""}>
        {a?.name ?? "—"}
      </span>
      <span className="bracket-match__vs">vs</span>
      <span className={match.winnerId && b?.id === match.winnerId ? "bracket-match--win" : ""}>
        {b?.name ?? "부전승"}
      </span>
      <span className="bracket-match__status">
        {status}
        {match.bye ? "" : match.resultReason ? ` · ${match.resultReason}` : ""}
      </span>
      {match.id && tournament.selfMatch?.id === match.id && (
        <span className="badge badge--me">내 경기</span>
      )}
    </div>
  );
}
