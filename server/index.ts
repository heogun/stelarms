// STELARMS 온라인 대전 서버 (Bun WebSocket).
//
// 권위형 서버다. 클라이언트는 액션만 보내고, 서버가 엔진으로 검증한 뒤
// 플레이어별로 정보를 가린 뷰(`toPlayerView`)만 돌려준다.
//
// 보안/안정성:
//   - 소켓에 묶인 seat만 신뢰한다. (클라이언트가 보낸 player/seat 무시)
//   - 메시지 크기 제한, 액션 레이트리밋, 방/연결 수 제한.
//   - 턴 타임아웃 시 안전한 기본 액션을 서버가 대신 수행한다.
//   - 모든 상태 변경은 `applyAction`(복제 후 검증)만 통과한다.
//   - 리플레이 검증용 액션/해시 로그를 방에 보관한다.

import { applyAction, createMatch, hashState, isRuleError, toPlayerView } from "../src/engine";
import type { Action, GameState, PlayerId } from "../src/engine";
import { decks } from "../src/data/decks";
import type { Deck } from "../src/data/types";
import {
  MAX_MESSAGE_BYTES,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  ROOM_CODE_LENGTH,
} from "../src/net/protocol";
import type { ClientMessage, LobbySeat, ServerMessage } from "../src/net/protocol";

/* ────────────────────────────── 설정 ────────────────────────────── */

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const TURN_MS = Number(process.env.STELARMS_TURN_MS ?? 90_000);
const ROOM_IDLE_MS = 30 * 60_000;
const ROOM_MAX_MS = 3 * 60 * 60_000;
const MAX_ROOMS = 2_000;
const MAX_CLIENTS = 4_000;
const MAX_ACTIONS = 4_000;
const RATE_CAPACITY = 12;
const RATE_PER_SEC = 6;
const DIST_DIR = `${process.cwd()}/dist`;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const deckTable = new Map(decks.map((deck) => [deck.id, deck]));

/* ────────────────────────────── 타입 ────────────────────────────── */

interface Client {
  id: string;
  ws: BunWebSocket<{ id: string }>;
  room: Room | null;
  seat: PlayerId | null;
  token: string | null;
  bucket: { tokens: number; at: number };
}

interface Seat {
  token: string;
  name: string;
  deckId: string | null;
  client: Client | null;
  connected: boolean;
  disconnectedAt: number | null;
}

interface Room {
  code: string;
  hostSeat: PlayerId;
  seats: (Seat | null)[];
  state: GameState | null;
  hash: string;
  seq: number;
  actions: { seat: PlayerId; action: unknown; hash: string }[];
  createdAt: number;
  lastActivity: number;
  deadline: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  started: boolean;
}

const clients = new Map<string, Client>();
const rooms = new Map<string, Room>();
const tokens = new Map<string, { room: Room; seat: PlayerId }>();

/* ────────────────────────────── 유틸 ────────────────────────────── */

function send(ws: BunWebSocket<{ id: string }>, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // 이미 닫힌 소켓은 close 핸들러가 정리한다.
  }
}

function sendError(client: Client, code: string, message: string): void {
  send(client.ws, { type: "error", code, message });
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "플레이어";
  const name = [...raw]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || "플레이어";
}

function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code) ? code : null;
}

function findDeck(raw: unknown): Deck | null {
  return typeof raw === "string" ? (deckTable.get(raw) ?? null) : null;
}

function newRoomCode(): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
    const code = [...bytes].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
    if (!rooms.has(code)) return code;
  }
  throw new Error("방 코드를 생성할 수 없습니다.");
}

function newToken(): string {
  return crypto.randomUUID();
}

function rateAllowed(client: Client): boolean {
  const now = performance.now();
  const elapsed = Math.max(0, now - client.bucket.at) / 1000;
  client.bucket.at = now;
  client.bucket.tokens = Math.min(RATE_CAPACITY, client.bucket.tokens + elapsed * RATE_PER_SEC);
  if (client.bucket.tokens < 1) return false;
  client.bucket.tokens -= 1;
  return true;
}

