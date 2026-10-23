// 액션 검증과 실행.
//
// 서버는 이 파일만 신뢰한다.
// 클라이언트가 보낸 값은 먼저 `parseAction`으로 **형태**를 검사하고,
// 그다음 현재 상태와 대조해 **합법성**을 검사한다.
// 하나라도 어긋나면 상태를 바꾸지 않고 RuleError를 던진다.

import { getCard } from "./cards";
import {
  cardName,
  checkGameOver,
  clamp,
  drawFromDeck,
  gainAura,
  gainFlare,
  log,
  loseAura,
  moveDistance,
  other,
} from "./core";
import { fail, isRuleError } from "./errors";
import { hashState } from "./hash";
import { shuffle } from "./rng";
import { resetTurnFlags } from "./state";
import {
  consumeAttackBuffs,
  evalCond,
  eventOps,
  previewRangeExpand,
  runOps,
  staticAttackBonus,
  staticDamageReduction,
} from "./effects/run";
import type { FlowHooks } from "./effects/run";
import { getProgram } from "./effects/registry";
import { normalizeRange } from "./effects/run";
import type { GameState, PlayerId, AttackDraft, BasicAction, CardInstance, EffectCtx } from "./types";
import type { Op } from "./effects/types";

export type Action =
  | { type: "mulligan"; returnUids: string[] }
  | { type: "startPhase"; recompose: boolean }
  | { type: "declarePower" }
  | { type: "basic"; action: BasicAction; pay: "focus" | "hand"; handUid?: string }
  | { type: "playCard"; uid: string }
  | { type: "response"; uid?: string }
  | { type: "defend"; choice: "aura" | "life" }
  | { type: "choice"; optionId: string }
  | { type: "order"; uids: string[] }
  | { type: "discardDown"; uids: string[] }
  | { type: "penalty"; choice: "aura" | "life" }
  | { type: "endTurn" }
  | { type: "surrender" };

const BASIC_ACTIONS: BasicAction[] = ["advance", "retreat", "coil", "gather", "breakaway"];

/* ────────────────────────────── 검증 ────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    fail("bad-action", `${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail("bad-action", `${field} 값이 올바르지 않습니다.`);
  return value;
}

function strArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 10) {
    fail("bad-action", `${field} 값이 올바르지 않습니다.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 120) {
      fail("bad-action", `${field} 값이 올바르지 않습니다.`);
    }
  }
  if (new Set(value).size !== value.length) {
    fail("bad-action", `${field}에 중복된 카드가 있습니다.`);
  }
  return value as string[];
}

function noExtraKeys(raw: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) fail("bad-action", `알 수 없는 필드: ${key}`);
  }
}

/** 클라이언트 입력을 액션으로 파싱한다. 형태가 틀리면 즉시 실패. */
export function parseAction(raw: unknown): Action {
  if (!isRecord(raw)) fail("bad-action", "액션이 객체가 아닙니다.");
  const type = str(raw.type, "type");
  switch (type) {
    case "mulligan":
      noExtraKeys(raw, ["type", "returnUids"]);
      return { type, returnUids: strArray(raw.returnUids, "returnUids") };
    case "startPhase":
      noExtraKeys(raw, ["type", "recompose"]);
      return { type, recompose: bool(raw.recompose, "recompose") };
    case "declarePower":
      noExtraKeys(raw, ["type"]);
      return { type };
    case "basic": {
      noExtraKeys(raw, ["type", "action", "pay", "handUid"]);
      const basicAction = str(raw.action, "action") as BasicAction;
      if (!BASIC_ACTIONS.includes(basicAction)) fail("bad-action", "알 수 없는 기본동작입니다.");
      const pay = str(raw.pay, "pay");
      if (pay !== "focus" && pay !== "hand") fail("bad-action", "pay 값이 올바르지 않습니다.");
      const handUid = raw.handUid === undefined ? undefined : str(raw.handUid, "handUid");
      if (pay === "hand" && !handUid) fail("bad-action", "손패를 낼 카드가 필요합니다.");
      return { type, action: basicAction, pay, handUid };
    }
    case "playCard":
      noExtraKeys(raw, ["type", "uid"]);
      return { type, uid: str(raw.uid, "uid") };
    case "response":
      noExtraKeys(raw, ["type", "uid"]);
      return { type, uid: raw.uid === undefined ? undefined : str(raw.uid, "uid") };
    case "defend": {
      noExtraKeys(raw, ["type", "choice"]);
      const choice = str(raw.choice, "choice");
      if (choice !== "aura" && choice !== "life") fail("bad-action", "choice 값이 올바르지 않습니다.");
      return { type, choice };
    }
    case "choice":
      noExtraKeys(raw, ["type", "optionId"]);
      return { type, optionId: str(raw.optionId, "optionId") };
    case "order":
      noExtraKeys(raw, ["type", "uids"]);
      return { type, uids: strArray(raw.uids, "uids") };
    case "discardDown":
      noExtraKeys(raw, ["type", "uids"]);
      return { type, uids: strArray(raw.uids, "uids") };
    case "penalty": {
      noExtraKeys(raw, ["type", "choice"]);
      const choice = str(raw.choice, "choice");
      if (choice !== "aura" && choice !== "life") fail("bad-action", "choice 값이 올바르지 않습니다.");
      return { type, choice };
    }
    case "endTurn":
      noExtraKeys(raw, ["type"]);
      return { type };
    case "surrender":
      noExtraKeys(raw, ["type"]);
      return { type };
    default:
      fail("bad-action", `알 수 없는 액션: ${type}`);
  }
}

