// 효과 DSL 인터프리터.
//
// 카드 효과는 Op 배열을 순서대로 실행한다.
// 도중에 플레이어의 선택이 필요하면 `state.pending`을 세우고 멈춘다.
// 남은 Op 배열은 pending.resume에 저장되므로 서버 재시작/리플레이에도 안전하다.

import type { EffectCtx, GameState, PlayerId, PlayerState } from "../types";
import type { Cond, EventHook, Op } from "./types";
import { getProgram } from "./registry";
import { getCard } from "../cards";
import {
  addCounter,
  cardName,
  // checkGameOver,
  destroyAttach,
  drawFromDeck,
  foe,
  loseAura,
  loseFlare,
  loseLife,
  log,
  moveDistance,
  other,
  // payLife,
  gainAura,
  gainFlare,
  heal,
  player,
  spendCounter,
} from "../core";

export interface FlowHooks {
  enterMain(): void;
  openResponse(ctx: EffectCtx): void;
  resolveAttack(ctx: EffectCtx): void;
  finishAttack(ctx: EffectCtx): void;
  askStart(): void;
  finishTurn(): void;
  nextTurn(): void;
}

type ExecResult = { pause?: true; prepend?: Op[] } | undefined;

const whoOf = (ctx: EffectCtx, who: "self" | "foe"): PlayerId =>
  who === "self" ? ctx.self : other(ctx.self);

function target(state: GameState, ctx: EffectCtx, who: "self" | "foe"): PlayerState {
  return state.players[whoOf(ctx, who)];
}

function cardIdOfUid(uid: string): string {
  return uid.split("-").slice(1).join("-");
}

function sourceStella(_state: GameState, ctx: EffectCtx): string | undefined {
  if (!ctx.cardUid) return undefined;
  const cardId = cardIdOfUid(ctx.cardUid);
  return getCard(cardId)?.stellaId;
}

function stellaMatches(
  sourceStellaId: string | undefined,
  mode: "partner" | "self" | undefined,
  attackCardId: string,
): boolean {
  if (!mode || !sourceStellaId) return true;
  const attackStella = getCard(attackCardId)?.stellaId;
  if (!attackStella) return true;
  return mode === "self" ? attackStella === sourceStellaId : attackStella !== sourceStellaId;
}

/** 조건 평가 */
export function evalCond(state: GameState, cond: Cond, self: PlayerId): boolean {
  const me = state.players[self];
  const op = state.players[other(self)];
  const pick = (who: "self" | "foe"): PlayerState => (who === "self" ? me : op);
  const cmp = (a: number, c: string, b: number): boolean =>
    c === "<=" ? a <= b : c === ">=" ? a >= b : a === b;
  switch (cond.c) {
    case "life":
      return cmp(pick(cond.who).life, cond.op, cond.n);
    case "aura":
      return cmp(pick(cond.who).aura, cond.op, cond.n);
    case "flare":
      return cmp(pick(cond.who).flare, cond.op, cond.n);
    case "counter":
      return cmp(pick(cond.who).counters[cond.name], cond.op, cond.n);
    case "distance":
      return cmp(state.distance, cond.op, cond.n);
    case "attaches":
      return cmp(pick(cond.who).attaches.length, cond.op, cond.n);
    case "attacks":
      return cmp(me.flags.attacks, cond.op, cond.n);
    case "stance":
      return pick(cond.who).stance === cond.value;
    case "deckTopType": {
      const top = pick(cond.who).deck[0];
      if (!top) return false;
      return getCard(top.cardId)?.type === cond.value;
    }
    case "handSize":
      return cmp(pick(cond.who).hand.length, cond.op, cond.n);
    case "dealtLife":
      return me.flags.dealtLife;
    case "tookLife":
      return me.flags.tookLife;
    case "not":
      return !evalCond(state, cond.cond, self);
    case "and":
      return cond.conds.every((c) => evalCond(state, c, self));
    case "or":
      return cond.conds.some((c) => evalCond(state, c, self));
    default:
      return false;
  }
}

