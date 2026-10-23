// 엔진 공개 API
//
// 순수 TypeScript. Vite 전용 모듈을 import하지 않는다.

export { DEFAULT_CONFIG, DEFAULT_TOURNAMENT, createMatch, emptyFlags, resetTurnFlags } from "./state";
export { applyAction, parseAction, tryApplyAction } from "./actions";
export type { Action, ApplyResult } from "./actions";
export { toPlayerView } from "./view";
export type { PlayerView, PendingView, YouView, FoeView } from "./view";
export { hashState } from "./hash";
export { createRng, nextInt, shuffle } from "./rng";
export { getCard, engineCards, cardTable, sameGeneration, stellaGeneration } from "./cards";
export { assertAllPrograms, getProgram, hasProgram, missingPrograms, programIds } from "./effects/registry";
export { RuleError, isRuleError } from "./errors";
export * from "./types";
