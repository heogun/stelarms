// 온라인 대전 WebSocket 훅.
//
// 서버가 보내는 것: 방 정보, 플레이어별 뷰, 대회 스냅샷, 대회 경기 뷰, 오류.
// 클라이언트가 보내는 것: 방/대회 생성·참가·재접속, 덱/픽/밴, 액션.
// 재접속 토큰은 sessionStorage에 보관한다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action } from "../engine";
import type { CustomDeckInput } from "../data/customDeck";
import type {
  ClientMessage,
  DeckChoice,
  LobbySeat,
  PlayerView,
  ServerMessage,
  TournamentView,
} from "./protocol";

const SESSION_KEY = "stelarms.session.v2";
const LEGACY_ROOM_SESSION_KEY = "stelarms.session.v1";

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
  kind: "room" | "tournament";
  code: string;
  token: string;
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Session>;
      if (
        (parsed.kind === "room" || parsed.kind === "tournament") &&
        typeof parsed.code === "string" &&
        typeof parsed.token === "string"
      ) {
        return { kind: parsed.kind, code: parsed.code, token: parsed.token };
      }
    }
    // v0.6 이전의 방 세션도 계속 복원한다.
    const legacy = sessionStorage.getItem(LEGACY_ROOM_SESSION_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as { roomCode?: unknown; token?: unknown };
    if (typeof parsed.roomCode === "string" && typeof parsed.token === "string") {
      return { kind: "room", code: parsed.roomCode, token: parsed.token };
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
    sessionStorage.removeItem(LEGACY_ROOM_SESSION_KEY);
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

const FATAL_SESSION_CODES = new Set([
  "bad-token",
  "room-not-found",
  "room-expired",
  "room-closed",
  "tournament-not-found",
  "tournament-expired",
  "session-replaced",
]);

export function useOnline() {
  const socketRef = useRef<WebSocket | null>(null);
  const shouldReconnect = useRef(true);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const resumedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [resuming, setResuming] = useState(() => readSession() !== null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [tournament, setTournament] = useState<TournamentView | null>(null);
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

  const clearMatchState = useCallback(() => {
    setView(null);
    setHash("");
    setSeq(0);
    setDeadline(null);
  }, []);

  const handle = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "welcome": {
          setConnected(true);
          retryRef.current = 0;
          const session = readSession();
          if (session && !resumedRef.current) {
            resumedRef.current = true;
            setResuming(true);
            if (session.kind === "tournament") {
              send({ type: "tresume", code: session.code, token: session.token });
            } else {
              send({ type: "resume", roomCode: session.code, token: session.token });
            }
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
          setTournament(null);
          setSeats(message.seats);
          writeSession({ kind: "room", code: info.roomCode, token: info.token });
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
        case "tournament": {
          setTournament(message.tournament);
          setRoom(null);
          setResuming(false);
          setError(null);
          const match = message.tournament.selfMatch;
          if (!match || match.status !== "game") clearMatchState();
          if (message.tournament.token) {
            writeSession({
              kind: "tournament",
              code: message.tournament.code,
              token: message.tournament.token,
            });
          }
          break;
        }
        case "tstate":
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
          if (FATAL_SESSION_CODES.has(message.code)) {
            clearSession();
            resumedRef.current = false;
            setRoom(null);
            setTournament(null);
            clearMatchState();
            setSeats([]);
          }
          break;
        case "pong":
          break;
      }
    },
    [send, clearMatchState],
  );

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

  const createTournament = useCallback(
    (name: string) => {
      setError(null);
      setResuming(false);
      resumedRef.current = true;
      send({ type: "tcreate", name });
    },
    [send],
  );

  const joinTournament = useCallback(
    (code: string, name: string) => {
      setError(null);
      setResuming(false);
      resumedRef.current = true;
      send({ type: "tjoin", code, name });
    },
    [send],
  );

  const startTournament = useCallback(() => send({ type: "tstart" }), [send]);
  const pickStellas = useCallback(
    (stellas: string[]) => send({ type: "tpick", stellas }),
    [send],
  );
  const banStella = useCallback((stellaId: string) => send({ type: "tban", stellaId }), [send]);
  const submitTournamentDeck = useCallback(
    (deck: CustomDeckInput) => send({ type: "tdeck", deck }),
    [send],
  );
  const tournamentAct = useCallback(
    (action: Action) => send({ type: "taction", action }),
    [send],
  );

  const clearAll = useCallback(() => {
    clearSession();
    resumedRef.current = false;
    setRoom(null);
    setTournament(null);
    setSeats([]);
    clearMatchState();
    setError(null);
    setResuming(false);
  }, [clearMatchState]);

  const leave = useCallback(() => {
    send(tournament ? { type: "tleave" } : { type: "leave" });
    clearAll();
  }, [send, clearAll, tournament]);

  return {
    connected,
    resuming,
    room,
    tournament,
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
    createTournament,
    joinTournament,
    startTournament,
    pickStellas,
    banStella,
    submitTournamentDeck,
    tournamentAct,
  };
}

export type Online = ReturnType<typeof useOnline>;