/** 부여패의 상시 공격 보정 */
export function staticAttackBonus(
  state: GameState,
  attacker: PlayerId,
  attackCardId: string,
): { aura: number; life: number } {
  const p = state.players[attacker];
  let aura = 0;
  let life = 0;
  for (const attach of p.attaches) {
    const prog = getProgram(attach.cardId);
    if (!prog?.static) continue;
    const stellaId = getCard(attach.cardId)?.stellaId;
    for (const mod of prog.static) {
      if (mod.attack && !stellaMatches(stellaId, mod.onlyStella, attackCardId)) continue;
      if (mod.cond && !evalCond(state, mod.cond, attacker)) continue;
      if (mod.attack) {
        aura += mod.attack.aura ?? 0;
        life += mod.attack.life ?? 0;
      }
      if (mod.perCounter) {
        if (mod.perCounter.cond && !evalCond(state, mod.perCounter.cond, attacker)) continue;
        const count = Math.min(mod.perCounter.max, p.counters[mod.perCounter.name]);
        aura += (mod.perCounter.aura ?? 0) * count;
        life += (mod.perCounter.life ?? 0) * count;
      }
    }
  }
  return { aura, life };
}

/** 부여패의 상시 피해 감소 */
export function staticDamageReduction(
  state: GameState,
  defender: PlayerId,
): { aura: number; life: number } {
  const p = state.players[defender];
  let aura = 0;
  let life = 0;
  for (const attach of p.attaches) {
    const prog = getProgram(attach.cardId);
    if (!prog?.static) continue;
    for (const mod of prog.static) {
      if (mod.auraTaken || mod.lifeTaken) {
        if (mod.cond && !evalCond(state, mod.cond, defender)) continue;
        aura += mod.auraTaken ?? 0;
        life += mod.lifeTaken ?? 0;
      }
    }
  }
  return { aura, life };
}

/** 이번 공격에 적용되는 일회성 버프 (적용 후 소모) */
export function consumeAttackBuffs(
  state: GameState,
  attacker: PlayerId,
  attackCardId: string,
): { aura: number; life: number; rangeExpand: number } {
  const p = state.players[attacker];
  const stella = getCard(attackCardId)?.stellaId;
  let aura = 0;
  let life = 0;
  let rangeExpand = 0;
  const remaining = [];
  for (const buff of p.buffs) {
    if (buff.charges <= 0) continue;
    if (buff.minAttacks && p.flags.attacks < buff.minAttacks) {
      remaining.push(buff);
      continue;
    }
    const allowed =
      (!buff.onlyStellaId || buff.onlyStellaId === stella) &&
      (!buff.notStellaId || buff.notStellaId !== stella);
    if (!allowed || buff.charges <= 0) {
      remaining.push(buff);
      continue;
    }
    aura += buff.aura;
    life += buff.life;
    rangeExpand += buff.rangeExpand ?? 0;
    buff.charges -= 1;
    if (buff.charges > 0) remaining.push(buff);
  }
  p.buffs = remaining;
  return { aura, life, rangeExpand };
}

/** 버프 없이 이번 공격에 적용될 거리확대만 미리 계산 */
export function previewRangeExpand(
  state: GameState,
  attacker: PlayerId,
  attackCardId: string,
): number {
  const p = state.players[attacker];
  const stella = getCard(attackCardId)?.stellaId;
  let rangeExpand = 0;
  for (const buff of p.buffs) {
    if (buff.charges <= 0) continue;
    if (buff.minAttacks && p.flags.attacks < buff.minAttacks) continue;
    const allowed =
      (!buff.onlyStellaId || buff.onlyStellaId === stella) &&
      (!buff.notStellaId || buff.notStellaId !== stella);
    if (allowed) rangeExpand += buff.rangeExpand ?? 0;
  }
  return rangeExpand;
}

/** 부여패 발동 효과 수집 (턴에 1번 기록 포함) */
export function eventOps(
  state: GameState,
  owner: PlayerId,
  event: EventHook["on"],
  attackCardId?: string,
): Op[] {
  const p = state.players[owner];
  const out: Op[] = [];
  for (const attach of p.attaches) {
    const prog = getProgram(attach.cardId);
    if (!prog?.events) continue;
    for (const hook of prog.events) {
      if (hook.on !== event) continue;
      if (hook.onlyStella || event === "selfAttack") {
        if (!attackCardId) continue;
        const attachStella = getCard(attach.cardId)?.stellaId;
        if (!stellaMatches(attachStella, hook.onlyStella, attackCardId)) continue;
      }
      if (hook.cond && !evalCond(state, hook.cond, owner)) continue;
      const key = `${attach.uid}:${event}`;
      if (hook.once && p.flags.onceKeys.includes(key)) continue;
      if (hook.once) p.flags.onceKeys.push(key);
      out.push(...hook.ops);
    }
  }
  return out;
}

