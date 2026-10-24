#!/usr/bin/env bash
# STELARMS 최대 동시 접속자(CCU) 자동 탐색 부하테스트
#
# 동작:
#   1. 서버를 띄우고 헬스체크한다.
#   2. START_VUS → MAX_VUS 까지 단계별(기본 2배)로 k6를 "각각" 실행한다.
#   3. 각 단계가 끝날 때마다 오류율/연결 지연/프로토콜 오류/헬스체크를 검사한다.
#   4. 한계가 감지되면 그 단계에서 중단하고, 마지막 성공 VU를 최대 안정 CCU로 기록한다.
#      (REFINE_ROUNDS > 0 이면 성공/실패 사이를 이진 탐색해 최대치를 좁힌다.)
#   5. 서버를 자동 종료하고, 터미널에는 간략한 표만, 상세 결과는 로그 디렉터리에 남긴다.
#
# 사용법:
#   scripts/loadtest/run-max.sh
#   MODE=1v1 MAX_VUS=200 scripts/loadtest/run-max.sh
#   MAX_VUS=2000 STAGE_SECONDS=45 REFINE_ROUNDS=4 scripts/loadtest/run-max.sh
#
# 환경 변수:
#   PORT=3001              서버 포트
#   MODE=staged            staged(연결/로비, VU=접속 1명) 또는 1v1(VU=매치 1개, 접속 2명)
#   START_VUS=50           첫 단계 VU
#   MAX_VUS=800            탐색 상한 VU (1v1 모드에서는 매치 수)
#   STEP_FACTOR=2          단계 증가 배수
#   STAGE_SECONDS=60       각 단계의 부하 유지 시간(초)
#   RAMP_SECONDS=10        각 단계의 램프업 시간(초)
#   REFINE_ROUNDS=3        한계 구간 이진 탐색 횟수 (0이면 끔)
#   MAX_ERROR_RATE=0.01    한계 판정: WS 오류율 (0.01 = 1%)
#   MAX_CONNECT_P95_MS=2000 한계 판정: 연결 p95 (0이면 끔)
#   MAX_SETUP_P95_MS=0     한계 판정: 1v1 매치 시작 p95 (0이면 끔)
#   MAX_PROTOCOL_ERRORS=100 한계 판정: 프로토콜 오류 건수 (0이면 끔)
#   CONN_HOLD_SECONDS=45   VU별 연결(매치) 유지 시간(초)
#   PING_SECONDS=15        핑 주기(초)
#   DECK_ID=deck-yuni-huya 사용할 프리셋 덱
#   HEALTH_TIMEOUT=90      서버 헬스체크 대기 시간(초)
#
# 상세 로그: logs/loadtest-<시각>/
#   run.log                  전체 실행 로그
#   report.md                단계별 표 + 최종 결과 + 설정
#   results.tsv              단계별 핵심 지표 (기계 판독용)
#   stage-XX-*-summary.json  k6 summary 원본 (모든 지표)
#   stage-XX-*-metrics.tsv   k6 모든 지표 평탄화
#   stage-XX-*.log           k6 콘솔 전체 로그
#   stage-XX-*-health-*.json 단계 전/후 /health 응답
#   server.log               서버 로그 사본

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
START_VUS="${START_VUS:-50}"
MAX_VUS="${MAX_VUS:-800}"
STEP_FACTOR="${STEP_FACTOR:-2}"
STAGE_SECONDS="${STAGE_SECONDS:-60}"
RAMP_SECONDS="${RAMP_SECONDS:-10}"
REFINE_ROUNDS="${REFINE_ROUNDS:-3}"
MAX_ERROR_RATE="${MAX_ERROR_RATE:-0.01}"
MAX_CONNECT_P95_MS="${MAX_CONNECT_P95_MS:-2000}"
MAX_SETUP_P95_MS="${MAX_SETUP_P95_MS:-0}"
MAX_PROTOCOL_ERRORS="${MAX_PROTOCOL_ERRORS:-100}"
CONN_HOLD_SECONDS="${CONN_HOLD_SECONDS:-45}"
PING_SECONDS="${PING_SECONDS:-15}"
DECK_ID="${DECK_ID:-deck-yuni-huya}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

