// 대전 보드.
//
// 모든 판정은 서버가 한다. 여기서는 뷰를 그리고, 플레이어의 의도를
// 액션으로 만들어 보낼 뿐이다. 불가능해 보이는 버튼은 미리 비활성화하지만
// 최종 검증은 항상 서버의 `applyAction`이 담당한다.

import { useMemo, useState } from "react";
import type { Action, BasicAction, PendingView, PlayerView } from "../../engine";
import { getCard, getProgram } from "../../engine";
import type { Card } from "../../data";
import type { Online } from "../../net/useOnline";
import { AttackSummary, PlayerPanel, SmallCard } from "./shared";
import { cardName, useAutoScroll, useCountdown } from "./viewUtils";

type MyPending = Exclude<PendingView, { waiting: true }>;

function isWaiting(pending: PendingView | null): pending is Extract<PendingView, { waiting: true }> {
  return Boolean(pending && "waiting" in pending && pending.waiting);
}

const WAITING_LABEL: Record<string, string> = {
  mulligan: "상대가 멀리건을 고르는 중…",
  startPhase: "상대가 개시 페이즈를 준비하는 중…",
  response: "상대가 대응 카드를 고르는 중…",
  defend: "상대가 방어를 고르는 중…",
  choice: "상대가 선택하는 중…",
  order: "상대가 패산을 정리하는 중…",
  discardDown: "상대가 손패를 정리하는 중…",
  penalty: "상대가 페널티를 처리하는 중…",
};

const PHASE_LABEL: Record<string, string> = {
  setup: "준비",
  main: "메인",
  gameover: "종료",
};

function basicLabel(kind: BasicAction): string {
  switch (kind) {
    case "advance":
      return "전진";
    case "retreat":
      return "후퇴";
    case "coil":
      return "휘감기";
    case "gather":
      return "품기";
    case "breakaway":
      return "이탈";
  }
}

function basicHint(kind: BasicAction): string {
  switch (kind) {
    case "advance":
      return "거리 -1, 오라 +1";
    case "retreat":
      return "오라 -1, 거리 +1";
    case "coil":
      return "더스트 -1, 오라 +1";
    case "gather":
      return "오라 -1, 플레어 +1";
    case "breakaway":
      return "거리 2 이하: 더스트 -1, 거리 +1";
  }
}

function rangeOf(card: Card): [number, number] | null {
  if (card.range === undefined) return null;
  return Array.isArray(card.range) ? card.range : [card.range, card.range];
}

