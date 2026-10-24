# STELARMS 부하테스트

`k6`로 STELARMS 서버의 최대 동시 접속자(CCU)를 **자동으로 탐색**하는 스크립트 모음입니다.
서버의 실제 보호 한도(IP당 연결 수, 방 수 제한)를 우회하도록 구성되어 있으므로
**반드시 로컬/스테이징 서버에서만** 사용하세요.

## 파일

| 파일 | 설명 |
|---|---|
| `run-max.sh` | 서버 기동 → 단계별 k6 → 한계 판정 → 자동 종료 → 리포트 생성 |
| `k6-casual-staged.js` | VU마다 WebSocket 1개로 방을 만들고 유지. 연결/로비 처리량 측정 |
| `k6-casual-1v1.js` | VU 1개가 WebSocket 2개(호스트/게스트)로 방 생성 → 참가 → 대전 시작까지 진행. VU 1개 = 동시 1매치 |

## 사전 준비

```bash
brew install k6 jq
bun --version
```

## 빠른 시작

```bash
# 연결/로비 자동 탐색 (기본 50 → 800 VU, 2배씩)
./scripts/loadtest/run-max.sh

# 1v1 매치 자동 탐색 (기본 50 → 800 매치)
MODE=1v1 ./scripts/loadtest/run-max.sh

# 범위/시간 조정
MODE=1v1 MAX_VUS=300 START_VUS=25 STAGE_SECONDS=45 ./scripts/loadtest/run-max.sh
```

## 자동 탐색 동작

1. 서버를 띄우고 `/health`를 확인한다.
2. `START_VUS`부터 `STEP_FACTOR`배씩 올리며 **각 단계를 개별 k6 실행**으로 돌린다.
3. 단계가 끝날 때마다 아래 조건을 검사한다.
   - `ws_error_rate` > `MAX_ERROR_RATE`
   - `ws_connecting` p95 > `MAX_CONNECT_P95_MS`
   - `match_setup_ms` p95 > `MAX_SETUP_P95_MS` (1v1, 0이면 끔)
   - `protocol_errors` > `MAX_PROTOCOL_ERRORS` (0이면 끔)
   - 단계 후 `/health` 실패 (서버 다운)
   - 방/매치가 하나도 생성되지 않음
4. 한계가 나오면 **그 단계에서 즉시 중단**하고, 마지막 성공 VU를 최대 안정 CCU로 기록한다.
5. `REFINE_ROUNDS > 0`이면 마지막 성공과 첫 실패 사이를 이진 탐색해 최대치를 좁힌다.
6. 서버를 자동 종료하고 터미널에는 요약 표만, 상세 결과는 로그 디렉터리에 남긴다.

> `1v1` 모드에서 VU 1개는 매치 1개(접속 2명)입니다. 최종 결과에 매치 수와
> 환산 접속자 수(매치 × 2)를 함께 표시합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MODE` | `staged` | `staged`(연결/로비) 또는 `1v1`(매치) |
| `PORT` | `3001` | 서버 포트 |
| `START_VUS` | `50` | 첫 단계 VU |
| `MAX_VUS` | `800` | 탐색 상한 VU (1v1에서는 매치 수) |
| `STEP_FACTOR` | `2` | 단계 증가 배수 |
| `STAGE_SECONDS` | `60` | 각 단계의 부하 유지 시간 |
| `RAMP_SECONDS` | `10` | 각 단계의 램프업 시간 |
| `REFINE_ROUNDS` | `3` | 한계 구간 이진 탐색 횟수 (0이면 끔) |
| `MAX_ERROR_RATE` | `0.01` | 한계 판정 WS 오류율 (0.01 = 1%) |
| `MAX_CONNECT_P95_MS` | `2000` | 한계 판정 연결 p95 (0이면 끔) |
| `MAX_SETUP_P95_MS` | `0` | 한계 판정 1v1 매치 시작 p95 (0이면 끔) |
| `MAX_PROTOCOL_ERRORS` | `100` | 한계 판정 프로토콜 오류 건수 (0이면 끔) |
| `CONN_HOLD_SECONDS` | `45` | VU별 연결(매치) 유지 시간 |
| `PING_SECONDS` | `15` | 핑 주기 |
| `DECK_ID` | `deck-yuni-huya` | 사용할 프리셋 덱 ID |
| `HEALTH_TIMEOUT` | `90` | 서버 헬스체크 대기 시간 |

`MAX_VUS`를 2000 이상으로 올리면 서버의 `MAX_ROOMS`(2000)에 먼저 도달할 수 있습니다.
스크립트는 종료 시 `leave`를 보내 방을 정리합니다.

## 결과

터미널에는 단계별 요약 표와 최대 안정 CCU만 출력됩니다.
상세 결과는 실행마다 `logs/loadtest-<시각>/`에 저장됩니다.

| 파일 | 내용 |
|---|---|
| `report.md` | 설정, 단계별 표, 최종 결과 |
| `results.tsv` | 단계별 핵심 지표 (기계 판독용) |
| `run.log` | 전체 실행 로그 (k6 출력 포함) |
| `stage-XX-*.log` | 해당 단계 k6 콘솔 전체 로그 |
| `stage-XX-*-summary.json` | k6 summary 원본 (모든 지표) |
| `stage-XX-*-metrics.tsv` | k6 모든 지표 평탄화 |
| `stage-XX-*-health-before/after.json` | 단계 전/후 `/health` 응답 |
| `server.log` | 서버 로그 사본 |

`1v1` 모드에서 확인할 지표:

| 지표 | 의미 |
|---|---|
| `matches_started` / `matches_completed` | 시작/정상 완료된 매치 수 |
| `match_setup_ms` | 방 생성 → 대전 시작까지 걸린 시간 |
| `rooms_created` | 생성된 방 수 |
| `ws_error_rate` | 연결/세션 오류 비율 |

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
(`run-max.sh`가 자동 적용합니다.)

## 해석 팁

- `ws_error_rate`가 1%를 넘거나 `ws_connecting` p95가 급증하면 해당 VU 구간이 한계입니다.
- `1v1` 모드에서 `match_setup_ms`가 커지면 로비/방 생성 경로가 병목입니다.
- 서버 CPU/메모리/FD는 별도로 수집하세요. (예: `top`, `vm_stat`, `lsof -p <pid> | wc -l`)
- 부하 생성기는 가능하면 서버와 다른 장비/네트워크에서 실행하세요.
- `run-max.sh`는 한계를 "찾는" 도구이므로, 한계를 찾으면 종료 코드 0으로 끝납니다.
  설정 오류/서버 기동 실패만 1로 끝납니다.
