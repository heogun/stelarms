// 경기 생성.
//
// 덱 순서/선공은 전부 시드 RNG로 정해진다.
// 서버가 시드를 만들고, 같은 시드 + 같은 액션이면 항상 같은 경기가 된다.

import { createRng, nextInt, shuffle } from "./rng";
import { cardTable, sameGeneration } from "./cards";
import { fail } from "./errors";
import { log } from "./core";
import { hasProgram } from "./effects/registry";
import type {
  CardInstance,
  GameConfig,
  GameState,
  MatchSetup,
  PlayerId,
  PlayerState,
  SpecialState,
  TournamentRules,
} from "./types";

export const DEFAULT_CONFIG: GameConfig = {
  life: 10,
  aura: 3,
  auraMax: 5,
  distance: 10,
  distanceMax: 10,
  /** 종료 페이즈 손패 상한 */
  handLimit: 2,
  /** 턴당 기본 기본동작 수 (카드 효과로 증가) */
  basicLimit: 1,
  /** 오라 데미지 상한 (【초극】 예외) */
  auraDamageCap: 5,
  focusMax: 2,
};

export const DEFAULT_TOURNAMENT: TournamentRules = {
  sameGenerationFlare: true,
};

export function emptyFlags(config: GameConfig) {
  return {
    basicsUsed: 0,
    basicLimit: config.basicLimit,
    attacks: 0,
    mode: null,
    powerUsed: false,
    onceKeys: [] as string[],
    dealtLife: false,
    tookLife: false,
  };
}

function makePlayer(
  setup: MatchSetup["players"][number],
  id: PlayerId,
  config: GameConfig,
  rng: ReturnType<typeof createRng>,
): PlayerState {
  const p: PlayerState = {
    id,
    name: setup.name,
    stellas: setup.stellas,
    life: config.life,
    aura: config.aura,
    flare: 0,
    dust: 0,
    focus: 0,
    hand: [],
    deck: [],
    discard: [],
    cover: [],
    attaches: [],
    specials: [],
    counters: {
      seonggwang: 0,
      chungjeon: 0,
      pyojeok: 0,
      gise: 0,
      wonhan: 0,
      unun: 0,
    },
    stance: "day",
    flags: emptyFlags(config),
    buffs: [],
    restrictions: [],
    mulliganDone: false,
    turnsTaken: 0,
  };

  const deckCards: CardInstance[] = setup.deck.map((cardId) => ({
    uid: `${id}-${cardId}`,
    cardId,
  }));
  p.deck = shuffle(rng, deckCards);

  p.specials = setup.specials.map<SpecialState>((cardId) => ({
    uid: `${id}-${cardId}`,
    cardId,
    faceUp: false,
    used: false,
  }));

  return p;
}

function validateDeck(entry: MatchSetup["players"][number], label: string): void {
  if (entry.deck.length !== 7) {
    fail("deck-limit", `${label}: 통상패는 정확히 7장이어야 합니다.`);
  }
  if (entry.specials.length !== 3) {
    fail("deck-limit", `${label}: 비장패는 정확히 3장이어야 합니다.`);
  }
  if (new Set(entry.deck).size !== 7 || new Set(entry.specials).size !== 3) {
    fail("setup-invalid", `${label}: 같은 카드를 두 장 넣을 수 없습니다.`);
  }
  if (new Set([...entry.deck, ...entry.specials]).size !== 10) {
    fail("setup-invalid", `${label}: 통상패와 비장패가 겹칩니다.`);
  }
  const stellas = new Set(entry.stellas);
  for (const cardId of entry.deck) {
    const card = cardTable.get(cardId);
    if (!card) fail("card-not-found", `${label}: 알 수 없는 카드 ${cardId}`);
    if (card.kind !== "normal") fail("setup-invalid", `${label}: ${cardId}는 통상패가 아닙니다.`);
    if (!stellas.has(card.stellaId)) {
      fail("setup-invalid", `${label}: ${cardId}는 고른 스텔라의 카드가 아닙니다.`);
    }
    if (!hasProgram(cardId)) {
      fail("card-unplayable", `${label}: ${cardId}의 효과가 아직 구현되지 않았습니다.`);
    }
  }
  for (const cardId of entry.specials) {
    const card = cardTable.get(cardId);
    if (!card) fail("card-not-found", `${label}: 알 수 없는 카드 ${cardId}`);
    if (card.kind !== "special") fail("setup-invalid", `${label}: ${cardId}는 비장패가 아닙니다.`);
    if (!stellas.has(card.stellaId)) {
      fail("setup-invalid", `${label}: ${cardId}는 고른 스텔라의 카드가 아닙니다.`);
    }
    if (!hasProgram(cardId)) {
      fail("card-unplayable", `${label}: ${cardId}의 효과가 아직 구현되지 않았습니다.`);
    }
  }
}

export function createMatch(setup: MatchSetup): GameState {
  if (!setup.seed) fail("setup-invalid", "시드가 필요합니다.");
  validateDeck(setup.players[0], "P1");
  validateDeck(setup.players[1], "P2");

  const config = DEFAULT_CONFIG;
  const rng = createRng(setup.seed);
  const firstPlayer: PlayerId = setup.firstPlayer ?? (nextInt(rng, 2) as PlayerId);

  const players: [PlayerState, PlayerState] = [
    makePlayer(setup.players[0], 0, config, rng),
    makePlayer(setup.players[1], 1, config, rng),
  ];

  for (const p of players) {
    p.focus = p.id === firstPlayer ? 0 : 1;
    if (DEFAULT_TOURNAMENT.sameGenerationFlare && sameGeneration(p.stellas[0], p.stellas[1])) {
      p.flare += 1;
    }
    // 초기 손패 3장
    for (let i = 0; i < 3; i += 1) {
      const card = p.deck.shift();
      if (card) p.hand.push(card);
    }
  }

  const state: GameState = {
    schema: 1,
    seq: 1,
    logSeq: 0,
    rng,
    config,
    rules: DEFAULT_TOURNAMENT,
    phase: "setup",
    turn: firstPlayer,
    firstPlayer,
    round: 0,
    distance: config.distance,
    players,
    pending: { kind: "mulligan", player: firstPlayer },
    winner: null,
    log: [],
    nextBuffId: 1,
    history: [],
  };

  log(state, "system", `대전 시작. 선공: ${players[firstPlayer].name}`);
  log(state, "system", `거리 ${state.distance}, 라이프 ${config.life}, 오라 ${config.aura}.`);
  return state;
}

/** 이번 턴 플래그 초기화 */
export function resetTurnFlags(state: GameState, p: PlayerState): void {
  p.flags = emptyFlags(state.config);
  p.buffs = [];
}