/* ────────────────────────────── 실행 ────────────────────────────── */

export interface ApplyResult {
  ok: boolean;
  state?: GameState;
  code?: string;
  message?: string;
}

/** 예외 없이 결과를 돌려주는 래퍼 (서버용) */
export function tryApplyAction(state: GameState, playerId: PlayerId, raw: unknown): ApplyResult {
  try {
    return { ok: true, state: applyAction(state, playerId, raw) };
  } catch (error) {
    if (error instanceof Error) {
      const code = "code" in error ? String((error as { code?: string }).code ?? "internal") : "internal";
      return { ok: false, code, message: error.message };
    }
    return { ok: false, code: "internal", message: "알 수 없는 오류" };
  }
}

export function applyAction(state: GameState, playerId: PlayerId, raw: unknown): GameState {
  const action = parseAction(raw);
  const next = structuredClone(state) as GameState;
  const hooks = createHooks(next);

  if (next.phase === "gameover" && action.type !== "surrender") {
    fail("bad-phase", "이미 종료된 경기입니다.");
  }

  if (action.type === "surrender") {
    if (next.phase === "gameover") fail("bad-phase", "이미 종료된 경기입니다.");
    next.phase = "gameover";
    next.pending = null;
    next.winner = other(playerId);
    log(next, "system", `${next.players[playerId].name} 기권.`);
    record(next, playerId, action);
    return next;
  }

  const pending = next.pending;
  if (pending) {
    switch (pending.kind) {
      case "mulligan": {
        if (action.type !== "mulligan") fail("pending", "멀리건을 먼저 완료해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 멀리건을 기다리는 중입니다.");
        doMulligan(next, playerId, action.returnUids);
        break;
      }
      case "startPhase": {
        if (action.type !== "startPhase") fail("pending", "개시 페이즈 선택을 먼저 해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 개시 페이즈를 기다리는 중입니다.");
        doStartPhase(next, playerId, action.recompose, hooks);
        break;
      }
      case "response": {
        if (action.type !== "response") fail("pending", "대응/패스를 선택해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 대응을 기다리는 중입니다.");
        doResponse(next, playerId, action.uid, hooks);
        break;
      }
      case "defend": {
        if (action.type !== "defend") fail("pending", "오라/라이프를 선택해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 방어 선택을 기다리는 중입니다.");
        doDefend(next, action.choice, hooks);
        break;
      }
      case "choice": {
        if (action.type !== "choice") fail("pending", "선택을 먼저 해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 선택을 기다리는 중입니다.");
        doChoice(next, action.optionId, hooks);
        break;
      }
      case "order": {
        if (action.type !== "order") fail("pending", "패산 순서를 먼저 정해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 선택을 기다리는 중입니다.");
        doOrder(next, action.uids, hooks);
        break;
      }
      case "discardDown": {
        if (action.type !== "discardDown") fail("pending", "버릴 카드를 먼저 골라야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 종료 처리를 기다리는 중입니다.");
        doDiscardDown(next, action.uids, hooks);
        break;
      }
      case "penalty": {
        if (action.type !== "penalty") fail("pending", "고갈 페널티를 먼저 처리해야 합니다.");
        if (pending.player !== playerId) fail("not-pending-player", "상대의 처리를 기다리는 중입니다.");
        doPenalty(next, action.choice, hooks);
        break;
      }
      default:
        fail("internal", "알 수 없는 대기 상태입니다.");
    }
    settle(next, hooks);
    record(next, playerId, action);
    return next;
  }

  if (playerId !== next.turn) fail("not-your-turn", "당신의 턴이 아닙니다.");
  if (next.phase !== "main") fail("bad-phase", "메인 페이즈가 아닙니다.");

  switch (action.type) {
    case "declarePower":
      doDeclarePower(next, playerId);
      break;
    case "basic":
      doBasic(next, playerId, action, hooks);
      break;
    case "playCard":
      doPlayCard(next, playerId, action.uid, hooks);
      break;
    case "endTurn":
      doEndTurn(next, playerId, hooks);
      break;
    default:
      fail("bad-action", "지금 할 수 없는 행동입니다.");
  }

  settle(next, hooks);
  record(next, playerId, action);
  return next;
}

