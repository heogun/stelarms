// 커스텀 덱 검증과 서버용 덱 선택 해석 테스트.

import { describe, expect, test } from "bun:test";
import { createMatch } from "../src/engine";
import { decks } from "../src/data/decks";
import { validateCustomDeck } from "../src/data/customDeck";
import { resolveDeckChoice, seatDeckFor } from "../src/net/deckChoice";

const D0 = decks.find((d) => d.id === "deck-yuni-huya")!;
const D1 = decks.find((d) => d.id === "deck-huya-hina")!;

function customDeck() {
  return {
    name: "  내 커스텀 덱  ",
    mainId: D0.mainId,
    partnerId: D0.partnerId,
    normals: [...D0.normals],
    specials: [...D0.specials],
  };
}

describe("validateCustomDeck", () => {
  test("올바른 커스텀 덱을 정규화한다", () => {
    const result = validateCustomDeck(customDeck());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.name).toBe("내 커스텀 덱");
    expect(result.deck.normals).toHaveLength(7);
    expect(result.deck.specials).toHaveLength(3);
  });

  test("같은 스텔라 두 명은 거부한다", () => {
    const result = validateCustomDeck({ ...customDeck(), partnerId: D0.mainId });
    expect(result.ok).toBe(false);
  });

  test("통상패/비장패 장수와 중복을 검사한다", () => {
    const six = validateCustomDeck({ ...customDeck(), normals: D0.normals.slice(0, 6) });
    expect(six.ok).toBe(false);

    const duplicate = validateCustomDeck({
      ...customDeck(),
      normals: [...D0.normals.slice(0, 6), D0.normals[0]],
    });
    expect(duplicate.ok).toBe(false);

    const mixed = validateCustomDeck({
      ...customDeck(),
      normals: [...D0.normals.slice(0, 6), D0.specials[0]],
    });
    expect(mixed.ok).toBe(false);
  });

  test("고른 스텔라 소속이 아닌 카드를 거부한다", () => {
    const result = validateCustomDeck({
      ...customDeck(),
      normals: [...D0.normals.slice(0, 6), "HI-N-1"],
    });
    expect(result.ok).toBe(false);
  });

  test("빈 이름과 32자 초과 이름을 거부한다", () => {
    expect(validateCustomDeck({ ...customDeck(), name: "   " }).ok).toBe(false);
    expect(validateCustomDeck({ ...customDeck(), name: "가".repeat(33) }).ok).toBe(false);
  });
});

describe("resolveDeckChoice", () => {
  test("추천 덱을 해석한다", () => {
    const result = resolveDeckChoice({ kind: "preset", id: D0.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.id).toBe(D0.id);
    expect(result.deck.normals).toEqual(D0.normals);
  });

  test("커스텀 덱을 해석한다", () => {
    const result = resolveDeckChoice({ kind: "custom", deck: customDeck() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.id).toBe("custom");
    expect(result.deck.mainId).toBe(D0.mainId);
  });

  test("알 수 없는 추천 덱과 잘못된 커스텀 덱을 거부한다", () => {
    expect(resolveDeckChoice({ kind: "preset", id: "nope" }).ok).toBe(false);
    expect(resolveDeckChoice({ kind: "custom", deck: { name: "x" } }).ok).toBe(false);
  });

  test("해석한 커스텀 덱으로 대전을 시작할 수 있다", () => {
    const resolved = resolveDeckChoice({ kind: "custom", deck: customDeck() });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const state = createMatch({
      seed: "custom-deck-test",
      players: [
        {
          name: "P1",
          stellas: [resolved.deck.mainId, resolved.deck.partnerId],
          deck: resolved.deck.normals,
          specials: resolved.deck.specials,
        },
        {
          name: "P2",
          stellas: [D1.mainId, D1.partnerId],
          deck: D1.normals,
          specials: D1.specials,
        },
      ],
    });
    expect(state.players[0].deck.length + state.players[0].hand.length).toBe(7);
    expect(state.players[0].specials).toHaveLength(3);
  });
});

describe("seatDeckFor", () => {
  test("본인에게만 카드 목록을 보낸다", () => {
    const resolved = resolveDeckChoice({ kind: "custom", deck: customDeck() });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const mine = seatDeckFor(resolved.deck, 0, 0);
    expect(mine.normals).toEqual(D0.normals);
    expect(mine.normalCount).toBe(7);

    const foe = seatDeckFor(resolved.deck, 0, 1);
    expect(foe.normals).toBeUndefined();
    expect(foe.specials).toBeUndefined();
    expect(foe.normalCount).toBe(7);
    expect(foe.specialCount).toBe(3);
    expect(foe.mainId).toBe(D0.mainId);
  });
});
