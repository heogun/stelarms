// STELARMS 캐주얼 1v1 매치 부하테스트
//
// VU 1개가 WebSocket 2개(호스트/게스트)를 열어 실제로 방 생성 → 참가 →
// 대전 시작까지 진행한다. 즉 VU 1개 = 동시 1매치(접속 2명)이다.
//
// 측정 대상:
//   - 매치 생성/참가/시작까지의 지연(match_setup_ms)
//   - 방/매치 생성 성공률, 프로토콜 오류, WS 오류
//   - VU 증가에 따른 방 생성/시작 처리량
//
// 게임 액션(카드 플레이)은 이 스크립트에서 시뮬레이션하지 않는다.
// 액션까지 부하를 주려면 서버의 턴 타임아웃 기본 액션을 이용하거나
// 별도 봇 클라이언트를 사용해야 한다.
//
// 주의:
//   - 서버는 IP당 동시 WS 연결 16개, 분당 업그레이드 30회로 제한한다.
//   - run-max.sh 는 TRUST_PROXY=true 로 서버를 띄우고, 이 스크립트는
//     연결마다 다른 X-Forwarded-For 를 보내 로컬에서도 제한을 피한다.
//
// 실행 예:
//   k6 run -e WS_URL=ws://127.0.0.1:3001/ws \
//     -e STAGE_TARGETS=25,50,100 -e STEP_SECONDS=60 \
//     scripts/loadtest/k6-casual-1v1.js

import { WebSocket } from "k6/websockets";
import { Counter, Rate, Trend } from "k6/metrics";

const WS_URL = __ENV.WS_URL || "ws://127.0.0.1:3001/ws";
const DECK_ID = __ENV.DECK_ID || "deck-yuni-huya";
const PING_SECONDS = Number(__ENV.PING_SECONDS || 15);
const HOLD_SECONDS = Number(__ENV.CONN_HOLD_SECONDS || 30);
const MAX_MATCH_SECONDS = Number(__ENV.MAX_MATCH_SECONDS || 90);
const LEAVE_GRACE_MS = 300;

const roomsCreated = new Counter("rooms_created");
const matchesStarted = new Counter("matches_started");
const matchesCompleted = new Counter("matches_completed");
const messagesReceived = new Counter("messages_received");
const protocolErrors = new Counter("protocol_errors");
const wsErrors = new Counter("ws_errors");
const wsErrorRate = new Rate("ws_error_rate");
const matchSetupMs = new Trend("match_setup_ms", true);

function parseTargets(raw) {
  const out = [];
  for (const part of String(raw || "").split(",")) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n > 0) out.push(Math.floor(n));
  }
  return out.length > 0 ? out : [10, 25, 50];
}

const targets = parseTargets(__ENV.STAGE_TARGETS);
const stepSeconds = Number(__ENV.STEP_SECONDS || 60);
const holdSeconds = Number(__ENV.HOLD_SECONDS || 120);
const downSeconds = Number(__ENV.DOWN_SECONDS || 30);

const stages = [];
for (const target of targets) {
  stages.push({ duration: `${stepSeconds}s`, target });
}
stages.push({ duration: `${holdSeconds}s`, target: targets[targets.length - 1] });
stages.push({ duration: `${downSeconds}s`, target: 0 });