TS="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$ROOT_DIR/logs"
RUN_DIR="$LOG_DIR/loadtest-${TS}"
mkdir -p "$RUN_DIR"
RUN_LOG="$RUN_DIR/run.log"
RESULTS_TSV="$RUN_DIR/results.tsv"
REPORT="$RUN_DIR/report.md"
SERVER_CONSOLE="$RUN_DIR/server-console.log"

# 이후 모든 출력을 터미널과 run.log 에 동시에 남긴다.
exec > >(tee -a "$RUN_LOG") 2>&1

die() {
  echo "[오류] $*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*"
}

command -v k6 >/dev/null 2>&1 || die "k6가 설치되어 있지 않습니다. (brew install k6)"
command -v curl >/dev/null 2>&1 || die "curl이 필요합니다."
command -v jq >/dev/null 2>&1 || die "jq가 필요합니다. (brew install jq)"
command -v bun >/dev/null 2>&1 || die "bun이 설치되어 있지 않습니다."
[ -f "$K6_SCRIPT" ] || die "k6 스크립트가 없습니다: $K6_SCRIPT"
[ -x "$STOP_SCRIPT" ] || die "중지 스크립트가 없거나 실행 권한이 없습니다: $STOP_SCRIPT"

is_pos_int() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ]; }

is_pos_int "$START_VUS" || die "START_VUS는 1 이상의 숫자여야 합니다: $START_VUS"
is_pos_int "$MAX_VUS" || die "MAX_VUS는 1 이상의 숫자여야 합니다: $MAX_VUS"
is_pos_int "$STEP_FACTOR" || die "STEP_FACTOR는 1 이상의 숫자여야 합니다: $STEP_FACTOR"
is_pos_int "$STAGE_SECONDS" || die "STAGE_SECONDS는 1 이상의 숫자여야 합니다: $STAGE_SECONDS"
[[ "$REFINE_ROUNDS" =~ ^[0-9]+$ ]] || die "REFINE_ROUNDS는 0 이상의 숫자여야 합니다: $REFINE_ROUNDS"
[ "$START_VUS" -le "$MAX_VUS" ] || START_VUS="$MAX_VUS"
[ "$STEP_FACTOR" -ge 2 ] || STEP_FACTOR=2
[[ "$MAX_CONNECT_P95_MS" =~ ^[0-9]+$ ]] || die "MAX_CONNECT_P95_MS는 0 이상의 정수여야 합니다: $MAX_CONNECT_P95_MS"
[[ "$MAX_SETUP_P95_MS" =~ ^[0-9]+$ ]] || die "MAX_SETUP_P95_MS는 0 이상의 정수여야 합니다: $MAX_SETUP_P95_MS"
[[ "$MAX_PROTOCOL_ERRORS" =~ ^[0-9]+$ ]] || die "MAX_PROTOCOL_ERRORS는 0 이상의 정수여야 합니다: $MAX_PROTOCOL_ERRORS"
awk -v r="$MAX_ERROR_RATE" 'BEGIN { exit !(r >= 0) }' || die "MAX_ERROR_RATE는 0 이상이어야 합니다: $MAX_ERROR_RATE"

connect_criteria="> ${MAX_CONNECT_P95_MS}ms"
[ "$MAX_CONNECT_P95_MS" -gt 0 ] || connect_criteria="off"
setup_criteria="> ${MAX_SETUP_P95_MS}ms"
[ "$MAX_SETUP_P95_MS" -gt 0 ] || setup_criteria="off"
protocol_criteria="> ${MAX_PROTOCOL_ERRORS}"
[ "$MAX_PROTOCOL_ERRORS" -gt 0 ] || protocol_criteria="off"