function record(state: GameState, playerId: PlayerId, action: Action): void {
  state.seq += 1;
  state.history.push({
    seq: state.seq,
    player: playerId,
    type: action.type,
    payload: action,
    hash: hashState({ ...state, history: state.history.length }),
  });
}

/* ────────────────────────────── 준비 ────────────────────────────── */

function doMulligan(state: GameState, playerId: PlayerId, uids: string[]): void {
  const p = state.players[playerId];
  for (const uid of uids) {
    if (!p.hand.some((c) => c.uid === uid)) fail("card-not-in-hand", "손패에 없는 카드입니다.");
  }
  const returned: CardInstance[] = [];
  for (const uid of uids) {
    const card = p.hand.find((c) => c.uid === uid) as CardInstance;
    p.hand = p.hand.filter((c) => c.uid !== uid);
    p.deck.push(card);
    returned.push(card);
  }
  for (let i = 0; i < returned.length; i += 1) {
    drawFromDeck(p, 1);
  }
  p.mulliganDone = true;
  log(state, "action", `${p.name} 멀리건 ${uids.length}장.`);

  if (state.players.every((player) => player.mulliganDone)) {
    const first = state.players[state.firstPlayer];
    first.turnsTaken = 1;
    state.phase = "main";
    state.pending = null;
    state.round = 1;
    log(state, "phase", `${first.name}의 첫 턴. 개시 페이즈를 건너뜁니다.`);
  } else {
    state.pending = { kind: "mulligan", player: other(state.firstPlayer) };
  }
}

/* ────────────────────────────── 메인 페이즈 ────────────────────────────── */

function doDeclarePower(state: GameState, playerId: PlayerId): void {
  const p = state.players[playerId];
  if (p.flags.mode !== null) fail("power-mode", "이미 행동 모드를 선언했습니다.");
  if (p.flags.basicsUsed > 0) fail("power-mode", "이미 기본동작을 사용했습니다.");
  p.flags.mode = "power";
  if (!canPlayAnyCard(state, playerId)) {
    fail("power-mode", "전력 행동으로 사용할 수 있는 카드가 없습니다.");
  }
  log(state, "phase", `${p.name} 전력 행동.`);
}

/** 전력 행동으로 실제 사용 가능한 카드가 하나라도 있는지 (복제 상태에서 시험) */
function canPlayAnyCard(state: GameState, playerId: PlayerId): boolean {
  const p = state.players[playerId];
  const uids = [
    ...p.hand.map((c) => c.uid),
    ...p.specials.filter((s) => !s.used).map((s) => s.uid),
  ];
  for (const uid of uids) {
    const clone = structuredClone(state) as GameState;
    const hooks = createHooks(clone);
    try {
      doPlayCard(clone, playerId, uid, hooks);
      return true;
    } catch (error) {
      if (!isRuleError(error)) throw error;
    }
  }
  return false;
}

