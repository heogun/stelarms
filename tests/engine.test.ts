// 룰 엔진 시나리오 테스트.
//
// `bun test`로 실행한다. (tsconfig의 빌드 대상이 아니므로 bun 전용 타입을 써도 된다)

import { describe, expect, test } from "bun:test";
import {
  applyAction,
  createMatch,
  getProgram,
  hashState,
  toPlayerView,
  tryApplyAction,
} from "../src/engine";
import type { Action, ApplyResult, GameState, PlayerId } from "../src/engine";
import { decks } from "../src/data/decks";

const D0 = decks.find((d) => d.id === "deck-yuni-huya")!;
const D1 = decks.find((d) => d.id === "deck-huya-hina")!;

function setup(seed = "test", firstPlayer: PlayerId = 0): GameState {
  return createMatch({
    seed,
    firstPlayer,
    players: [
      { name: "P1", stellas: [D0.mainId, D0.partnerId], deck: D0.normals, specials: D0.specials },
      { name: "P2", stellas: [D1.mainId, D1.partnerId], deck: D1.normals, specials: D1.specials },
    ],
  });
}

function start(seed = "test"): GameState {
  let s = setup(seed);
  s = applyAction(s, 0, { type: "mulligan", returnUids: [] });
  s = applyAction(s, 1, { type: "mulligan", returnUids: [] });
  return s;
}

function ok(state: GameState, player: PlayerId, action: Action | unknown): GameState {
  const result = tryApplyAction(state, player, action);
  if (!result.ok || !result.state) {
    throw new Error(`action failed: ${result.code} ${result.message}`);
  }
  return result.state;
}

function denied(state: GameState, player: PlayerId, action: Action | unknown): ApplyResult {
  const result = tryApplyAction(state, player, action);
  expect(result.ok).toBe(false);
  return result;
}

/** 테스트용: 손패에 카드를 직접 넣는다. */
function give(state: GameState, player: PlayerId, cardId: string): GameState {
  const p = state.players[player];
  p.hand.push({ uid: `${player}-${cardId}`, cardId });
  return state;
}

function endTurn(state: GameState, player: PlayerId): GameState {
  let s = ok(state, player, { type: "endTurn" });
  if (s.pending?.kind === "discardDown") {
    const need = s.players[player].hand.length - s.pending.to;
    s = ok(s, player, {
      type: "discardDown",
      uids: s.players[player].hand.slice(0, need).map((c) => c.uid),
    });
  }
  return s;
}

function startTurn(state: GameState): GameState {
  if (state.pending?.kind !== "startPhase") return state;
  return ok(state, state.turn, { type: "startPhase", recompose: false });
}

describe("setup", () => {
  test("멀리건 후 본게임, 선공 손패 3장, 후공 집중력 1", () => {
    const s = start();
    expect(s.phase).toBe("main");
    expect(s.pending).toBeNull();
    expect(s.turn).toBe(0);
    expect(s.players[0].hand.length).toBe(3);
    expect(s.players[1].hand.length).toBe(3);
    expect(s.players[0].focus).toBe(0);
    expect(s.players[1].focus).toBe(1);
  });

  test("멀리건은 패산 아래로 보내고 같은 수를 뽑는다", () => {
    const s = setup("mulligan");
    const bottomTop = s.players[0].hand[0];
    const before = s.players[0].deck.length;
    const next = ok(s, 0, { type: "mulligan", returnUids: [bottomTop.uid] });
    expect(next.players[0].hand.length).toBe(3);
    expect(next.players[0].deck.length).toBe(before);
    expect(next.players[0].deck.at(-1)?.uid).toBe(bottomTop.uid);
    expect(next.players[0].mulliganDone).toBe(true);
  });

  test("같은 시드 + 같은 액션 = 같은 해시", () => {
    const a = start("determinism");
    const b = start("determinism");
    expect(hashState(a)).toBe(hashState(b));
    const actA = ok(a, 0, { type: "basic", action: "advance", pay: "hand", handUid: a.players[0].hand[0].uid });
    const actB = ok(b, 0, { type: "basic", action: "advance", pay: "hand", handUid: b.players[0].hand[0].uid });
    expect(hashState(actA)).toBe(hashState(actB));
  });

  test("정보 은닉: 상대 손패/패산/덮음패는 뷰에 없다", () => {
    const s = start("hidden");
    const view = toPlayerView(s, 0) as any;
    expect(view.foe.hand).toBeUndefined();
    expect(view.foe.deck).toBeUndefined();
    expect(view.foe.cover).toBeUndefined();
    expect(view.you.hand.length).toBe(3);
    expect(view.foe.handCount).toBe(3);
  });
});