function actorOf(state: GameState): PlayerId {
  return state.pending ? state.pending.player : state.turn;
}

function lobbySeats(room: Room): (LobbySeat | null)[] {
  return room.seats.map((seat, index) =>
    seat
      ? {
          seat: index as PlayerId,
          name: seat.name,
          deckId: seat.deckId,
          connected: seat.connected,
        }
      : null,
  );
}

/* ────────────────────────────── 방/좌석 ────────────────────────────── */

function bindSeat(client: Client, room: Room, seat: PlayerId): void {
  const entry = room.seats[seat];
  if (!entry) return;
  // 같은 좌석에 이미 붙은 소켓이 있으면 끊는다. (계정 탈취/중복 접속 방지)
  if (entry.client && entry.client !== client) {
    const old = entry.client;
    old.room = null;
    old.seat = null;
    old.token = null;
    try {
      old.ws.close(4001, "다른 곳에서 접속했습니다.");
    } catch {
      // ignore
    }
  }
  entry.client = client;
  entry.connected = true;
  entry.disconnectedAt = null;
  client.room = room;
  client.seat = seat;
  client.token = entry.token;
  tokens.set(entry.token, { room, seat });
}

function detachClient(client: Client): void {
  const room = client.room;
  const seat = client.seat;
  client.room = null;
  client.seat = null;
  client.token = null;
  if (!room || seat === null) return;
  const entry = room.seats[seat];
  if (entry && entry.client === client) {
    entry.client = null;
    entry.connected = false;
    entry.disconnectedAt = Date.now();
  }
}

function roomMessage(room: Room, seat: PlayerId): ServerMessage {
  const entry = room.seats[seat];
  return {
    type: "room",
    roomCode: room.code,
    seat,
    token: entry?.token ?? "",
    hostSeat: room.hostSeat,
    started: room.started,
    seats: lobbySeats(room),
  };
}

function stateMessage(room: Room, seat: PlayerId): ServerMessage | null {
  if (!room.state) return null;
  return {
    type: "state",
    view: toPlayerView(room.state, seat),
    hash: room.hash,
    seq: room.seq,
    deadline: room.deadline,
    seats: lobbySeats(room),
  };
}

function sendRoom(room: Room, seat: PlayerId): void {
  const client = room.seats[seat]?.client;
  if (client) send(client.ws, roomMessage(room, seat));
}

function broadcastRoom(room: Room): void {
  for (const seat of [0, 1] as const) sendRoom(room, seat);
}

function broadcastState(room: Room): void {
  if (!room.state) return;
  for (const seat of [0, 1] as const) {
    const client = room.seats[seat]?.client;
    if (!client) continue;
    const message = stateMessage(room, seat);
    if (message) send(client.ws, message);
  }
}

function refreshTimer(room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.deadline = null;
  if (!room.started || !room.state || room.state.phase === "gameover") return;
  const actor = actorOf(room.state);
  if (!room.seats[actor]?.connected) return; // 상대가 끊기면 타이머를 멈춘다.
  room.deadline = Date.now() + TURN_MS;
  room.timer = setTimeout(() => onTimeout(room), TURN_MS);
}

function notifyRoomClosed(room: Room, message: string): void {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  for (const seat of room.seats) {
    if (seat?.client) {
      sendError(seat.client, "room-closed", message);
      try {
        seat.client.ws.close(4000, "room closed");
      } catch {
        // ignore
      }
    }
    if (seat) tokens.delete(seat.token);
  }
}

function publish(room: Room, withRoom = false): void {
  refreshTimer(room);
  if (withRoom) broadcastRoom(room);
  broadcastState(room);
}

/* ────────────────────────────── 타임아웃 ────────────────────────────── */