function destroyNow(state: GameState, p: PlayerState, uid: string): Op[] {
  const attach = p.attaches.find((a) => a.uid === uid);
  if (!attach) return [];
  const prog = getProgram(attach.cardId);
  destroyAttach(state, p, attach);
  return prog?.onDestroy ?? [];
}

function choiceBetween(
  state: GameState,
  ctx: EffectCtx,
  prompt: string,
  options: { id: string; label: string; then: Op[] }[],
  rest: Op[],
  reveal?: string[],
): void {
  const branches: Record<string, unknown[]> = {};
  for (const option of options) branches[option.id] = option.then;
  state.pending = {
    kind: "choice",
    player: ctx.self,
    prompt,
    options: options.map((o) => ({ id: o.id, label: o.label })),
    branches,
    reveal,
    resume: [...rest],
    ctx: { ...ctx },
  };
}

/** Op 배열 실행. pending이 서면 즉시 반환한다. */
export function runOps(
  state: GameState,
  ops: Op[],
  ctx: EffectCtx,
  hooks: FlowHooks,
): void {
  const queue = [...ops];
  let guard = 0;
  while (queue.length > 0) {
    guard += 1;
    if (guard > 500) {
      // 효과 폭주 방어. 서버가 로그를 남긴다.
      log(state, "error", "효과 해결 한도 초과. 남은 효과를 중단합니다.");
      return;
    }
    if (state.phase === "gameover") {
      state.pending = null;
      return;
    }
    const op = queue.shift() as Op;
    const result = execOp(state, op, ctx, hooks, queue);
    if (result?.pause) return;
    if (result?.prepend) queue.unshift(...result.prepend);
  }
}

