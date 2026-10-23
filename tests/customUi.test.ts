// 커스텀 덱 저장값이 덱 빌더와 로비 UI에 반영되는지 확인하는 SSR 스모크 테스트.

import { beforeAll, expect, mock, test } from "bun:test";
import { decks } from "../src/data/decks";
import {
  writeCustomDraft,
  writeDeckSelection,
} from "../src/components/play/deckStorage";

mock.module("virtual:asset-manifest", () => ({ artFiles: {}, frameFiles: {} }));

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

globalThis.localStorage = new MemoryStorage();

const D0 = decks.find((deck) => deck.id === "deck-yuni-huya")!;
let React: typeof import("react");
let renderToStaticMarkup: (node: React.ReactElement) => string;
let Lobby: typeof import("../src/components/play/Lobby").Lobby;
let DeckBuilder: typeof import("../src/components/DeckBuilder").DeckBuilder;

beforeAll(async () => {
  React = await import("react");
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  ({ Lobby } = await import("../src/components/play/Lobby"));
  ({ DeckBuilder } = await import("../src/components/DeckBuilder"));

  writeCustomDraft({
    name: "UI 테스트 덱",
    mainId: D0.mainId,
    partnerId: D0.partnerId,
    normals: [...D0.normals],
    specials: [...D0.specials],
  });
  writeDeckSelection({ kind: "custom" });
});

test("로비가 저장된 커스텀 덱을 선택지와 미리보기로 보여 준다", () => {
  const online = {
    connected: true,
    resuming: false,
    room: null,
    seats: [null, null],
    view: null,
    hash: null,
    seq: 0,
    deadline: null,
    error: null,
    clearError: () => {},
    create: () => {},
    join: () => {},
    setDeck: () => {},
    start: () => {},
    act: () => {},
    leave: () => {},
  } as unknown as import("../src/net/useOnline").Online;

  const html = renderToStaticMarkup(React.createElement(Lobby, { online }));
  expect(html).toContain("커스텀 · UI 테스트 덱");
  expect(html).toContain("커스텀 덱: UI 테스트 덱");
  expect(html).toContain("통상 7 · 비장 3");
  expect(html).toContain("별빛 결속");
});

test("덱 빌더가 저장된 커스텀 덱을 복원하고 대전 버튼을 활성화한다", () => {
  const html = renderToStaticMarkup(React.createElement(DeckBuilder));
  expect(html).toContain("통상 7/7");
  expect(html).toContain("비장 3/3");
  expect(html).toContain("유효한 덱");
  expect(html).toContain("온라인 대전에 사용");
});
