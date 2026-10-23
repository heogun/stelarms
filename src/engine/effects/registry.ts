// 카드 효과 등록.
//
// 이 파일을 import하면 154장의 효과 정의가 모두 로드된다.
// 새 확장을 추가하면 카드 데이터 파일과 `cards/` 아래 효과 파일을 추가하고
// 여기서 한 줄 import하면 된다.

import "./cards/everys";
import "./cards/universe";
import "./cards/cliche";
import "./cards/abyss";

import { engineCards } from "../cards";
import { programIds } from "./registry-core";

export { defineCard, getProgram, hasProgram, programIds } from "./registry-core";

/** 효과가 정의되지 않은 카드 ID 목록 */
export function missingPrograms(): string[] {
  const known = new Set(programIds());
  return engineCards.filter((card) => !known.has(card.id)).map((card) => card.id);
}

/** 효과가 정의되지 않은 카드가 있으면 즉시 실패 (개발/CI용) */
export function assertAllPrograms(): void {
  const missing = missingPrograms();
  if (missing.length > 0) {
    throw new Error(`효과가 정의되지 않은 카드: ${missing.join(", ")}`);
  }
}
