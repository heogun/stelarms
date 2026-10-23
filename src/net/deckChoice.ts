// 덱 선택(추천/커스텀)을 서버가 검증해 실제 대전 덱으로 바꾼다.
//
// 서버는 클라이언트가 보낸 카드 ID·스텔라·덱 이름을 그대로 신뢰하지 않는다.
// 여기서 한 번 검증하고, `createMatch`가 시작 시 한 번 더 검증한다.

import { decks } from "../data/decks";
import { validateCustomDeck } from "../data/customDeck";
import { hasProgram } from "../engine";
import type { PlayerId } from "../engine";
import type { DeckChoice, SeatDeck } from "./protocol";

export interface ResolvedDeck {
  id: string;
  name: string;
  mainId: string;
  partnerId: string;
  normals: string[];
  specials: string[];
}

export type ResolveDeckResult =
  | { ok: true; deck: ResolvedDeck }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkPrograms(deck: ResolvedDeck): string | null {
  for (const cardId of [...deck.normals, ...deck.specials]) {
    if (!hasProgram(cardId)) {
      return `${cardId}의 효과가 아직 구현되지 않았습니다.`;
    }
  }
  return null;
}

export function resolveDeckChoice(value: unknown): ResolveDeckResult {
  if (!isRecord(value)) {
    return { ok: false, error: "덱 형식이 올바르지 않습니다." };
  }

  if (value.kind === "preset") {
    if (typeof value.id !== "string") {
      return { ok: false, error: "추천 덱 ID가 올바르지 않습니다." };
    }
    const deck = decks.find((item) => item.id === value.id);
    if (!deck) return { ok: false, error: "알 수 없는 추천 덱입니다." };
    return {
      ok: true,
      deck: {
        id: deck.id,
        name: deck.name,
        mainId: deck.mainId,
        partnerId: deck.partnerId,
        normals: [...deck.normals],
        specials: [...deck.specials],
      },
    };
  }

  if (value.kind === "custom") {
    const result = validateCustomDeck(value.deck);
    if (!result.ok) return result;
    const deck: ResolvedDeck = { id: "custom", ...result.deck };
    const programError = checkPrograms(deck);
    if (programError) return { ok: false, error: programError };
    return { ok: true, deck };
  }

  return { ok: false, error: "덱 종류가 올바르지 않습니다." };
}

/** 좌석에 보여 줄 덱 요약. 본인에게만 카드 목록을 포함한다. */
export function seatDeckFor(
  deck: ResolvedDeck,
  viewerSeat: PlayerId,
  seat: PlayerId,
): SeatDeck {
  const own = viewerSeat === seat;
  return {
    id: deck.id,
    name: deck.name,
    mainId: deck.mainId,
    partnerId: deck.partnerId,
    normalCount: deck.normals.length,
    specialCount: deck.specials.length,
    ...(own
      ? { normals: [...deck.normals], specials: [...deck.specials] }
      : {}),
  };
}

export type { DeckChoice };
