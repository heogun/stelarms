import { useEffect, type RefObject } from "react";

/**
 * 주어진 상자에 맞도록 글자 크기를 자동으로 줄인다.
 *
 * 카드 폭이 바뀌면(그리드 크기 조절, 모달 확대 등) ResizeObserver가 다시 맞춘다.
 * `factor`는 상자 폭 대비 최대 글자 크기 비율이다.
 */
export function useFitText(
  ref: RefObject<HTMLElement | null>,
  {
    factor,
    min,
    cap,
  }: {
    /** 상자 폭 × factor 를 최대 글자 크기로 쓴다 */
    factor: number;
    /** 최소 글자 크기(px). 이보다 작아지면 잘린다 */
    min: number;
    /** 절대 최대 글자 크기(px) */
    cap: number;
  },
) {
  useEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;

    const fit = () => {
      const max = Math.min(cap, box.clientWidth * factor);
      let lo = min;
      let hi = Math.max(min, max);
      let best = min;

      // 이진 탐색: 넘치지 않는 가장 큰 크기를 찾는다
      for (let i = 0; i < 7; i += 1) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (el.scrollHeight <= box.clientHeight + 0.5) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      el.style.fontSize = `${best}px`;
    };

    // ResizeObserver 콜백은 레이아웃 직후에 불리므로 바로 맞춘다.
    // (rAF로 미루면 백그라운드 탭에서 프레임이 멈춰 크기가 갱신되지 않는다)
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);

    return () => ro.disconnect();
  }, [ref, factor, min, cap]);
}
