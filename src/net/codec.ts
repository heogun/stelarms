// 클라이언트/서버 공용 프로토콜 압축 유틸 (대역폭 최적화)
// 기존 키명과 호환되는 단축 키를 사용한다.

export type MsgType =
  | "welcome"
  | "room"
  | "state"
  | "tournament"
  | "tstate"
  | "error"
  | "pong"
  | "create"
  | "join"
  | "resume"
  | "setDeck"
  | "start"
  | "action"
  | "leave"
  | "tcreate"
  | "tjoin"
  | "tresume"
  | "tstart"
  | "tpick"
  | "tban"
  | "tdeck"
  | "taction"
  | "tleave"
  | "ping";

// 서버→클라이언트 단축
export const S2C: Record<string, string> = {
  welcome: "w",
  room: "r",
  state: "s",
  tournament: "T",
  tstate: "ts",
  error: "e",
  pong: "p",
};

export const C2S: Record<string, string> = {
  create: "C",
  join: "J",
  resume: "R",
  setDeck: "d",
  start: "S",
  action: "a",
  leave: "L",
  tcreate: "tc",
  tjoin: "tj",
  tresume: "tr",
  tstart: "tS",
  tpick: "tp",
  tban: "tb",
  tdeck: "td",
  taction: "ta",
  tleave: "tL",
  ping: "i",
};

const S2C_REV: Record<string, string> = Object.fromEntries(
  Object.entries(S2C).map(([k, v]) => [v, k]),
);
const C2S_REV: Record<string, string> = Object.fromEntries(
  Object.entries(C2S).map(([k, v]) => [v, k]),
);

function shortKeys(obj: any, map: Record<string, string>): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => shortKeys(v, map));
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = map[k] ?? k;
    out[nk] = shortKeys(v, map);
  }
  return out;
}

function longKeys(obj: any, rev: Record<string, string>): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => longKeys(v, rev));
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = rev[k] ?? k;
    out[nk] = longKeys(v, rev);
  }
  return out;
}

export function encodeServer(m: any): string {
  return JSON.stringify(shortKeys(m, S2C));
}

export function decodeClient(raw: string): any {
  try {
    const parsed = JSON.parse(raw);
    return longKeys(parsed, C2S_REV);
  } catch {
    return null;
  }
}

export function encodeClient(m: any): string {
  return JSON.stringify(shortKeys(m, C2S));
}

export function decodeServer(raw: string): any {
  try {
    const parsed = JSON.parse(raw);
    return longKeys(parsed, S2C_REV);
  } catch {
    return null;
  }
}
