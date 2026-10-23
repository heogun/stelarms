// 데이터 집계 및 조회 헬퍼.
//
// 확장판을 추가할 때는 `src/data/cards/` 아래에 새 파일을 만들고
// 여기 `allCards` 배열에만 추가하면 된다. UI 코드는 건드릴 필요가 없다.

import { everysCards } from "./cards/everys";
import { universeCards } from "./cards/universe";
import { clicheCards } from "./cards/cliche";
import { abyssCards } from "./cards/abyss";
import { decks } from "./decks";
import { generations, stellaById, stellas } from "./stellas";
import type { Card, CardType, Deck, GenerationId, Stella } from "./types";
import { artFiles } from "virtual:asset-manifest";

export { generations, stellaById, stellas, generationById } from "./stellas";
export { decks } from "./decks";
export { frames, frameFor, artAspect } from "./frames";
export type { Frame } from "./frames";
export type {
  Card,
  CardKind,
  CardType,
  Deck,
  Generation,
  GenerationId,
  Range,
  Stella,
} from "./types";

/** 모든 카드 (기수 순, 파일 순서 그대로) */
export const allCards: Card[] = [
  ...everysCards,
  ...universeCards,
  ...clicheCards,
  ...abyssCards,
];

/** 카드 ID -> 카드 */
export const cardById: Record<string, Card> = Object.fromEntries(
  allCards.map((c) => [c.id, c]),
);

/**
 * 일러스트 이미지 경로 (프레임 없이 그림만).
 *
 * `public/images/art/`에 실제 파일이 있을 때만 경로를 돌려준다.
 * 없으면 `undefined` → 카드가 플레이스홀더를 그린다. (불필요한 404 요청 없음)
 * 다른 경로를 쓰려면 카드 데이터의 `art`에 직접 지정한다.
 */
export function cardArtSrc(card: Card): string | undefined {
  if (card.art) return card.art;
  const file = artFiles[card.id];
  return file ? `/images/art/${file}` : undefined;
}

/** 완성된 카드 전체 이미지 (있으면 합성하지 않음) */
export function cardFlatSrc(card: Card): string | undefined {
  return card.image;
}

/** 스트리머별 카드 (통상패 먼저, 그다음 비장패, 각각 번호순) */
export function cardsByStella(stellaId: string): Card[] {
  return allCards
    .filter((c) => c.stellaId === stellaId)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "normal" ? -1 : 1;
      return a.id.localeCompare(b.id, "en", { numeric: true });
    });
}

/** 기수별 카드 */
export function cardsByGeneration(gen: GenerationId): Card[] {
  return allCards.filter((c) => stellaById[c.stellaId]?.generation === gen);
}

/** 타입별 카드 */
export function cardsByType(type: CardType): Card[] {
  return allCards.filter((c) => c.type === type);
}

/** 스트리머별 덱 */
export function decksByStella(stellaId: string): Deck[] {
  return decks.filter((d) => d.mainId === stellaId || d.partnerId === stellaId);
}

/** 이름·텍스트·출처를 대상으로 한 단순 검색 */
export function searchCards(query: string): Card[] {
  const q = query.trim().toLowerCase();
  if (!q) return allCards;
  return allCards.filter((c) => {
    const haystack = [
      c.name,
      c.text,
      c.source ?? "",
      c.notes ?? "",
      stellaById[c.stellaId]?.name ?? "",
      ...(c.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** 카드가 속한 기수 */
export function generationOfCard(card: Card): GenerationId | undefined {
  return stellaById[card.stellaId]?.generation;
}

/** 스트리머별 카드 수 */
export function cardCountByStella(stella: Stella): number {
  return allCards.filter((c) => c.stellaId === stella.id).length;
}

/** 카드 집합의 요약 통계 */
export const cardStats = {
  total: allCards.length,
  normal: allCards.filter((c) => c.kind === "normal").length,
  special: allCards.filter((c) => c.kind === "special").length,
  attack: allCards.filter((c) => c.type === "attack").length,
  action: allCards.filter((c) => c.type === "action").length,
  attach: allCards.filter((c) => c.type === "attach").length,
};

/** 덱의 카드 ID 목록을 카드 객체로 (없는 ID는 건너뜀) */
export function resolveDeck(deck: Deck): { normals: Card[]; specials: Card[] } {
  const pick = (ids: string[]) =>
    ids.map((id) => cardById[id]).filter((c): c is Card => Boolean(c));
  return { normals: pick(deck.normals), specials: pick(deck.specials) };
}

/** 스텔라 목록을 기수별로 묶는다. */
export function stellasByGeneration(): { gen: (typeof generations)[number]; members: Stella[] }[] {
  return generations.map((gen) => ({
    gen,
    members: stellas.filter((s) => s.generation === gen.id),
  }));
}
