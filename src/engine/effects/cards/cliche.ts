// 3기 Cliché — 시부키 · 린 · 나나 · 리코 카드 효과.

import { defineCard } from "../registry-core";
import {
  attackMod,
  aura,
  buff,
  choose,
  counter,
  draw,
  freeBasic,
  ifCond,
  loseAura,
  move,
  moveChoice,
  opt,
  peek,
  pierce,
  putHandBottom,
  reduce,
  spend,
} from "../dsl";

/* ── 텐코 시부키 ────────────────────────────── */

defineCard("SH-N-1", { onAfter: [counter("self", "chungjeon", 1)] });
defineCard("SH-N-2", {
  onAttack: [ifCond({ c: "counter", who: "self", name: "chungjeon", op: ">=", n: 2 }, [attackMod(1, 0)])],
});
defineCard("SH-N-3", { onAfter: [counter("self", "chungjeon", 1)] });
defineCard("SH-N-4", { onUse: [counter("self", "chungjeon", 1), draw(1)] });

defineCard("SH-N-5", {
  events: [{ on: "selfCardUse", once: true, ops: [counter("self", "chungjeon", 1)] }],
  onDestroy: [counter("self", "chungjeon", 1)],
});

defineCard("SH-N-6", {
  playable: { c: "counter", who: "self", name: "chungjeon", op: ">=", n: 1 },
  onUse: [spend("self", "chungjeon", 1), moveChoice(), draw(1)],
});

defineCard("SH-N-7", {
  onResponse: [reduce(1, 0), counter("self", "chungjeon", 1)],
});

defineCard("SH-S-1", {
  onAttack: [
    ifCond({ c: "counter", who: "self", name: "chungjeon", op: ">=", n: 2 }, [
      choose("충전을 태울까?", [
        opt("burn", "충전 2 소모 (+2/+1)", [spend("self", "chungjeon", 2), attackMod(2, 1)]),
        opt("keep", "그대로", []),
      ]),
    ]),
  ],
});

defineCard("SH-S-2", {
  playable: { c: "counter", who: "self", name: "chungjeon", op: ">=", n: 3 },
  onAttack: [spend("self", "chungjeon", 3), pierce()],
});

defineCard("SH-S-3", {
  onUse: [counter("self", "chungjeon", 3), buff(1, 0, { label: "행복" })],
});

defineCard("SH-S-4", {
  static: [{ attack: { aura: 1 } }],
  onDestroy: [counter("self", "chungjeon", 3)],
});

/* ── 아오쿠모 린 ────────────────────────────── */

defineCard("RI-N-1", { onAfter: [peek("self", 1, "optionalBottom")] });

defineCard("RI-N-2", {
  onAfter: [
    draw(1),
    choose("손패 1장을 패산 아래로 보낼까?", [
      opt("yes", "보낸다", [putHandBottom(1)]),
      opt("no", "그대로 둔다", []),
    ]),
  ],
});

defineCard("RI-N-3", { onAfter: [peek("self", 1, "keep")] });
defineCard("RI-N-4", { onUse: [peek("self", 3, "reorder"), draw(1)] });

defineCard("RI-N-5", {
  events: [{ on: "turnStart", ops: [peek("self", 1, "keep")] }],
  onDestroy: [draw(1)],
});

defineCard("RI-N-6", { onUse: [putHandBottom(1), draw(2)] });
defineCard("RI-N-7", { onResponse: [reduce(1, 0), peek("self", 1, "keep")] });
defineCard("RI-S-1", { onAfter: [peek("foe", 1, "optionalBottom")] });

defineCard("RI-S-2", {
  onAttack: [
    pierce(),
    ifCond({ c: "deckTopType", who: "self", value: "attack" }, [attackMod(1, 0)]),
  ],
});

defineCard("RI-S-3", { onUse: [peek("self", 5, "reorder"), draw(1)] });

defineCard("RI-S-4", {
  static: [{ attack: { aura: 1 } }],
  onDestroy: [draw(1)],
});

/* ── 하나코 나나 ────────────────────────────── */

defineCard("NA-N-1", { onAfter: [counter("foe", "pyojeok", 1)] });
defineCard("NA-N-2", {
  onAttack: [ifCond({ c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 1 }, [attackMod(1, 0)])],
});
defineCard("NA-N-3", { onAfter: [counter("foe", "pyojeok", 1)] });
defineCard("NA-N-4", { onUse: [counter("foe", "pyojeok", 1), draw(1)] });

defineCard("NA-N-5", {
  static: [
    {
      cond: { c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 1 },
      attack: { aura: 1 },
    },
  ],
  onDestroy: [counter("foe", "pyojeok", 1)],
});

defineCard("NA-N-6", {
  onResponse: [reduce(1, 0), counter("foe", "pyojeok", 1)],
});

defineCard("NA-N-7", {
  onUse: [
    moveChoice(),
    ifCond({ c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 1 }, [draw(1)]),
  ],
});

defineCard("NA-S-1", {
  onAttack: [
    ifCond({ c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 1 }, [pierce()]),
  ],
});

defineCard("NA-S-2", {
  playable: { c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 1 },
  onAttack: [spend("foe", "pyojeok", 1), attackMod(0, 1)],
});

defineCard("NA-S-3", {
  playable: { c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 2 },
  onUse: [spend("foe", "pyojeok", 2), loseAura("foe", 2), draw(1)],
});

defineCard("NA-S-4", {
  static: [
    {
      cond: { c: "counter", who: "foe", name: "pyojeok", op: ">=", n: 1 },
      attack: { aura: 1 },
    },
  ],
  onDestroy: [counter("foe", "pyojeok", 1)],
});

/* ── 유즈하 리코 ────────────────────────────── */

defineCard("RK-N-1", {
  onAttack: [ifCond({ c: "attacks", op: ">=", n: 2 }, [attackMod(1, 0)])],
});

defineCard("RK-N-2", { onAfter: [aura(1)] });
defineCard("RK-N-3", {});
defineCard("RK-N-4", { onUse: [draw(1), buff(1, 0, { label: "Orange" })] });

defineCard("RK-N-5", {
  static: [{ cond: { c: "attacks", op: ">=", n: 2 }, attack: { aura: 1 } }],
  onDestroy: [draw(1)],
});

defineCard("RK-N-6", {
  onUse: [move(-1), ifCond({ c: "attacks", op: ">=", n: 2 }, [draw(1)])],
});

defineCard("RK-N-7", { onResponse: [reduce(2, 0)] });
defineCard("RK-S-1", { onAfter: [freeBasic("advance")] });

defineCard("RK-S-2", {
  onAttack: [ifCond({ c: "attacks", op: ">=", n: 2 }, [attackMod(1, 1)])],
});

defineCard("RK-S-3", {
  onUse: [buff(2, 0, { minAttacks: 2, label: "네잎클로버" }), draw(1)],
});

defineCard("RK-S-4", {
  static: [{ cond: { c: "attacks", op: ">=", n: 2 }, attack: { aura: 1, life: 1 } }],
  onDestroy: [loseAura("foe", 1)],
});