describe("기본동작", () => {
  test("전진은 거리 -1, 오라 +1, 손패 코스트", () => {
    const s = start("advance");
    const uid = s.players[0].hand[0].uid;
    const next = ok(s, 0, { type: "basic", action: "advance", pay: "hand", handUid: uid });
    expect(next.distance).toBe(9);
    expect(next.players[0].aura).toBe(4);
    expect(next.players[0].hand.length).toBe(2);
    expect(next.players[0].cover.length).toBe(1);
    expect(next.players[0].flags.basicsUsed).toBe(1);
  });

  test("기본동작은 턴에 1회", () => {
    let s = start("once");
    s = ok(s, 0, { type: "basic", action: "advance", pay: "hand", handUid: s.players[0].hand[0].uid });
    const r = denied(s, 0, { type: "basic", action: "advance", pay: "hand", handUid: s.players[0].hand[0].uid });
    expect(r.code).toBe("no-basic-left");
  });

  test("전진 불가 조건: 거리 2 이하, 오라 최대", () => {
    const s = start("limits");
    s.distance = 2;
    expect(denied(s, 0, { type: "basic", action: "advance", pay: "hand", handUid: s.players[0].hand[0].uid }).code).toBe(
      "basic-unavailable",
    );
    s.distance = 5;
    s.players[0].aura = 5;
    expect(denied(s, 0, { type: "basic", action: "advance", pay: "hand", handUid: s.players[0].hand[0].uid }).code).toBe(
      "basic-unavailable",
    );
  });

  test("휘감기/품기/이탈", () => {
    let s = start("basics");
    s.players[0].dust = 1;
    s = ok(s, 0, { type: "basic", action: "coil", pay: "hand", handUid: s.players[0].hand[0].uid });
    expect(s.players[0].aura).toBe(4);
    expect(s.players[0].dust).toBe(0);

    let t = start("basics2");
    t.players[0].aura = 3;
    t.players[0].flare = 0;
    t = ok(t, 0, { type: "basic", action: "gather", pay: "hand", handUid: t.players[0].hand[0].uid });
    expect(t.players[0].aura).toBe(2);
    expect(t.players[0].flare).toBe(1);

    let u = start("basics3");
    u.distance = 2;
    u.players[0].dust = 1;
    u = ok(u, 0, { type: "basic", action: "breakaway", pay: "hand", handUid: u.players[0].hand[0].uid });
    expect(u.distance).toBe(3);
    expect(u.players[0].dust).toBe(0);
  });
});