function defaultAction(state: GameState, playerId: PlayerId): Action | null {
  const pending = state.pending;
  if (pending) {
    switch (pending.kind) {
      case "mulligan":
        return { type: "mulligan", returnUids: [] };
      case "startPhase":
        return { type: "startPhase", recompose: false };
      case "response":
        return { type: "response" };
      case "defend": {
        const p = state.players[playerId];
        const aura = pending.attack.aura;
        const life = pending.attack.life;
        if (aura > 0 && p.aura >= aura) return { type: "defend", choice: "aura" };
        if (life > 0) return { type: "defend", choice: "life" };
        return { type: "defend", choice: "aura" };
      }
      case "penalty":
        return {
          type: "penalty",
          choice: state.players[playerId].aura > 0 ? "aura" : "life",
        };
      case "choice":
        return pending.options.length > 0
          ? { type: "choice", optionId: pending.options[0].id }
          : null;
      case "order":
        return { type: "order", uids: pending.uids };
      case "discardDown": {
        const p = state.players[playerId];
        const need = p.hand.length - pending.to;
        return { type: "discardDown", uids: p.hand.slice(0, need).map((c) => c.uid) };
      }
    }
  }
  if (state.phase !== "main") return null;
  const p = state.players[playerId];
  if (p.flags.mode === "power" && !p.flags.powerUsed) {
    const uids = [
      ...p.hand.map((c) => c.uid),
      ...p.specials.filter((s) => !s.used).map((s) => s.uid),
    ];
    for (const uid of uids) {
      if (tryAction(state, playerId, { type: "playCard", uid })) {
        return { type: "playCard", uid };
      }
    }
  }
  if (tryAction(state, playerId, { type: "endTurn" })) return { type: "endTurn" };
  for (const card of p.hand) {
    if (tryAction(state, playerId, { type: "playCard", uid: card.uid })) {
      return { type: "playCard", uid: card.uid };
    }
  }
  return null;
}

function tryAction(state: GameState, playerId: PlayerId, action: Action): GameState | null {
  try {
    return applyAction(state, playerId, action);
  } catch {
    return null;
  }
}

function applyAndPublish(room: Room, seat: PlayerId, action: Action): boolean {
  if (!room.state) return false;
  try {
    const next = applyAction(room.state, seat, action);
    room.state = next;
    room.seq += 1;
    room.hash = hashState(next);
    room.actions.push({ seat, action, hash: room.hash });
    if (room.actions.length > MAX_ACTIONS) room.actions.splice(0, room.actions.length - MAX_ACTIONS);
    room.lastActivity = Date.now();
    publish(room);
    return true;
  } catch (error) {
    if (isRuleError(error)) {
      const client = room.seats[seat]?.client;
      if (client) sendError(client, error.code, error.message);
    } else {
      console.error(`[room ${room.code}] engine error`, error);
      const client = room.seats[seat]?.client;
      if (client) sendError(client, "internal", "서버 내부 오류가 발생했습니다.");
    }
    return false;
  }
}

function onTimeout(room: Room): void {
  room.timer = null;
  if (!room.state || room.state.phase === "gameover") return;
  const actor = actorOf(room.state);
  if (!room.seats[actor]?.connected) {
    publish(room);
    return;
  }
  const action = defaultAction(room.state, actor);
  if (action && applyAndPublish(room, actor, action)) return;

  // 기본 액션도 실패하면 타임아웃 패배로 처리해 교착을 막는다.
  if (applyAndPublish(room, actor, { type: "surrender" })) return;
  console.error(`[room ${room.code}] timeout softlock`, room.state.pending);
  room.deadline = Date.now() + 5_000;
  room.timer = setTimeout(() => onTimeout(room), 5_000);
}

/* ────────────────────────────── 방 생성/참가 ────────────────────────────── */

function createRoom(client: Client, message: Extract<ClientMessage, { type: "create" }>): void {
  if (client.room) {
    sendError(client, "already-in-room", "이미 방에 참가하고 있습니다.");
    return;
  }
  if (rooms.size >= MAX_ROOMS) {
    sendError(client, "server-full", "서버에 방이 너무 많습니다. 잠시 후 다시 시도하세요.");
    return;
  }
  const deck = findDeck(message.deckId);
  if (!deck) {
    sendError(client, "bad-deck", "알 수 없는 덱입니다.");
    return;
  }
  const code = newRoomCode();
  const room: Room = {
    code,
    hostSeat: 0,
    seats: [
      {
        token: newToken(),
        name: sanitizeName(message.name),
        deckId: deck.id,
        client: null,
        connected: true,
        disconnectedAt: null,
      },
      null,
    ],
    state: null,
    hash: "",
    seq: 0,
    actions: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    deadline: null,
    timer: null,
    started: false,
  };
  rooms.set(code, room);
  bindSeat(client, room, 0);
  sendRoom(room, 0);
}

