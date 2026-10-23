// 카드 효과를 짧고 읽기 쉽게 쓰기 위한 헬퍼.
//
// 카드 데이터는 이 헬퍼들을 조합한 Op 배열이다.
// (Op 자체는 직렬화 가능한 데이터이므로 이 파일은 "작성 편의"일 뿐이다)

import type { CounterId } from "../types";
import type { Op, Who } from "./types";

export const draw = (n = 1): Op => ({ op: "draw", n });
export const move = (delta: number): Op => ({ op: "move", delta });
export const moveChoice = (): Op => ({ op: "moveChoice" });
export const aura = (n = 1): Op => ({ op: "aura", n });
export const loseAura = (who: Who, n = 1): Op => ({ op: "loseAura", who, n });
export const flare = (n = 1): Op => ({ op: "flare", n });
export const loseFlare = (who: Who, n = 1): Op => ({ op: "loseFlare", who, n });
export const payLife = (n = 1): Op => ({ op: "payLife", n });
export const heal = (n = 1): Op => ({ op: "heal", n });

export const counter = (who: Who, name: CounterId, n = 1): Op => ({
  op: "counter",
  who,
  name,
  n,
});
export const spend = (who: Who, name: CounterId, n = 1): Op => ({
  op: "spendCounter",
  who,
  name,
  n,
});

export const buff = (
  auraValue = 0,
  lifeValue = 0,
  extra: Partial<Extract<Op, { op: "buff" }>> = {},
): Op => ({ op: "buff", aura: auraValue, life: lifeValue, ...extra });

export const attackMod = (auraValue = 0, lifeValue = 0): Op => ({
  op: "attackMod",
  aura: auraValue,
  life: lifeValue,
});

export const reduce = (auraValue = 0, lifeValue = 0): Op => ({
  op: "reduce",
  aura: auraValue,
  life: lifeValue,
});

export const pierce = (): Op => ({ op: "pierce" });
export const superAttack = (): Op => ({ op: "super" });

export const attachDamage = (who: Who, n = 1): Op => ({ op: "attachDamage", who, n });
export const destroyAttach = (who: Who, n = 1): Op => ({ op: "destroyAttach", who, n });
export const attachDamageCard = (who: Who, cardId: string): Op => ({
  op: "attachDamageCard",
  who,
  cardId,
});

export const discard = (who: Who, n = 1): Op => ({ op: "discard", who, n });
export const peek = (
  who: Who,
  n: number,
  then: "keep" | "reorder" | "optionalBottom",
  prompt?: string,
): Op => ({ op: "peek", who, n, then, prompt });
export const putHandBottom = (n = 1): Op => ({ op: "putHandBottom", n });
export const millFoe = (n = 1): Op => ({ op: "millFoe", n });

export const restrict = (who: Who, kind: "advance" | "retreat" | "basic"): Op => ({
  op: "restrict",
  who,
  kind,
});
export const stance = (
  value: "day" | "night" | "toggle",
  who: Who = "self",
): Op => ({ op: "stance", who, value });
export const extraBasic = (n = 1): Op => ({ op: "extraBasic", n });
export const freeBasic = (action: "advance" | "retreat"): Op => ({ op: "freeBasic", action });

export function ifCond(
  cond: Extract<Op, { op: "if" }>["cond"],
  then: Op[],
  otherwise?: Op[],
): Op {
  return { op: "if", cond, then, else: otherwise };
}

export function choose(
  prompt: string,
  options: { id: string; label: string; then: Op[] }[],
): Op {
  return { op: "choose", prompt, options };
}

export const opt = (id: string, label: string, then: Op[] = []) => ({ id, label, then });