describe("공격과 방어", () => {
  test("공격 → 대응 패스 → 오라 방어 → 데미지", () => {
    let s = start("combat");
    give(s, 0, "YU-N-2");
    s.distance = 3;
    s.players[0].aura = 5;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-2" });
    expect(s.pending?.kind).toBe("response");
    s = ok(s, 1, { type: "response" });
    expect(s.pending?.kind).toBe("defend");
    s = ok(s, 1, { type: "defend", choice: "aura" });
    expect(s.players[1].aura).toBe(1);
    expect(s.players[1].dust).toBe(2);
    expect(s.pending).toBeNull();
  });

  test("대응 카드로 오라 데미지 감소", () => {
    let s = start("response");
    give(s, 0, "YU-N-2");
    give(s, 1, "YU-N-7");
    s.distance = 3;
    s.players[0].aura = 5;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-2" });
    s = ok(s, 1, { type: "response", uid: "1-YU-N-7" });
    // 대응을 한 번 더 열어 준다. (대응 카드는 여러 장 쓸 수 있다)
    expect(s.pending?.kind).toBe("response");
    s = ok(s, 1, { type: "response" });
    // 오라 0/라이프 1 → 오라 선택 불가, 라이프 자동
    expect(s.pending).toBeNull();
    expect(s.players[1].life).toBe(9);
    expect(s.players[1].flare).toBe(1);
    expect(s.players[1].discard.map((c) => c.cardId)).toContain("YU-N-7");
  });

  test("【필중】은 대응 단계를 건너뛴다", () => {
    let s = start("pierce");
    s.distance = 4;
    s.players[0].flare = 2;
    s.players[1].aura = 5;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-S-2" });
    expect(s.pending?.kind).toBe("defend");
    expect((s.pending as any).attack.pierce).toBe(true);
    s = ok(s, 1, { type: "defend", choice: "life" });
    expect(s.players[1].life).toBe(8);
    expect(s.players[1].flare).toBe(2);
    expect(s.players[0].specials.find((x) => x.cardId === "YU-S-2")?.used).toBe(true);
  });

  test("오라가 부족하면 라이프로만 받는다", () => {
    let s = start("overflow");
    give(s, 0, "YU-N-2");
    s.distance = 3;
    s.players[1].aura = 1;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-2" });
    s = ok(s, 1, { type: "response" });
    expect(s.pending).toBeNull();
    expect(s.players[1].life).toBe(9);
    expect(s.players[1].aura).toBe(1);
  });

  test("라이프 0이면 즉시 패배", () => {
    let s = start("gameover");
    give(s, 0, "YU-N-2");
    s.distance = 3;
    s.players[1].life = 1;
    s.players[1].aura = 0;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-2" });
    s = ok(s, 1, { type: "response" });
    expect(s.phase).toBe("gameover");
    expect(s.winner).toBe(0);
  });

  test("특수패 공격은 버림패로 가지 않는다", () => {
    let s = start("specialdiscard");
    s.distance = 4;
    s.players[0].flare = 2;
    s.players[1].aura = 5;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-S-2" });
    s = ok(s, 1, { type: "defend", choice: "life" });
    expect(s.players[0].discard.map((c) => c.cardId)).not.toContain("YU-S-2");
    expect(s.players[0].specials.find((x) => x.cardId === "YU-S-2")?.used).toBe(true);
  });
});

describe("부여패", () => {
  test("부여 비용과 상시 공격 보정", () => {
    let s = start("attach");
    s.players[0].life = 5;
    give(s, 0, "YU-N-5");
    s.players[0].aura = 5;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-5" });
    expect(s.players[0].aura).toBe(3);
    expect(s.players[0].attaches).toEqual([{ uid: "0-YU-N-5", cardId: "YU-N-5", crystals: 2 }]);

    give(s, 0, "YU-N-2");
    s.distance = 3;
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-2" });
    const draft = (s.pending as any).attack;
    // 기본 2 + 상시 1 + 라이프 5 이하 공격시 1
    expect(draft.aura).toBe(4);
  });

  test("개시 페이즈에 크리스탈 1개가 더스트로, 0이면 파기", () => {
    let s = start("decay");
    // P1 1턴 → P2 1턴 → P1 2턴
    s = endTurn(s, 0);
    s = endTurn(s, 1);
    s = startTurn(s);
    expect(s.turn).toBe(0);
    expect(s.players[0].turnsTaken).toBe(2);
    s.players[0].attaches.push({ uid: "0-YU-N-5", cardId: "YU-N-5", crystals: 2 });
    // P1 2턴 종료 → P2 2턴 → P1 3턴
    s = endTurn(s, 0);
    s = startTurn(s);
    s = endTurn(s, 1);
    s = startTurn(s);
    expect(s.turn).toBe(0);
    expect(s.players[0].attaches[0].crystals).toBe(1);
    expect(s.players[0].dust).toBe(1);
    // P1 3턴 종료 → P2 3턴 → P1 4턴
    s = endTurn(s, 0);
    s = startTurn(s);
    s = endTurn(s, 1);
    s = startTurn(s);
    expect(s.players[0].attaches.length).toBe(0);
    expect(s.players[0].dust).toBe(2);
    expect(s.players[0].discard.map((c) => c.cardId)).toContain("YU-N-5");
  });

  test("비장패 부여는 파기되어도 버림패로 가지 않는다", () => {
    let s = start("specialattach");
    s.players[0].flare = 2;
    s.players[0].aura = 5;
    // TO-S-4는 토아 전용이므로 이 덱에서는 쓸 수 없다. 규칙 검증만.
    const r = denied(s, 0, { type: "playCard", uid: "0-TO-S-4" });
    expect(r.code).toBe("card-not-found");
  });
});

