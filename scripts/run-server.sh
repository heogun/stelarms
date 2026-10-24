#!/usr/bin/env bash
# STELARMS 서버 실행 스크립트
# 사용법: ./scripts/run-server.sh [dev|prod] [포트]
# 예시: ./scripts/run-server.sh prod 3001

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

MODE="${1:-prod}"
PORT="${2:-3001}"

# 환경 변수 기본값
export NODE_ENV="${NODE_ENV:-$([ "$MODE" = "prod" ] && echo production || echo development)}"
export PORT="$PORT"
export HOST="${HOST:-0.0.0.0}"
export TRUST_PROXY="${TRUST_PROXY:-false}"
export RENDER="${RENDER:-false}"

# INSTANCE_ID 자동 생성 (없을 경우)
if [ -z "$INSTANCE_ID" ]; then
  if command -v uuidgen >/dev/null 2>&1; then
    export INSTANCE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  else
    export INSTANCE_ID="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
fi

# 로그 디렉토리
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server-$(date +%Y%m%d_%H%M%S).log"
LATEST_LOG="$LOG_DIR/server-latest.log"

echo "=========================================="
echo " STELARMS 서버 시작"
echo "=========================================="
echo "모드       : $MODE ($NODE_ENV)"
echo "주소       : http://$HOST:$PORT"
echo "WebSocket  : ws://$HOST:$PORT/ws"
echo "InstanceID : $INSTANCE_ID"
echo "로그       : $LOG_FILE"
echo "=========================================="
echo ""

# 의존성 체크
if ! command -v bun >/dev/null 2>&1; then
  echo "[오류] bun이 설치되어 있지 않습니다."
  echo "설치: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# 프로덕션 모드일 경우 빌드 확인
if [ "$MODE" = "prod" ]; then
  if [ ! -d "$ROOT_DIR/dist" ] || [ ! -f "$ROOT_DIR/dist/index.html" ]; then
    echo "[경고] dist/ 가 없거나 불완전합니다. 빌드를 먼저 진행합니다..."
    echo ""
    bun run build
    echo ""
  fi
  echo "[시작] 프로덕션 모드로 서버를 실행합니다..."
  echo ""
  bun run serve 2>&1 | tee -a "$LOG_FILE" | tee "$LATEST_LOG"
else
  echo "[시작] 개발 모드로 서버를 실행합니다... (dev:server)"
  echo ""
  bun run dev:server 2>&1 | tee -a "$LOG_FILE" | tee "$LATEST_LOG"
fi
