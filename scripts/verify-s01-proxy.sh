#!/usr/bin/env bash
# verify-s01-proxy.sh — Contract tests for S01 chat proxy and user status endpoints
# Usage: bash scripts/verify-s01-proxy.sh [BASE_URL]

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=4

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓ PASS${NC}: $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC}: $1 — $2"; FAIL=$((FAIL+1)); }

echo "=== S01 Proxy Contract Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# Generate a test JWT
JWT=$(node --input-type=module -e "
import jwt from 'jsonwebtoken';
const secret = process.env.JWT_SECRET || 'neuraltrace-dev-secret';
const token = jwt.sign({ userId: 'test-user-001', email: 'test@neuraltrace.ai', plan: 'free' }, secret, { expiresIn: '5m' });
console.log(token);
")

if [ -z "$JWT" ]; then
  echo "ERROR: Failed to generate test JWT."
  exit 1
fi

# Ensure test user exists in system DB
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.pragma('journal_mode = WAL');
sdb.exec(\`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  plan TEXT DEFAULT 'free', created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)\`);
const existing = sdb.prepare('SELECT id FROM users WHERE id = ?').get('test-user-001');
if (!existing) {
  sdb.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('test-user-001', 'test@neuraltrace.ai');
  console.log('Created test user');
} else {
  console.log('Test user exists');
}
sdb.close();
"

# --- Test 1: POST /api/chat/completions without auth → 401 ---
echo "Test 1: Chat proxy rejects unauthenticated requests"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}')

if [ "$HTTP_CODE" = "401" ]; then
  pass "POST /api/chat/completions without auth → 401"
else
  fail "POST /api/chat/completions without auth" "expected 401, got $HTTP_CODE"
fi

# --- Test 2: POST /api/chat/completions with JWT → SSE stream ---
echo "Test 2: Chat proxy returns SSE stream for authenticated request"
HEADERS_FILE=$(mktemp)
RESPONSE=$(curl -s --no-buffer --max-time 20 \
  -X POST "$BASE_URL/api/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"messages":[{"role":"user","content":"Say exactly one word: hello"}]}' \
  -D "$HEADERS_FILE" 2>/dev/null || true)

CONTENT_TYPE=$(grep -i "content-type" "$HEADERS_FILE" 2>/dev/null | head -1 || echo "")
rm -f "$HEADERS_FILE"

if echo "$CONTENT_TYPE" | grep -qi "text/event-stream"; then
  if echo "$RESPONSE" | grep -q "data:"; then
    pass "POST /api/chat/completions with JWT → SSE stream with data: lines"
  else
    fail "POST /api/chat/completions with JWT" "got event-stream content-type but no data: lines"
  fi
else
  fail "POST /api/chat/completions with JWT" "expected Content-Type: text/event-stream, got: $CONTENT_TYPE. Response: ${RESPONSE:0:200}"
fi

# --- Test 3: GET /api/user/status with JWT → 200 with plan/model/limits ---
echo "Test 3: User status returns plan, model, and limits"
STATUS_RESPONSE=$(curl -s \
  -X GET "$BASE_URL/api/user/status" \
  -H "Authorization: Bearer $JWT")
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "$BASE_URL/api/user/status" \
  -H "Authorization: Bearer $JWT")

if [ "$STATUS_CODE" = "200" ]; then
  HAS_FIELDS=$(echo "$STATUS_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if 'plan' in d and 'model' in d and 'limits' in d else 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_FIELDS" = "yes" ]; then
    pass "GET /api/user/status → 200 with plan, model, limits ($STATUS_RESPONSE)"
  else
    fail "GET /api/user/status" "200 but missing fields: $STATUS_RESPONSE"
  fi
else
  fail "GET /api/user/status" "expected 200, got $STATUS_CODE: $STATUS_RESPONSE"
fi

# --- Test 4: GET /api/user/status without auth → 401 ---
echo "Test 4: User status rejects unauthenticated requests"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "$BASE_URL/api/user/status")

if [ "$HTTP_CODE" = "401" ]; then
  pass "GET /api/user/status without auth → 401"
else
  fail "GET /api/user/status without auth" "expected 401, got $HTTP_CODE"
fi

# --- Summary ---
echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
