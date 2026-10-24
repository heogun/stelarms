// STELARMS 캐주얼 1v1(로비/연결) 스테이지 부하테스트
//
// 각 VU는 WebSocket에 연결해 방을 만들고(create), 핑을 보내며 일정 시간
// 연결을 유지한 뒤 leave 후 종료한다. 방을 만들 때 상대가 필요 없으므로
// "동시 연결 수 / 방 생성 / 메시지 처리" 한계를 측정하기에 적합하다.
//
// 주의:
//   - 서버는 IP당 동시 WS 연결 16개, 분당 업그레이드 30회로 제한한다.
//   - run-max.sh 는 TRUST_PROXY=true 로 서버를 띄우고, 이 스크립트는
//     VU마다 다른 X-Forwarded-For 를 보내 로컬에서도 제한을 피한다.
//
// 실행 예:
//   k6 run -e WS_URL=ws://127.0.0.1:3001/ws \
//     -e STAGE_TARGETS=50,100,200,400 \
//     -e STEP_SECONDS=60 -e HOLD_SECONDS=120 \
//     scripts/loadtest/k6-casual-staged.js

import ws from "k6/ws";
import { Counter, Rate, Trend } from "k6/metrics";

const WS_URL = __ENV.WS_URL || "ws://127.0.0.1:3001/ws";
const DECK_ID = __ENV.DECK_ID || "deck-yuni-huya";
const PING_SECONDS = Number(__ENV.PING_SECONDS || 15);
const HOLD_SECONDS = Number(__ENV.CONN_HOLD_SECONDS || 45);

/** "50,100,200" -> [50, 100, 200] */
function parseTargets(raw) {
  const out = [];
  for (const part of String(raw || "").split(",")) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n > 0) out.push(Math.floor(n));
  }
  return out.length > 0 ? out : [50, 100, 200, 400];
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
    casual_staged: {
      executor: "ramping-vus",
      startVUs: 0,
      stages,
      gracefulRampDown: "30s",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    // 참고용 기준. 초과해도 결과 수집은 계속된다(종료 코드 99).
    ws_error_rate: ["rate<0.05"],
    protocol_errors: ["count<100"],
  },
};

const roomsCreated = new Counter("rooms_created");
const messagesReceived = new Counter("messages_received");
const protocolErrors = new Counter("protocol_errors");
const wsErrors = new Counter("ws_errors");
const wsErrorRate = new Rate("ws_error_rate");
const connectMs = new Trend("casual_connect_ms", true);

/** VU별로 겹치지 않는 사설 IP를 만든다. (TRUST_PROXY=true 전제) */
function fakeIp(vu) {
  const n = Math.max(1, vu);
  const a = (Math.floor((n - 1) / 65025) % 250) + 1;
  const b = Math.floor((n - 1) / 255) % 255;
  const c = (n - 1) % 255;
  return `10.${a}.${b}.${c}`;
}

export default function () {
  const startedAt = Date.now();
  let established = false;
  let failed = false;

  const params = {
    headers: {
      "X-Forwarded-For": fakeIp(__VU),
      "X-Real-IP": fakeIp(__VU),
    },
    tags: { scenario: "casual_staged" },
  };

  const res = ws.connect(WS_URL, params, function (socket) {
    socket.on("open", function () {
      established = true;
      connectMs.add(Date.now() - startedAt);
      socket.send(
        JSON.stringify({
          type: "create",
          name: `k6-${__VU}-${__ITER}`.slice(0, 24),
          deck: { kind: "preset", id: DECK_ID },
        }),
      );
    });

    socket.on("message", function (raw) {
      messagesReceived.add(1);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_) {
        protocolErrors.add(1);
        return;
      }
      if (!msg || typeof msg !== "object") {
        protocolErrors.add(1);
        return;
      }
      if (msg.type === "room") {
        roomsCreated.add(1);
      } else if (msg.type === "error") {
        protocolErrors.add(1);
        if (__ENV.VERBOSE === "true") {
          console.warn(`[VU ${__VU}] server error: ${msg.code} ${msg.message || ""}`);
        }
      }
    });

    socket.on("error", function () {
      failed = true;
      wsErrors.add(1);
      try {
        socket.close();
      } catch (_) {
        // ignore
      }
    });

    socket.setInterval(function () {
      try {
        socket.send(JSON.stringify({ type: "ping" }));
      } catch (_) {
        // ignore
      }
    }, PING_SECONDS * 1000);

    socket.setTimeout(function () {
      try {
        // 방을 즉시 정리해 서버의 MAX_ROOMS(2000) 도달을 막는다.
        socket.send(JSON.stringify({ type: "leave" }));
      } catch (_) {
        // ignore
      }
      socket.setTimeout(function () {
        try {
          socket.close();
        } catch (_) {
          // ignore
        }
      }, 1000);
    }, HOLD_SECONDS * 1000);
  });

  if (res && res.error) {
    failed = true;
    wsErrors.add(1);
  }
  wsErrorRate.add(failed || !established ? 1 : 0);
}