function doBasic(
  state: GameState,
  playerId: PlayerId,
  action: Extract<Action, { type: "basic" }>,
  hooks: FlowHooks,
): void {
  const p = state.players[playerId];
  const kind = action.action;

  if (p.flags.mode === "power") fail("power-mode", "전력 행동에서는 기본동작을 할 수 없습니다.");
  if (p.flags.mode === null) p.flags.mode = "standard";
  if (p.flags.basicsUsed >= p.flags.basicLimit) {
    fail("no-basic-left", "이번 턴 기본동작 횟수를 모두 사용했습니다.");
  }
  if (p.restrictions.some((r) => r.kind === "basic")) fail("restricted", "기본동작이 봉쇄되어 있습니다.");
  if (kind === "advance" && p.restrictions.some((r) => r.kind === "advance")) {
    fail("restricted", "이번 턴 전진할 수 없습니다.");
  }
  if (kind === "retreat" && p.restrictions.some((r) => r.kind === "retreat")) {
    fail("restricted", "이번 턴 후퇴할 수 없습니다.");
  }

  // 코스트
  if (action.pay === "focus") {
    if (p.focus < 1) fail("not-enough-aura", "집중력이 부족합니다.");
    p.focus -= 1;
  } else {
    const uid = action.handUid;
    if (!uid) fail("bad-action", "손패를 낼 카드가 필요합니다.");
    const card = p.hand.find((c) => c.uid === uid);
    if (!card) fail("card-not-in-hand", "손패에 없는 카드입니다.");
    p.hand = p.hand.filter((c) => c.uid !== uid);
    p.cover.push(card);
    log(state, "action", `${p.name} 손패 1장을 덮음패로.`);
  }

  // 효과
  switch (kind) {
    case "advance": {
      if (state.distance <= 2) fail("basic-unavailable", "거리 2 이하에서는 전진할 수 없습니다.");
      if (p.aura >= state.config.auraMax) fail("basic-unavailable", "오라가 가득 차 전진할 수 없습니다.");
      moveDistance(state, -1);
      gainAura(state, p, 1);
      log(state, "action", `${p.name} 전진. 거리 ${state.distance}, 오라 ${p.aura}`);
      p.flags.basicsUsed += 1;
      const ops = [...eventOps(state, other(playerId), "foeMove"), ...eventOps(state, other(playerId), "foeAdvance")];
      if (ops.length > 0) runOps(state, ops, { self: other(playerId) }, hooks);
      return;
    }
    case "retreat": {
      if (p.aura <= 0) fail("basic-unavailable", "오라가 없어 후퇴할 수 없습니다.");
      if (state.distance >= state.config.distanceMax) fail("basic-unavailable", "거리가 이미 최대입니다.");
      loseAura(p, 1);
      moveDistance(state, 1);
      log(state, "action", `${p.name} 후퇴. 거리 ${state.distance}, 오라 ${p.aura}`);
      p.flags.basicsUsed += 1;
      const ops = eventOps(state, other(playerId), "foeMove");
      if (ops.length > 0) runOps(state, ops, { self: other(playerId) }, hooks);
      return;
    }
    case "coil": {
      if (p.aura >= state.config.auraMax) fail("basic-unavailable", "오라가 이미 최대입니다.");
      if (p.dust < 1) fail("not-enough-dust", "더스트가 없습니다.");
      p.dust -= 1;
      gainAura(state, p, 1);
      log(state, "action", `${p.name} 휘감기. 오라 ${p.aura}`);
      break;
    }
    case "gather": {
      if (p.aura <= 0) fail("basic-unavailable", "오라가 없습니다.");
      loseAura(p, 1);
      gainFlare(p, 1);
      log(state, "action", `${p.name} 품기. 플레어 ${p.flare}`);
      break;
    }
    case "breakaway": {
      if (state.distance > 2) fail("basic-unavailable", "거리 2 이하에서만 이탈할 수 있습니다.");
      if (state.distance >= state.config.distanceMax) fail("basic-unavailable", "거리가 이미 최대입니다.");
      if (p.dust < 1) fail("not-enough-dust", "더스트가 없습니다.");
      p.dust -= 1;
      moveDistance(state, 1);
      log(state, "action", `${p.name} 이탈. 거리 ${state.distance}`);
      const ops = eventOps(state, other(playerId), "foeMove");
      if (ops.length > 0) runOps(state, ops, { self: other(playerId) }, hooks);
      break;
    }
  }
  p.flags.basicsUsed += 1;
}

