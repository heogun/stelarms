// 대전 UI에서 쓰는 비컴포넌트 헬퍼.
// Fast Refresh가 컴포넌트 파일에서 상수/훅을 함께 export하지 않도록 분리한다.

import { useEffect, useRef, useState } from "react";
import type { CounterId } from "../../engine";
import { getCard } from "../../engine";

export const COUNTER_LABELS: Record<CounterId, string> = {
  seonggwang: "성광",
  chungjeon: "충전",
  pyojeok: "표적",
  gise: "기세",
  wonhan: "원한",
  unun: "불운",
};

export function cardName(cardId: string): string {
  return getCard(cardId)?.name ?? cardId;
}

export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** 로그 자동 스크롤 */
export function useAutoScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}
