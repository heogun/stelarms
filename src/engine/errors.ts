// 엔진 오류.
//
// 모든 실패는 예외가 아니라 값으로 돌려준다.
// 서버는 이 코드를 로그로 남기고 클라이언트에는 사람이 읽을 메시지만 보낸다.

export type ErrorCode =
  | "bad-action"
  | "not-your-turn"
  | "bad-phase"
  | "pending"
  | "not-pending-player"
  | "card-not-in-hand"
  | "card-not-found"
  | "card-unplayable"
  | "special-used"
  | "special-not-owned"
  | "not-enough-flare"
  | "not-enough-aura"
  | "not-enough-dust"
  | "not-enough-counter"
  | "not-enough-offering"
  | "out-of-range"
  | "no-basic-left"
  | "basic-unavailable"
  | "restricted"
  | "power-mode"
  | "standard-mode"
  | "deck-limit"
  | "setup-invalid"
  | "bad-choice"
  | "bad-order"
  | "internal";

export class RuleError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "RuleError";
    this.code = code;
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new RuleError(code, message);
}

export function isRuleError(error: unknown): error is RuleError {
  return error instanceof RuleError;
}