function doPlayCard(state: GameState, playerId: PlayerId, uid: string, hooks: FlowHooks): void {
  const p = state.players[playerId];
  const handCard = p.hand.find((c) => c.uid === uid);
  const special = p.specials.find((s) => s.uid === uid);
  if (!handCard && !special) fail("card-not-found", "사용할 수 있는 카드가 아닙니다.");
  if (special && special.used) fail("special-used", "이미 사용한 비장패입니다.");

  const cardId = handCard?.cardId ?? special?.cardId;
  if (!cardId) fail("card-not-found", "카드를 찾을 수 없습니다.");
  const card = getCard(cardId);
  if (!card) fail("card-not-found", "알 수 없는 카드입니다.");
  const program = getProgram(cardId);
  if (!program) fail("card-unplayable", "효과가 구현되지 않은 카드입니다.");

  const isPowerCard = (card.keywords ?? []).includes("전력");
  if (p.flags.mode === "power" && p.flags.powerUsed) fail("power-mode", "전력 행동은 카드 1장만 사용합니다.");
  if (isPowerCard && p.flags.mode !== "power") fail("standard-mode", "【전력】 카드는 전력 행동에서만 사용할 수 있습니다.");
  if (p.flags.mode === null) p.flags.mode = "standard";
  if (p.flags.mode === "power" && p.flags.basicsUsed > 0) {
    fail("power-mode", "전력 행동에서는 기본동작을 할 수 없습니다.");
  }

  // 비용
  if (special) {
    const cost = card.cost ?? 0;
    if (p.flare < cost) fail("not-enough-flare", "플레어가 부족합니다.");
    p.flare -= cost;
    special.used = true;
    special.faceUp = true;
    log(state, "card", `${p.name} 비장패 【${card.name}】 사용.`);
  }
  if (handCard) {
    p.hand = p.hand.filter((c) => c.uid !== uid);
    log(state, "card", `${p.name} 【${card.name}】 사용.`);
  }

  if (program.playable && !evalCond(state, program.playable, playerId)) {
    fail("card-unplayable", "이 카드를 사용할 조건이 갖춰지지 않았습니다.");
  }

  // 전력 행동은 카드 1장으로 끝난다. (효과 해결 후 자동 종료)
  if (p.flags.mode === "power") p.flags.powerUsed = true;

  const ctx: EffectCtx = { self: playerId, cardUid: uid };
  const useOps = eventOps(state, playerId, "selfCardUse");

  if (card.type === "attach") {
    const offering = card.offering ?? 0;
    if (p.aura + p.dust < offering) fail("not-enough-offering", "봉납할 크리스탈이 부족합니다.");
    let pay = offering;
    const fromDust = Math.min(p.dust, pay);
    p.dust -= fromDust;
    pay -= fromDust;
    p.aura -= pay;
    p.attaches.push({ uid, cardId, crystals: offering });
    log(state, "card", `${p.name} 【${card.name}】 부여. 크리스탈 ${offering}`);
    runOps(state, [...useOps, ...(program.onUse ?? [])], ctx, hooks);
    return;
  }

  if (card.type === "action") {
    // 비장패는 버림패로 가지 않는다. (비장패 존에 사용 완료로 남는다)
    if (handCard) p.discard.push({ uid, cardId });
    runOps(state, [...useOps, ...(program.onUse ?? [])], ctx, hooks);
    return;
  }

  // 공격
  const baseRange = card.range;
  if (baseRange === undefined) fail("card-unplayable", "공격 카드에 거리 정보가 없습니다.");
  // 이번 공격 횟수를 먼저 반영해야 "2번째 공격부터" 버프의 거리확대도 적용된다.
  p.flags.attacks += 1;
  const expansion = previewRangeExpand(state, playerId, cardId);
  const [lo, hi] = normalizeRange(baseRange);
  const effLo = Math.max(0, lo - expansion);
  const effHi = Math.min(state.config.distanceMax, hi + expansion);
  if (state.distance < effLo || state.distance > effHi) {
    fail("out-of-range", `적정거리(${effLo}-${effHi}) 밖입니다.`);
  }

  const bonus = consumeAttackBuffs(state, playerId, cardId);
  const stat = staticAttackBonus(state, playerId, cardId);
  const draft: AttackDraft = {
    attacker: playerId,
    uid,
    cardId,
    aura: (card.auraDamage ?? 0) + bonus.aura + stat.aura,
    life: (card.lifeDamage ?? 0) + bonus.life + stat.life,
    pierce: (card.keywords ?? []).includes("필중"),
    super: (card.keywords ?? []).includes("초극"),
    range: [effLo, effHi],
    reductions: [],
    responded: false,
  };
  const attackCtx: EffectCtx = { self: playerId, cardUid: uid, attack: draft };
  // 비장패는 버림패로 가지 않는다. (비장패 존에 사용 완료로 남는다)
  if (handCard) p.discard.push({ uid, cardId });

  const attackEvents = [
    ...eventOps(state, playerId, "selfAttack", cardId),
    ...eventOps(state, other(playerId), "foeAttack"),
  ];
  runOps(
    state,
    [...useOps, ...attackEvents, ...(program.onUse ?? []), ...(program.onAttack ?? []), { op: "openResponse" }],
    attackCtx,
    hooks,
  );
}

/* ────────────────────────────── 공격 해결 ────────────────────────────── */

function createHooks(state: GameState): FlowHooks {
  const hooks: FlowHooks = {
    enterMain: () => {
      state.phase = "main";
      state.pending = null;
      log(state, "phase", `${state.players[state.turn].name} 메인 페이즈.`);
    },
    openResponse: (ctx) => {
      const draft = ctx.attack;
      if (!draft) return;
      if (draft.pierce) {
        resolveAttack(state, draft, hooks);
        return;
      }
      state.pending = { kind: "response", player: other(draft.attacker), attack: draft };
    },
    resolveAttack: (ctx) => {
      if (ctx.attack) resolveAttack(state, ctx.attack, hooks);
    },
    finishAttack: () => {
      state.pending = null;
      state.phase = "main";
      const p = state.players[state.turn];
      if (p.flags.mode === "power" && p.flags.powerUsed) autoEndTurn(state, hooks);
    },
    askStart: () => {
      state.pending = {
        kind: "startPhase",
        player: state.turn,
        canRecompose:
          state.players[state.turn].life > 1 &&
          state.players[state.turn].discard.length + state.players[state.turn].cover.length > 0,
      };
    },
    finishTurn: () => {
      finishTurnFlow(state, hooks);
    },
    nextTurn: () => {
      beginTurn(state, hooks);
    },
  };
  return hooks;
}

