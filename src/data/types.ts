// 게임 데이터 타입 정의
//
// 카드/스트리머/덱을 수정할 때는 이 파일을 참고해서
// `src/data/` 아래의 데이터 파일만 고치면 된다.
// 타입이 맞지 않으면 에디터와 `bun run build`에서 바로 오류가 난다.

/** 카드 분류: 통상패 / 비장패 */
export type CardKind = "normal" | "special";

/** 카드 타입: 공격 / 행동 / 부여 */
export type CardType = "attack" | "action" | "attach";

/** 기수 ID */
export type GenerationId = "everys" | "universe" | "cliche" | "abyss";

/** 적정거리 (공격 카드만). 숫자 하나면 단일 거리, 범위면 [최소, 최대]. */
export type Range = number | [number, number];

/** 카드 한 장 */
export interface Card {
  /** 카드 ID. 파일명과 1:1로 대응한다. 예: "YU-N-1" -> public/images/art/YU-N-1.png */
  id: string;
  /** 스트리머 ID (stella.ts의 Stella.id) */
  stellaId: string;
  /** 통상패/비장패 */
  kind: CardKind;
  /** 공격/행동/부여 */
  type: CardType;
  /** 카드 이름 */
  name: string;
  /** 공격 카드의 적정거리. 행동/부여는 생략 가능 */
  range?: Range;
  /** 오라 데미지 (공격만) */
  auraDamage?: number;
  /** 라이프 데미지 (공격만) */
  lifeDamage?: number;
  /** 부여 카드의 봉납 비용 (부여만) */
  offering?: number;
  /** 비장패의 소모 비용 (비장패만) */
  cost?: number;
  /** 카드 텍스트 (효과 설명) */
  text: string;
  /** 태그: 【필중】, 【대응】, 【전력】 등 강조 키워드. 검색·필터에 사용 */
  keywords?: string[];
  /** 카드 이름 출처 (밈/커버곡 등). 선택 사항 */
  source?: string;
  /**
   * 일러스트 이미지 경로 오버라이드.
   * 없으면 `/images/art/<id>.png`를 쓴다.
   * 일러스트는 프레임 없이 그림만 넣는다 (텍스트는 앱이 그린다).
   */
  art?: string;
  /**
   * 완성된 카드 **전체** 이미지 경로.
   * 지정하면 프레임/텍스트 합성을 건너뛰고 이 이미지만 표시한다.
   * 기존처럼 카드 전체를 한 장으로 뽑아 쓰고 싶을 때만 쓴다.
   */
  image?: string;
  /** 밸런스 메모 등 개발자용 비고 (UI에서는 접었다 펼침) */
  notes?: string;
}

/** 스트리머 한 명 */
export interface Stella {
  /** 스트리머 ID (카드의 stellaId와 연결) */
  id: string;
  /** 카드 ID 접두어. 예: "YU" -> YU-N-1 */
  code: string;
  /** 이름 */
  name: string;
  /** 영문/로마자 이름 (검색·정렬용) */
  nameEn: string;
  /** 소속 기수 */
  generation: GenerationId;
  /** 한 줄 컨셉 */
  tagline: string;
  /** 대표색 (CSS 색상). 카드 테두리·강조에 사용 */
  color: string;
  /** 공식 신장 */
  height: string;
  /** 설정상 무기 */
  weapon: string;
  /** 무기 등급 (단/중/장) */
  weaponTier: string;
  /** 주 거리대 */
  mainRange: string;
  /** 시그니처 메커니즘 이름 */
  signature: string;
  /** 시그니처 설명 */
  signatureDesc: string;
  /** 플레이 스타일 요약 */
  playstyle: string;
  /** 난이도 (1~4) */
  difficulty: number;
  /** 추천 페어 스트리머 ID 목록 */
  pairsWith: string[];
  /** 카드 이름 출처 요약 (표시용) */
  nameSources?: string;
}

/** 기수 메타데이터 */
export interface Generation {
  id: GenerationId;
  /** 표시명. 예: "1기 Everys" */
  label: string;
  /** 기수 컨셉 */
  concept: string;
  /** 대표색 */
  color: string;
}

/** 덱 (통상패 7 + 비장패 3) */
export interface Deck {
  /** 덱 ID */
  id: string;
  /** 덱 이름 */
  name: string;
  /** 메인 스트리머 ID */
  mainId: string;
  /** 파트너 스트리머 ID */
  partnerId: string;
  /** 통상패 카드 ID 7장 */
  normals: string[];
  /** 비장패 카드 ID 3장 */
  specials: string[];
  /** 운영 플랜 */
  plan: string[];
  /** 장점 */
  strength: string;
  /** 약점 */
  weakness: string;
}