function joinRoom(client: Client, message: Extract<ClientMessage, { type: "join" }>): void {
  if (client.room) {
    sendError(client, "already-in-room", "이미 방에 참가하고 있습니다.");
    return;
  }
  const code = normalizeCode(message.roomCode);
  if (!code) {
    sendError(client, "bad-room", "방 코드는 6자리입니다.");
    return;
  }
  const room = rooms.get(code);
  if (!room) {
    sendError(client, "room-not-found", "방을 찾을 수 없습니다.");
    return;
  }
  if (room.started) {
    sendError(client, "room-started", "이미 시작한 방입니다. 재접속은 토큰으로만 가능합니다.");
    return;
  }
  if (room.seats[1]) {
    sendError(client, "room-full", "방이 가득 찼습니다.");
    return;
  }
  const deck = findDeck(message.deckId);
  if (!deck) {
    sendError(client, "bad-deck", "알 수 없는 덱입니다.");
    return;
  }
  room.seats[1] = {
    token: newToken(),
    name: sanitizeName(message.name),
    deckId: deck.id,
    client: null,
    connected: true,
    disconnectedAt: null,
  };
  bindSeat(client, room, 1);
  const entry = room.seats[1];
  if (entry) tokens.set(entry.token, { room, seat: 1 });
  room.lastActivity = Date.now();
  broadcastRoom(room);
}

function resumeRoom(client: Client, message: Extract<ClientMessage, { type: "resume" }>): void {
  if (client.room) {
    sendError(client, "already-in-room", "이미 방에 참가하고 있습니다.");
    return;
  }
  if (typeof message.token !== "string" || message.token.length > 128) {
    sendError(client, "bad-token", "재접속 토큰이 올바르지 않습니다.");
    return;
  }
  const found = tokens.get(message.token);
  if (!found) {
    sendError(client, "bad-token", "재접속 토큰이 만료되었습니다.");
    return;
  }
  const code = normalizeCode(message.roomCode);
  if (!code || found.room.code !== code) {
    sendError(client, "bad-token", "방과 토큰이 일치하지 않습니다.");
    return;
  }
  const room = found.room;
  const entry = room.seats[found.seat];
  if (!entry) {
    sendError(client, "bad-token", "좌석이 사라졌습니다.");
    return;
  }
  bindSeat(client, room, found.seat);
  room.lastActivity = Date.now();
  sendRoom(room, found.seat);
  const state = stateMessage(room, found.seat);
  if (state) send(client.ws, state);
  broadcastRoom(room);
  publish(room);
}

function startRoom(client: Client): void {
  const room = client.room;
  const seat = client.seat;
  if (!room || seat === null) {
    sendError(client, "no-room", "방에 참가하지 않았습니다.");
    return;
  }
  if (room.started) {
    sendError(client, "room-started", "이미 시작했습니다.");
    return;
  }
  if (seat !== room.hostSeat) {
    sendError(client, "not-host", "방장만 시작할 수 있습니다.");
    return;
  }
  const a = room.seats[0];
  const b = room.seats[1];
  if (!a || !b) {
    sendError(client, "not-ready", "두 플레이어가 모두 필요합니다.");
    return;
  }
  if (!a.deckId || !b.deckId) {
    sendError(client, "not-ready", "두 플레이어 모두 덱을 골라야 합니다.");
    return;
  }
  const deckA = findDeck(a.deckId);
  const deckB = findDeck(b.deckId);
  if (!deckA || !deckB) {
    sendError(client, "bad-deck", "덱 정보가 올바르지 않습니다.");
    return;
  }
  try {
    const state = createMatch({
      seed: `${room.code}:${crypto.randomUUID()}`,
      players: [
        {
          name: a.name,
          stellas: [deckA.mainId, deckA.partnerId],
          deck: [...deckA.normals],
          specials: [...deckA.specials],
        },
        {
          name: b.name,
          stellas: [deckB.mainId, deckB.partnerId],
          deck: [...deckB.normals],
          specials: [...deckB.specials],
        },
      ],
    });
    room.state = state;
    room.started = true;
    room.hash = hashState(state);
    room.seq = 1;
    room.actions = [];
    room.lastActivity = Date.now();
    broadcastRoom(room);
    publish(room);
  } catch (error) {
    console.error(`[room ${room.code}] start failed`, error);
    sendError(client, "internal", "대전을 시작할 수 없습니다.");
  }
}