function doResponse(state: GameState, playerId: PlayerId, uid: string | undefined, hooks: FlowHooks): void {
  const pending = state.pending;
  if (!pending || pending.kind !== "response") fail("pending", "대응 단계가 아닙니다.");
  const draft = pending.attack;
  const p = state.players[playerId];

  if (!uid) {
    log(state, "action", `${p.name} 대응 없음.`);
    resolveAttack(state, draft, hooks);
    return;
  }

  const handCard = p.hand.find((c) => c.uid === uid);
  const special = p.specials.find((s) => s.uid === uid);
  if (!handCard && !special) fail("card-not-found", "대응 카드가 없습니다.");
  if (special?.used) fail("special-used", "이미 사용한 비장패입니다.");
  const cardId = handCard?.cardId ?? special?.cardId;
  if (!cardId) fail("card-not-found", "카드를 찾을 수 없습니다.");
  const program = getProgram(cardId);
  if (!program?.onResponse) fail("card-unplayable", "【대응】 카드가 아닙니다.");
  const card = getCard(cardId);
  if (!card) fail("card-not-found", "알 수 없는 카드입니다.");

  if (special) {
    const cost = card.cost ?? 0;
    if (p.flare < cost) fail("not-enough-flare", "플레어가 부족합니다.");
    p.flare -= cost;
    special.used = true;
    special.faceUp = true;
  } else {
    p.hand = p.hand.filter((c) => c.uid !== uid);
    p.discard.push({ uid, cardId });
  }
  draft.responded = true;
  log(state, "card", `${p.name} 【${card.name}】 대응.`);

  state.pending = null;
  const ctx: EffectCtx = { self: playerId, cardUid: uid, attack: draft };
  runOps(state, [...(program.onResponse ?? []), { op: "openResponse" }], ctx, hooks);
}

function resolveAttack(state: GameState, draft: AttackDraft, hooks: FlowHooks): void {
  const defender = other(draft.attacker);
  const def = state.players[defender];
  const reduction = staticDamageReduction(state, defender);

  // 상한을 먼저 적용하고, 그다음 정적 감소를 적용한다.
  let aura = draft.super ? draft.aura : Math.min(draft.aura, state.config.auraDamageCap);
  aura = Math.max(0, aura - reduction.aura);
  const life = Math.max(0, draft.life - reduction.life);
  draft.aura = aura;
  draft.life = life;

  const canAura = aura > 0 && def.aura >= aura;
  const canLife = life > 0;

  if (!canAura && !canLife) {
    log(state, "damage", "데미지가 없습니다.");
    finishAttackFlow(state, draft, false, hooks);
    return;
  }
  if (canAura && canLife) {
    state.pending = { kind: "defend", player: defender, attack: draft };
    return;
  }
  applyDefend(state, draft, canAura ? "aura" : "life", hooks);
}

function doDefend(state: GameState, choice: "aura" | "life", hooks: FlowHooks): void {
  const pending = state.pending;
  if (!pending || pending.kind !== "defend") fail("pending", "방어 단계가 아닙니다.");
  applyDefend(state, pending.attack, choice, hooks);
}

function applyDefend(
  state: GameState,
  draft: AttackDraft,
  choice: "aura" | "life",
  hooks: FlowHooks,
): void {
  const defender = other(draft.attacker);
  const def = state.players[defender];
  const atk = state.players[draft.attacker];

  let dealtLife = 0;
  if (choice === "aura") {
    if (draft.aura <= 0 || def.aura < draft.aura) fail("bad-choice", "오라로 받을 수 없습니다.");
    const lost = loseAura(def, draft.aura);
    log(state, "damage", `${def.name} 오라 데미지 ${lost}. (오라 ${def.aura})`);
  } else {
    const dmg = Math.min(def.life, draft.life);
    def.life -= dmg;
    def.flare += dmg;
    dealtLife = dmg;
    if (dmg > 0) {
      atk.flags.dealtLife = true;
      def.flags.tookLife = true;
      log(state, "damage", `${def.name} 라이프 데미지 ${dmg}. (라이프 ${def.life})`);
    } else {
      log(state, "damage", `${def.name} 라이프 데미지 없음.`);
    }
    checkGameOver(state);
  }

  finishAttackFlow(state, draft, dealtLife > 0, hooks);
}