cleanup() {
  "$STOP_SCRIPT" --quiet --port="$PORT" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ────────────────────────── 단계 실행 ──────────────────────────

STAGE_RESULT=""
STAGE_REASON=""
STAGE_ERROR_PCT=""
STAGE_CONN_P95=""
STAGE_SETUP_P95=""
STAGE_ROOMS=""
STAGE_MATCHES=""
STAGE_PROTOCOL=""
STAGE_SUMMARY=""
STAGE_K6LOG=""

json_value() { # 파일 키
  jq -r --arg k "$2" '.metrics[$k].value // empty' "$1" 2>/dev/null || true
}
json_count() {
  jq -r --arg k "$2" '.metrics[$k].count // empty' "$1" 2>/dev/null || true
}
json_p95() {
  jq -r --arg k "$2" '.metrics[$k]["p(95)"] // empty' "$1" 2>/dev/null || true
}

gt() { # a > b (실수 비교)
  awk -v a="$1" -v b="$2" 'BEGIN { exit !(a > b) }'
}
fmt_pct() { awk -v e="$1" 'BEGIN { printf "%.2f", e * 100 }'; }
fmt_ms() { awk -v v="$1" 'BEGIN { printf "%.0f", v }'; }

ADD_REASON=""
add_reason() {
  if [ -z "$ADD_REASON" ]; then
    ADD_REASON="$1"
  else
    ADD_REASON="$ADD_REASON; $1"
  fi
}

run_stage() {
  local index="$1" target="$2" phase="$3"
  local name
  name="$(printf "stage-%02d-%s-%s" "$index" "$phase" "$target")"

  STAGE_ERROR_PCT=""
  STAGE_CONN_P95=""
  STAGE_SETUP_P95=""
  STAGE_ROOMS=""
  STAGE_MATCHES=""
  STAGE_PROTOCOL=""
  ADD_REASON=""
  STAGE_SUMMARY="$RUN_DIR/${name}-summary.json"
  STAGE_K6LOG="$RUN_DIR/${name}.log"

  say ""
  say "[단계 ${index}] ${phase} · ${target} VU · 램프 ${RAMP_SECONDS}s + 유지 ${STAGE_SECONDS}s"

  curl -fsS "http://${HEALTH_HOST}:${PORT}/health" \
    >"$RUN_DIR/${name}-health-before.json" 2>/dev/null || true

  local k6_status=0
  k6 run \
    -e WS_URL="ws://${HEALTH_HOST}:${PORT}/ws" \
    -e STAGE_TARGETS="$target" \
    -e STEP_SECONDS="$RAMP_SECONDS" \
    -e HOLD_SECONDS="$STAGE_SECONDS" \
    -e DOWN_SECONDS="1" \
    -e CONN_HOLD_SECONDS="$CONN_HOLD_SECONDS" \
    -e PING_SECONDS="$PING_SECONDS" \
    -e DECK_ID="$DECK_ID" \
    --summary-export "$STAGE_SUMMARY" \
    "$K6_SCRIPT" 2>&1 | tee "$STAGE_K6LOG" || k6_status=$?

  curl -fsS "http://${HEALTH_HOST}:${PORT}/health" \
    >"$RUN_DIR/${name}-health-after.json" 2>/dev/null || true

  if [ ! -f "$STAGE_SUMMARY" ]; then
    STAGE_RESULT="FAIL"
    add_reason "summary 없음 (k6 exit=${k6_status})"
    STAGE_REASON="$ADD_REASON"
    say "  → FAIL: ${STAGE_REASON}"
    append_result "$index" "$phase" "$target" "$name" "$k6_status"
    return 0
  fi

  # 모든 지표를 빠짐없이 평탄화해 저장
  jq -r '
    .metrics | to_entries[]
    | .key as $k
    | .value | to_entries[]
    | "\($k).\(.key)\t\(.value | tojson)"
  ' "$STAGE_SUMMARY" >"$RUN_DIR/${name}-metrics.tsv" 2>/dev/null || true

  local err connect95 setup95 protocol rooms matches
  err="$(json_value "$STAGE_SUMMARY" ws_error_rate)"
  connect95="$(json_p95 "$STAGE_SUMMARY" ws_connecting)"
  setup95="$(json_p95 "$STAGE_SUMMARY" match_setup_ms)"
  protocol="$(json_count "$STAGE_SUMMARY" protocol_errors)"
  rooms="$(json_count "$STAGE_SUMMARY" rooms_created)"
  matches="$(json_count "$STAGE_SUMMARY" matches_started)"

  [ -n "$err" ] || err=0
  [ -n "$protocol" ] || protocol=0
  [ -n "$rooms" ] || rooms=0
  [ -n "$matches" ] || matches=0
  STAGE_ERROR_PCT="$(fmt_pct "$err")"
  STAGE_CONN_P95=""
  STAGE_SETUP_P95=""
  [ -z "$connect95" ] || STAGE_CONN_P95="$(fmt_ms "$connect95")"
  [ -z "$setup95" ] || STAGE_SETUP_P95="$(fmt_ms "$setup95")"
  STAGE_ROOMS="$rooms"
  STAGE_MATCHES="$matches"
  STAGE_PROTOCOL="$protocol"

  # 한계 판정
  if [ "$k6_status" -ne 0 ] && [ "$k6_status" -ne 99 ]; then
    add_reason "k6-exit=${k6_status}"
  fi
  if gt "$err" "$MAX_ERROR_RATE"; then
    add_reason "ws_error_rate=${STAGE_ERROR_PCT}% > $(fmt_pct "$MAX_ERROR_RATE")%"
  fi
  if [ -n "$connect95" ] && [ "$MAX_CONNECT_P95_MS" -gt 0 ] && gt "$connect95" "$MAX_CONNECT_P95_MS"; then
    add_reason "connect_p95=${STAGE_CONN_P95}ms > ${MAX_CONNECT_P95_MS}ms"
  fi
  if [ -n "$setup95" ] && [ "$MAX_SETUP_P95_MS" -gt 0 ] && gt "$setup95" "$MAX_SETUP_P95_MS"; then
    add_reason "setup_p95=${STAGE_SETUP_P95}ms > ${MAX_SETUP_P95_MS}ms"
  fi
  if [ "$MAX_PROTOCOL_ERRORS" -gt 0 ] && gt "$protocol" "$MAX_PROTOCOL_ERRORS"; then
    add_reason "protocol_errors=${protocol} > ${MAX_PROTOCOL_ERRORS}"
  fi
  if ! jq -e '.ok == true' "$RUN_DIR/${name}-health-after.json" >/dev/null 2>&1; then
    add_reason "server-unhealthy"
  fi
  if [ "$MODE" = "1v1" ]; then
    if [ "$matches" -eq 0 ] 2>/dev/null; then
      add_reason "matches_started=0"
    fi
  else
    if [ "$rooms" -eq 0 ] 2>/dev/null; then
      add_reason "rooms_created=0"
    fi
  fi
  if [ -z "$ADD_REASON" ] && [ "$k6_status" -eq 99 ]; then
    add_reason "k6-threshold"
  fi

  if [ -n "$ADD_REASON" ]; then
    STAGE_RESULT="FAIL"
    STAGE_REASON="$ADD_REASON"
    say "  → FAIL: ${STAGE_REASON}"
  else
    STAGE_RESULT="PASS"
    STAGE_REASON="-"
    say "  → PASS (err ${STAGE_ERROR_PCT}%, rooms ${rooms}, matches ${matches})"
  fi

  append_result "$index" "$phase" "$target" "$name" "$k6_status"
}

append_result() {
  local index="$1" phase="$2" target="$3" name="$4" k6_status="$5"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$index" "$phase" "$target" "$STAGE_RESULT" \
    "$STAGE_ERROR_PCT" "$STAGE_CONN_P95" "$STAGE_ROOMS" "$STAGE_MATCHES" \
    "$STAGE_SETUP_P95" "$STAGE_PROTOCOL" "$STAGE_REASON" "$k6_status" \
    "$RUN_DIR/${name}-summary.json" "$RUN_DIR/${name}.log" \
    >>"$RESULTS_TSV"
}

# ────────────────────────── 실행 ──────────────────────────

printf 'index\tphase\ttarget\tresult\terror_pct\tconnect_p95_ms\trooms\tmatches_started\tsetup_p95_ms\tprotocol_errors\treason\tk6_exit\tsummary\tk6_log\n' >"$RESULTS_TSV"

say "=========================================="
say " STELARMS 최대 CCU 자동 탐색"
say "=========================================="
say "모드       : ${MODE}"
say "대상       : ws://${HEALTH_HOST}:${PORT}/ws"
say "탐색 범위  : ${START_VUS} → ${MAX_VUS} VU (x${STEP_FACTOR})"
say "단계 시간  : 램프 ${RAMP_SECONDS}s + 유지 ${STAGE_SECONDS}s"
say "한계 기준  : err > $(fmt_pct "$MAX_ERROR_RATE")%, conn p95 ${connect_criteria}, setup p95 ${setup_criteria}, protocol errors ${protocol_criteria}"
say "상세 로그  : ${RUN_DIR}"
say "=========================================="

if curl -fsS "http://${HEALTH_HOST}:${PORT}/health" >/dev/null 2>&1; then
  say "[정리] 기존 서버를 중지합니다. (포트 ${PORT})"
  "$STOP_SCRIPT" --quiet --port="$PORT" || true
  sleep 1
fi

say "[시작] 서버 (포트 ${PORT})"
(
  cd "$ROOT_DIR"
  TRUST_PROXY=true HOST=0.0.0.0 PORT="$PORT" NODE_ENV=production \
    ./scripts/run-server.sh prod "$PORT"
) >"$SERVER_CONSOLE" 2>&1 &
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
  say "[오류] 서버가 ${HEALTH_TIMEOUT}s 안에 준비되지 않았습니다."
  [ -f "$SERVER_CONSOLE" ] && tail -n 40 "$SERVER_CONSOLE" || true
  exit 1
fi
say "[준비] 서버 헬스체크 통과"

stage_index=0
last_pass=0
first_fail=""
fail_reason="-"
capped=false

target="$START_VUS"
while [ "$target" -le "$MAX_VUS" ]; do
  stage_index=$((stage_index + 1))
  run_stage "$stage_index" "$target" "ladder"
  if [ "$STAGE_RESULT" = "PASS" ]; then
    last_pass="$target"
  else
    first_fail="$target"
    fail_reason="$STAGE_REASON"
    break
  fi
  if [ "$target" -ge "$MAX_VUS" ]; then
    capped=true
    break
  fi
  next=$((target * STEP_FACTOR))
  [ "$next" -gt "$MAX_VUS" ] && next="$MAX_VUS"
  target="$next"
done

# 성공/실패 사이를 이진 탐색해 최대치를 좁힌다.
if [ -n "$first_fail" ] && [ "$last_pass" -gt 0 ] && [ "$REFINE_ROUNDS" -gt 0 ]; then
  lo="$last_pass"
  hi="$first_fail"
  round=0
  while [ "$round" -lt "$REFINE_ROUNDS" ] && [ "$((hi - lo))" -gt 1 ]; do
    round=$((round + 1))
    mid=$(((lo + hi) / 2))
    [ "$mid" -le "$lo" ] && break
    stage_index=$((stage_index + 1))
    run_stage "$stage_index" "$mid" "refine"
    if [ "$STAGE_RESULT" = "PASS" ]; then
      lo="$mid"
    else
      hi="$mid"
      fail_reason="$STAGE_REASON"
    fi
  done
  last_pass="$lo"
  first_fail="$hi"
fi

if [ "$MODE" = "1v1" ]; then
  max_connections=$((last_pass * 2))
else
  max_connections="$last_pass"
fi

say ""
say "[종료] 서버 중지"
cleanup
trap - EXIT

# 서버 로그 사본
if [ -f "$ROOT_DIR/logs/server-latest.log" ]; then
  cp "$ROOT_DIR/logs/server-latest.log" "$RUN_DIR/server.log" 2>/dev/null || true
fi

# ────────────────────────── 결과 출력 ──────────────────────────

say ""
say "=========================================="
say " 단계별 결과 (상세: ${REPORT})"
say "=========================================="
printf '%-3s %-7s %-6s %-6s %-7s %-8s %-7s %-7s %s\n' \
  "#" "PHASE" "VU" "RESULT" "ERR%" "CONN95" "ROOMS" "MATCH" "REASON"
awk -F'\t' 'NR > 1 {
  conn = ($6 == "" ? "-" : $6 "ms")
  setup = ($9 == "" ? "-" : $9 "ms")
  reason = ($11 == "" ? "-" : $11)
  printf "%-3s %-7s %-6s %-6s %-7s %-8s %-7s %-7s %s\n", $1, $2, $3, $4, ($5 == "" ? "-" : $5), conn, ($7 == "" ? "-" : $7), ($8 == "" ? "-" : $8), reason
}' "$RESULTS_TSV"

