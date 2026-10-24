#!/usr/bin/env bash
# STELARMS 최대 CCU 탐색용 스테이지 부하테스트 러너
#
# 서버를 띄우고 → k6를 스테이지로 실행하고 → 서버를 자동 종료한다.
# 결과: logs/loadtest-<시각>.json (summary), logs/loadtest-<시각>.log
#
# 사용법:
#   scripts/loadtest/run-max.sh
#   MAX_VUS=1200 START_VUS=100 scripts/loadtest/run-max.sh
#   PORT=3002 MAX_VUS=400 STEP_SECONDS=30 scripts/loadtest/run-max.sh
#
# 환경 변수:
#   PORT=3001              서버 포트
#   MODE=staged            staged(연결/로비) 또는 1v1(두 소켓으로 매치 시작)
#   MAX_VUS=800            최대 동시 VU (1v1 모드에서는 동시 매치 수)
#   START_VUS=50           첫 스테이지 VU
#   STEP_SECONDS=60        각 스테이지 상승 시간(초)
#   HOLD_SECONDS=120       최대 VU 유지 시간(초)
#   DOWN_SECONDS=30        종료 램프다운 시간(초)
#   CONN_HOLD_SECONDS=45   VU별 연결 유지 시간(초)
#   PING_SECONDS=15        핑 주기(초)
#   DECK_ID=deck-yuni-huya 사용할 프리셋 덱
#
# 주의: 부하 생성기는 서버와 분리된 장비/네트워크에서 실행하는 것을 권장한다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STOP_SCRIPT="$ROOT_DIR/scripts/stop_server.sh"
MODE="${MODE:-staged}"
case "$MODE" in
  staged) K6_SCRIPT="$SCRIPT_DIR/k6-casual-staged.js" ;;
  1v1) K6_SCRIPT="$SCRIPT_DIR/k6-casual-1v1.js" ;;
  *)
    echo "[오류] MODE는 staged 또는 1v1 이어야 합니다: $MODE" >&2
    exit 1
    ;;
esac

PORT="${PORT:-3001}"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
MAX_VUS="${MAX_VUS:-800}"
START_VUS="${START_VUS:-50}"
STEP_SECONDS="${STEP_SECONDS:-60}"
HOLD_SECONDS="${HOLD_SECONDS:-120}"
DOWN_SECONDS="${DOWN_SECONDS:-30}"
CONN_HOLD_SECONDS="${CONN_HOLD_SECONDS:-45}"
PING_SECONDS="${PING_SECONDS:-15}"
DECK_ID="${DECK_ID:-deck-yuni-huya}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

die() {
  echo "[오류] $*" >&2
  exit 1
}

command -v k6 >/dev/null 2>&1 || die "k6가 설치되어 있지 않습니다. (brew install k6)"
command -v curl >/dev/null 2>&1 || die "curl이 필요합니다."
command -v bun >/dev/null 2>&1 || die "bun이 설치되어 있지 않습니다."
[ -f "$K6_SCRIPT" ] || die "k6 스크립트가 없습니다: $K6_SCRIPT"
[ -x "$STOP_SCRIPT" ] || die "중지 스크립트가 없거나 실행 권한이 없습니다: $STOP_SCRIPT"

if ! [[ "$MAX_VUS" =~ ^[0-9]+$ ]] || [ "$MAX_VUS" -lt 1 ]; then
  die "MAX_VUS는 1 이상의 숫자여야 합니다: $MAX_VUS"
fi
if ! [[ "$START_VUS" =~ ^[0-9]+$ ]] || [ "$START_VUS" -lt 1 ]; then
  die "START_VUS는 1 이상의 숫자여야 합니다: $START_VUS"
fi
[ "$START_VUS" -le "$MAX_VUS" ] || START_VUS="$MAX_VUS"

# 스테이지 대상: START_VUS 에서 2배씩 올리고 마지막에 MAX_VUS
targets=()
v="$START_VUS"
while [ "$v" -lt "$MAX_VUS" ]; do
  targets+=("$v")
  v=$((v * 2))
done
targets+=("$MAX_VUS")
STAGE_TARGETS="$(IFS=,; echo "${targets[*]}")"

