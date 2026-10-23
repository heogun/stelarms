// 덱 빌더와 온라인 로비가 공유하는 localStorage 저장소.
//
// 저장하는 것은 "작성 중인 커스텀 덱"과 "온라인에서 쓸 덱 선택"이다.
// 저장된 값은 항상 다시 검증해서 읽는다. (오래된/깨진 데이터 방어)

import { validateCustomDeck, type CustomDeckInput } from "../../data/customDeck";
import { decks } from "../../data/decks";
import { stellaById } from "../../data/stellas";
import type { Deck } from "../../data/types";
import type { DeckChoice, SeatDeck } from "../../net/protocol";

const DRAFT_KEY = "stelarms.customDeck.v1";
const SELECTION_KEY = "stelarms.deckSelection.v2";

export type DeckSelection =
  | { kind: "preset"; id: string }
  | { kind: "custom" };

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return value.slice(0, 30);
}

/** 덱 빌더 복원용. 완성되지 않은 덱도 그대로 돌려준다. */
export function readCustomDraft(): CustomDeckInput | null {
  const value = readJson(DRAFT_KEY);
  if (!isRecord(value)) return null;
  const mainId = value.mainId;
  const partnerId = value.partnerId;
  if (typeof mainId !== "string" || !stellaById[mainId]) return null;
  if (typeof partnerId !== "string" || !stellaById[partnerId]) return null;
  const normals = stringArray(value.normals);
  const specials = stringArray(value.specials);
  if (!normals || !specials) return null;
  return {
    name: typeof value.name === "string" ? value.name : "내 덱",
    mainId,
    partnerId,
    normals,
    specials,
  };
}

/** 로비에서 선택할 수 있는 완성된 커스텀 덱. */
export function readValidCustomDeck(): CustomDeckInput | null {
  const draft = readCustomDraft();
  if (!draft) return null;
  const result = validateCustomDeck(draft);
  return result.ok ? result.deck : null;
}

export function writeCustomDraft(deck: CustomDeckInput): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(deck));
  } catch {
    // 저장 공간/프라이버시 모드에서는 저장하지 않는다.
  }
}

export function readDeckSelection(): DeckSelection {
  const value = readJson(SELECTION_KEY);
  if (isRecord(value) && value.kind === "custom" && readValidCustomDeck()) {
    return { kind: "custom" };
  }
  if (
    isRecord(value) &&
    value.kind === "preset" &&
    typeof value.id === "string" &&
    decks.some((deck) => deck.id === value.id)
  ) {
    return { kind: "preset", id: value.id };
  }
  return { kind: "preset", id: decks[0].id };
}

export function writeDeckSelection(selection: DeckSelection): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // ignore
  }
}

export function deckChoiceOf(
  selection: DeckSelection,
  custom: CustomDeckInput | null,
): DeckChoice {
  if (selection.kind === "custom" && custom) {
    return { kind: "custom", deck: custom };
  }
  return {
    kind: "preset",
    id: selection.kind === "preset" ? selection.id : decks[0].id,
  };
}

export function presetPreview(deck: Deck): SeatDeck {
  return {
    id: deck.id,
    name: deck.name,
    mainId: deck.mainId,
    partnerId: deck.partnerId,
    normalCount: deck.normals.length,
    specialCount: deck.specials.length,
    normals: [...deck.normals],
    specials: [...deck.specials],
  };
}

export function customPreview(deck: CustomDeckInput): SeatDeck {
  return {
    id: "custom",
    name: deck.name,
    mainId: deck.mainId,
    partnerId: deck.partnerId,
    normalCount: deck.normals.length,
    specialCount: deck.specials.length,
    normals: [...deck.normals],
    specials: [...deck.specials],
  };
}
