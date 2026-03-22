#!/usr/bin/env bash
# verify-s04-extension-ui.sh — Contract tests for S04 Plan-Aware Extension UI
# Tests server-side contracts: status shapes, newToken issuance, rate limit shapes, plan upgrade detection
# Requires: NEURALTRACE_MODE=cloud server running on localhost:3000
# Usage: bash scripts/verify-s04-extension-ui.sh [BASE_URL]

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=5

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓ PASS${NC}: $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC}: $1 — $2"; FAIL=$((FAIL+1)); }

echo "=== S04 Extension UI Contract Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# --- Setup: create test users and JWTs ---
TEST_FREE_USER="test-s04-free-$(date +%s)"
TEST_PRO_USER="test-s04-pro-$(date +%s)"
TEST_FREE_EMAIL="${TEST_FREE_USER}@test.neuraltrace.ai"
TEST_PRO_EMAIL="${TEST_PRO_USER}@test.neuraltrace.ai"

echo -e "${YELLOW}Setting up test users...${NC}"

SETUP_OUTPUT=$(node --input-type=module -e "
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';

const secret = process.env.JWT_SECRET || 'neuraltrace-dev-secret';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.pragma('journal_mode = WAL');

// Create free user
const freeId = '${TEST_FREE_USER}';
const freeEmail = '${TEST_FREE_EMAIL}';
sdb.prepare('INSERT OR REPLACE INTO users (id, email, plan, daily_search_count, daily_search_reset) VALUES (?, ?, ?, 0, NULL)').run(freeId, freeEmail, 'free');

// Create pro user (for later upgrade test)
const proId = '${TEST_PRO_USER}';
const proEmail = '${TEST_PRO_EMAIL}';
sdb.prepare('INSERT OR REPLACE INTO users (id, email, plan, daily_search_count, daily_search_reset) VALUES (?, ?, ?, 0, NULL)').run(proId, proEmail, 'pro');

// Generate JWTs
const freeJwt = jwt.sign({ userId: freeId, email: freeEmail, plan: 'free' }, secret, { expiresIn: '10m' });
const proJwt = jwt.sign({ userId: proId, email: proEmail, plan: 'pro' }, secret, { expiresIn: '10m' });

// Create vault dirs
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

# --- Test 1: Free user status returns plan=free + model + limits ---
echo "Test 1: Free user status shape"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "$BASE_URL/api/user/status" \
  -H "Authorization: Bearer $FREE_JWT")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  CHECK=$(echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
plan = d.get('plan', '')
model = d.get('model', '')
limits = d.get('limits', {})
errors = []
if plan != 'free': errors.append(f'plan={plan}')
if 'deepseek' not in model.lower(): errors.append(f'model={model}')
if not isinstance(limits, dict) or 'traces' not in limits: errors.append(f'limits missing')
if errors:
    print('bad: ' + ', '.join(errors))
else:
    print('ok')
" 2>/dev/null || echo "parse_error")

  if [ "$CHECK" = "ok" ]; then
    pass "Free status: plan=free, model contains deepseek, limits present"
  else
    fail "Free status" "$CHECK"
  fi
else
  fail "Free status" "expected 200, got $HTTP_CODE"
fi

# --- Test 2: Stale JWT (free JWT, DB plan=pro) returns newToken + plan=pro ---
echo "Test 2: Stale JWT returns newToken"

# Update free user's plan to pro in DB (simulating upgrade) while JWT still says free
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.prepare('UPDATE users SET plan = ? WHERE id = ?').run('pro', '${FREE_ID}');
sdb.close();
"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "$BASE_URL/api/user/status" \
  -H "Authorization: Bearer $FREE_JWT")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  CHECK=$(echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
plan = d.get('plan', '')
newToken = d.get('newToken', '')
errors = []
if plan != 'pro': errors.append(f'plan={plan}')
if not newToken: errors.append('newToken missing')
if errors:
    print('bad: ' + ', '.join(errors))
else:
    print('ok')
" 2>/dev/null || echo "parse_error")

  if [ "$CHECK" = "ok" ]; then
    pass "Stale JWT: plan=pro, newToken present"
  else
    fail "Stale JWT" "$CHECK"
  fi
else
  fail "Stale JWT" "expected 200, got $HTTP_CODE"
fi

# Revert free user back to free for remaining tests
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.prepare('UPDATE users SET plan = ? WHERE id = ?').run('free', '${FREE_ID}');
sdb.close();
"

# --- Test 3: 51st trace returns 403 with code=trace_limit + limit + upgradeUrl ---
echo "Test 3: 51st trace rate limit shape"

# Re-generate a fresh free JWT (previous one had stale plan)
FRESH_FREE_JWT=$(node --input-type=module -e "
import jwt from 'jsonwebtoken';
const secret = process.env.JWT_SECRET || 'neuraltrace-dev-secret';
const token = jwt.sign({ userId: '${FREE_ID}', email: '${TEST_FREE_EMAIL}', plan: 'free' }, secret, { expiresIn: '10m' });
process.stdout.write(token);
")

# Insert 50 traces
TRACE_FAIL=0
for i in $(seq 1 50); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/trace" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $FRESH_FREE_JWT" \
    -d "{\"content\":\"s04 test trace $i\",\"tags\":\"test\"}")
  if [ "$HTTP_CODE" != "201" ]; then
    TRACE_FAIL=1
    break
  fi
done

if [ "$TRACE_FAIL" = "1" ]; then
  fail "Trace limit shape" "Failed to insert 50 traces (stopped at $i with $HTTP_CODE)"
else
  # 51st should return 403 with full error shape
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/api/trace" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $FRESH_FREE_JWT" \
    -d '{"content":"trace 51 should fail","tags":"test"}')
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  CHECK=$(echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
errors = []
if d.get('code') != 'trace_limit': errors.append(f'code={d.get(\"code\")}')
if d.get('limit') != 50: errors.append(f'limit={d.get(\"limit\")}')
if 'upgradeUrl' not in d and 'upgrade_url' not in d: errors.append('upgradeUrl missing')
if errors:
    print('bad: ' + ', '.join(errors))
else:
    print('ok')
" 2>/dev/null || echo "parse_error")

  if [ "$HTTP_CODE" = "403" ] && [ "$CHECK" = "ok" ]; then
    pass "51st trace: 403 + code=trace_limit + limit=50 + upgradeUrl"
  else
    fail "Trace limit shape" "HTTP=$HTTP_CODE, $CHECK"
  fi
fi

# --- Test 4: 26th search returns 429 with code=search_limit + limit + upgradeUrl ---
echo "Test 4: 26th search rate limit shape"

# Reset search counter
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
    -H "Authorization: Bearer $FRESH_FREE_JWT")
  if [ "$HTTP_CODE" != "200" ]; then
    SEARCH_FAIL=1
    break
  fi
