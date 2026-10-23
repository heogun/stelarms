// 룰 엔진의 상태 타입.
//
// 이 파일의 타입은 전부 **직렬화 가능한 순수 데이터**다.
// 서버가 상태를 보관하고 그대로 클라이언트에 보낼 수 있어야 하므로
// 함수/클래스/Map/Set을 상태에 넣지 않는다.

import type { Range } from "../data/types";

export type PlayerId = 0 | 1;

export type Phase = "setup" | "main" | "gameover";

export type BasicAction =
  | "advance"
  | "retreat"
  | "coil"
  | "gather"
  | "breakaway";

export type CounterId =
  | "seonggwang"
  | "chungjeon"
  | "pyojeok"
  | "gise"
  | "wonhan"
  | "unun";

export type Stance = "day" | "night";

/** 덱/손패/패산 등에 들어가는 카드 한 장의 인스턴스 */
export interface CardInstance {
  /** 경기 내 고유 ID. `${player}-${cardId}` */
  uid: string;
  /** `src/data/cards`의 카드 ID */
  cardId: string;
}

/** 부여패 존의 카드 */
export interface AttachState {
  uid: string;
  cardId: string;
  /** 카드 위에 올라간 크리스탈 수 (0이 되면 파기) */
  crystals: number;
}

/** 비장패 존의 카드 */
export interface SpecialState {
  uid: string;
  cardId: string;
  /** 앞면 공개 여부 */
  faceUp: boolean;
  /** 이번 게임에서 사용했는지 */
  used: boolean;
}

/** "다음 공격 +1/+0" 같은 일회성 강화 */
export interface Buff {
  id: number;
  aura: number;
  life: number;
  /** 적용 가능한 남은 횟수 */
  charges: number;
  /** 특정 스텔라 카드에만 적용 (파트너 한정 효과) */
  onlyStellaId?: string;
  /** 이 스텔라 카드에는 적용하지 않는다 (파트너 = 내 카드 제외) */
  notStellaId?: string;
  /** 이 공격에 적용할 거리확대 */
  rangeExpand?: number;
  /** 이번 턴 공격 횟수가 이 값 이상일 때만 적용 (두 번째 공격 강화) */
  minAttacks?: number;
  /** 이번 턴에만 유효 */
  expires: "turn";
  label: string;
}

/** 상대에게 걸린 행동 제한 */
export interface Restriction {
  kind: "advance" | "retreat" | "basic";
  /** 남은 턴 수 */
  turns: number;
  label: string;
}

export interface TurnFlags {
  /** 이번 턴에 사용한 기본동작 수 */
  basicsUsed: number;
  /** 이번 턴에 허용된 기본동작 수 (기본 1 + 카드 효과) */
  basicLimit: number;
  /** 이번 턴에 사용한 공격 수 */
  attacks: number;
  /** 이번 턴 메인 페이즈 모드 */
  mode: "standard" | "power" | null;
  /** 전력 행동으로 카드를 사용했는지 */
  powerUsed: boolean;
  /** 이번 턴에 이미 발동한 "턴에 1번" 효과 키 */
  onceKeys: string[];
  /** 이번 턴에 라이프 데미지를 줬는지 */
  dealtLife: boolean;
  /** 이번 턴에 라이프 데미지를 받았는지 */
  tookLife: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** 고른 스텔라 2명 */
  stellas: [string, string];
  life: number;
  aura: number;
  flare: number;
  dust: number;
  focus: number;
  hand: CardInstance[];
  /** 패산. index 0이 맨 위 */
  deck: CardInstance[];
  discard: CardInstance[];
  /** 덮음패 */
  cover: CardInstance[];
  attaches: AttachState[];
  specials: SpecialState[];
  counters: Record<CounterId, number>;
  stance: Stance;
  flags: TurnFlags;
  buffs: Buff[];
  restrictions: Restriction[];
  /** 멀리건 완료 여부 */
  mulliganDone: boolean;
  /** 이번 게임에서 가져간 턴 수 */
  turnsTaken: number;
}

