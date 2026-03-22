#!/usr/bin/env bash
# verify-s02-limits.sh — Contract tests for S02 tier rate limiting
# Requires: NEURALTRACE_MODE=cloud server running on localhost:3000
# Usage: bash scripts/verify-s02-limits.sh [BASE_URL]

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=6

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓ PASS${NC}: $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC}: $1 — $2"; FAIL=$((FAIL+1)); }

echo "=== S02 Rate Limit Contract Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# --- Setup: create test users and JWTs ---
TEST_FREE_USER="test-ratelimit-free-$(date +%s)"
TEST_PRO_USER="test-ratelimit-pro-$(date +%s)"
TEST_FREE_EMAIL="${TEST_FREE_USER}@test.neuraltrace.ai"
TEST_PRO_EMAIL="${TEST_PRO_USER}@test.neuraltrace.ai"

echo -e "${YELLOW}Setting up test users...${NC}"

# Create test users directly in system DB and generate JWTs
SETUP_OUTPUT=$(node --input-type=module -e "
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const secret = process.env.JWT_SECRET || 'neuraltrace-dev-secret';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.pragma('journal_mode = WAL');

// Create free user
const freeId = '${TEST_FREE_USER}';
const freeEmail = '${TEST_FREE_EMAIL}';
sdb.prepare('INSERT OR REPLACE INTO users (id, email, plan, daily_search_count, daily_search_reset) VALUES (?, ?, ?, 0, NULL)').run(freeId, freeEmail, 'free');

// Create pro user
const proId = '${TEST_PRO_USER}';
const proEmail = '${TEST_PRO_EMAIL}';
sdb.prepare('INSERT OR REPLACE INTO users (id, email, plan, daily_search_count, daily_search_reset) VALUES (?, ?, ?, 0, NULL)').run(proId, proEmail, 'pro');

// Generate JWTs
const freeJwt = jwt.sign({ userId: freeId, email: freeEmail, plan: 'free' }, secret, { expiresIn: '10m' });
const proJwt = jwt.sign({ userId: proId, email: proEmail, plan: 'pro' }, secret, { expiresIn: '10m' });

// Create vault dirs for per-user DBs
const vaultsDir = path.join(process.cwd(), 'data', 'vaults');
fs.mkdirSync(vaultsDir, { recursive: true });

sdb.close();

console.log(JSON.stringify({ freeJwt, proJwt, freeId, proId }));
")

FREE_JWT=$(echo "$SETUP_OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['freeJwt'])")
PRO_JWT=$(echo "$SETUP_OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['proJwt'])")
FREE_ID=$(echo "$SETUP_OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['freeId'])")
PRO_ID=$(echo "$SETUP_OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['proId'])")

echo "  Free user: $FREE_ID"
echo "  Pro user:  $PRO_ID"
echo ""

# --- Test 1: Trace limit — 50 traces allowed, 51st blocked ---
echo "Test 1: Free user trace limit (50 max)"

# Insert 50 traces
TRACE_FAIL=0
for i in $(seq 1 50); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/trace" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $FREE_JWT" \
    -d "{\"content\":\"test trace $i\",\"tags\":\"test\"}")
  if [ "$HTTP_CODE" != "201" ]; then
    TRACE_FAIL=1
    break
  fi
done

if [ "$TRACE_FAIL" = "1" ]; then
  fail "Trace limit" "Failed to insert 50 traces (stopped at $i with $HTTP_CODE)"
else
  # 51st should be blocked
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/trace" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $FREE_JWT" \
    -d '{"content":"trace 51 should fail","tags":"test"}')
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  CODE_FIELD=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")

  if [ "$HTTP_CODE" = "403" ] && [ "$CODE_FIELD" = "trace_limit" ]; then
    pass "51st trace blocked with 403 + code=trace_limit"
  else
    fail "Trace limit" "expected 403 + trace_limit, got $HTTP_CODE + code=$CODE_FIELD"
  fi
fi

# --- Test 2: Search limit — 25 searches allowed, 26th blocked ---
echo "Test 2: Free user daily search limit (25 max)"

# Reset search counter for clean test
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.prepare('UPDATE users SET daily_search_count = 0, daily_search_reset = NULL WHERE id = ?').run('${FREE_ID}');
sdb.close();
"

SEARCH_FAIL=0
for i in $(seq 1 25); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X GET "$BASE_URL/api/search?q=test" \
    -H "Authorization: Bearer $FREE_JWT")
  if [ "$HTTP_CODE" != "200" ]; then
    SEARCH_FAIL=1
    break
  fi
done

if [ "$SEARCH_FAIL" = "1" ]; then
  fail "Search limit" "Failed before 25 searches (stopped at $i with $HTTP_CODE)"
