// 카드 프레임 정의.
//
// 카드는 세 겹을 합성해서 그린다.
//   1) 프레임  : 이 파일에 정의된 이미지 (없으면 CSS로 그린 내장 프레임)
//   2) 일러스트: public/images/art/<카드ID>.<확장자>
//   3) 텍스트  : src/data의 이름·수치·효과를 HTML로 실시간 렌더
//
// 레이아웃(일러스트 창 위치, 여백)은 여기서만 고치면 된다.
// 프레임 이미지를 만들 때도 아래 `art` 비율에 맞춰 투명 창을 뚫으면 된다.

import { frameFiles } from "virtual:asset-manifest";
import type { Card, CardKind } from "./types";

export interface Frame {
  /** 프레임 ID */
  id: string;
  /** 표시 이름 */
  label: string;
  /**
   * 프레임 이미지 경로 (750×1050 PNG 권장).
   * `public/frames/<id>.png` 파일이 있을 때만 채워진다.
   * 없으면 CSS 내장 프레임으로 그린다.
   */
  image?: string;
  /**
   * 일러스트가 들어갈 창. 카드 크기 대비 %.
   * 예: top 14, bottom 30 -> 위 14% ~ 아래 30% 지점까지.
   */
  art: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

/** `public/frames/`에 해당 파일이 있으면 경로를 돌려준다 */
function frameImage(id: string): string | undefined {
  const file = frameFiles[id];
  return file ? `/frames/${file}` : undefined;
}

/** 통상패/비장패 기본 프레임 */
export const frames: Record<CardKind, Frame> = {
  normal: {
    id: "normal",
    label: "통상패",
    image: frameImage("normal"),
    art: { top: 14, right: 10, bottom: 30, left: 10 },
  },
  special: {
    id: "special",
    label: "비장패",
    image: frameImage("special"),
    art: { top: 14, right: 10, bottom: 30, left: 10 },
  },
};

/**
 * 카드에 맞는 프레임을 고른다.
 *
 * 기수별/스트리머별로 다른 프레임을 쓰고 싶으면 여기서 분기하면 된다.
 * 예: `if (card.stellaId === "shibuki") return frames.special`
 * (프레임을 추가하려면 `frames`에 항목을 더하고 `public/frames/<id>.png`를 넣는다)
 */
export function frameFor(card: Card): Frame {
  return frames[card.kind];
}

/** 일러스트 창의 가로:세로 비율 (문서·가이드용) */
export function artAspect(frame: Frame): string {
  const w = 100 - frame.art.left - frame.art.right;
  const h = 100 - frame.art.top - frame.art.bottom;
  return `${w.toFixed(1)}% × ${h.toFixed(1)}%`;
}
