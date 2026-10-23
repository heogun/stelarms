// 카드 프로그램 저장소의 핵심.
//
// 카드 데이터 파일이 이 파일만 import하므로 순환 참조가 생기지 않는다.
// (registry.ts가 카드 파일들을 로드해 여기에 등록한다)

import type { CardProgram } from "./types";

const programs = new Map<string, CardProgram>();

export function defineCard(id: string, program: CardProgram): CardProgram {
  if (programs.has(id)) {
    throw new Error(`중복 카드 효과 정의: ${id}`);
  }
  programs.set(id, program);
  return program;
}

export function getProgram(id: string): CardProgram | undefined {
  return programs.get(id);
}

export function hasProgram(id: string): boolean {
  return programs.has(id);
}

export function programIds(): string[] {
  return [...programs.keys()];
}
