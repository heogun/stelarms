// 엔진이 참조하는 카드/스텔라 데이터.
//
// `src/data/index.ts`는 Vite 전용 `virtual:asset-manifest`를 import하므로
// 서버/Bun 테스트에서는 쓸 수 없다. 엔진은 카드 배열을 직접 가져와
// 자체 조회 테이블을 만든다. (카드 데이터의 단일 소스는 그대로 유지)

import { everysCards } from "../data/cards/everys";
import { universeCards } from "../data/cards/universe";
import { clicheCards } from "../data/cards/cliche";
import { abyssCards } from "../data/cards/abyss";
import { stellaById } from "../data/stellas";
import type { Card } from "../data/types";

export const engineCards: Card[] = [
  ...everysCards,
  ...universeCards,
  ...clicheCards,
  ...abyssCards,
];

export const cardTable: ReadonlyMap<string, Card> = new Map(
  engineCards.map((card) => [card.id, card]),
);

export function getCard(cardId: string): Card | undefined {
  return cardTable.get(cardId);
}

export function stellaGeneration(stellaId: string): string | undefined {
  return stellaById[stellaId]?.generation;
}

/** 같은 기수 스텔라 2명인지 (합방 보너스) */
export function sameGeneration(a: string, b: string): boolean {
  const ga = stellaGeneration(a);
  return Boolean(ga) && ga === stellaGeneration(b);
}
