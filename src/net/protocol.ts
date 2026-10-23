// 클라이언트/서버 공용 프로토콜.
//
// 액션 자체(`Action`)는 엔진의 `parseAction`이 검증하므로 여기서는
// "누가 보낸 어떤 메시지인가"만 정의한다. 서버는 클라이언트가 보낸
// seat/player를 절대 신뢰하지 않고 소켓에 묶인 seat를 사용한다.

import type { PlayerId, PlayerView } from "../engine";

export const PROTOCOL_VERSION = 1;

export type { PlayerView };

export interface LobbySeat {
  seat: PlayerId;
  name: string;
  deckId: string | null;
  connected: boolean;
}

export type ClientMessage =
  | { type: "create"; name: string; deckId: string }
  | { type: "join"; roomCode: string; name: string; deckId: string }
  | { type: "resume"; roomCode: string; token: string }
  | { type: "setDeck"; deckId: string }
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