function finishAttackFlow(state: GameState, draft: AttackDraft, dealtLife: boolean, hooks: FlowHooks): void {
  state.pending = null;
  if (state.phase === "gameover") return;
  const program = getProgram(draft.cardId);
  const after: Op[] = [...(program?.onAfter ?? [])];
  if (dealtLife) {
    after.push(...eventOps(state, draft.attacker, "selfLifeDealt"));
    after.push(...eventOps(state, other(draft.attacker), "selfLifeTaken"));
  }
  const ctx: EffectCtx = { self: draft.attacker, cardUid: draft.uid, attack: draft };
  runOps(state, [...after, { op: "finishAttack" }], ctx, hooks);
}

/* ────────────────────────────── 선택/정렬 ────────────────────────────── */

function doChoice(state: GameState, optionId: string, hooks: FlowHooks): void {
  const pending = state.pending;
  if (!pending || pending.kind !== "choice") fail("pending", "선택 단계가 아닙니다.");
  if (!pending.options.some((o) => o.id === optionId)) fail("bad-choice", "없는 선택지입니다.");
  const branch = (pending.branches[optionId] as Op[] | undefined) ?? [];
  const ctx: EffectCtx = { ...pending.ctx, choice: optionId };
  state.pending = null;
  runOps(state, [...branch, ...(pending.resume as Op[])], ctx, hooks);
}

function doOrder(state: GameState, uids: string[], hooks: FlowHooks): void {
  const pending = state.pending;
  if (!pending || pending.kind !== "order") fail("pending", "정렬 단계가 아닙니다.");
  const expected = new Set(pending.uids);
  if (uids.length !== pending.uids.length || !uids.every((uid) => expected.has(uid))) {
    fail("bad-order", "확인한 카드의 순서를 정확히 지정해야 합니다.");
  }
  const owner = pending.who === "self" ? pending.ctx.self : other(pending.ctx.self);
  const p = state.players[owner];
  if (pending.reorder) {
    const cards = uids.map((uid) => p.deck.find((c) => c.uid === uid));
    if (cards.some((c) => !c)) fail("bad-order", "패산에 없는 카드입니다.");
    const top = p.deck.slice(0, uids.length).map((c) => c.uid).sort().join(",");
    const given = [...uids].sort().join(",");
    if (top !== given) fail("bad-order", "패산 위 카드만 정렬할 수 있습니다.");
    p.deck = [...(cards as CardInstance[]), ...p.deck.slice(uids.length)];
    log(state, "card", `${p.name} 패산 위 ${uids.length}장 순서 변경.`);
  }
  const ctx: EffectCtx = { ...pending.ctx, order: uids };
  state.pending = null;
  runOps(state, pending.resume as Op[], ctx, hooks);
}

function doPenalty(state: GameState, choice: "aura" | "life", hooks: FlowHooks): void {
  const pending = state.pending;
  if (!pending || pending.kind !== "penalty") fail("pending", "페널티 단계가 아닙니다.");
  const p = state.players[pending.player];
  if (choice === "aura") {
    if (p.aura <= 0) fail("bad-choice", "오라가 없습니다.");
    loseAura(p, 1);
    log(state, "damage", `${p.name} 패산 고갈 페널티: 오라 1.`);
  } else {
    p.life -= 1;
    p.flare += 1;
    log(state, "damage", `${p.name} 패산 고갈 페널티: 라이프 1.`);
    checkGameOver(state);
  }

  if (state.phase === "gameover") return;
  const remaining = pending.remaining - 1;
  if (remaining > 0) {
    state.pending = { ...pending, remaining };
    return;
  }
  state.pending = null;
  runOps(state, pending.resume as Op[], pending.ctx, hooks);
}

/* ────────────────────────────── 종료/턴 ────────────────────────────── */

function doDiscardDown(state: GameState, uids: string[], hooks: FlowHooks): void {
  const pending = state.pending;
  if (!pending || pending.kind !== "discardDown") fail("pending", "종료 단계가 아닙니다.");
  const p = state.players[pending.player];
  const need = p.hand.length - pending.to;
  if (uids.length !== need) fail("bad-choice", `카드 ${need}장을 골라야 합니다.`);
  for (const uid of uids) {
    if (!p.hand.some((c) => c.uid === uid)) fail("card-not-in-hand", "손패에 없는 카드입니다.");
  }
  for (const uid of uids) {
    const card = p.hand.find((c) => c.uid === uid) as CardInstance;
    p.hand = p.hand.filter((c) => c.uid !== uid);
    p.cover.push(card);
  }
  log(state, "action", `${p.name} 손패 ${uids.length}장을 덮음패로.`);
  state.pending = null;
  finishTurnFlow(state, hooks);
}

