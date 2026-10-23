// 4기 ABYSS — 토아 · 랑 · 히요리 · 메리 카드 효과.

import { defineCard } from "../registry-core";
import {
  attachDamage,
  attackMod,
  aura,
  buff,
  choose,
  counter,
  discard,
  draw,
  flare,
  freeBasic,
  ifCond,
  loseAura,
  millFoe,
  move,
  moveChoice,
  opt,
  payLife,
  pierce,
  reduce,
  restrict,
  spend,
  stance,
} from "../dsl";

/* ── 시즈키 토아 ────────────────────────────── */

defineCard("TO-N-1", {
  onUse: [ifCond({ c: "stance", who: "self", value: "day" }, [draw(1)])],
  onAttack: [ifCond({ c: "stance", who: "self", value: "night" }, [attackMod(1, 0)])],
});

defineCard("TO-N-2", {
  onUse: [ifCond({ c: "stance", who: "self", value: "day" }, [aura(1)])],
  onAttack: [ifCond({ c: "stance", who: "self", value: "night" }, [attackMod(0, 1)])],
});

defineCard("TO-N-3", {
  onUse: [
    ifCond({ c: "stance", who: "self", value: "day" }, [attachDamage("foe", 1)]),
  ],
  onAttack: [ifCond({ c: "stance", who: "self", value: "night" }, [attackMod(1, 0)])],
});

defineCard("TO-N-4", { onUse: [stance("toggle"), draw(1)] });

defineCard("TO-N-5", {
  static: [
    { cond: { c: "stance", who: "self", value: "day" }, auraTaken: 1 },
    { cond: { c: "stance", who: "self", value: "night" }, attack: { aura: 1 } },
  ],
  onDestroy: [draw(1)],
});

defineCard("TO-N-6", { onResponse: [reduce(1, 0), stance("toggle")] });

defineCard("TO-N-7", {
  onUse: [
    moveChoice(),
    ifCond({ c: "stance", who: "self", value: "day" }, [aura(1)], [flare(1)]),
  ],
});

defineCard("TO-S-1", {
  onAttack: [
    ifCond({ c: "stance", who: "self", value: "night" }, [attackMod(1, 1)]),
  ],
  onAfter: [stance("day")],
});

defineCard("TO-S-2", {
  onAttack: [
    ifCond({ c: "stance", who: "self", value: "day" }, [attackMod(0, 1)]),
    ifCond({ c: "stance", who: "self", value: "night" }, [pierce()]),
  ],
});

defineCard("TO-S-3", {
  onUse: [stance("toggle"), buff(1, 1, { label: "토기도문: 앙코르" })],
});

defineCard("TO-S-4", {
  static: [{ attack: { aura: 1 } }],
  events: [{ on: "stanceChange", ops: [aura(1)] }],
  onDestroy: [draw(1)],
});

/* ── 코가네 랑 ────────────────────────────── */

defineCard("RA-N-1", { onAfter: [counter("self", "gise", 1)] });
defineCard("RA-N-2", { onAfter: [counter("self", "gise", 1)] });

defineCard("RA-N-3", {
  onAttack: [
    ifCond({ c: "counter", who: "self", name: "gise", op: ">=", n: 1 }, [
      choose("기세를 태울까?", [
        opt("burn", "기세 1 소모 (+1/+0)", [spend("self", "gise", 1), attackMod(1, 0)]),
        opt("keep", "그대로", []),
      ]),
    ]),
  ],
});

defineCard("RA-N-4", { onUse: [counter("self", "gise", 1), aura(1)] });

defineCard("RA-N-5", {
  events: [{ on: "selfLifeTaken", ops: [counter("self", "gise", 1)] }],
  onDestroy: [aura(1)],
});

defineCard("RA-N-6", {
  onResponse: [reduce(2, 0), counter("self", "gise", 1)],
});

defineCard("RA-N-7", {
  onUse: [freeBasic("advance"), counter("self", "gise", 1)],
});

defineCard("RA-S-1", {
  onAttack: [
    ifCond({ c: "counter", who: "self", name: "gise", op: ">=", n: 2 }, [
      choose("기세를 태울까?", [
        opt("burn", "기세 2 소모 (+1/+1)", [spend("self", "gise", 2), attackMod(1, 1)]),
        opt("keep", "그대로", []),
      ]),
    ]),
  ],
});