export const options = {
  scenarios: {
    casual_1v1: {
      executor: "ramping-vus",
      startVUs: 0,
      stages,
      gracefulRampDown: "30s",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    ws_error_rate: ["rate<0.05"],
    protocol_errors: ["count<100"],
  },
};

/** VU/연결별로 겹치지 않는 사설 IP를 만든다. (TRUST_PROXY=true 전제) */
function fakeIp(n) {
  const v = Math.max(1, n);
  const a = (Math.floor((v - 1) / 65025) % 250) + 1;
  const b = Math.floor((v - 1) / 255) % 255;
  const c = (v - 1) % 255;
  return `10.${a}.${b}.${c}`;
}

function playerName(prefix) {
  return `${prefix}-${__VU}-${__ITER}`.slice(0, 24);
}

export default async function () {
  const hostIp = fakeIp(__VU * 2 - 1);
  const guestIp = fakeIp(__VU * 2);

  let host = null;
  let guest = null;
  let guestOpening = false;
  let startSent = false;
  let started = false;
  let finished = false;
  let closeTimer = null;
  let forceTimer = null;
  let hostPing = null;
  let guestPing = null;
  let hostOpenedAt = 0;
  let error = false;

  await new Promise((resolve) => {
    function stopPings() {
      if (hostPing !== null) clearInterval(hostPing);
      if (guestPing !== null) clearInterval(guestPing);
      hostPing = null;
      guestPing = null;
    }

    function finish(reason) {
      if (finished) return;
      finished = true;
      stopPings();
      if (closeTimer !== null) clearTimeout(closeTimer);
      if (forceTimer !== null) clearTimeout(forceTimer);

      // 방을 즉시 정리해 서버의 MAX_ROOMS(2000) 도달을 막는다.
      try {
        if (host && host.readyState === WebSocket.OPEN) host.send(JSON.stringify({ type: "leave" }));
      } catch (_) {
        // ignore
      }
      try {
        if (guest && guest.readyState === WebSocket.OPEN) guest.send(JSON.stringify({ type: "leave" }));
      } catch (_) {
        // ignore
      }

      setTimeout(function () {
        try {
          if (host) host.close();
        } catch (_) {
          // ignore
        }
        try {
          if (guest) guest.close();
        } catch (_) {
          // ignore
        }
        wsErrorRate.add(error || !started ? 1 : 0);
        if (started) matchesCompleted.add(1);
        resolve();
      }, LEAVE_GRACE_MS);
    }

    function scheduleFinish() {
      if (!started || closeTimer !== null) return;
      closeTimer = setTimeout(function () {
        finish("hold");
      }, HOLD_SECONDS * 1000);
    }

    function onHostMessage(event) {
      messagesReceived.add(1);
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        protocolErrors.add(1);
        return;
      }
      if (!msg || typeof msg !== "object") {
        protocolErrors.add(1);
        return;
      }

      if (msg.type === "room") {
        if (!guestOpening && msg.roomCode) {
          guestOpening = true;
          roomsCreated.add(1);
          openGuest(msg.roomCode);
        }
        if (msg.started) {
          if (!started) {
            started = true;
            matchesStarted.add(1);
            matchSetupMs.add(Date.now() - hostOpenedAt);
          }
          scheduleFinish();
        } else if (!startSent && Array.isArray(msg.seats) && msg.seats[0] && msg.seats[1]) {
          startSent = true;
          host.send(JSON.stringify({ type: "start" }));
        }
      } else if (msg.type === "error") {
        protocolErrors.add(1);
        if (__ENV.VERBOSE === "true") {
          console.warn(`[VU ${__VU}] host error: ${msg.code} ${msg.message || ""}`);
        }
      }
    }

    function onGuestMessage(event) {
      messagesReceived.add(1);
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        protocolErrors.add(1);
        return;
      }
      if (!msg || typeof msg !== "object") {
        protocolErrors.add(1);
        return;
      }
      if (msg.type === "room" && msg.started) {
        if (!started) {
          started = true;
          matchesStarted.add(1);
          matchSetupMs.add(Date.now() - hostOpenedAt);
        }
        scheduleFinish();
      } else if (msg.type === "error") {
        protocolErrors.add(1);
        if (__ENV.VERBOSE === "true") {
          console.warn(`[VU ${__VU}] guest error: ${msg.code} ${msg.message || ""}`);
        }
      }
    }

    function openGuest(roomCode) {
      guest = new WebSocket(WS_URL, null, {
        headers: {
          "X-Forwarded-For": guestIp,
          "X-Real-IP": guestIp,
        },
        tags: { role: "guest" },
      });

      guest.onopen = function () {
        guest.send(
          JSON.stringify({
            type: "join",
            roomCode,
            name: playerName("k6g"),
            deck: { kind: "preset", id: DECK_ID },
          }),
        );
        guestPing = setInterval(function () {
          try {
            if (guest.readyState === WebSocket.OPEN) guest.send(JSON.stringify({ type: "ping" }));
          } catch (_) {
            // ignore
          }
        }, PING_SECONDS * 1000);
      };

      guest.onmessage = onGuestMessage;
      guest.onerror = function () {
        error = true;
        wsErrors.add(1);
        finish("guest-error");
      };
      guest.onclose = function () {
        if (!finished) finish("guest-close");
      };
    }

    forceTimer = setTimeout(function () {
      finish("timeout");
    }, MAX_MATCH_SECONDS * 1000);

    hostOpenedAt = Date.now();
    host = new WebSocket(WS_URL, null, {
      headers: {
        "X-Forwarded-For": hostIp,
        "X-Real-IP": hostIp,
      },
      tags: { role: "host" },
    });

    host.onopen = function () {
      host.send(
        JSON.stringify({
          type: "create",
          name: playerName("k6h"),
          deck: { kind: "preset", id: DECK_ID },
        }),
      );
      hostPing = setInterval(function () {
        try {
          if (host.readyState === WebSocket.OPEN) host.send(JSON.stringify({ type: "ping" }));
        } catch (_) {
          // ignore
        }
      }, PING_SECONDS * 1000);
    };

    host.onmessage = onHostMessage;
    host.onerror = function () {
      error = true;
      wsErrors.add(1);
      finish("host-error");
    };
    host.onclose = function () {
      if (!finished) finish("host-close");
    };
  });
}