function execOp(
  state: GameState,
  op: Op,
  ctx: EffectCtx,
  hooks: FlowHooks,
  rest: Op[],
): ExecResult {
  const me = player(state, ctx.self);
  switch (op.op) {
    case "draw": {
      let count = op.n;
      const opponent = foe(state, ctx.self);
      for (const attach of opponent.attaches) {
        const prog = getProgram(attach.cardId);
        if (!prog?.static) continue;
        for (const mod of prog.static) {
          if (!mod.negateFoeDraw) continue;
          if (mod.cond && !evalCond(state, mod.cond, opponent.id)) continue;
          const key = `${attach.uid}:negateDraw`;
          if (opponent.flags.onceKeys.includes(key)) continue;
          opponent.flags.onceKeys.push(key);
          count = Math.max(0, count - mod.negateFoeDraw);
          log(state, "card", `${cardName(attach.cardId)}: 드로우 ${mod.negateFoeDraw}장 무효.`);
        }
      }
      let missing = 0;
      for (let i = 0; i < count; i += 1) {
        if (drawFromDeck(me, 1) === 0) missing += 1;
      }
      if (count > 0) log(state, "action", `${me.name} 카드 ${count - missing}장 드로우.`);
      if (missing > 0) {
        state.pending = {
          kind: "penalty",
          player: ctx.self,
          remaining: missing,
          resume: [...rest],
          ctx: { ...ctx },
        };
        return { pause: true };
      }
      return;
    }
    case "move": {
      const actual = moveDistance(state, op.delta);
      if (actual !== 0) {
        log(state, "action", `거리 ${actual > 0 ? "+" : ""}${actual} → ${state.distance}`);
        return { prepend: moveEvents(state, ctx.self, op.delta) };
      }
      return;
    }
    case "moveChoice": {
      choiceBetween(
        state,
        ctx,
        "거리를 어떻게 바꿀까?",
        [
          { id: "up", label: "거리 +1", then: [{ op: "move", delta: 1 }] },
          { id: "down", label: "거리 -1", then: [{ op: "move", delta: -1 }] },
        ],
        rest,
      );
      return { pause: true };
    }
    case "aura": {
      const gained = gainAura(state, me, op.n);
      if (gained !== 0) log(state, "action", `오라 +${gained} (${me.aura})`);
      return;
    }
    case "loseAura": {
      const p = target(state, ctx, op.who);
      const lost = loseAura(p, op.n);
      if (lost > 0) log(state, "damage", `${p.name} 오라 -${lost} (${p.aura})`);
      return;
    }
    case "flare": {
      gainFlare(me, op.n);
      log(state, "action", `플레어 +${op.n} (${me.flare})`);
      return;
    }
    case "loseFlare": {
      const p = target(state, ctx, op.who);
      loseFlare(p, op.n);
      return;
    }
    case "dust": {
      me.dust += op.n;
      return;
    }
    case "heal": {
      const amount = heal(state, me, op.n);
      if (amount > 0) log(state, "action", `라이프 +${amount} (${me.life})`);
      return;
    }
    case "payLife": {
      if (me.life <= op.n) return;
      me.life -= op.n;
      me.flare += op.n;
      log(state, "action", `${me.name} 라이프 ${op.n} 지불.`);
      return;
    }
    case "counter": {
      const p = target(state, ctx, op.who);
      addCounter(p, op.name, op.n);
      log(state, "action", `${p.name} ${counterName(op.name)} ${op.n} 획득 (${p.counters[op.name]})`);
      return;
    }
    case "spendCounter": {
      const p = target(state, ctx, op.who);
      if (spendCounter(p, op.name, op.n)) {
        log(state, "action", `${p.name} ${counterName(op.name)} ${op.n} 소모 (${p.counters[op.name]})`);
      }
      return;
    }
    case "loseLife": {
      const p = target(state, ctx, op.who);
      const lost = loseLife(state, p, op.n);
      if (lost > 0) log(state, "damage", `${p.name} 라이프 -${lost} (${p.life})`);
      return;
    }
    case "buff": {
      const stella = sourceStella(state, ctx);
      const onlyStellaId = op.onlyStella === "self" ? stella : undefined;
      const notStellaId = op.onlyStella === "partner" ? stella : undefined;
      me.buffs.push({
        id: state.nextBuffId++,
        aura: op.aura ?? 0,
        life: op.life ?? 0,
        charges: op.charges ?? 1,
        onlyStellaId,
        notStellaId,
        rangeExpand: op.rangeExpand,
        minAttacks: op.minAttacks,
        expires: "turn",
        label: op.label ?? "공격 강화",
      });
      log(
        state,
        "action",
        `${me.name} 공격 강화 +${op.aura ?? 0}/+${op.life ?? 0}${
          op.rangeExpand ? ` 거리확대 ${op.rangeExpand}` : ""
        }`,
      );
      return;
    }
    case "condBuff": {
      if (evalCond(state, op.cond, ctx.self)) {
        return execOp(
          state,
          { op: "buff", aura: op.aura, life: op.life, charges: 1 },
          ctx,
          hooks,
          rest,
        );
      }
      return;
    }
    case "attackMod": {
      if (!ctx.attack) return;
      ctx.attack.aura += op.aura ?? 0;
      ctx.attack.life += op.life ?? 0;
      log(state, "card", `이번 공격 +${op.aura ?? 0}/+${op.life ?? 0}.`);
      return;
    }
    case "reduce": {
      if (!ctx.attack) return;
      ctx.attack.aura = Math.max(0, ctx.attack.aura - (op.aura ?? 0));
      ctx.attack.life = Math.max(0, ctx.attack.life - (op.life ?? 0));
      ctx.attack.reductions.push({ aura: op.aura ?? 0, life: op.life ?? 0 });
      log(state, "card", `이번 공격 데미지 감소. (${ctx.attack.aura}/${ctx.attack.life})`);
      return;
    }
    case "pierce": {
      if (ctx.attack) ctx.attack.pierce = true;
      return;
    }
    case "super": {
      if (ctx.attack) ctx.attack.super = true;
      return;
    }
    case "expandRange": {
      if (!ctx.attack) return;
      const [lo, hi] = normalizeRange(ctx.attack.range);
      ctx.attack.range = [Math.max(0, lo - op.n), Math.min(state.config.distanceMax, hi + op.n)];
      return;
    }
    case "attachDamage":
    case "destroyAttach": {
      const p = target(state, ctx, op.who);
      if (op.n <= 0 || p.attaches.length === 0) return;
      if (p.attaches.length === 1) {
        const uid = p.attaches[0].uid;
        const next: Op =
          op.op === "destroyAttach"
            ? { op: "destroyAttachUid", who: op.who, uid }
            : { op: "attachDamageUid", who: op.who, uid };
        return { prepend: [next, ...(op.n > 1 ? [{ ...op, n: op.n - 1 } as Op] : [])] };
      }
      choiceBetween(
        state,
        ctx,
        op.op === "destroyAttach" ? "파기할 부여패를 고른다." : "크리스탈을 줄일 부여패를 고른다.",
        p.attaches.map((a) => ({
          id: a.uid,
          label: cardName(a.cardId),
          then: [
            op.op === "destroyAttach"
              ? ({ op: "destroyAttachUid", who: op.who, uid: a.uid } as Op)
              : ({ op: "attachDamageUid", who: op.who, uid: a.uid } as Op),
            ...(op.n > 1 ? [{ ...op, n: op.n - 1 } as Op] : []),
          ],
        })),
        rest,
      );
      return { pause: true };
    }
    case "attachDamageUid": {
      const p = target(state, ctx, op.who);
      const attach = p.attaches.find((a) => a.uid === op.uid);
      if (!attach) return;
      attach.crystals -= 1;
      log(state, "card", `${cardName(attach.cardId)} 크리스탈 -1 (${Math.max(0, attach.crystals)})`);
      if (attach.crystals <= 0) return { prepend: destroyNow(state, p, attach.uid) };
      return;
    }
    case "destroyAttachUid": {
      const p = target(state, ctx, op.who);
      return { prepend: destroyNow(state, p, op.uid) };
    }
    case "attachDamageCard": {
      const p = target(state, ctx, op.who);
      const attach = p.attaches.find((a) => a.cardId === op.cardId);
      if (!attach) return;
      attach.crystals -= 1;
      log(state, "card", `${cardName(attach.cardId)} 크리스탈 -1 (${Math.max(0, attach.crystals)})`);
      if (attach.crystals <= 0) return { prepend: destroyNow(state, p, attach.uid) };
      return;
    }
    case "discard": {
      const p = target(state, ctx, op.who);
      if (p.hand.length === 0 || op.n <= 0) return;
      const restOp: Op = { ...op, n: op.n - 1 };
      if (p.hand.length === 1) {
        return { prepend: [{ op: "discardUid", who: op.who, uid: p.hand[0].uid }, restOp] };
      }
      // 상대에게 버릴 카드를 고르게 한다.
      state.pending = {
        kind: "choice",
        player: p.id,
        prompt: "버릴 카드를 고른다.",
        options: p.hand.map((c) => ({ id: c.uid, label: cardName(c.cardId) })),
        branches: Object.fromEntries(
          p.hand.map((c) => [c.uid, [{ op: "discardUid", who: op.who, uid: c.uid }, restOp]]),
        ),
        resume: [...rest],
        ctx: { ...ctx },
      };
      return { pause: true };
    }
    case "discardUid": {
      const p = target(state, ctx, op.who);
      const card = p.hand.find((c) => c.uid === op.uid);
      if (!card) return;
      p.hand = p.hand.filter((c) => c.uid !== card.uid);
      p.discard.push(card);
      log(state, "card", `${p.name} ${cardName(card.cardId)} 버림.`);
      return;
    }
    case "bottomUid": {
      const p = target(state, ctx, op.who);
      const card = p.deck.find((c) => c.uid === op.uid);
      if (!card) return;
      p.deck = p.deck.filter((c) => c.uid !== card.uid);
      p.deck.push(card);
      log(state, "card", `${p.name} 패산 위 카드 1장을 아래로.`);
      return;
    }
    case "handToBottomUid": {
      const p = target(state, ctx, op.who);
      const card = p.hand.find((c) => c.uid === op.uid);
      if (!card) return;
      p.hand = p.hand.filter((c) => c.uid !== card.uid);
      p.deck.push(card);
      log(state, "card", `${p.name} 손패 1장을 패산 아래로.`);
      return;
    }
    case "peek": {
      const p = target(state, ctx, op.who);
      const uids = p.deck.slice(0, Math.min(op.n, p.deck.length)).map((c) => c.uid);
      if (uids.length === 0) {
        log(state, "card", "패산이 비어 확인할 카드가 없다.");
        return;
      }
      const prompt = op.prompt ?? `패산 위 ${uids.length}장을 확인한다.`;
      if (op.then === "optionalBottom") {
        state.pending = {
          kind: "choice",
          player: ctx.self,
          prompt,
          options: [
            { id: "keep", label: "그대로 둔다" },
            { id: "bottom", label: "패산 아래로 보낸다" },
          ],
          branches: {
            keep: [],
            bottom: [{ op: "bottomUid", who: op.who, uid: uids[0] }],
          },
          reveal: uids,
          resume: [...rest],
          ctx: { ...ctx },
        };
        return { pause: true };
      }
      state.pending = {
        kind: "order",
        player: ctx.self,
        prompt,
        uids,
        who: op.who,
        reorder: op.then === "reorder",
        reveal: uids,
        resume: [...rest],
        ctx: { ...ctx },
      };
      return { pause: true };
    }
    case "putHandBottom": {
      if (me.hand.length === 0 || op.n <= 0) return;
      const restOp: Op = { ...op, n: op.n - 1 };
      if (me.hand.length === 1) {
        return { prepend: [{ op: "handToBottomUid", who: "self", uid: me.hand[0].uid }, restOp] };
      }
      choiceBetween(
        state,
        ctx,
        "패산 아래로 보낼 손패를 고른다.",
        me.hand.map((c) => ({
          id: c.uid,
          label: cardName(c.cardId),
          then: [{ op: "handToBottomUid", who: "self", uid: c.uid }, restOp],
        })),
        rest,
      );
      return { pause: true };
    }
    case "millFoe": {
      const p = foe(state, ctx.self);
      for (let i = 0; i < op.n; i += 1) {
        const card = p.deck.shift();
        if (!card) break;
        p.deck.push(card);
      }
      log(state, "card", `${p.name}의 패산 위 카드 ${op.n}장을 아래로.`);
      return;
    }
    case "restrict": {
      const p = target(state, ctx, op.who);
      p.restrictions.push({
        kind: op.kind,
        turns: 1,
        label: op.kind === "advance" ? "전진 불가" : op.kind === "retreat" ? "후퇴 불가" : "기본동작 불가",
      });
      log(state, "card", `${p.name} ${p.restrictions[p.restrictions.length - 1].label}.`);
      return;
    }
    case "stance": {
      const p = target(state, ctx, op.who ?? "self");
      const before = p.stance;
      p.stance = op.value === "toggle" ? (p.stance === "day" ? "night" : "day") : op.value;
      if (p.stance !== before) {
        log(state, "action", `${p.name} 스탠스 ${p.stance === "day" ? "낮" : "밤"}.`);
        return { prepend: eventOps(state, p.id, "stanceChange") };
      }
      return;
    }
    case "extraBasic": {
      me.flags.basicLimit += op.n;
      log(state, "action", `이번 턴 기본동작 ${op.n}회 추가 (${me.flags.basicLimit - me.flags.basicsUsed}회 남음)`);
      return;
    }
    case "freeBasic": {
      const ops = freeBasic(state, me, op.action);
      return ops.length > 0 ? { prepend: ops } : undefined;
    }
    case "if": {
      const branch = evalCond(state, op.cond, ctx.self) ? op.then : op.else;
      return branch && branch.length > 0 ? { prepend: [...branch] } : undefined;
    }
    case "choose": {
      choiceBetween(state, ctx, op.prompt, op.options, rest);
      return { pause: true };
    }
    case "enterMain":
      hooks.enterMain();
      return;
    case "openResponse":
      hooks.openResponse(ctx);
      return { pause: true };
    case "resolveAttack":
      hooks.resolveAttack(ctx);
      return { pause: true };
    case "finishAttack":
      hooks.finishAttack(ctx);
      return;
    case "askStart":
      hooks.askStart();
      return { pause: true };
    case "finishTurn":
      hooks.finishTurn();
      return;
    case "nextTurn":
      hooks.nextTurn();
      return;
    default:
      return;
  }
}