/* ────────────────────────────── 메시지 처리 ────────────────────────────── */

function handleMessage(client: Client, raw: string | Uint8Array): void {
  const size = typeof raw === "string" ? raw.length : raw.byteLength;
  if (size > MAX_MESSAGE_BYTES) {
    sendError(client, "too-large", "메시지가 너무 큽니다.");
    client.ws.close(1009, "too large");
    return;
  }
  if (!rateAllowed(client)) {
    sendError(client, "rate-limit", "요청이 너무 많습니다.");
    return;
  }

  let message: ClientMessage;
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== "string") throw new Error("type");
    message = parsed as ClientMessage;
  } catch {
    sendError(client, "bad-message", "메시지를 읽을 수 없습니다.");
    return;
  }

  switch (message.type) {
    case "ping":
      send(client.ws, { type: "pong", serverTime: Date.now() });
      return;
    case "create":
      createRoom(client, message);
      return;
    case "join":
      joinRoom(client, message);
      return;
    case "resume":
      resumeRoom(client, message);
      return;
    case "setDeck": {
      const room = client.room;
      const seat = client.seat;
      if (!room || seat === null) {
        sendError(client, "no-room", "방에 참가하지 않았습니다.");
        return;
      }
      if (room.started) {
        sendError(client, "room-started", "이미 시작했습니다.");
        return;
      }
      const deck = findDeck(message.deckId);
      if (!deck) {
        sendError(client, "bad-deck", "알 수 없는 덱입니다.");
        return;
      }
      const entry = room.seats[seat];
      if (!entry) return;
      entry.deckId = deck.id;
      room.lastActivity = Date.now();
      broadcastRoom(room);
      return;
    }
    case "start":
      startRoom(client);
      return;
    case "action": {
      const room = client.room;
      const seat = client.seat;
      if (!room || seat === null) {
        sendError(client, "no-room", "방에 참가하지 않았습니다.");
        return;
      }
      if (!room.started || !room.state) {
        sendError(client, "not-started", "아직 대전이 시작되지 않았습니다.");
        return;
      }
      if (room.state.phase === "gameover") {
        sendError(client, "game-over", "이미 끝난 대전입니다.");
        return;
      }
      applyAndPublish(room, seat, message.action as Action);
      return;
    }
    case "leave": {
      const room = client.room;
      const seat = client.seat;
      if (!room || seat === null) {
        detachClient(client);
        return;
      }
      if (room.started && room.state && room.state.phase !== "gameover") {
        applyAndPublish(room, seat, { type: "surrender" });
      }
      detachClient(client);
      room.lastActivity = Date.now();
      const entry = room.seats[seat];
      if (entry) {
        tokens.delete(entry.token);
        entry.token = "";
      }
      if (!room.started) {
        if (seat === room.hostSeat) {
          // 방장이 로비에서 나가면 방을 닫는다.
          notifyRoomClosed(room, "방장이 방을 닫았습니다.");
          rooms.delete(room.code);
          return;
        }
        room.seats[seat] = null;
        if (room.seats.every((s) => !s)) rooms.delete(room.code);
      }
      broadcastRoom(room);
      publish(room);
      return;
    }
    default:
      sendError(client, "bad-message", "알 수 없는 메시지입니다.");
  }
}