done

if [ "$SEARCH_FAIL" = "1" ]; then
  fail "Search limit shape" "Failed before 25 searches (stopped at $i with $HTTP_CODE)"
else
  # 26th should return 429 with full error shape
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "$BASE_URL/api/search?q=test" \
    -H "Authorization: Bearer $FRESH_FREE_JWT")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  CHECK=$(echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
errors = []
if d.get('code') != 'search_limit': errors.append(f'code={d.get(\"code\")}')
if d.get('limit') != 25: errors.append(f'limit={d.get(\"limit\")}')
if 'upgradeUrl' not in d and 'upgrade_url' not in d: errors.append('upgradeUrl missing')
if errors:
    print('bad: ' + ', '.join(errors))
else:
    print('ok')
" 2>/dev/null || echo "parse_error")

  if [ "$HTTP_CODE" = "429" ] && [ "$CHECK" = "ok" ]; then
    pass "26th search: 429 + code=search_limit + limit=25 + upgradeUrl"
  else
    fail "Search limit shape" "HTTP=$HTTP_CODE, $CHECK"
  fi
fi

# --- Test 5: After DB update to pro, status returns plan=pro + gemini model + newToken ---
echo "Test 5: Plan upgrade detection via status"

# Update free user to pro in DB
node --input-type=module -e "
import Database from 'better-sqlite3';
import path from 'node:path';
const sdb = new Database(path.join(process.cwd(), 'data', 'system.db'));
sdb.prepare('UPDATE users SET plan = ? WHERE id = ?').run('pro', '${FREE_ID}');
sdb.close();
"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "$BASE_URL/api/user/status" \
  -H "Authorization: Bearer $FRESH_FREE_JWT")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  CHECK=$(echo "$BODY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
plan = d.get('plan', '')
model = d.get('model', '')
newToken = d.get('newToken', '')
errors = []
if plan != 'pro': errors.append(f'plan={plan}')
if 'gemini' not in model.lower(): errors.append(f'model={model}')
if not newToken: errors.append('newToken missing')
if errors:
    print('bad: ' + ', '.join(errors))
else:
    print('ok')
" 2>/dev/null || echo "parse_error")

  if [ "$CHECK" = "ok" ]; then
    pass "Upgrade detection: plan=pro, model=gemini, newToken present"
  else
    fail "Upgrade detection" "$CHECK"
  fi
else
  fail "Upgrade detection" "expected 200, got $HTTP_CODE"
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
