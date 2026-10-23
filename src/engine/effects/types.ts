// 카드 효과 DSL.
//
// 카드 한 장의 동작은 **데이터**로만 기술한다. (함수 금지)
// 서버가 상태와 함께 저장/전송할 수 있고, 리플레이에서도 그대로 재실행된다.
//
// 새 카드를 추가할 때는 `src/engine/effects/cards/*.ts`에
// `defineCard("ID", { ... })`를 추가하면 된다.

import type { CardType } from "../../data/types";
import type { CounterId, Stance } from "../types";

export type Compare = "<=" | ">=" | "=";
export type Who = "self" | "foe";

/** 조건. 모든 조건은 현재 상태에서 즉시 평가된다. */
export type Cond =
  | { c: "life"; who: Who; op: Compare; n: number }
  | { c: "aura"; who: Who; op: Compare; n: number }
  | { c: "flare"; who: Who; op: Compare; n: number }
  | { c: "counter"; who: Who; name: CounterId; op: Compare; n: number }
  | { c: "distance"; op: Compare; n: number }
  | { c: "attaches"; who: Who; op: Compare; n: number }
  /** 이번 턴에 사용한 공격 수 (현재 공격 포함) */
  | { c: "attacks"; op: Compare; n: number }
  | { c: "stance"; who: Who; value: Stance }
  | { c: "deckTopType"; who: Who; value: CardType }
  | { c: "handSize"; who: Who; op: Compare; n: number }
  /** 이번 턴 내가 라이프 데미지를 줬는가 */
  | { c: "dealtLife" }
  /** 이번 턴 내가 라이프 데미지를 받았는가 */
  | { c: "tookLife" }
  | { c: "not"; cond: Cond }
  | { c: "and"; conds: Cond[] }
  | { c: "or"; conds: Cond[] };

/** 부여패의 【전개중】 상시 보정 */
export interface StaticMod {
  cond?: Cond;
  /** 특정 스텔라(파트너/자신)의 공격에만 */
  onlyStella?: "partner" | "self";
  /** 내 공격 +a/+l */
  attack?: { aura?: number; life?: number };
  /** 내가 받는 오라 데미지 -n */
  auraTaken?: number;
  /** 내가 받는 라이프 데미지 -n */
  lifeTaken?: number;
  /** 카운터 1당 공격 보정 (최대 max) */
  perCounter?: {
    name: CounterId;
    aura?: number;
    life?: number;
    max: number;
    cond?: Cond;
  };
  /** 상대의 드로우 1회에서 n장 무효화 (턴에 1번) */
  negateFoeDraw?: number;
}

/** 부여패의 발동형 효과 */
export interface EventHook {
  on:
    | "foeAdvance"
    | "foeAttack"
    | "selfAttack"
    | "foeMove"
    | "foeTurnEnd"
    | "selfLifeDealt"
    | "selfLifeTaken"
    | "stanceChange"
    | "selfCardUse"
    | "turnStart";
  /** 턴에 1번만 */
  once?: boolean;
  /** 이 카드의 스텔라 기준으로 파트너/자신 공격에만 (selfAttack) */
  onlyStella?: "partner" | "self";
  cond?: Cond;
  ops: Op[];
}

export type Op =
  | { op: "draw"; n: number }
  | { op: "move"; delta: number }
  | { op: "moveChoice" }
  | { op: "aura"; n: number }
  | { op: "loseAura"; who: Who; n: number }
  | { op: "flare"; n: number }
  | { op: "loseFlare"; who: Who; n: number }
  | { op: "dust"; n: number }
  | { op: "heal"; n: number }
  | { op: "payLife"; n: number }
  | { op: "counter"; who: Who; name: CounterId; n: number }
  | { op: "spendCounter"; who: Who; name: CounterId; n: number }
  /** 직접 데미지 (방어 선택 없음). 오라/라이프를 "잃는다" */
  | { op: "loseLife"; who: Who; n: number }
  | {
      op: "buff";
      aura?: number;
      life?: number;
      charges?: number;
      onlyStella?: "partner" | "self";
      rangeExpand?: number;
      minAttacks?: number;
      label?: string;
    }
  | { op: "condBuff"; cond: Cond; aura?: number; life?: number }
  | { op: "attackMod"; aura?: number; life?: number }
  | { op: "reduce"; aura?: number; life?: number }
  | { op: "pierce" }
  | { op: "super" }
  | { op: "expandRange"; n: number }
  | { op: "attachDamage"; who: Who; n: number }
  | { op: "destroyAttach"; who: Who; n: number }
  | { op: "attachDamageUid"; who: Who; uid: string }
  | { op: "destroyAttachUid"; who: Who; uid: string }
  | { op: "attachDamageCard"; who: Who; cardId: string }
  | { op: "discard"; who: Who; n: number }
  | { op: "discardUid"; who: Who; uid: string }
  | { op: "bottomUid"; who: Who; uid: string }
  | { op: "handToBottomUid"; who: Who; uid: string }
  | {
      op: "peek";
      who: Who;
      n: number;
      then: "keep" | "reorder" | "optionalBottom";
      prompt?: string;
    }
  | { op: "putHandBottom"; n: number }
  | { op: "millFoe"; n: number }
  | { op: "restrict"; who: Who; kind: "advance" | "retreat" | "basic" }
  | { op: "stance"; who: Who; value: Stance | "toggle" }
  | { op: "extraBasic"; n: number }
  | { op: "freeBasic"; action: "advance" | "retreat" }
  | { op: "if"; cond: Cond; then: Op[]; else?: Op[] }
  | {
      op: "choose";
      prompt: string;
      options: { id: string; label: string; then: Op[] }[];
    }
  /** 내부 제어용. 카드 데이터에는 쓰지 않는다. */
  | { op: "enterMain" }
  | { op: "openResponse" }
  | { op: "resolveAttack" }
  | { op: "finishAttack" }
  | { op: "askStart" }
  | { op: "finishTurn" }
  | { op: "nextTurn" };

export interface CardProgram {
  /** 사용 가능 조건 (코스트/키워드 외 추가 조건) */
  playable?: Cond;
  /** 사용 시 (공격/행동/부여 공통, 코스트 지불 후) */
  onUse?: Op[];
  /** 공격 선언 시, 데미지 확정 전 */
  onAttack?: Op[];
  /** 【공격후】 */
  onAfter?: Op[];
  /** 【대응】 */
  onResponse?: Op[];
  /** 부여패 【전개중】 */
  static?: StaticMod[];
  /** 부여패 【파기시】 */
  onDestroy?: Op[];
  /** 부여패 발동 효과 */
  events?: EventHook[];
}
