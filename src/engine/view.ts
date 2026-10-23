// 정보 은닉 뷰.
//
// 서버는 이 뷰를 플레이어별로 생성해 전송한다.
// 상대의 손패/패산/덮음패/비장패는 절대 보내지 않는다.
//
// `PendingView`는 UI가 바로 소비할 수 있도록 내부 필드(resume/ctx 등)를
// 노출하지 않고 필요한 정보만 담는다.

import { other } from "./core";
import type {
  AttackDraft,
  ChoiceOption,
  GameState,
  Pending,
  PlayerId,
  PlayerState,
} from "./types";

function cardIdOfUid(uid: string): string {
  return uid.split("-").slice(1).join("-");
}

function revealCard(uid: string) {
  return { uid, cardId: cardIdOfUid(uid) };
}

function youView(p: PlayerState) {
  return {
    id: p.id,
    name: p.name,
    stellas: p.stellas,
    life: p.life,
    aura: p.aura,
    flare: p.flare,
    dust: p.dust,
    focus: p.focus,
    hand: p.hand.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    handCount: p.hand.length,
    deckCount: p.deck.length,
    cover: p.cover.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    coverCount: p.cover.length,
    discard: p.discard.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    discardCount: p.discard.length,
    specials: p.specials.map((s) => ({
      uid: s.uid,
      cardId: s.cardId,
      faceUp: s.faceUp,
      used: s.used,
    })),
    attaches: p.attaches,
    counters: p.counters,
    stance: p.stance,
    flags: {
      basicsUsed: p.flags.basicsUsed,
      basicLimit: p.flags.basicLimit,
      attacks: p.flags.attacks,
      mode: p.flags.mode,
      powerUsed: p.flags.powerUsed,
    },
    buffs: p.buffs,
    restrictions: p.restrictions,
    mulliganDone: p.mulliganDone,
    turnsTaken: p.turnsTaken,
  };
}

function foeView(p: PlayerState) {
  return {
    id: p.id,
    name: p.name,
    stellas: p.stellas,
    life: p.life,
    aura: p.aura,
    flare: p.flare,
    dust: p.dust,
    focus: p.focus,
    handCount: p.hand.length,
    deckCount: p.deck.length,
    coverCount: p.cover.length,
    discard: p.discard.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    discardCount: p.discard.length,
    specials: p.specials.map((s) => ({
      uid: s.uid,
      faceUp: s.faceUp,
      used: s.used,
      cardId: s.faceUp ? s.cardId : undefined,
    })),
    attaches: p.attaches,
    counters: p.counters,
    stance: p.stance,
    buffs: p.buffs,
    restrictions: p.restrictions,
    flags: {
      basicsUsed: p.flags.basicsUsed,
      basicLimit: p.flags.basicLimit,
      attacks: p.flags.attacks,
      mode: p.flags.mode,
      powerUsed: p.flags.powerUsed,
    },
  };
}

export type YouView = ReturnType<typeof youView>;
export type FoeView = ReturnType<typeof foeView>;

export type PendingView =
  | { kind: "mulligan"; player: PlayerId }
  | { kind: "startPhase"; player: PlayerId; canRecompose: boolean }
  | { kind: "response"; player: PlayerId; attack: AttackDraft }
  | { kind: "defend"; player: PlayerId; attack: AttackDraft }
  | { kind: "discardDown"; player: PlayerId; to: number }
  | { kind: "penalty"; player: PlayerId; remaining: number }
  | {
      kind: "choice";
      player: PlayerId;
      prompt: string;
      options: ChoiceOption[];
      reveal?: { uid: string; cardId: string }[];
    }
  | {
      kind: "order";
      player: PlayerId;
      prompt: string;
      uids: string[];
      who: "self" | "foe";
      reorder: boolean;
      reveal?: { uid: string; cardId: string }[];
    }
  | { kind: Pending["kind"]; player: PlayerId; waiting: true; message: string };

function pendingView(state: GameState, seat: PlayerId): PendingView | null {
  const pending = state.pending;
  if (!pending) return null;
  if (pending.player !== seat) {
    return { kind: pending.kind, player: pending.player, waiting: true, message: "상대가 선택 중" };
  }
  switch (pending.kind) {
    case "mulligan":
      return { kind: "mulligan", player: pending.player };
    case "startPhase":
      return { kind: "startPhase", player: pending.player, canRecompose: pending.canRecompose };
    case "response":
      return { kind: "response", player: pending.player, attack: pending.attack };
    case "defend":
      return { kind: "defend", player: pending.player, attack: pending.attack };
    case "discardDown":
      return { kind: "discardDown", player: pending.player, to: pending.to };
    case "penalty":
      return { kind: "penalty", player: pending.player, remaining: pending.remaining };
    case "choice":
      return {
        kind: "choice",
        player: pending.player,
        prompt: pending.prompt,
        options: pending.options,
        reveal: pending.reveal?.map(revealCard),
      };
    case "order":
      return {
        kind: "order",
        player: pending.player,
        prompt: pending.prompt,
        uids: pending.uids,
        who: pending.who,
        reorder: pending.reorder,
        reveal: pending.reveal?.map(revealCard),
      };
  }
}

export function toPlayerView(state: GameState, seat: PlayerId) {
  const you = state.players[seat];
  const them = state.players[other(seat)];

  return {
    seat,
    turn: state.turn,
    phase: state.phase,
    round: state.round,
    distance: state.distance,
    winner: state.winner,
    config: state.config,
    you: youView(you),
    foe: foeView(them),
    pending: pendingView(state, seat),
    log: state.log.slice(-40),
  };
}

export type PlayerView = ReturnType<typeof toPlayerView>;
