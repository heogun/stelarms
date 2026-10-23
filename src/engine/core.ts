// 상태를 바꾸는 저수준 연산.
//
// 여기 있는 함수는 **절대 실패 예외를 던지지 않는다.** (검증은 actions.ts에서 선행)
// 수치는 문서의 상한/하한을 넘지 않도록 클램프한다.

import { getCard } from "./cards";
import type {
  AttachState,
  CardInstance,
  GameState,
  PlayerId,
  PlayerState,
} from "./types";

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function player(state: GameState, p: PlayerId): PlayerState {
  return state.players[p];
}

export function foe(state: GameState, p: PlayerId): PlayerState {
  return state.players[other(p)];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 로그 한 줄 추가 */
export function log(
  state: GameState,
  kind: "system" | "action" | "damage" | "phase" | "card" | "error",
  text: string,
): void {
  state.logSeq += 1;
  state.log.push({
    seq: state.logSeq,
    turn: state.turn,
    kind,
    text,
  });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

export function cardName(uidOrId: string): string {
  const id = uidOrId.split("-").slice(1).join("-");
  return getCard(uidOrId)?.name ?? getCard(id)?.name ?? uidOrId;
}

export function cardTypeOf(cardId: string): string | undefined {
  return getCard(cardId)?.type;
}

export function findCard(p: PlayerState, uid: string): CardInstance | undefined {
  return p.hand.find((c) => c.uid === uid);
}

export function findAttach(p: PlayerState, uid: string): AttachState | undefined {
  return p.attaches.find((a) => a.uid === uid);
}

/** 오라 획득 (상한 클램프) */
export function gainAura(state: GameState, p: PlayerState, n: number): number {
  const before = p.aura;
  p.aura = clamp(p.aura + n, 0, state.config.auraMax);
  return p.aura - before;
}

/** 오라 상실: 오라 → 더스트. 실제로 잃은 양을 돌려준다. */
export function loseAura(p: PlayerState, n: number): number {
  const actual = Math.min(p.aura, Math.max(0, n));
  p.aura -= actual;
  p.dust += actual;
  return actual;
}

export function gainFlare(p: PlayerState, n: number): void {
  p.flare = Math.max(0, p.flare + n);
}

export function loseFlare(p: PlayerState, n: number): number {
  const actual = Math.min(p.flare, Math.max(0, n));
  p.flare -= actual;
  return actual;
}

/** 라이프 지불: 라이프 → 플레어. 라이프가 0이 되면 패배. */
export function payLife(state: GameState, p: PlayerState, n: number): void {
  p.life = Math.max(0, p.life - n);
  p.flare += n;
  checkGameOver(state);
}

/** 라이프 직접 상실 (데미지/페널티): 라이프 → 플레어 */
export function loseLife(state: GameState, p: PlayerState, n: number): number {
  const actual = Math.min(p.life, Math.max(0, n));
  p.life -= actual;
  p.flare += actual;
  checkGameOver(state);
  return actual;
}

/** 회복: 더스트 → 라이프 (상한 10) */
export function heal(state: GameState, p: PlayerState, n: number): number {
  const actual = Math.min(p.dust, Math.max(0, n), state.config.life - p.life);
  p.dust -= actual;
  p.life += actual;
  return actual;
}

/** 거리 이동 (0~10 클램프) */
export function moveDistance(state: GameState, delta: number): number {
  const before = state.distance;
  state.distance = clamp(state.distance + delta, 0, state.config.distanceMax);
  return state.distance - before;
}

export function addCounter(
  p: PlayerState,
  name: keyof PlayerState["counters"],
  n: number,
): void {
  const max = name === "pyojeok" || name === "unun" ? 2 : 3;
  p.counters[name] = clamp(p.counters[name] + n, 0, max);
}

export function spendCounter(
  p: PlayerState,
  name: keyof PlayerState["counters"],
  n: number,
): boolean {
  if (p.counters[name] < n) return false;
  p.counters[name] -= n;
  return true;
}

export function checkGameOver(state: GameState): void {
  if (state.phase === "gameover") return;
  const dead0 = state.players[0].life <= 0;
  const dead1 = state.players[1].life <= 0;
  if (!dead0 && !dead1) return;
  state.phase = "gameover";
  state.pending = null;
  if (dead0 && dead1) state.winner = "draw";
  else state.winner = dead0 ? 1 : 0;
  log(
    state,
    "system",
    state.winner === "draw"
      ? "양쪽 라이프가 0이 되었다. 무승부."
      : `${state.players[state.winner].name} 승리!`,
  );
}

/** 덱 맨 위에서 n장 드로우. 부족하면 뽑은 만큼만 돌려준다. */
export function drawFromDeck(p: PlayerState, n: number): number {
  let drawn = 0;
  for (let i = 0; i < n; i += 1) {
    const card = p.deck.shift();
    if (!card) break;
    p.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

export function deckToDiscard(p: PlayerState, n: number): number {
  let moved = 0;
  for (let i = 0; i < n; i += 1) {
    const card = p.deck.shift();
    if (!card) break;
    p.discard.push(card);
    moved += 1;
  }
  return moved;
}

export function discardToBottom(p: PlayerState, card: CardInstance): void {
  p.hand = p.hand.filter((c) => c.uid !== card.uid);
  p.deck.push(card);
}

export function handToCover(p: PlayerState, card: CardInstance): void {
  p.hand = p.hand.filter((c) => c.uid !== card.uid);
  p.cover.push(card);
}

export function discardCard(p: PlayerState, card: CardInstance): void {
  p.hand = p.hand.filter((c) => c.uid !== card.uid);
  p.discard.push(card);
}

/** 부여패 파기 (크리스탈은 더스트로) */
export function destroyAttach(state: GameState, p: PlayerState, attach: AttachState): void {
  p.attaches = p.attaches.filter((a) => a.uid !== attach.uid);
  p.dust += attach.crystals;
  // 비장패는 버림패로 가지 않는다. (비장패 존에 사용 완료로 남는다)
  if (getCard(attach.cardId)?.kind !== "special") {
    p.discard.push({ uid: attach.uid, cardId: attach.cardId });
  }
  log(state, "card", `${cardName(attach.cardId)} 부여패 파기.`);
}

/** 무작위 카드 (시크릿) */
export function randomFrom<T>(items: T[], random: (max: number) => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[random(items.length)];
}
