// 온라인 대전 WebSocket 훅.
//
// 서버가 보내는 것: 방 정보, 플레이어별 뷰, 오류.
// 클라이언트가 보내는 것: 방 생성/참가/재접속, 덱 변경, 액션.
// 재접속 토큰은 sessionStorage에 보관한다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action } from "../engine";
import type {
  ClientMessage,
  DeckChoice,
  LobbySeat,
  PlayerView,
  ServerMessage,
} from "./protocol";

const SESSION_KEY = "stelarms.session.v1";

export interface RoomInfo {
  roomCode: string;
  seat: 0 | 1;
  token: string;
  hostSeat: 0 | 1;
  started: boolean;
}

export interface OnlineError {
  code: string;
  message: string;
}

interface Session {
  roomCode: string;
  token: string;
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.roomCode === "string" && typeof parsed.token === "string") {
      return { roomCode: parsed.roomCode, token: parsed.token };
    }
  } catch {
    // ignore
  }
  return null;
}

function writeSession(session: Session): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

function wsUrl(): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  if (env.VITE_WS_URL) return env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV) return `${proto}//${window.location.hostname}:3001/ws`;
  return `${proto}//${window.location.host}/ws`;
}

export function useOnline() {
  const socketRef = useRef<WebSocket | null>(null);
  const shouldReconnect = useRef(true);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const resumedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [resuming, setResuming] = useState(() => readSession() !== null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [seats, setSeats] = useState<(LobbySeat | null)[]>([]);
  const [view, setView] = useState<PlayerView | null>(null);
  const [hash, setHash] = useState("");
  const [seq, setSeq] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [error, setError] = useState<OnlineError | null>(null);

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const handle = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "welcome": {
        setConnected(true);
        retryRef.current = 0;
        const session = readSession();
        if (session && !resumedRef.current) {
          resumedRef.current = true;
          setResuming(true);
          send({ type: "resume", roomCode: session.roomCode, token: session.token });
        } else {
          setResuming(false);
        }
        break;
      }
      case "room": {
        const info: RoomInfo = {
          roomCode: message.roomCode,
          seat: message.seat,
          token: message.token,
          hostSeat: message.hostSeat,
          started: message.started,
        };
        setRoom(info);
        setSeats(message.seats);
        writeSession({ roomCode: info.roomCode, token: info.token });
        setResuming(false);
        setError(null);
        break;
      }
      case "state":
        setView(message.view);
        setHash(message.hash);
        setSeq(message.seq);
        setDeadline(message.deadline);
        setSeats(message.seats);
        setResuming(false);
        setError(null);
        break;
      case "error":
        setResuming(false);
        setError({ code: message.code, message: message.message });
        if (
          message.code === "bad-token" ||
          message.code === "room-not-found" ||
          message.code === "room-expired" ||
          message.code === "room-closed"
        ) {
          clearSession();
          resumedRef.current = false;
          setRoom(null);
          setView(null);
          setSeats([]);
        }
        break;
      case "pong":
        break;
    }
  }, [send]);

  useEffect(() => {
    shouldReconnect.current = true;
    resumedRef.current = false;

    const connect = () => {
      setConnected(false);
      const socket = new WebSocket(wsUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        // 새 연결마다 저장된 세션으로 한 번 재접속을 시도한다.
        resumedRef.current = false;
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          handle(message);
        } catch {
          setError({ code: "bad-message", message: "서버 응답을 읽을 수 없습니다." });
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!shouldReconnect.current) return;
        const attempt = retryRef.current + 1;
        retryRef.current = attempt;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5));
        timerRef.current = window.setTimeout(connect, delay);
      };
      socket.onerror = () => {
        // onclose가 재접속을 담당한다.
      };
    };

    connect();

    return () => {
      shouldReconnect.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [handle]);

  // 30초마다 핑 (프록시 유휴 연결 정리 방지)
  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => send({ type: "ping" }), 30_000);
    return () => window.clearInterval(id);
  }, [connected, send]);

  const create = useCallback(
    (name: string, deck: DeckChoice) => {
      setError(null);
      setResuming(false);
      resumedRef.current = true;
      send({ type: "create", name, deck });
    },
    [send],
  );

  const join = useCallback(
    (roomCode: string, name: string, deck: DeckChoice) => {
      setError(null);
      setResuming(false);
      resumedRef.current = true;
      send({ type: "join", roomCode, name, deck });
    },
    [send],
  );

  const setDeck = useCallback((deck: DeckChoice) => send({ type: "setDeck", deck }), [send]);
  const start = useCallback(() => send({ type: "start" }), [send]);
  const act = useCallback((action: Action) => send({ type: "action", action }), [send]);

  const leave = useCallback(() => {
    send({ type: "leave" });
    clearSession();
    resumedRef.current = false;
    setRoom(null);
    setView(null);
    setSeats([]);
    setHash("");
    setSeq(0);
    setDeadline(null);
    setError(null);
    setResuming(false);
  }, [send]);

  return {
    connected,
    resuming,
    room,
    seats,
    view,
    hash,
    seq,
    deadline,
    error,
    clearError,
    create,
    join,
    setDeck,
    start,
    act,
    leave,
  };
}

export type Online = ReturnType<typeof useOnline>;
