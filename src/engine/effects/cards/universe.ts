// 2기 Universe — 히나 · 마시로 · 리제 · 타비 카드 효과.

import { defineCard } from "../registry-core";
import {
  attachDamage,
  attachDamageCard,
  attackMod,
  aura,
  destroyAttach,
  draw,
  extraBasic,
  flare,
  freeBasic,
  ifCond,
  loseAura,
  loseFlare,
  move,
  moveChoice,
  payLife,
  pierce,
  reduce,
  restrict,
} from "../dsl";

/* ── 시라유키 히나 ────────────────────────────── */

defineCard("HI-N-1", {});
defineCard("HI-N-2", {});

defineCard("HI-N-3", { onAfter: [move(1)] });
defineCard("HI-N-4", { onUse: [move(1), draw(1)] });

defineCard("HI-N-5", {
  events: [{ on: "foeAdvance", once: true, ops: [loseAura("foe", 1)] }],
  onDestroy: [draw(1)],
});

defineCard("HI-N-6", { onResponse: [reduce(0, 1)] });

defineCard("HI-N-7", {
  onUse: [
    restrict("foe", "advance"),
    ifCond({ c: "distance", op: ">=", n: 6 }, [draw(1)]),
  ],
});

defineCard("HI-S-1", { onAfter: [move(1)] });

defineCard("HI-S-2", {
  onAttack: [ifCond({ c: "aura", who: "foe", op: ">=", n: 3 }, [attackMod(1, 0)])],
});

defineCard("HI-S-3", {
  onUse: [move(2), restrict("foe", "advance"), restrict("foe", "retreat")],
});

defineCard("HI-S-4", {
  static: [{ attack: { aura: 1 } }],
  events: [{ on: "foeAttack", once: true, ops: [loseAura("foe", 1)] }],
  onDestroy: [move(1)],
});

/* ── 네네코 마시로 ────────────────────────────── */

defineCard("MA-N-1", { onAfter: [extraBasic(1)] });
defineCard("MA-N-2", { onAfter: [aura(1)] });
defineCard("MA-N-3", { onUse: [freeBasic("advance"), draw(1)] });
defineCard("MA-N-4", { onUse: [aura(1), extraBasic(1)] });

defineCard("MA-N-5", {
  events: [{ on: "turnStart", once: true, ops: [extraBasic(1)] }],
  onDestroy: [draw(1)],
});

defineCard("MA-N-6", {
  onAttack: [ifCond({ c: "distance", op: "<=", n: 2 }, [attackMod(1, 0)])],
});

defineCard("MA-N-7", { onResponse: [reduce(1, 0)] });
defineCard("MA-S-1", { onAfter: [freeBasic("retreat")] });
defineCard("MA-S-2", { onAttack: [pierce()] });
defineCard("MA-S-3", { onUse: [extraBasic(2), draw(1)] });

defineCard("MA-S-4", {
  static: [{ attack: { aura: 1 } }],
  onDestroy: [loseAura("foe", 1)],
});

/* ── 아카네 리제 ────────────────────────────── */

defineCard("LI-N-1", {
  onAttack: [ifCond({ c: "flare", who: "self", op: ">=", n: 2 }, [attackMod(1, 0)])],
});

defineCard("LI-N-2", {
  onAfter: [ifCond({ c: "dealtLife" }, [flare(1)])],
});

defineCard("LI-N-3", {
  onAfter: [
    ifCond({ c: "aura", who: "self", op: ">=", n: 1 }, [loseAura("self", 1), flare(1)]),
  ],
});

defineCard("LI-N-4", {
  playable: { c: "life", who: "self", op: ">=", n: 2 },
  onUse: [payLife(1), draw(1)],
});

defineCard("LI-N-5", {
  events: [{ on: "selfLifeDealt", ops: [flare(1)] }],
  onDestroy: [draw(1)],
});

defineCard("LI-N-6", {
  playable: { c: "flare", who: "self", op: ">=", n: 2 },
  onUse: [loseFlare("self", 2), moveChoice(), draw(1)],
});

defineCard("LI-N-7", { onResponse: [reduce(0, 1), flare(1)] });

defineCard("LI-S-1", {
  onAfter: [ifCond({ c: "life", who: "self", op: ">=", n: 2 }, [payLife(1)])],
});

defineCard("LI-S-2", {
  onAttack: [
    pierce(),
    ifCond({ c: "flare", who: "self", op: ">=", n: 3 }, [attackMod(1, 1)]),
  ],
});

defineCard("LI-S-3", {
  playable: { c: "life", who: "self", op: ">=", n: 2 },
  onUse: [payLife(1), draw(2)],
});

defineCard("LI-S-4", {
  static: [
    { attack: { aura: 1 } },
    {
      cond: { c: "flare", who: "self", op: ">=", n: 3 },
      attack: { aura: 1 },
    },
  ],
  onDestroy: [aura(1)],
});

/* ── 아라하시 타비 ────────────────────────────── */

defineCard("TA-N-1", { onAfter: [move(1)] });

defineCard("TA-N-2", {
  onAfter: [ifCond({ c: "attaches", who: "foe", op: ">=", n: 1 }, [draw(1)])],
});

defineCard("TA-N-3", { onAfter: [attachDamage("foe", 1)] });
defineCard("TA-N-4", { onUse: [draw(1), moveChoice()] });

defineCard("TA-N-5", {
  events: [{ on: "foeAdvance", once: true, ops: [loseAura("foe", 1)] }],
  onDestroy: [draw(1)],
});

defineCard("TA-N-6", {
  events: [
    {
      on: "foeAttack",
      once: true,
      ops: [attachDamageCard("self", "TA-N-6"), loseAura("foe", 1)],
    },
  ],
  onDestroy: [move(1)],
});

defineCard("TA-N-7", {
  onResponse: [reduce(1, 0), attachDamage("foe", 1)],
});

defineCard("TA-S-1", { onAfter: [destroyAttach("foe", 1)] });

defineCard("TA-S-2", {
  onAttack: [
    pierce(),
    ifCond({ c: "attaches", who: "foe", op: ">=", n: 2 }, [attackMod(2, 0)], [
      ifCond({ c: "attaches", who: "foe", op: ">=", n: 1 }, [attackMod(1, 0)]),
    ]),
  ],
});

defineCard("TA-S-3", { onUse: [destroyAttach("foe", 2), draw(1)] });

defineCard("TA-S-4", {
  events: [{ on: "foeMove", once: true, ops: [loseAura("foe", 1)] }],
  onDestroy: [loseAura("foe", 2)],
});