say ""
say "=========================================="
say " 최종 결과"
say "=========================================="
if [ "$last_pass" -eq 0 ]; then
  say "안정 구간 없음: 첫 단계(${START_VUS} VU)부터 한계 초과"
else
  if [ "$MODE" = "1v1" ]; then
    say "최대 안정 CCU: ${last_pass} 매치 (동시 접속 약 ${max_connections}명)"
    say "탐색 상한  : ${MAX_VUS} 매치"
  else
    say "최대 안정 CCU: ${last_pass} VU (동시 접속 약 ${max_connections}명)"
    say "탐색 상한  : ${MAX_VUS} VU"
  fi
fi
if [ "$capped" = true ]; then
  say "판정       : 탐색 상한(MAX_VUS=${MAX_VUS})까지 통과 — 상한을 올려 재시험 필요"
  say "한계       : 감지되지 않음"
elif [ -n "$first_fail" ]; then
  say "한계 단계  : ${first_fail} VU"
  say "실패 사유  : ${fail_reason}"
else
  say "판정       : 한계 감지되지 않음"
fi
say "상세 로그  : ${RUN_DIR}"
say "리포트     : ${REPORT}"
say "실행 로그  : ${RUN_LOG}"
say "=========================================="

# ────────────────────────── 리포트 파일 ──────────────────────────

