// 1기 Everys — 유니 · 후야 카드 효과.

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
  move,
  moveChoice,
  opt,
  pierce,
  reduce,
  spend,
} from "../dsl";

/* ── 아야츠노 유니 ────────────────────────────── */

defineCard("YU-N-1", {
  onAfter: [buff(1, 0, { label: "달빛 오버라이드" })],
});

defineCard("YU-N-2", {
  onAttack: [ifCond({ c: "life", who: "self", op: "<=", n: 5 }, [attackMod(1, 0)])],
});

defineCard("YU-N-3", {
  onAfter: [move(-1)],
});

defineCard("YU-N-4", {
  onUse: [draw(1), ifCond({ c: "life", who: "self", op: "<=", n: 5 }, [aura(1)])],
});

defineCard("YU-N-5", {
  static: [
    {
      cond: { c: "life", who: "self", op: "<=", n: 5 },
      attack: { aura: 1 },
    },
  ],
  onDestroy: [draw(1)],
});

defineCard("YU-N-6", {
  onUse: [
    buff(1, 1, { label: "도파민즈" }),
    ifCond({ c: "life", who: "self", op: "<=", n: 5 }, [buff(1, 0)]),
  ],
});

defineCard("YU-N-7", {
  onResponse: [reduce(2, 0)],
});

defineCard("YU-S-1", {
  onAfter: [
    choose("기본동작을 고른다.", [
      opt("advance", "전진", [freeBasic("advance")]),
      opt("retreat", "후퇴", [freeBasic("retreat")]),
    ]),
  ],
});

defineCard("YU-S-2", {
  onAttack: [
    pierce(),
    ifCond({ c: "life", who: "self", op: "<=", n: 5 }, [attackMod(0, 1)]),
  ],
});

defineCard("YU-S-3", {
  onUse: [
    buff(1, 0, { charges: 2, label: "도파민즈 러시" }),
    ifCond({ c: "life", who: "self", op: "<=", n: 5 }, [
      buff(0, 0, { charges: 2, rangeExpand: 1 }),
    ]),
  ],
});

defineCard("YU-S-4", {
  static: [
    {
      cond: { c: "life", who: "self", op: "<=", n: 5 },
      attack: { aura: 1, life: 1 },
    },
  ],
  onDestroy: [draw(1)],
});

/* ── 사키하네 후야 ────────────────────────────── */

defineCard("HU-N-1", {
  onAfter: [counter("self", "seonggwang", 1)],
});

defineCard("HU-N-2", {
  onUse: [moveChoice(), counter("self", "seonggwang", 1)],
});

defineCard("HU-N-3", {
  onUse: [
    buff(1, 0, { onlyStella: "partner", label: "오츠카레summer" }),
    ifCond({ c: "counter", who: "self", name: "seonggwang", op: ">=", n: 2 }, [
      buff(0, 1, { onlyStella: "partner" }),
    ]),
  ],
});

defineCard("HU-N-4", {
  playable: { c: "counter", who: "self", name: "seonggwang", op: ">=", n: 1 },
  onUse: [
    spend("self", "seonggwang", 1),
    buff(0, 0, { onlyStella: "partner", rangeExpand: 1 }),
  ],
});

defineCard("HU-N-5", {
  events: [
    {
      on: "selfAttack",
      onlyStella: "partner",
      once: true,
      ops: [counter("self", "seonggwang", 1)],
    },
  ],
  onDestroy: [aura(1)],
});

defineCard("HU-N-6", {
  onUse: [
    ifCond({ c: "counter", who: "self", name: "seonggwang", op: ">=", n: 2 }, [
      choose("성광을 몇 개 소모할까?", [
        opt("two", "2 소모, 2장 드로우", [spend("self", "seonggwang", 2), draw(2)]),
        opt("one", "1 소모, 1장 드로우", [spend("self", "seonggwang", 1), draw(1)]),
        opt("zero", "소모하지 않는다", []),
      ]),
    ], [
      ifCond({ c: "counter", who: "self", name: "seonggwang", op: ">=", n: 1 }, [
        choose("성광을 소모할까?", [
          opt("one", "1 소모, 1장 드로우", [spend("self", "seonggwang", 1), draw(1)]),
          opt("zero", "소모하지 않는다", []),
        ]),
      ]),
    ]),
  ],
});

defineCard("HU-N-7", {
  onResponse: [reduce(2, 0), counter("self", "seonggwang", 1)],
});

defineCard("HU-S-1", {
  onAfter: [counter("self", "seonggwang", 2)],
});

defineCard("HU-S-2", {
  onAttack: [
    pierce(),
    ifCond({ c: "counter", who: "self", name: "seonggwang", op: ">=", n: 3 }, [
      attackMod(1, 1),
    ]),
  ],
});

defineCard("HU-S-3", {
  onUse: [
    counter("self", "seonggwang", 3),
    buff(2, 1, { onlyStella: "partner", label: "후야는 용" }),
  ],
});

defineCard("HU-S-4", {
  static: [
    {
      onlyStella: "partner",
      perCounter: { name: "seonggwang", life: 1, max: 2 },
    },
  ],
  onDestroy: [draw(1)],
});