function doEndTurn(state: GameState, playerId: PlayerId, hooks: FlowHooks): void {
  const p = state.players[playerId];
  if (p.flags.mode === "power" && !p.flags.powerUsed) {
    // 전력 행동을 선언만 하고 끝낼 수는 없다.
    fail("power-mode", "전력 행동에서는 카드 1장을 사용해야 합니다.");
  }
  if (p.hand.length > state.config.handLimit) {
    state.pending = { kind: "discardDown", player: playerId, to: state.config.handLimit };
    return;
  }
  finishTurnFlow(state, hooks);
}

function finishTurnFlow(state: GameState, hooks: FlowHooks): void {
  const p = state.players[state.turn];
  p.buffs = [];
  // 이번 턴에 걸린 제한은 이번 턴으로 소모된다.
  p.restrictions = p.restrictions
    .map((r) => ({ ...r, turns: r.turns - 1 }))
    .filter((r) => r.turns > 0);

  const o = other(state.turn);
  const events = eventOps(state, o, "foeTurnEnd");
  runOps(state, [...events, { op: "nextTurn" }], { self: o }, hooks);
}

function beginTurn(state: GameState, hooks: FlowHooks): void {
  state.turn = other(state.turn);
  state.round += 1;
  const p = state.players[state.turn];
  resetTurnFlags(state, p);
  p.turnsTaken += 1;
  log(state, "phase", `${p.name}의 턴 ${p.turnsTaken}.`);

  if (p.turnsTaken === 1) {
    state.phase = "main";
    state.pending = null;
    log(state, "phase", `${p.name}의 첫 턴. 개시 페이즈를 건너뜁니다.`);
    return;
  }

  // 개시 페이즈: 집중력 → 부여패 감소 → (재구성 선택) → 드로우
  p.focus = clamp(p.focus + 1, 0, state.config.focusMax);
  log(state, "phase", `${p.name} 집중력 ${p.focus}.`);

  const destroyOps: Op[] = [];
  const toDestroy = p.attaches.filter((attach) => attach.crystals - 1 <= 0);
  for (const attach of toDestroy) {
    const prog = getProgram(attach.cardId);
    destroyOps.push(...(prog?.onDestroy ?? []));
    p.attaches = p.attaches.filter((a) => a.uid !== attach.uid);
    p.dust += 1;
    // 비장패는 버림패로 가지 않는다.
    if (getCard(attach.cardId)?.kind !== "special") {
      p.discard.push({ uid: attach.uid, cardId: attach.cardId });
    }
    log(state, "card", `${cardName(attach.cardId)} 부여패 파기.`);
  }
  for (const attach of p.attaches) {
    if (!toDestroy.includes(attach)) {
      attach.crystals -= 1;
      p.dust += 1;
    }
  }

  runOps(state, [...destroyOps, { op: "askStart" }], { self: state.turn }, hooks);
}

function doStartPhase(state: GameState, playerId: PlayerId, recompose: boolean, hooks: FlowHooks): void {
  const p = state.players[playerId];
  if (recompose) {
    if (p.life <= 1) fail("bad-choice", "라이프 1 이하에서는 재구성할 수 없습니다.");
    p.life -= 1;
    p.flare += 1;
    log(state, "action", `${p.name} 재구성. 라이프 1을 플레어로.`);
    checkGameOver(state);
    if (state.phase === "gameover") return;
    const cards = [...p.deck, ...p.discard, ...p.cover];
    p.deck = shuffle(state.rng, cards);
    p.discard = [];
    p.cover = [];
    log(state, "action", `패산 재구성 (${p.deck.length}장).`);
  }
  state.pending = null;
  const events = eventOps(state, playerId, "turnStart");
  runOps(state, [{ op: "draw", n: 2 }, ...events, { op: "enterMain" }], { self: playerId }, hooks);
}

function autoEndTurn(state: GameState, hooks: FlowHooks): void {
  if (state.pending || state.phase !== "main") return;
  const p = state.players[state.turn];
  if (p.flags.mode !== "power" || !p.flags.powerUsed) return;
  log(state, "phase", `${p.name} 전력 행동 종료.`);
  doEndTurn(state, state.turn, hooks);
}

/** 액션 처리 후 전력 행동 자동 종료 등 후속 정리 */
function settle(state: GameState, hooks: FlowHooks): void {
  if (state.phase === "gameover" || state.phase === "setup") return;
  if (state.pending) return;
  autoEndTurn(state, hooks);
}

export { toPlayerView } from "./view";
