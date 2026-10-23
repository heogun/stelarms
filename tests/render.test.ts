// 대전 보드의 SSR 렌더 스모크 테스트.
//
// 실제 브라우저 없이 pending 상태별 JSX가 런타임 오류 없이 렌더되는지만 확인한다.
// (버튼 클릭·애니메이션은 브라우저 E2E에서 확인한다.)

import { beforeAll, expect, mock, test } from "bun:test";

// Vite 전용 가상 모듈. 카드 아트 파일 목록이 없어도 렌더에는 지장이 없다.
mock.module("virtual:asset-manifest", () => ({ artFiles: {}, frameFiles: {} }));

let React: typeof import("react");
let renderToStaticMarkup: (node: React.ReactElement) => string;
let engine: typeof import("../src/engine");
let Game: typeof import("../src/components/play/Game").Game;
let decks: typeof import("../src/data/decks").decks;

const D0 = "deck-yuni-huya";
const D1 = "deck-huya-hina";

beforeAll(async () => {
  React = await import("react");
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  engine = await import("../src/engine");
  ({ Game } = await import("../src/components/play/Game"));
  ({ decks } = await import("../src/data/decks"));
});

function base(): import("../src/engine").GameState {
  const d0 = decks.find((d) => d.id === D0)!;
  const d1 = decks.find((d) => d.id === D1)!;
  let state = engine.createMatch({
    seed: "render-test",
    firstPlayer: 0,
    players: [
      { name: "Alice", stellas: [d0.mainId, d0.partnerId], deck: d0.normals, specials: d0.specials },
      { name: "Bob", stellas: [d1.mainId, d1.partnerId], deck: d1.normals, specials: d1.specials },
    ],
  });
  state = engine.applyAction(state, state.pending!.player, { type: "mulligan", returnUids: [] });
  state = engine.applyAction(state, state.pending!.player, { type: "mulligan", returnUids: [] });
  return state;
}

function render(view: import("../src/engine").PlayerView): string {
  const online = {
    connected: true,
    resuming: false,
    room: { roomCode: "ABC123", seat: view.seat, token: "t", hostSeat: 0, started: true },
    seats: [
      {
        seat: 0,
        name: "Alice",
        deck: {
          id: D0,
          name: "별빛 결속",
          mainId: "yuni",
          partnerId: "huya",
          normalCount: 7,
          specialCount: 3,
        },
        connected: true,
      },
      {
        seat: 1,
        name: "Bob",
        deck: {
          id: D1,
          name: "별과 눈",
          mainId: "huya",
          partnerId: "hina",
          normalCount: 7,
          specialCount: 3,
        },
        connected: true,
      },
    ],
    view,
    hash: "0123456789abcdef",
    seq: 42,
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
  return renderToStaticMarkup(React.createElement(Game, { online, view }));
}

test("메인 페이즈 보드가 렌더된다", () => {
  const html = render(engine.toPlayerView(base(), 0));
  expect(html).toContain("내 손패");
  expect(html).toContain("전력 행동");
  expect(html).toContain("기록");
});

test("공격 대응과 방어 프롬프트가 렌더된다", () => {
  let state = base();
  state.phase = "main";
  state.turn = 0;
  state.pending = null;
  state.distance = 6;
  state.players[0].flags.mode = "standard";
  state.players[0].flags.basicsUsed = 0;
  state.players[0].hand = state.players[0].hand.filter((c) => c.cardId !== "HI-N-1");
  state.players[0].deck = state.players[0].deck.filter((c) => c.cardId !== "HI-N-1");
  state.players[0].hand.push({ uid: "p0-HI-N-1", cardId: "HI-N-1" });
  state.players[1].aura = 5;
  state.players[1].life = 10;

  state = engine.applyAction(state, 0, { type: "playCard", uid: "p0-HI-N-1" });
  const response = render(engine.toPlayerView(state, 1));
  expect(response).toContain("대응하지 않는다");
  expect(response).toContain("Loop in June");

  state = engine.applyAction(state, 1, { type: "response" });
  const defend = render(engine.toPlayerView(state, 1));
  expect(defend).toContain("오라로 받기");
  expect(defend).toContain("라이프로 받기");
});

test("선택·정렬·게임오버가 렌더된다", () => {
  const state = base();
  const choice = structuredClone(state);
  choice.pending = {
    kind: "choice",
    player: 0,
    prompt: "테스트 선택지",
    options: [
      { id: "a", label: "선택 A" },
      { id: "b", label: "선택 B" },
    ],
    branches: { a: [], b: [] },
    reveal: [choice.players[0].hand[0].uid],
    resume: [],
    ctx: { self: 0 },
  };
  const choiceHtml = render(engine.toPlayerView(choice, 0));
  expect(choiceHtml).toContain("테스트 선택지");
  expect(choiceHtml).toContain("선택 A");

  const order = structuredClone(state);
  const uids = order.players[0].deck.slice(0, 3).map((c) => c.uid);
  order.pending = {
    kind: "order",
    player: 0,
    prompt: "패산 순서를 정하세요.",
    uids,
    who: "self",
    reorder: true,
    reveal: uids,
    resume: [],
    ctx: { self: 0 },
  };
  const orderHtml = render(engine.toPlayerView(order, 0));
  expect(orderHtml).toContain("패산 정리");
  expect(orderHtml).toContain("이 순서로 확정");

  const over = structuredClone(state);
  over.phase = "gameover";
  over.pending = null;
  over.winner = 0;
  const overHtml = render(engine.toPlayerView(over, 0));
  expect(overHtml).toContain("승리");
  expect(overHtml).toContain("로비로 돌아가기");
});