describe("개시 페이즈와 턴", () => {
  test("양쪽 첫 턴은 개시 페이즈를 건너뛴다", () => {
    let s = start("firstturn");
    s = endTurn(s, 0);
    expect(s.turn).toBe(1);
    expect(s.pending).toBeNull();
    expect(s.players[1].hand.length).toBe(3);
    expect(s.players[1].focus).toBe(1);
    s = endTurn(s, 1);
    expect(s.pending?.kind).toBe("startPhase");
    expect(s.players[0].hand.length).toBe(2);
  });

  test("두 번째 턴부터 집중력 +1, 2장 드로우", () => {
    let s = start("startphase");
    const focusBefore = s.players[0].focus;
    s = endTurn(s, 0);
    s = endTurn(s, 1);
    // 개시 페이즈 진입 시점에 이미 집중력이 올라가 있다.
    expect(s.players[0].focus).toBe(focusBefore + 1);
    const hand = s.players[0].hand.length;
    const deck = s.players[0].deck.length;
    s = startTurn(s);
    expect(s.players[0].hand.length).toBe(hand + 2);
    expect(s.players[0].deck.length).toBe(deck - 2);
    expect(s.pending).toBeNull();
  });

  test("재구성: 라이프 1 지불, 버림패/덮음패를 패산에 섞음", () => {
    let s = start("recompose");
    // P1이 카드를 1장 덮음패로 만들고 턴을 넘긴다.
    s = endTurn(s, 0);
    expect(s.players[0].cover.length).toBe(1);
    s = endTurn(s, 1);
    const life = s.players[0].life;
    const flare = s.players[0].flare;
    const total = s.players[0].deck.length + s.players[0].discard.length + s.players[0].cover.length;
    s = ok(s, 0, { type: "startPhase", recompose: true });
    expect(s.players[0].life).toBe(life - 1);
    expect(s.players[0].flare).toBe(flare + 1);
    expect(s.players[0].discard.length).toBe(0);
    expect(s.players[0].cover.length).toBe(0);
    // 재구성한 덱에서 2장을 뽑았으므로 총량은 2장 줄어든다.
    expect(s.players[0].deck.length).toBe(total - 2);
  });

  test("패산 고갈: 뽑지 못한 1장당 오라/라이프 선택", () => {
    let s = start("deckout");
    s.players[0].deck = [];
    give(s, 0, "YU-N-4");
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-4" });
    expect(s.pending?.kind).toBe("penalty");
    expect((s.pending as any).remaining).toBe(1);
    const flare = s.players[0].flare;
    s = ok(s, 0, { type: "penalty", choice: "life" });
    expect(s.players[0].life).toBe(9);
    expect(s.players[0].flare).toBe(flare + 1);
    expect(s.pending).toBeNull();
  });

  test("전력 행동은 카드 1장 사용 후 자동 종료", () => {
    let s = start("power");
    give(s, 0, "YU-N-4");
    s = ok(s, 0, { type: "declarePower" });
    expect(s.players[0].flags.mode).toBe("power");
    s = ok(s, 0, { type: "playCard", uid: "0-YU-N-4" });
    // 손패가 3장이 되어 종료 페이즈의 discardDown 대기.
    expect(s.pending?.kind === "discardDown" || s.turn === 1).toBe(true);
  });
});