/** 공격 선언 후 데미지 확정 전까지의 임시 상태 */
export interface AttackDraft {
  attacker: PlayerId;
  uid: string;
  cardId: string;
  /** 현재 오라 데미지 */
  aura: number;
  /** 현재 라이프 데미지 */
  life: number;
  /** 【필중】 */
  pierce: boolean;
  /** 【초극】 */
  super: boolean;
  /** 적용된 적정거리 */
  range: Range;
  /** 대응으로 감소된 값 기록 */
  reductions: { aura: number; life: number }[];
  /** 이 공격에 이미 대응 카드를 썼는지 */
  responded: boolean;
}

export interface ChoiceOption {
  id: string;
  label: string;
}

/** 플레이어의 입력을 기다리는 지점 */
export type Pending =
  | { kind: "mulligan"; player: PlayerId }
  | { kind: "startPhase"; player: PlayerId; canRecompose: boolean }
  | {
      kind: "response";
      player: PlayerId;
      attack: AttackDraft;
    }
  | { kind: "defend"; player: PlayerId; attack: AttackDraft }
  | { kind: "discardDown"; player: PlayerId; to: number }
  | {
      kind: "penalty";
      player: PlayerId;
      remaining: number;
      resume: unknown[];
      ctx: EffectCtx;
    }
  | {
      kind: "choice";
      player: PlayerId;
      prompt: string;
      options: ChoiceOption[];
      /** option id -> 이어질 효과 */
      branches: Record<string, unknown[]>;
      /** 이 선택을 하는 플레이어에게만 보이는 카드 (확인 효과) */
      reveal?: string[];
      /** 선택 후 이어서 실행할 효과 */
      resume: unknown[];
      ctx: EffectCtx;
    }
  | {
      kind: "order";
      player: PlayerId;
      prompt: string;
      uids: string[];
      /** 어느 쪽 패산인지 */
      who: "self" | "foe";
      /** true면 순서를 바꿀 수 있다. false면 확인만. */
      reorder: boolean;
      reveal?: string[];
      resume: unknown[];
      ctx: EffectCtx;
    };

/** 효과 실행 컨텍스트 (직렬화 가능) */
export interface EffectCtx {
  /** 효과를 일으킨 플레이어 */
  self: PlayerId;
  /** 사용한 카드 uid (있으면) */
  cardUid?: string;
  /** 진행 중인 공격 */
  attack?: AttackDraft;
  /** 방금 고른 선택지 id */
  choice?: string;
  /** 방금 정렬한 카드 uid 순서 */
  order?: string[];
}

export interface LogEntry {
  seq: number;
  turn: PlayerId;
  kind: "system" | "action" | "damage" | "phase" | "card" | "error";
  text: string;
}

export interface GameConfig {
  /** 라이프 초기값 */
  life: number;
  /** 오라 초기값 */
  aura: number;
  /** 오라 최대 */
  auraMax: number;
  /** 거리 초기값 */
  distance: number;
  /** 거리 최대 */
  distanceMax: number;
  /** 손패 상한 */
  handLimit: number;
  /** 턴당 기본 기본동작 수 */
  basicLimit: number;
  /** 오라 데미지 상한 (초극 예외) */
  auraDamageCap: number;
  /** 집중력 상한 */
  focusMax: number;
}

export interface TournamentRules {
  /** 합방 보너스: 같은 기수 2명이면 플레어 +1 */
  sameGenerationFlare: boolean;
}

export interface GameState {
  schema: 1;
  seq: number;
  /** 로그 일련번호 (결정론적) */
  logSeq: number;
  rng: RngState;
  config: GameConfig;
  rules: TournamentRules;
  phase: Phase;
  turn: PlayerId;
  firstPlayer: PlayerId;
  round: number;
  distance: number;
  players: [PlayerState, PlayerState];
  pending: Pending | null;
  winner: PlayerId | "draw" | null;
  log: LogEntry[];
  nextBuffId: number;
  /** 액션 로그 (리플레이/검증용) */
  history: ActionRecord[];
}

export interface ActionRecord {
  seq: number;
  player: PlayerId;
  type: string;
  payload: unknown;
  /** 적용 후 상태 해시 (리플레이 검증용) */
  hash: string;
}

/** xoshiro128** 상태 */
export interface RngState {
  s: [number, number, number, number];
}

export interface MatchSetup {
  seed: string;
  players: [
    { name: string; stellas: [string, string]; deck: string[]; specials: string[] },
    { name: string; stellas: [string, string]; deck: string[]; specials: string[] },
  ];
  /** 테스트용: 첫 플레이어 고정 */
  firstPlayer?: PlayerId;
}
