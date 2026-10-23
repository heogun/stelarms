import type { Card, CardType } from "../data";

/** 적정거리를 사람이 읽는 문자열로 바꾼다. */
export function formatRange(range: Card["range"]): string {
  if (range === undefined) return "—";
  if (typeof range === "number") return String(range);
  return `${range[0]}-${range[1]}`;
}

/** 카드 타입을 한국어로. */
export function typeLabel(type: CardType): string {
  return type === "attack" ? "공격" : type === "action" ? "행동" : "부여";
}

/** 오라/라이프 데미지를 `2/1` 형태로. */
export function formatDamage(card: Card): string {
  return `${card.auraDamage ?? 0}/${card.lifeDamage ?? 0}`;
}
