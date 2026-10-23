// 결정론적 난수 (xoshiro128**).
//
// 상태가 16바이트 숫자 배열뿐이라 GameState에 그대로 담을 수 있고,
// 같은 시드 + 같은 액션이면 항상 같은 경기가 재현된다. (리플레이 검증용)

import type { RngState } from "./types";

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** 문자열 시드를 4개의 uint32로 확장한다 (splitmix32) */
export function createRng(seed: string): RngState {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const s: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    h = (h + 0x9e3779b9) >>> 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    s[i] = (z ^ (z >>> 15)) >>> 0;
  }
  // 0으로만 채워지는 퇴화 상태 방지
  if (s.every((v) => v === 0)) s[0] = 1;
  return { s };
}

/** 다음 uint32 (상태를 직접 갱신) */
export function nextUint32(rng: RngState): number {
  const s = rng.s;
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  return result >>> 0;
}

/** 0 이상 max 미만의 정수 (거부 샘플링으로 편향 제거) */
export function nextInt(rng: RngState, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("nextInt: maxExclusive must be a positive integer");
  }
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  for (let i = 0; i < 32; i += 1) {
    const value = nextUint32(rng);
    if (value < limit) return value % maxExclusive;
  }
  return nextUint32(rng) % maxExclusive;
}

/** 배열을 제자리에서 섞는다 (Fisher-Yates) */
export function shuffle<T>(rng: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** 상태를 복제한다 (불변성 유지용) */
export function cloneRng(rng: RngState): RngState {
  return { s: [...rng.s] as [number, number, number, number] };
}