else
  # 26th should be blocked
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "$BASE_URL/api/search?q=test" \
    -H "Authorization: Bearer $FREE_JWT")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  CODE_FIELD=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")

  if [ "$HTTP_CODE" = "429" ] && [ "$CODE_FIELD" = "search_limit" ]; then
    pass "26th search blocked with 429 + code=search_limit"
  else
    fail "Search limit" "expected 429 + search_limit, got $HTTP_CODE + code=$CODE_FIELD"
  fi
fi

# --- Test 3: API key limit — 1 key allowed, 2nd blocked ---
echo "Test 3: Free user API key limit (1 max)"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FREE_JWT" \
  -d '{"name":"test-key-1"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "201" ]; then
  # 2nd key should be blocked
  RESPONSE2=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/keys" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $FREE_JWT" \
    -d '{"name":"test-key-2"}')
  HTTP_CODE2=$(echo "$RESPONSE2" | tail -1)
  BODY2=$(echo "$RESPONSE2" | sed '$d')
  CODE_FIELD2=$(echo "$BODY2" | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")

  if [ "$HTTP_CODE2" = "403" ] && [ "$CODE_FIELD2" = "api_key_limit" ]; then
    pass "2nd API key blocked with 403 + code=api_key_limit"
  else
    fail "API key limit" "expected 403 + api_key_limit, got $HTTP_CODE2 + code=$CODE_FIELD2"
  fi
else
  fail "API key limit" "1st key creation failed with $HTTP_CODE"
fi

# --- Test 4: Pro user bypasses all limits ---
echo "Test 4: Pro user bypasses all limits"

PRO_OK=1

# Pro: insert 51+ traces (should all succeed)
for i in $(seq 1 55); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/trace" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $PRO_JWT" \
    -d "{\"content\":\"pro trace $i\",\"tags\":\"pro\"}")
  if [ "$HTTP_CODE" != "201" ]; then
    PRO_OK=0
    fail "Pro bypass" "Pro trace $i failed with $HTTP_CODE"
    break
  fi
done

# Pro: 30 searches (above free limit)
if [ "$PRO_OK" = "1" ]; then
  for i in $(seq 1 30); do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X GET "$BASE_URL/api/search?q=pro" \
      -H "Authorization: Bearer $PRO_JWT")
    if [ "$HTTP_CODE" != "200" ]; then
      PRO_OK=0
      fail "Pro bypass" "Pro search $i failed with $HTTP_CODE"
      break
    fi
  done
fi

if [ "$PRO_OK" = "1" ]; then
  pass "Pro user: 55 traces + 30 searches all succeeded"
fi

# --- Test 5: Status endpoint returns limits ---
echo "Test 5: GET /api/user/status returns limits"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "$BASE_URL/api/user/status" \
  -H "Authorization: Bearer $FREE_JWT")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  LIMITS_CHECK=$(echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
l = d.get('limits', {})
if l.get('traces') == 50 and l.get('searches') == 25:
    print('ok')
else:
    print(f'bad: traces={l.get(\"traces\")} searches={l.get(\"searches\")}')
" 2>/dev/null || echo "parse_error")

  if [ "$LIMITS_CHECK" = "ok" ]; then
    pass "Status returns limits: traces=50, searches=25"
  else
    fail "Status limits" "$LIMITS_CHECK"
  fi
else
  fail "Status limits" "expected 200, got $HTTP_CODE"
fi

# --- Test 6: Daily search reset ---
echo "Test 6: Daily search counter resets on new day"

# Set daily_search_reset to yesterday so counter resets
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
sdb.prepare('UPDATE users SET daily_search_count = 25, daily_search_reset = ? WHERE id = ?').run(yesterday, '${FREE_ID}');
sdb.close();
"

# Search should succeed (counter was reset)
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "$BASE_URL/api/search?q=test" \
  -H "Authorization: Bearer $FREE_JWT")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "200" ]; then
  pass "Search allowed after daily reset (yesterday → today)"
else
  fail "Daily reset" "expected 200, got $HTTP_CODE"
fi

# --- Cleanup ---
echo ""
echo -e "${YELLOW}Cleaning up test data...${NC}"
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// Clean system DB
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.prepare('DELETE FROM api_keys WHERE user_id IN (?, ?)').run('${FREE_ID}', '${PRO_ID}');
sdb.prepare('DELETE FROM users WHERE id IN (?, ?)').run('${FREE_ID}', '${PRO_ID}');
sdb.close();

// Clean vault files
const vaultsDir = path.join(process.cwd(), 'data', 'vaults');
for (const uid of ['${FREE_ID}', '${PRO_ID}']) {
  const vaultPath = path.join(vaultsDir, uid + '.db');
  try { fs.unlinkSync(vaultPath); } catch {}
  try { fs.unlinkSync(vaultPath + '-wal'); } catch {}
  try { fs.unlinkSync(vaultPath + '-shm'); } catch {}
}
console.log('Cleaned up test users and vaults');
"

# --- Summary ---
echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