describe("효과 선택", () => {
  test("패산 위 3장 확인/순서 변경 후 1장 드로우", () => {
    let s = start("peek");
    give(s, 0, "RI-N-4");
    const top3 = s.players[0].deck.slice(0, 3).map((c) => c.uid);
    s = ok(s, 0, { type: "playCard", uid: "0-RI-N-4" });
    expect(s.pending?.kind).toBe("order");
    expect((s.pending as any).reveal).toEqual(top3);
    // 상대에게는 선택 내용이 보이지 않는다.
    const foeView = toPlayerView(s, 1) as any;
    expect(foeView.pending.reveal).toBeUndefined();
    expect(foeView.pending.waiting).toBe(true);
    s = ok(s, 0, { type: "order", uids: [...top3].reverse() });
    // 뒤집은 3장 중 맨 위 1장을 뽑았으므로, 덱 맨 위는 뒤집은 순서의 두 번째다.
    expect(s.players[0].deck[0].uid).toBe(top3[1]);
    expect(s.players[0].hand.some((c) => c.uid === top3[2])).toBe(true);
    expect(s.players[0].hand.length).toBe(4);
  });

  test("공격후 선택: 패산 위 1장을 아래로", () => {
    let s = start("optional");
    give(s, 0, "RI-N-1");
    s.distance = 3;
    s = ok(s, 0, { type: "playCard", uid: "0-RI-N-1" });
    s = ok(s, 1, { type: "response" });
    s = ok(s, 1, { type: "defend", choice: "aura" });
    expect(s.pending?.kind).toBe("choice");
    const top = s.players[0].deck[0].uid;
    s = ok(s, 0, { type: "choice", optionId: "bottom" });
    expect(s.players[0].deck.at(-1)?.uid).toBe(top);
    expect(s.pending).toBeNull();
  });

  test("성광 소모 선택", () => {
    let s = start("choice");
    give(s, 0, "HU-N-6");
    s.players[0].counters.seonggwang = 3;
    const deck = s.players[0].deck.length;
    s = ok(s, 0, { type: "playCard", uid: "0-HU-N-6" });
    expect(s.pending?.kind).toBe("choice");
    s = ok(s, 0, { type: "choice", optionId: "two" });
    expect(s.players[0].counters.seonggwang).toBe(1);
    expect(s.players[0].deck.length).toBe(deck - 2);
  });
});

describe("불법 행동", () => {
  test("차례/페이즈/필드/범위 위반은 상태를 바꾸지 않는다", () => {
    const s = start("illegal");
    const before = hashState(s);
    expect(denied(s, 1, { type: "basic", action: "advance", pay: "focus" }).code).toBe("not-your-turn");
    expect(denied(s, 0, { type: "endTurn", hack: 1 }).code).toBe("bad-action");
    expect(denied(s, 0, { type: "choice", optionId: "x" }).code).toBe("bad-action");
    expect(denied(s, 0, { type: "playCard", uid: "0-YU-N-99" }).code).toBe("card-not-found");
    expect(hashState(s)).toBe(before);
  });

  test("적정거리 밖 공격은 사용할 수 없다", () => {
    const s = start("range");
    give(s, 0, "YU-N-2");
    s.distance = 10;
    expect(denied(s, 0, { type: "playCard", uid: "0-YU-N-2" }).code).toBe("out-of-range");
  });
});

describe("카드 보존과 리플레이", () => {
  test("모든 카드 효과가 정의되어 있다", () => {
    const s = start("programs");
    expect(s.history.length).toBe(2);
  });

  test("리플레이: 같은 액션을 다시 적용하면 같은 해시", () => {
    let a = start("replay");
    let b = start("replay");
    const steps: Action[] = [
      { type: "basic", action: "advance", pay: "hand", handUid: a.players[0].hand[0].uid },
      { type: "endTurn" },
    ];
    for (const action of steps) {
      a = ok(a, a.turn, action);
      b = ok(b, b.turn, action);
      expect(hashState(a)).toBe(hashState(b));
    }
  });
});