{
  echo "# STELARMS 부하테스트 리포트"
  echo ""
  echo "- 실행 시각: ${TS}"
  echo "- 모드: ${MODE}"
  echo "- 대상: ws://${HEALTH_HOST}:${PORT}/ws"
  echo "- 탐색 범위: ${START_VUS} → ${MAX_VUS} VU (x${STEP_FACTOR})"
  echo "- 단계 시간: 램프 ${RAMP_SECONDS}s + 유지 ${STAGE_SECONDS}s"
  echo "- 한계 기준: ws_error_rate > $(fmt_pct "$MAX_ERROR_RATE")%, connect p95 ${connect_criteria}, setup p95 ${setup_criteria}, protocol errors ${protocol_criteria}"
  echo ""
  echo "## 최종"
  echo ""
  if [ "$last_pass" -eq 0 ]; then
    echo "- 안정 구간 없음 (첫 단계부터 한계)"
  elif [ "$MODE" = "1v1" ]; then
    echo "- 최대 안정: **${last_pass} 매치 / 동시 접속 약 ${max_connections}명**"
  else
    echo "- 최대 안정: **${last_pass} VU / 동시 접속 약 ${max_connections}명**"
  fi
  if [ "$capped" = true ]; then
    echo "- 판정: 탐색 상한(MAX_VUS=${MAX_VUS})까지 통과, 한계 미감지"
  elif [ -n "$first_fail" ]; then
    echo "- 한계 단계: ${first_fail} VU"
    echo "- 실패 사유: ${fail_reason}"
  fi
  echo ""
  echo "## 단계별 결과"
  echo ""
  echo "| # | phase | VU | result | err% | conn p95 | rooms | matches | setup p95 | protocol errors | reason |"
  echo "|---|-------|----|--------|------|----------|-------|---------|-----------|-----------------|--------|"
  awk -F'\t' 'NR > 1 {
    printf "| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n",
      $1, $2, $3, $4, ($5 == "" ? "-" : $5), ($6 == "" ? "-" : $6), ($7 == "" ? "-" : $7), ($8 == "" ? "-" : $8), ($9 == "" ? "-" : $9), $10, $11
  }' "$RESULTS_TSV"
  echo ""
  echo "## 파일"
  echo ""
  echo "- \`results.tsv\`: 단계별 핵심 지표"
  echo "- \`stage-*-summary.json\`: k6 summary 원본"
  echo "- \`stage-*-metrics.tsv\`: k6 전체 지표 평탄화"
  echo "- \`stage-*.log\`: k6 콘솔 전체 로그"
  echo "- \`stage-*-health-before.json\`, \`stage-*-health-after.json\`: 단계 전/후 헬스체크"
  echo "- \`server.log\`: 서버 로그"
  echo "- \`run.log\`: 전체 실행 로그"
} >"$REPORT"
