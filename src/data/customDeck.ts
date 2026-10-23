// 커스텀 덱의 형태와 유효성 검사.
//
// 이 파일은 `virtual:asset-manifest`를 쓰지 않는다. 브라우저와 서버가 같은
// 규칙을 공유하도록 순수 데이터만 참조한다.

import { abyssCards } from "./cards/abyss";
import { clicheCards } from "./cards/cliche";
import { everysCards } from "./cards/everys";
import { universeCards } from "./cards/universe";
import { stellaById } from "./stellas";
import type { Card } from "./types";

export const CUSTOM_DECK_NAME_MAX = 32;
export const CUSTOM_DECK_NORMALS = 7;
export const CUSTOM_DECK_SPECIALS = 3;

export interface CustomDeckInput {
  name: string;
  mainId: string;
  partnerId: string;
  normals: string[];
  specials: string[];
}

const cardById = new Map<string, Card>(
  [...everysCards, ...universeCards, ...clicheCards, ...abyssCards].map((card) => [
    card.id,
    card,
  ]),
);

export function sanitizeDeckName(raw: string): string {
  return [...raw]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CUSTOM_DECK_NAME_MAX);
}

export type CustomDeckResult =
  | { ok: true; deck: CustomDeckInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function checkCards(
  ids: string[],
  kind: "normal" | "special",
  stellas: Set<string>,
): string | null {
  for (const id of ids) {
    const card = cardById.get(id);
    if (!card) return `알 수 없는 카드입니다: ${id}`;
    if (card.kind !== kind) {
      return `${id}는 ${kind === "normal" ? "통상패" : "비장패"}가 아닙니다.`;
    }
    if (!stellas.has(card.stellaId)) {
      return `${id}는 고른 스텔라의 카드가 아닙니다.`;
    }
  }
  return null;
}

/**
 * 클라이언트가 보낸 커스텀 덱을 검증하고 정규화한다.
 *
 * 카드 효과가 구현되어 있는지는 서버의 `resolveDeckChoice`에서 한 번 더
 * 확인한다. 여기서는 데이터/덱 구성 규칙만 본다.
 */
export function validateCustomDeck(value: unknown): CustomDeckResult {
  if (!isRecord(value)) {
    return { ok: false, error: "덱 형식이 올바르지 않습니다." };
  }

  const rawName = typeof value.name === "string" ? value.name : "";
  if (rawName.trim().length === 0) {
    return { ok: false, error: "덱 이름을 입력하세요." };
  }
  const name = sanitizeDeckName(rawName);
  if (name.length === 0) {
    return { ok: false, error: "덱 이름을 입력하세요." };
  }
  if (rawName.trim().length > CUSTOM_DECK_NAME_MAX) {
    return { ok: false, error: `덱 이름은 ${CUSTOM_DECK_NAME_MAX}자 이하입니다.` };
  }

  const mainId = value.mainId;
  const partnerId = value.partnerId;
  if (typeof mainId !== "string" || !stellaById[mainId]) {
    return { ok: false, error: "메인 스텔라가 올바르지 않습니다." };
  }
  if (typeof partnerId !== "string" || !stellaById[partnerId]) {
    return { ok: false, error: "파트너 스텔라가 올바르지 않습니다." };
  }
  if (mainId === partnerId) {
    return { ok: false, error: "메인과 파트너는 서로 다른 스텔라여야 합니다." };
  }

  const normals = value.normals;
  const specials = value.specials;
  if (!isStringArray(normals) || normals.length !== CUSTOM_DECK_NORMALS) {
    return {
      ok: false,
      error: `통상패는 정확히 ${CUSTOM_DECK_NORMALS}장이어야 합니다.`,
    };
  }
  if (!isStringArray(specials) || specials.length !== CUSTOM_DECK_SPECIALS) {
    return {
      ok: false,
      error: `비장패는 정확히 ${CUSTOM_DECK_SPECIALS}장이어야 합니다.`,
    };
  }
  if (new Set(normals).size !== normals.length) {
    return { ok: false, error: "같은 통상패를 두 장 넣을 수 없습니다." };
  }
  if (new Set(specials).size !== specials.length) {
    return { ok: false, error: "같은 비장패를 두 장 넣을 수 없습니다." };
  }
  if (new Set([...normals, ...specials]).size !== normals.length + specials.length) {
    return { ok: false, error: "통상패와 비장패가 겹칩니다." };
  }

  const stellas = new Set([mainId, partnerId]);
  const normalError = checkCards(normals, "normal", stellas);
  if (normalError) return { ok: false, error: normalError };
  const specialError = checkCards(specials, "special", stellas);
  if (specialError) return { ok: false, error: specialError };

  return {
    ok: true,
    deck: {
      name,
      mainId,
      partnerId,
      normals: [...normals],
      specials: [...specials],
    },
  };
}