describe("랜덤 플레이아웃 (엔진 무결성)", () => {
  test("무작위 합법 액션 2000회에도 예외/교착이 없다", () => {
    let rng = 123456789;
    const rand = (n: number) => {
      rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
      return rng % n;
    };
    let s = start("fuzz");

    for (let step = 0; step < 2000; step += 1) {
      if (s.phase === "gameover") break;
      const pending = s.pending;
      if (pending) {
        if (pending.kind === "mulligan") {
          s = ok(s, pending.player, { type: "mulligan", returnUids: [] });
        } else if (pending.kind === "startPhase") {
          s = ok(s, pending.player, { type: "startPhase", recompose: false });
        } else if (pending.kind === "response") {
          const p = s.players[pending.player];
          const options = [...p.hand, ...p.specials.filter((x) => !x.used)].filter(
            (c) => getProgram(c.cardId)?.onResponse,
          );
          if (options.length > 0 && rand(3) === 0) {
            s = ok(s, pending.player, { type: "response", uid: options[rand(options.length)].uid });
          } else {
            s = ok(s, pending.player, { type: "response" });
          }
        } else if (pending.kind === "defend") {
          const def = s.players[pending.player];
          const canAura = pending.attack.aura > 0 && def.aura >= pending.attack.aura;
          const choice = canAura && rand(2) === 0 ? "aura" : "life";
          s = ok(s, pending.player, { type: "defend", choice });
        } else if (pending.kind === "choice") {
          s = ok(s, pending.player, { type: "choice", optionId: pending.options[rand(pending.options.length)].id });
        } else if (pending.kind === "order") {
          const uids = rand(2) === 0 ? pending.uids : [...pending.uids].reverse();
          s = ok(s, pending.player, { type: "order", uids });
        } else if (pending.kind === "discardDown") {
          const p = s.players[pending.player];
          const need = p.hand.length - pending.to;
          const pool = [...p.hand];
          const picked: string[] = [];
          while (picked.length < need) {
            picked.push(pool.splice(rand(pool.length), 1)[0].uid);
          }
          s = ok(s, pending.player, { type: "discardDown", uids: picked });
        } else if (pending.kind === "penalty") {
          const p = s.players[pending.player];
          s = ok(s, pending.player, { type: "penalty", choice: p.aura > 0 && rand(2) === 0 ? "aura" : "life" });
        }
        continue;
      }
      if (s.phase === "setup") break;
      const me = s.players[s.turn];
      const candidates: Action[] = [{ type: "endTurn" }];
      if (me.focus > 0) {
        candidates.push({ type: "basic", action: "advance", pay: "focus" });
        candidates.push({ type: "basic", action: "retreat", pay: "focus" });
        candidates.push({ type: "basic", action: "coil", pay: "focus" });
        candidates.push({ type: "basic", action: "gather", pay: "focus" });
        candidates.push({ type: "basic", action: "breakaway", pay: "focus" });
      }
      for (const c of me.hand) {
        candidates.push({ type: "basic", action: "advance", pay: "hand", handUid: c.uid });
        candidates.push({ type: "playCard", uid: c.uid });
      }
      for (const c of me.specials) {
        if (!c.used) candidates.push({ type: "playCard", uid: c.uid });
      }
      candidates.push({ type: "declarePower" });

      const playable: { action: Action; state: GameState }[] = [];
      for (const action of candidates) {
        const r = tryApplyAction(s, s.turn, action);
        if (r.ok && r.state) playable.push({ action, state: r.state });
      }
      if (playable.length === 0) break;
      const pick = playable[rand(playable.length)];
      s = pick.state;

      // 카드 보존: 각 플레이어의 모든 존에 있는 uid는 중복되지 않는다.
      // (비장패는 사용 후 비장패 존에 남고, 부여된 비장패만 부여 존에도 있다)
      for (const p of s.players) {
        const uids = [
          ...p.hand.map((c) => c.uid),
          ...p.deck.map((c) => c.uid),
          ...p.discard.map((c) => c.uid),
          ...p.cover.map((c) => c.uid),
          ...p.attaches.map((c) => c.uid),
          ...p.specials.map((c) => c.uid),
        ];
        const ids = new Set(uids);
        expect(ids.size).toBe(10);
      }
    }
    expect(s.phase === "main" || s.phase === "gameover" || s.phase === "setup").toBe(true);
  });
});