export function Game({ online, view }: { online: Online; view: PlayerView }) {
  const you = view.you;
  const foe = view.foe;
  const pending = view.pending;
  const mine = pending && !isWaiting(pending) ? (pending as MyPending) : null;
  const waiting = isWaiting(pending) ? pending : null;
  const isMyTurn = view.turn === view.seat;
  const actorSeat = pending ? pending.player : view.turn;
  const foeSeat = view.seat === 0 ? 1 : 0;
  const foeInfo = online.seats[foeSeat];
  const foeConnected = foeInfo ? foeInfo.connected : true;
  const seconds = useCountdown(online.deadline);
  const logRef = useAutoScroll<HTMLDivElement>(view.log.length);

  // pending이 바뀌면 이전 선택을 자동으로 무시한다. key가 다르면 파생값이 비어 있다.
  const pendingKey = pending
    ? `${pending.kind}:${pending.player}:${"attack" in pending ? pending.attack.uid : ""}:${
        "prompt" in pending ? pending.prompt : ""
      }:${"uids" in pending ? pending.uids.join(",") : ""}`
    : "";

  const [selected, setSelected] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<"focus" | "hand">("focus");
  const [mulliganPick, setMulliganPick] = useState<{ key: string; uids: string[] }>({
    key: "",
    uids: [],
  });
  const [discardPickState, setDiscardPickState] = useState<{ key: string; uids: string[] }>({
    key: "",
    uids: [],
  });
  const [orderPick, setOrderPick] = useState<{ key: string; uids: string[] }>({ key: "", uids: [] });
  const [recomposePick, setRecomposePick] = useState<{ key: string; value: boolean }>({
    key: "",
    value: false,
  });

  const activePay = you.focus > 0 ? payMode : "hand";
  const mulligan = mulliganPick.key === pendingKey ? mulliganPick.uids : [];
  const discardPick = discardPickState.key === pendingKey ? discardPickState.uids : [];
  const orderUids =
    orderPick.key === pendingKey
      ? orderPick.uids
      : mine?.kind === "order"
        ? mine.uids
        : [];
  const recompose = recomposePick.key === pendingKey ? recomposePick.value : false;
  const setRecompose = (value: boolean) => setRecomposePick({ key: pendingKey, value });

  const selectedSpecial = you.specials.find((s) => s.uid === selected) ?? null;
  const selectedEntry = you.hand.find((c) => c.uid === selected) ?? selectedSpecial;
  const selectedCard = selectedEntry ? getCard(selectedEntry.cardId) : null;
  const selectedUsed = selectedSpecial?.used ?? false;
  const selectedIsHand = you.hand.some((c) => c.uid === selected);

  const payment =
    activePay === "focus"
      ? { pay: "focus" as const }
      : selectedIsHand && selected
        ? { pay: "hand" as const, handUid: selected }
        : null;

  const pickMode: "mulligan" | "discard" | null =
    mine?.kind === "mulligan" ? "mulligan" : mine?.kind === "discardDown" ? "discard" : null;

  const discardNeed = mine?.kind === "discardDown" ? Math.max(0, you.hand.length - mine.to) : 0;

  const responseCards = useMemo(() => {
    if (mine?.kind !== "response") return [];
    const all = [
      ...you.hand.map((c) => ({ ...c, special: false })),
      ...you.specials.filter((s) => !s.used).map((s) => ({ ...s, special: true })),
    ];
    return all
      .filter((c) => Boolean(getProgram(c.cardId)?.onResponse))
      .map((c) => ({ ...c, card: getCard(c.cardId) }));
  }, [mine?.kind, you.hand, you.specials]);

  function rangeHint(card: Card): { text: string; ok: boolean } | null {
    const base = rangeOf(card);
    if (!base) return null;
    let expand = 0;
    for (const buff of you.buffs) {
      if (buff.charges <= 0) continue;
      if (buff.minAttacks && you.flags.attacks + 1 < buff.minAttacks) continue;
      if (buff.onlyStellaId && buff.onlyStellaId !== card.stellaId) continue;
      if (buff.notStellaId && buff.notStellaId === card.stellaId) continue;
      expand += buff.rangeExpand ?? 0;
    }
    const lo = Math.max(0, base[0] - expand);
    const hi = Math.min(view.config.distanceMax, base[1] + expand);
    return {
      text: `적정거리 ${lo}–${hi} (현재 ${view.distance})`,
      ok: view.distance >= lo && view.distance <= hi,
    };
  }

  function playBlocker(entry: { cardId: string; used?: boolean }): string | null {
    if (mine) return "먼저 현재 선택을 완료하세요.";
    if (view.phase === "gameover") return "대전이 끝났습니다.";
    if (!isMyTurn) return "내 턴이 아닙니다.";
    if (entry.used) return "이미 사용한 비장패입니다.";
    if (you.flags.mode === "power" && you.flags.powerUsed) {
      return "전력 행동은 카드 1장만 사용합니다.";
    }
    const card = getCard(entry.cardId);
    if (!card) return "알 수 없는 카드입니다.";
    const isPower = (card.keywords ?? []).includes("전력");
    if (isPower && you.flags.mode !== "power") return "【전력】 카드는 전력 행동에서만 사용합니다.";
    if (card.kind === "special" && (card.cost ?? 0) > you.flare) return "플레어가 부족합니다.";
    if (card.type === "attach" && (card.offering ?? 0) > you.aura + you.dust) {
      return "봉납할 크리스탈이 부족합니다.";
    }
    if (card.type === "attack") {
      const range = rangeHint(card);
      if (range && !range.ok) return range.text;
    }
    return null;
  }

  function basicBlocker(kind: BasicAction): string | null {
    if (mine) return "먼저 현재 선택을 완료하세요.";
    if (view.phase !== "main") return "메인 페이즈가 아닙니다.";
    if (!isMyTurn) return "내 턴이 아닙니다.";
    const flags = you.flags;
    if (flags.mode === "power") return "전력 행동에서는 기본동작을 할 수 없습니다.";
    if (flags.basicsUsed >= flags.basicLimit) return "기본동작 횟수를 모두 사용했습니다.";
    if (you.restrictions.some((r) => r.kind === "basic")) return "기본동작이 봉쇄되어 있습니다.";
    if (kind === "advance" && you.restrictions.some((r) => r.kind === "advance")) {
      return "이번 턴 전진할 수 없습니다.";
    }
    if (kind === "retreat" && you.restrictions.some((r) => r.kind === "retreat")) {
      return "이번 턴 후퇴할 수 없습니다.";
    }
    if (kind === "advance") {
      if (view.distance <= 2) return "거리 2 이하에서는 전진할 수 없습니다.";
      if (you.aura >= view.config.auraMax) return "오라가 가득 찼습니다.";
    }
    if (kind === "retreat") {
      if (you.aura <= 0) return "오라가 없습니다.";
      if (view.distance >= view.config.distanceMax) return "거리가 이미 최대입니다.";
    }
    if (kind === "coil") {
      if (you.aura >= view.config.auraMax) return "오라가 가득 찼습니다.";
      if (you.dust < 1) return "더스트가 없습니다.";
    }
    if (kind === "gather" && you.aura <= 0) return "오라가 없습니다.";
    if (kind === "breakaway") {
      if (view.distance > 2) return "거리 2 이하에서만 이탈할 수 있습니다.";
      if (view.distance >= view.config.distanceMax) return "거리가 이미 최대입니다.";
      if (you.dust < 1) return "더스트가 없습니다.";
    }
    if (!payment) {
      return activePay === "focus" ? "집중력이 없습니다." : "코스트로 쓸 손패를 선택하세요.";
    }
    return null;
  }

  const runBasic = (kind: BasicAction) => {
    if (basicBlocker(kind) || !payment) return;
    const action: Action =
      payment.pay === "focus"
        ? { type: "basic", action: kind, pay: "focus" }
        : { type: "basic", action: kind, pay: "hand", handUid: payment.handUid };
    online.act(action);
    if (payment.pay === "hand") setSelected(null);
  };

  const playSelected = () => {
    if (!selectedEntry) return;
    if (playBlocker({ cardId: selectedEntry.cardId, used: selectedUsed })) return;
    online.act({ type: "playCard", uid: selectedEntry.uid });
    setSelected(null);
  };

  const toggleMulligan = (uid: string) => {
    setMulliganPick((prev) => {
      const base = prev.key === pendingKey ? prev.uids : [];
      const uids = base.includes(uid) ? base.filter((x) => x !== uid) : [...base, uid];
      return { key: pendingKey, uids };
    });
  };

  const toggleDiscard = (uid: string) => {
    setDiscardPickState((prev) => {
      const base = prev.key === pendingKey ? prev.uids : [];
      if (base.includes(uid)) return { key: pendingKey, uids: base.filter((x) => x !== uid) };
      if (base.length >= discardNeed) return prev;
      return { key: pendingKey, uids: [...base, uid] };
    });
  };

  const onHandClick = (uid: string) => {
    if (pickMode === "mulligan") toggleMulligan(uid);
    else if (pickMode === "discard") toggleDiscard(uid);
    else setSelected((prev) => (prev === uid ? null : uid));
  };

  const orderActive = mine?.kind === "order" ? orderUids : [];
  const orderCards = orderActive.map((uid) => {
    const revealed = mine?.kind === "order" ? mine.reveal?.find((r) => r.uid === uid) : undefined;
    return { uid, cardId: revealed?.cardId ?? uid.split("-").slice(1).join("-") };
  });

  const moveOrder = (index: number, delta: number) => {
    setOrderPick((prev) => {
      const base =
        prev.key === pendingKey
          ? prev.uids
          : mine?.kind === "order"
            ? mine.uids
            : [];
      const next = [...base];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { key: pendingKey, uids: next };
    });
  };

  const selectedBlocker = selectedEntry
    ? playBlocker({ cardId: selectedEntry.cardId, used: selectedUsed })
    : null;

  const foeDeck = online.seats[foeSeat]?.deckId;
  const myDeck = online.seats[view.seat]?.deckId;
  void foeDeck;
  void myDeck;

  const leave = () => {
    if (view.phase !== "gameover") {
      const ok = window.confirm("대전에서 나가면 기권 처리됩니다. 나갈까요?");
      if (!ok) return;
    }
    online.leave();
  };

  const turnLabel = isMyTurn ? "내 턴" : "상대 턴";
  const timerLabel =
    seconds !== null
      ? `${seconds}초`
      : !online.connected
        ? "재접속 중"
        : !foeConnected
          ? "상대 연결 대기"
          : "—";

  return (
    <div className="game">
      <header className="game__bar">
        <div className="game__meta">
          <span className="game__room">방 {online.room?.roomCode ?? "—"}</span>
          <span className="game__round">{view.round}라운드</span>
          <span className="game__phase">{PHASE_LABEL[view.phase] ?? view.phase}</span>
        </div>
        <div className={`game__turn ${isMyTurn ? "game__turn--mine" : ""}`}>
          <span>{turnLabel}</span>
          <span className="game__timer" title="현재 행동자 제한 시간">
            {timerLabel}
          </span>
        </div>
        <div className="game__distance">
          <span>거리</span>
          <b>{view.distance}</b>
          <span className="muted">/ {view.config.distanceMax}</span>
        </div>
        <button type="button" className="btn btn--tiny" onClick={leave}>
          나가기
        </button>
      </header>

      <div className="game__body">
        <div className="game__board">
          <PlayerPanel
            p={foe}
            side="foe"
            active={actorSeat === foeSeat}
            connected={foeConnected}
          />

          <div className="arena">
            <div className="arena__line" />
            <span className="arena__badge">
              {actorSeat === view.seat ? "내가 행동" : `${foe.name} 행동`}
            </span>
            <div className="arena__line" />
          </div>

          <PlayerPanel p={you} side="you" active={actorSeat === view.seat} connected />

          <div className="hand">
            <header className="hand__head">
              <h4>내 손패</h4>
              <span>
                {you.hand.length}장 · 패산 {you.deckCount} · 덮음 {you.coverCount}
              </span>
              {pickMode === "mulligan" && <span className="hint">바꿀 카드 {mulligan.length}장</span>}
              {pickMode === "discard" && (
                <span className="hint">
                  버릴 카드 {discardPick.length}/{discardNeed}장
                </span>
              )}
            </header>
            <div className="hand__scroll">
              {you.hand.map((entry) => {
                const picked =
                  pickMode === "mulligan"
                    ? mulligan.includes(entry.uid)
                    : pickMode === "discard"
                      ? discardPick.includes(entry.uid)
                      : false;
                const isResponse =
                  mine?.kind === "response" &&
                  Boolean(getProgram(entry.cardId)?.onResponse);
                return (
                  <div
                    key={entry.uid}
                    className={`hand__slot ${picked ? "hand__slot--picked" : ""} ${
                      isResponse ? "hand__slot--response" : ""
                    } ${selected === entry.uid ? "hand__slot--selected" : ""}`}
                  >
                    <SmallCard
                      cardId={entry.cardId}
                      selected={selected === entry.uid}
                      onClick={() => onHandClick(entry.uid)}
                    />
                    {picked && <span className="hand__check">✓</span>}
                    {isResponse && <span className="hand__tag">대응</span>}
                  </div>
                );
              })}
              {you.hand.length === 0 && <p className="muted">손패가 없습니다.</p>}
            </div>

            {you.specials.length > 0 && (
              <div className="special-row">
                <span className="special-row__label">비장패</span>
                {you.specials.map((entry) => (
                  <div
                    key={entry.uid}
                    className={`special-row__slot ${selected === entry.uid ? "selected" : ""}`}
                  >
                    <SmallCard
                      cardId={entry.cardId}
                      width={100}
                      used={entry.used}
                      selected={selected === entry.uid}
                      onClick={() => {
                        if (entry.used) return;
                        setSelected((prev) => (prev === entry.uid ? null : entry.uid));
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {mine && (
              <PendingBox
                mine={mine}
                view={view}
                online={online}
                mulligan={mulligan}
                discardPick={discardPick}
                discardNeed={discardNeed}
                recompose={recompose}
                setRecompose={setRecompose}
                orderCards={orderCards}
                reorder={mine.kind === "order" ? mine.reorder : false}
                moveOrder={moveOrder}
                responseCards={responseCards}
              />
            )}

            {waiting && (
              <div className="pending pending--waiting">
                <span className="pending__spinner" />
                {WAITING_LABEL[waiting.kind] ?? waiting.message}
              </div>
            )}

            {!mine && !waiting && (
              <div className="actions">
                <div className="actions__pay">
                  <span>기본동작 코스트</span>
                  <button
                    type="button"
                    className={`chip ${activePay === "focus" ? "chip--on" : ""}`}
                    disabled={you.focus <= 0}
                    onClick={() => setPayMode("focus")}
                  >
                    집중력 {you.focus}
                  </button>
                  <button
                    type="button"
                    className={`chip ${activePay === "hand" ? "chip--on" : ""}`}
                    onClick={() => setPayMode("hand")}
                  >
                    손패 1장
                  </button>
                  {activePay === "hand" && !selectedIsHand && (
                    <span className="actions__note">손패 카드를 선택하세요</span>
                  )}
                </div>

                <div className="actions__basics">
                  {(["advance", "retreat", "coil", "gather", "breakaway"] as BasicAction[]).map(
                    (kind) => {
                      const blocked = basicBlocker(kind);
                      return (
                        <button
                          key={kind}
                          type="button"
                          className="btn btn--basic"
                          disabled={Boolean(blocked)}
                          title={blocked ?? basicHint(kind)}
                          onClick={() => runBasic(kind)}
                        >
                          {basicLabel(kind)}
                        </button>
                      );
                    },
                  )}
                </div>

                <div className="actions__main">
                  {selectedEntry && selectedCard && (
                    <div className="actions__play">
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={Boolean(selectedBlocker)}
                        title={selectedBlocker ?? `${selectedCard.name} 사용`}
                        onClick={playSelected}
                      >
                        【{selectedCard.name}】 사용
                      </button>
                      {selectedBlocker && <span className="actions__note">{selectedBlocker}</span>}
                      {selectedCard.type === "attack" && (
                        <span className="actions__note">{rangeHint(selectedCard)?.text}</span>
                      )}
                    </div>
                  )}

                  {you.flags.mode === null && (
                    <button
                      type="button"
                      className="btn"
                      disabled={!isMyTurn || Boolean(mine) || you.flags.basicsUsed > 0}
                      title="기본동작 대신 카드 1장을 사용하는 행동 모드"
                      onClick={() => online.act({ type: "declarePower" })}
                    >
                      전력 행동
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn"
                    disabled={
                      !isMyTurn ||
                      Boolean(mine) ||
                      (you.flags.mode === "power" && !you.flags.powerUsed)
                    }
                    title={
                      you.flags.mode === "power" && !you.flags.powerUsed
                        ? "전력 행동에서는 카드 1장을 사용해야 합니다."
                        : "턴 종료"
                    }
                    onClick={() => online.act({ type: "endTurn" })}
                  >
                    턴 종료
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="game__side">
          {selectedCard && (
            <section className="preview">
              <header>
                <h4>선택한 카드</h4>
                <button type="button" className="btn btn--tiny" onClick={() => setSelected(null)}>
                  닫기
                </button>
              </header>
              <SmallCard
                cardId={selectedCard.id}
                width={190}
                used={Boolean(selectedUsed)}
              />
              <p className="preview__meta">
                {selectedIsHand ? "통상패" : "비장패"}
                {selectedCard.type === "attack" && rangeHint(selectedCard)
                  ? ` · ${rangeHint(selectedCard)?.text}`
                  : ""}
              </p>
              {selectedCard.type === "attack" && (
                <p className="preview__damage">
                  오라 {selectedCard.auraDamage ?? 0} / 라이프 {selectedCard.lifeDamage ?? 0}
                </p>
              )}
              {selectedCard.type === "attach" && (
                <p className="preview__meta">봉납 {selectedCard.offering ?? 0}</p>
              )}
              {selectedCard.kind === "special" && (
                <p className="preview__meta">플레어 비용 {selectedCard.cost ?? 0}</p>
              )}
            </section>
          )}

          <section className="game__log">
            <header>
              <h4>기록</h4>
              <span className="muted">seq {online.seq}</span>
            </header>
            <div className="game__log-list" ref={logRef}>
              {view.log.map((entry) => (
                <p key={entry.seq} className={`log log--${entry.kind}`}>
                  {entry.text}
                </p>
              ))}
            </div>
            {online.hash && (
              <p className="game__hash" title="결정론적 상태 해시 (리플레이 검증용)">
                hash {online.hash.slice(0, 12)}
              </p>
            )}
          </section>
        </aside>
      </div>

      {online.error && (
        <div className={`toast toast--${online.error.code}`} role="alert">
          <span>{online.error.message}</span>
          <button type="button" onClick={online.clearError}>
            닫기
          </button>
        </div>
      )}

      {view.phase === "gameover" && (
        <div className="gameover">
          <div className="gameover__box">
            <p className="gameover__eyebrow">대전 종료</p>
            <h2>
              {view.winner === "draw"
                ? "무승부"
                : view.winner === view.seat
                  ? "승리"
                  : "패배"}
            </h2>
            <p>
              {view.winner === "draw"
                ? "두 플레이어가 동시에 쓰러졌습니다."
                : view.winner === view.seat
                  ? `${foe.name}을(를) 쓰러뜨렸습니다.`
                  : `${foe.name}에게 패배했습니다.`}
            </p>
            <div className="gameover__stats">
              <span>라이프 {you.life}</span>
              <span>상대 라이프 {foe.life}</span>
              <span>seq {online.seq}</span>
            </div>
            <button type="button" className="btn btn--primary" onClick={online.leave}>
              로비로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── pending ────────────────────────────── */

function PendingBox({
  mine,
  view,
  online,
  mulligan,
  discardPick,
  discardNeed,
  recompose,
  setRecompose,
  orderCards,
  reorder,
  moveOrder,
  responseCards,
}: {
  mine: MyPending;
  view: PlayerView;
  online: Online;
  mulligan: string[];
  discardPick: string[];
  discardNeed: number;
  recompose: boolean;
  setRecompose: (value: boolean) => void;
  orderCards: { uid: string; cardId: string }[];
  reorder: boolean;
  moveOrder: (index: number, delta: number) => void;
  responseCards: { uid: string; cardId: string; card: Card | undefined; special: boolean }[];
}) {
  switch (mine.kind) {
    case "mulligan":
      return (
        <div className="pending">
          <h4>멀리건</h4>
          <p>
            바꾸고 싶은 카드를 손패에서 고르세요. 고른 카드는 패산으로 돌아가고 같은
            수만큼 다시 뽑습니다.
          </p>
          <div className="pending__buttons">
            <span className="pending__count">{mulligan.length}장 선택</span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => online.act({ type: "mulligan", returnUids: mulligan })}
            >
              {mulligan.length === 0 ? "그대로 시작" : `${mulligan.length}장 교체`}
            </button>
          </div>
        </div>
      );

    case "startPhase":
      return (
        <div className="pending">
          <h4>개시 페이즈</h4>
          <p>
            카드를 2장 드로우하고, 원하면 재구성할 수 있습니다. 재구성하면 라이프 1을
            지불해 플레어로 바꾸고, 패산·버림패·덮음패를 섞어 새 패산에서 2장을 뽑습니다.
          </p>
          <label className={`pending__check ${!mine.canRecompose ? "disabled" : ""}`}>
            <input
              type="checkbox"
              checked={recompose}
              disabled={!mine.canRecompose}
              onChange={(e) => setRecompose(e.target.checked)}
            />
            재구성 (라이프 {view.you.life} → {Math.max(0, view.you.life - 1)})
          </label>
          <div className="pending__buttons">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => online.act({ type: "startPhase", recompose })}
            >
              시작
            </button>
          </div>
        </div>
      );

    case "response":
      return (
        <div className="pending">
          <h4>대응</h4>
          <AttackSummary attack={mine.attack} attackerName={view.foe.name} />
          <div className="pending__buttons pending__buttons--wrap">
            {responseCards.map((entry) => {
              const cost = entry.card?.cost ?? 0;
              const blocked = entry.card?.kind === "special" && cost > view.you.flare;
              return (
                <button
                  key={entry.uid}
                  type="button"
                  className="btn"
                  disabled={blocked}
                  title={blocked ? "플레어가 부족합니다." : cardName(entry.cardId)}
                  onClick={() => online.act({ type: "response", uid: entry.uid })}
                >
                  【{cardName(entry.cardId)}】
                  {entry.special ? ` (플레어 ${cost})` : ""}
                </button>
              );
            })}
            {responseCards.length === 0 && <span className="muted">대응 카드가 없습니다.</span>}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => online.act({ type: "response" })}
            >
              대응하지 않는다
            </button>
          </div>
        </div>
      );

    case "defend":
      return (
        <div className="pending">
          <h4>방어</h4>
          <AttackSummary attack={mine.attack} attackerName={view.foe.name} />
          <p>오라로 받으면 오라만 잃고, 라이프로 받으면 라이프를 잃고 그만큼 플레어를 얻습니다.</p>
          <div className="pending__buttons">
            <button
              type="button"
              className="btn"
              disabled={mine.attack.aura <= 0 || view.you.aura < mine.attack.aura}
              onClick={() => online.act({ type: "defend", choice: "aura" })}
            >
              오라로 받기 (-{mine.attack.aura})
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={mine.attack.life <= 0}
              onClick={() => online.act({ type: "defend", choice: "life" })}
            >
              라이프로 받기 (-{mine.attack.life})
            </button>
          </div>
        </div>
      );

    case "discardDown":
      return (
        <div className="pending">
          <h4>종료 단계: 손패 정리</h4>
          <p>
            손패를 {view.config.handLimit}장 이하로 줄여야 합니다. 버릴 카드 {discardNeed}장을
            손패에서 고르세요. 고른 카드는 덮음패가 됩니다.
          </p>
          <div className="pending__buttons">
            <span className="pending__count">
              {discardPick.length}/{discardNeed}
            </span>
            <button
              type="button"
              className="btn btn--primary"
              disabled={discardPick.length !== discardNeed}
              onClick={() => online.act({ type: "discardDown", uids: discardPick })}
            >
              덮음패로
            </button>
          </div>
        </div>
      );

    case "penalty":
      return (
        <div className="pending">
          <h4>패산 고갈 페널티</h4>
          <p>패산이 비어 카드를 뽑지 못했습니다. 남은 페널티 {mine.remaining}회.</p>
          <div className="pending__buttons">
            <button
              type="button"
              className="btn"
              disabled={view.you.aura <= 0}
              onClick={() => online.act({ type: "penalty", choice: "aura" })}
            >
              오라 1 지불
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => online.act({ type: "penalty", choice: "life" })}
            >
              라이프 1 지불
            </button>
          </div>
        </div>
      );

    case "choice":
      return (
        <div className="pending">
          <h4>선택</h4>
          <p>{mine.prompt}</p>
          {mine.reveal && mine.reveal.length > 0 && (
            <div className="pending__reveal">
              {mine.reveal.map((c) => (
                <span key={c.uid} className="chip">
                  {cardName(c.cardId)}
                </span>
              ))}
            </div>
          )}
          <div className="pending__buttons pending__buttons--wrap">
            {mine.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="btn btn--primary"
                onClick={() => online.act({ type: "choice", optionId: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );

    case "order": {
      const uids = orderCards.length === mine.uids.length ? orderCards.map((c) => c.uid) : mine.uids;
      return (
        <div className="pending">
          <h4>패산 정리</h4>
          <p>{mine.prompt}</p>
          <p className="muted">{mine.who === "self" ? "내 패산" : "상대 패산"} · 위가 먼저 뽑힙니다.</p>
          <ol className="order">
            {orderCards.map((entry, index) => (
              <li key={entry.uid}>
                <span>{cardName(entry.cardId)}</span>
                {reorder && (
                  <span className="order__buttons">
                    <button
                      type="button"
                      className="btn btn--tiny"
                      disabled={index === 0}
                      onClick={() => moveOrder(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn--tiny"
                      disabled={index === orderCards.length - 1}
                      onClick={() => moveOrder(index, 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="pending__buttons">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => online.act({ type: "order", uids })}
            >
              {reorder ? "이 순서로 확정" : "확인"}
            </button>
          </div>
        </div>
      );
    }
  }
}
