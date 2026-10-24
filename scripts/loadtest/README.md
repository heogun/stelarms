# STELARMS 부하테스트

`k6`로 STELARMS 서버의 동시 접속/매치 생성 한계를 측정하는 스크립트 모음입니다.
서버의 실제 보호 한도(IP당 연결 수, 방 수 제한)를 우회하도록 구성되어 있으므로
**반드시 로컬/스테이징 서버에서만** 사용하세요.

## 파일

| 파일 | 설명 |
|---|---|
| `k6-casual-staged.js` | VU마다 WebSocket 1개로 방을 만들고 유지. 연결/로비 처리량 측정 |
| `k6-casual-1v1.js` | VU 1개가 WebSocket 2개(호스트/게스트)로 방 생성 → 참가 → 대전 시작까지 진행. VU 1개 = 동시 1매치 |
| `run-max.sh` | 서버 기동 → k6 실행 → 서버 종료까지 자동화. 결과를 `logs/`에 저장 |

## 사전 준비

```bash
brew install k6          # macOS
bun --version            # 서버 실행용
```

## 빠른 시작

```bash
# 연결/로비 스테이지 테스트 (기본 50 → 800 VU)
./scripts/loadtest/run-max.sh

# 1v1 매치 스테이지 테스트 (기본 10 → 50 매치)
MODE=1v1 MAX_VUS=50 ./scripts/loadtest/run-max.sh

# 규모/시간 조정
MODE=1v1 MAX_VUS=100 START_VUS=20 STEP_SECONDS=60 ./scripts/loadtest/run-max.sh
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MODE` | `staged` | `staged` 또는 `1v1` |
| `PORT` | `3001` | 서버 포트 |
| `MAX_VUS` | `800` (staged) | 최대 VU. `1v1`에서는 최대 동시 매치 수 |
| `START_VUS` | `50` | 첫 스테이지 VU |
| `STEP_SECONDS` | `60` | 각 스테이지 상승 시간 |
| `HOLD_SECONDS` | `120` | 최대 VU 유지 시간 |
| `DOWN_SECONDS` | `30` | 종료 램프다운 시간 |
| `CONN_HOLD_SECONDS` | `45` (staged) / `30` (1v1) | 연결(매치) 유지 시간 |
| `PING_SECONDS` | `15` | 핑 주기 |
| `DECK_ID` | `deck-yuni-huya` | 사용할 프리셋 덱 ID |
| `HEALTH_TIMEOUT` | `90` | 서버 헬스체크 대기 시간(초) |

`MAX_VUS`를 2000 이상으로 올리면 서버의 `MAX_ROOMS`(2000)에 먼저 도달할 수 있습니다.
스크립트는 종료 시 `leave`를 보내 방을 정리하지만, 급격한 재연결 구간에서는
방이 일시적으로 쌓일 수 있습니다.

## 결과

- `logs/loadtest-<시각>.json` : k6 summary (지표 원본)
- `logs/loadtest-<시각>.log` : k6 콘솔 출력
- `logs/server-latest.log` : 서버 로그

핵심 지표:

| 지표 | 의미 |
|---|---|
| `rooms_created` | 생성된 방 수 |
| `matches_started` / `matches_completed` | 시작/정상 완료된 1v1 매치 수 (`1v1` 전용) |
| `match_setup_ms` | 방 생성 → 대전 시작까지 걸린 시간 (`1v1` 전용) |
| `ws_connecting` | WebSocket 연결 시간 |
| `ws_error_rate` | 연결/세션 오류 비율 |
| `protocol_errors` | 서버가 보낸 오류 메시지 수 |

## 직접 k6 실행

`run-max.sh` 없이 이미 떠 있는 서버에 붙일 수도 있습니다.

```bash
k6 run \
  -e WS_URL=ws://127.0.0.1:3001/ws \
  -e STAGE_TARGETS=50,100,200 \
  -e STEP_SECONDS=60 \
  scripts/loadtest/k6-casual-staged.js
```

`/ws`가 IP당 연결 수를 제한하므로, 로컬에서 큰 부하를 주려면 서버를
`TRUST_PROXY=true`로 띄우고 스크립트가 보내는 `X-Forwarded-For`를 신뢰하게 해야 합니다.
(`run-max.sh`가 이 설정을 자동으로 적용합니다.)

## 해석 팁

- `ws_error_rate`가 1%를 넘거나 `ws_connecting` p95가 급증하면 해당 VU 구간이 한계입니다.
- `1v1` 모드에서 `match_setup_ms`가 커지면 로비/방 생성 경로가 병목입니다.
- 서버 CPU/메모리/FD는 별도로 수집하세요. (예: `top`, `vm_stat`, `lsof -p <pid> | wc -l`)
- 부하 생성기는 가능하면 서버와 다른 장비/네트워크에서 실행하세요.