TS="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/loadtest-${TS}.json"
K6_LOG="$LOG_DIR/loadtest-${TS}.log"
SERVER_LOG="$LOG_DIR/server-latest.log"

cleanup() {
  "$STOP_SCRIPT" --quiet --port="$PORT" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if curl -fsS "http://${HEALTH_HOST}:${PORT}/health" >/dev/null 2>&1; then
  echo "[정리] 기존 서버를 중지합니다. (포트 ${PORT})"
  "$STOP_SCRIPT" --quiet --port="$PORT" || true
  sleep 1
fi

echo "=========================================="
echo " STELARMS 스테이지 부하테스트"
echo "=========================================="
echo "모드       : ${MODE}"
echo "대상       : ws://${HEALTH_HOST}:${PORT}/ws"
echo "스테이지   : ${STAGE_TARGETS} (각 ${STEP_SECONDS}s)"
echo "최대 유지  : ${HOLD_SECONDS}s @ ${MAX_VUS} VU"
echo "연결 유지  : ${CONN_HOLD_SECONDS}s, 핑 ${PING_SECONDS}s"
echo "결과       : ${SUMMARY}"
echo "=========================================="
echo ""

echo "[시작] 서버 (포트 ${PORT})"
(
  cd "$ROOT_DIR"
  TRUST_PROXY=true HOST=0.0.0.0 PORT="$PORT" NODE_ENV=production \
    ./scripts/run-server.sh prod "$PORT"
) >/dev/null 2>&1 &
echo "$!" >"$LOG_DIR/server.pid"

healthy=false
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -fsS "http://${HEALTH_HOST}:${PORT}/health" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done

if [ "$healthy" != true ]; then
  echo "[오류] 서버가 ${HEALTH_TIMEOUT}s 안에 준비되지 않았습니다." >&2
  if [ -f "$SERVER_LOG" ]; then
    echo "--- server-latest.log (마지막 40줄) ---" >&2
    tail -n 40 "$SERVER_LOG" >&2 || true
  fi
  exit 1
fi

echo "[준비] 서버 헬스체크 통과"
echo "[실행] k6 시작"
echo ""

k6_status=0
k6 run \
  -e WS_URL="ws://${HEALTH_HOST}:${PORT}/ws" \
  -e STAGE_TARGETS="$STAGE_TARGETS" \
  -e STEP_SECONDS="$STEP_SECONDS" \
  -e HOLD_SECONDS="$HOLD_SECONDS" \
  -e DOWN_SECONDS="$DOWN_SECONDS" \
  -e CONN_HOLD_SECONDS="$CONN_HOLD_SECONDS" \
  -e PING_SECONDS="$PING_SECONDS" \
  -e DECK_ID="$DECK_ID" \
  --summary-export "$SUMMARY" \
  "$K6_SCRIPT" 2>&1 | tee "$K6_LOG" || k6_status=$?

echo ""
echo "[종료] 서버 중지"
cleanup
trap - EXIT

if [ -f "$SUMMARY" ] && command -v jq >/dev/null 2>&1; then
  echo ""
  echo "--- 핵심 지표 ---"
  jq -r '
    .metrics as $m
    | ["vus_max", "rooms_created", "ws_error_rate", "protocol_errors", "ws_connecting", "ws_session_duration"]
    | .[] as $k
    | ($m[$k] // empty) as $v
    | "\($k): " + (
        if $v.count != null then "count=\($v.count)"
        elif $k == "ws_error_rate" then "rate=\((($v.value // 0) * 10000 | round) / 100)%"
        elif $v."p(95)" != null then "p95=\($v."p(95)")ms avg=\($v.avg)ms"
        elif $v.value != null then "value=\($v.value)"
        else ($v | tostring)
        end)
  ' "$SUMMARY" 2>/dev/null || true
fi

echo ""
echo "결과 파일: $SUMMARY"
echo "k6 로그  : $K6_LOG"

if [ "$k6_status" -ne 0 ]; then
  echo "[경고] k6가 종료 코드 ${k6_status}로 끝났습니다. (임계값 초과 또는 오류)"
  exit "$k6_status"
fi