/** 이동 후 상대 부여패의 반응 */
function moveEvents(state: GameState, mover: PlayerId, delta: number): Op[] {
  const owner = other(mover);
  const ops = eventOps(state, owner, "foeMove");
  if (delta < 0) ops.push(...eventOps(state, owner, "foeAdvance"));
  return ops;
}

function freeBasic(state: GameState, p: PlayerState, action: "advance" | "retreat"): Op[] {
  if (action === "advance") {
    if (state.distance <= 2 || p.aura >= state.config.auraMax) return [];
    moveDistance(state, -1);
    gainAura(state, p, 1);
    log(state, "action", `${p.name} 무료 전진. 거리 ${state.distance}`);
  } else {
    if (p.aura <= 0 || state.distance >= state.config.distanceMax) return [];
    loseAura(p, 1);
    moveDistance(state, 1);
    log(state, "action", `${p.name} 무료 후퇴. 거리 ${state.distance}`);
  }
  return moveEvents(state, p.id, action === "advance" ? -1 : 1);
}

export function normalizeRange(range: number | [number, number]): [number, number] {
  return typeof range === "number" ? [range, range] : [range[0], range[1]];
}

export function counterName(name: string): string {
  switch (name) {
    case "seonggwang":
      return "성광";
    case "chungjeon":
      return "충전";
    case "pyojeok":
      return "표적";
    case "gise":
      return "기세";
    case "wonhan":
      return "원한";
    case "unun":
      return "불운";
    default:
      return name;
  }
}

export { target as targetPlayer };
