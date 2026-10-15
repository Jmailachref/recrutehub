#!/bin/sh
# Checks a running stack from the outside, through the gateway.
# Usage: sh e2e/smoke.sh [base_url]   (default http://localhost)
set -e
BASE="${1:-http://localhost}"
fail() { echo "FAIL: $1"; exit 1; }

for service in auth offers questions candidates assessments notifications; do
  tries=0
  until curl -fsS "$BASE/api/$service/health" 2>/dev/null | grep -q '"database":true'; do
    tries=$((tries + 1)); [ $tries -lt 60 ] || fail "$service health"; sleep 2
  done
  echo "ok  $service"
done

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/internal/anything")
[ "$code" = 404 ] || fail "internal endpoints must not be reachable through the gateway (got $code)"
echo "ok  internal endpoints are hidden"

curl -fsSL "$BASE/login" | grep -q '<title>RecruteHub' || fail "frontend"
echo "ok  frontend"

docker compose exec -T assessments python -c \
  "import httpx; httpx.get('http://codeplay-api:8000/v1/health').raise_for_status()" || fail "assessments cannot reach Code Playground"
echo "ok  Code Playground reachable from the backends"

tries=0
until docker compose exec -T candidates python -c \
  "import httpx; httpx.get('http://cvanalyzer-api:8000/health').raise_for_status()" 2>/dev/null; do
  tries=$((tries + 1)); [ $tries -lt 60 ] || fail "candidates cannot reach the CV analyzer"; sleep 2
done
echo "ok  CV Analyzer reachable from the backends"

code=$(curl -s -o /dev/null -w '%{http_code}' -F name=Smoke -F email=smoke@example.com -F "cv=@/dev/null;type=application/pdf" "$BASE/api/candidates/apply/no-such-offer")
[ "$code" = 404 ] || fail "applying to an unknown offer should be 404 (got $code)"
echo "ok  apply checks the offer"
