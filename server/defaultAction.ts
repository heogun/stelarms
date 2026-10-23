// 서버가 턴 타임아웃 때 사용할 안전한 기본 액션.
//
// 캐주얼 방과 토너먼트 경기가 같은 규칙을 쓰도록 분리했다.

import { applyAction } from "../src/engine";
import type { Action, GameState, PlayerId } from "../src/engine";

export function tryAction(state: GameState, playerId: PlayerId, action: Action): GameState | null {
  try {
    return applyAction(state, playerId, action);
  } catch {
    return null;
  }
}

export function defaultAction(state: GameState, playerId: PlayerId): Action | null {
  const pending = state.pending;
  if (pending) {
    switch (pending.kind) {
      case "mulligan":
        return { type: "mulligan", returnUids: [] };
      case "startPhase":
        return { type: "startPhase", recompose: false };
      case "response":
        return { type: "response" };
      case "defend": {
        const p = state.players[playerId];
        const aura = pending.attack.aura;
        const life = pending.attack.life;
        if (aura > 0 && p.aura >= aura) return { type: "defend", choice: "aura" };
        if (life > 0) return { type: "defend", choice: "life" };
        return { type: "defend", choice: "aura" };
      }
      case "penalty":
        return {
          type: "penalty",
          choice: state.players[playerId].aura > 0 ? "aura" : "life",
        };
      case "choice":
        return pending.options.length > 0
          ? { type: "choice", optionId: pending.options[0].id }
          : null;
      case "order":
        return { type: "order", uids: pending.uids };
      case "discardDown": {
        const p = state.players[playerId];
        const need = p.hand.length - pending.to;
        return { type: "discardDown", uids: p.hand.slice(0, need).map((c) => c.uid) };
      }
    }
  }
  if (state.phase !== "main") return null;
  const p = state.players[playerId];
  if (p.flags.mode === "power" && !p.flags.powerUsed) {
    const uids = [
      ...p.hand.map((c) => c.uid),
      ...p.specials.filter((s) => !s.used).map((s) => s.uid),
    ];
    for (const uid of uids) {
      if (tryAction(state, playerId, { type: "playCard", uid })) {
        return { type: "playCard", uid };
      }
    }
  }
  if (tryAction(state, playerId, { type: "endTurn" })) return { type: "endTurn" };
  for (const card of p.hand) {
    if (tryAction(state, playerId, { type: "playCard", uid: card.uid })) {
      return { type: "playCard", uid: card.uid };
    }
  }
  return null;
}