defineCard("RA-S-2", {
  playable: { c: "counter", who: "self", name: "gise", op: ">=", n: 3 },
  onAttack: [spend("self", "gise", 3), pierce()],
});

defineCard("RA-S-3", { onUse: [counter("self", "gise", 3), draw(1)] });

defineCard("RA-S-4", {
  static: [{ attack: { aura: 1 }, auraTaken: 1 }],
  onDestroy: [counter("self", "gise", 2)],
});

/* ── 하나요 히요리 ────────────────────────────── */

defineCard("HY-N-1", { onAfter: [counter("foe", "wonhan", 1)] });

defineCard("HY-N-2", {
  onAttack: [
    ifCond({ c: "counter", who: "foe", name: "wonhan", op: ">=", n: 2 }, [attackMod(1, 0)]),
  ],
});

defineCard("HY-N-3", { onAfter: [counter("foe", "wonhan", 1)] });
defineCard("HY-N-4", { onUse: [counter("foe", "wonhan", 1), draw(1)] });

defineCard("HY-N-5", {
  events: [
    {
      on: "foeTurnEnd",
      cond: { c: "counter", who: "foe", name: "wonhan", op: ">=", n: 1 },
      ops: [loseAura("foe", 1), spend("foe", "wonhan", 1)],
    },
  ],
  onDestroy: [counter("foe", "wonhan", 1)],
});

defineCard("HY-N-6", {
  onResponse: [reduce(1, 0), counter("foe", "wonhan", 1)],
});

defineCard("HY-N-7", { onUse: [move(1), restrict("foe", "retreat")] });

defineCard("HY-S-1", {
  playable: { c: "counter", who: "foe", name: "wonhan", op: ">=", n: 2 },
  onAttack: [spend("foe", "wonhan", 2), loseAura("foe", 2)],
});

defineCard("HY-S-2", {
  playable: { c: "counter", who: "foe", name: "wonhan", op: ">=", n: 3 },
  onAttack: [spend("foe", "wonhan", 3), attackMod(0, 1), pierce()],
});

defineCard("HY-S-3", { onUse: [counter("foe", "wonhan", 2), draw(1)] });

defineCard("HY-S-4", {
  static: [{ attack: { aura: 1 } }],
  events: [
    {
      on: "foeTurnEnd",
      cond: { c: "counter", who: "foe", name: "wonhan", op: ">=", n: 2 },
      ops: [loseAura("foe", 2), spend("foe", "wonhan", 2)],
    },
  ],
});

/* ── 토키노 메리 ────────────────────────────── */

defineCard("ME-N-1", { onAfter: [counter("foe", "unun", 1)] });

defineCard("ME-N-2", {
  onAttack: [
    ifCond({ c: "counter", who: "foe", name: "unun", op: ">=", n: 1 }, [attackMod(1, 0)]),
  ],
});

defineCard("ME-N-3", { onAfter: [millFoe(1)] });

defineCard("ME-N-4", {
  playable: { c: "life", who: "self", op: ">=", n: 2 },
  onUse: [counter("foe", "unun", 1), payLife(1), draw(1)],
});

defineCard("ME-N-5", {
  events: [{ on: "selfLifeDealt", once: true, ops: [counter("foe", "unun", 1)] }],
  onDestroy: [draw(1)],
});

defineCard("ME-N-6", {
  onResponse: [reduce(1, 0), counter("foe", "unun", 1)],
});

defineCard("ME-N-7", { onUse: [moveChoice(), draw(1)] });

defineCard("ME-S-1", {
  playable: { c: "counter", who: "foe", name: "unun", op: ">=", n: 1 },
  onAttack: [spend("foe", "unun", 1)],
  onAfter: [discard("foe", 1)],
});

defineCard("ME-S-2", {
  playable: { c: "counter", who: "foe", name: "unun", op: ">=", n: 2 },
  onAttack: [spend("foe", "unun", 2), pierce()],
});

defineCard("ME-S-3", {
  playable: { c: "life", who: "self", op: ">=", n: 2 },
  onUse: [counter("foe", "unun", 2), payLife(1), draw(1)],
});

defineCard("ME-S-4", {
  static: [{ attack: { aura: 1 } }, { negateFoeDraw: 1 }],
  onDestroy: [loseAura("foe", 2)],
});