/* ────────────────────────────── 정적 파일 ────────────────────────────── */

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    return Response.json({ ok: true, rooms: rooms.size, clients: clients.size });
  }
  if (url.pathname === "/ws") {
    return new Response("WebSocket only", { status: 400 });
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("bad path", { status: 400 });
  }
  if (pathname.includes("\u0000")) return new Response("bad path", { status: 400 });
  if (pathname === "/") pathname = "/index.html";

  const rel = pathname.replace(/^\/+/, "");
  const isAsset = rel.startsWith("assets/");
  const isImage = rel.startsWith("images/") || rel.startsWith("frames/");
  const cache = isAsset ? "public, max-age=31536000, immutable" : isImage ? "public, max-age=3600" : "no-cache";

  if (rel && !rel.includes("..") && !rel.startsWith("/")) {
    const file = Bun.file(`${DIST_DIR}/${rel}`);
    if (await file.exists()) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? "";
      return new Response(file, {
        headers: { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": cache },
      });
    }
  }

  // SPA fallback: 확장자가 없는 경로만 index.html로 보낸다.
  if (!rel.includes(".")) {
    const index = Bun.file(`${DIST_DIR}/index.html`);
    if (await index.exists()) {
      return new Response(index, {
        headers: { "content-type": MIME.html, "cache-control": "no-cache" },
      });
    }
  }
  return new Response("STELARMS 서버 실행 중. UI는 `bun run build` 후 dist에 있습니다.", {
    status: 404,
    headers: { "content-type": MIME.txt },
  });
}

/* ────────────────────────────── 서버 ────────────────────────────── */

const server = Bun.serve<{ id: string }>({
  port: PORT,
  hostname: HOST,
  development: process.env.NODE_ENV !== "production",
  async fetch(req, bunServer) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (clients.size >= MAX_CLIENTS) {
        return new Response("too many clients", { status: 503 });
      }
      const id = crypto.randomUUID();
      const upgraded = bunServer.upgrade(req, { data: { id } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return serveStatic(req);
  },
  websocket: {
    open(ws) {
      const client: Client = {
        id: ws.data.id,
        ws,
        room: null,
        seat: null,
        token: null,
        bucket: { tokens: RATE_CAPACITY, at: performance.now() },
      };
      clients.set(client.id, client);
      send(ws, { type: "welcome", version: PROTOCOL_VERSION, serverTime: Date.now() });
    },
    message(ws, raw) {
      const client = clients.get(ws.data.id);
      if (!client) return;
      try {
        handleMessage(client, raw);
      } catch (error) {
        console.error("message handler crashed", error);
        sendError(client, "internal", "서버 내부 오류가 발생했습니다.");
      }
    },
    close(ws) {
      const client = clients.get(ws.data.id);
      if (!client) return;
      clients.delete(client.id);
      const room = client.room;
      const seat = client.seat;
      detachClient(client);
      if (room) {
        room.lastActivity = Date.now();
        if (seat !== null) {
          const entry = room.seats[seat];
          if (entry && !room.started) {
            if (seat === room.hostSeat) {
              notifyRoomClosed(room, "방장이 방을 닫았습니다.");
              rooms.delete(room.code);
              return;
            }
            // 로비에서 나가면 좌석을 비운다.
            room.seats[seat] = null;
            tokens.delete(entry.token);
            if (room.seats.every((s) => !s)) rooms.delete(room.code);
          }
        }
        broadcastRoom(room);
        publish(room);
      }
    },
  },
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = now - room.lastActivity;
    const bothGone = room.seats.every((seat) => !seat || !seat.connected);
    if (idle > ROOM_IDLE_MS || now - room.createdAt > ROOM_MAX_MS || (bothGone && idle > 10 * 60_000)) {
      if (room.timer) clearTimeout(room.timer);
      for (const seat of room.seats) {
        if (seat?.client) {
          sendError(seat.client, "room-expired", "방이 만료되었습니다.");
          try {
            seat.client.ws.close(4000, "room expired");
          } catch {
            // ignore
          }
        }
        if (seat) tokens.delete(seat.token);
      }
      rooms.delete(code);
    }
  }
}, 60_000);

console.log(`STELARMS server on http://${HOST}:${server.port} (ws://.../ws)`);
console.log(`turn timeout: ${TURN_MS}ms, rooms: ${rooms.size}`);
