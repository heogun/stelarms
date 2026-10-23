// 클라이언트/서버 공용 프로토콜.
//
// 액션 자체(`Action`)는 엔진의 `parseAction`이 검증하므로 여기서는
// "누가 보낸 어떤 메시지인가"만 정의한다. 서버는 클라이언트가 보낸
// seat/player를 절대 신뢰하지 않고 소켓에 묶인 seat를 사용한다.

import type { PlayerId, PlayerView } from "../engine";
import type { CustomDeckInput } from "../data/customDeck";

export const PROTOCOL_VERSION = 2;

export type { PlayerView };

/** 서버가 검증한 덱 선택. 프리셋 ID 또는 커스텀 덱 전체. */
export type DeckChoice =
  | { kind: "preset"; id: string }
  | { kind: "custom"; deck: CustomDeckInput };

/**
 * 로비에 보여 주는 덱 요약.
 *
 * `normals`/`specials`는 본인 좌석에만 채운다. 상대에게는 이름·스텔라·
 * 장수만 보내 덱 구성을 숨긴다.
 */
export interface SeatDeck {
  id: string;
  name: string;
  mainId: string;
  partnerId: string;
  normalCount: number;
  specialCount: number;
  normals?: string[];
  specials?: string[];
}

export interface LobbySeat {
  seat: PlayerId;
  name: string;
  deck: SeatDeck | null;
  connected: boolean;
}

export type ClientMessage =
  | { type: "create"; name: string; deck: DeckChoice }
  | { type: "join"; roomCode: string; name: string; deck: DeckChoice }
  | { type: "resume"; roomCode: string; token: string }
  | { type: "setDeck"; deck: DeckChoice }
  | { type: "start" }
  | { type: "action"; action: unknown }
  | { type: "leave" }
  | { type: "ping" };

export type ServerMessage =
  | { type: "welcome"; version: number; serverTime: number }
  | {
      type: "room";
      roomCode: string;
      seat: PlayerId;
      token: string;
      hostSeat: PlayerId;
      started: boolean;
      seats: (LobbySeat | null)[];
    }
  | {
      type: "state";
      view: PlayerView;
      hash: string;
      seq: number;
      deadline: number | null;
      seats: (LobbySeat | null)[];
    }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; serverTime: number };

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_NAME_LENGTH = 24;
export const ROOM_CODE_LENGTH = 6;
