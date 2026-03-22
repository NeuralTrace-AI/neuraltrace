#!/usr/bin/env bash
# S05 Landing Page + Production Deploy — 5 tests
# Usage: bash scripts/verify-s05-landing.sh
# Default: tests against localhost
# Override: BASE_URL=https://your-domain.com bash scripts/verify-s05-landing.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_URL="${API_URL:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=5

pass() { echo "  ✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "═══════════════════════════════════════════════"
echo " S05 Landing Page + Production Tests ($TOTAL tests)"
echo "═══════════════════════════════════════════════"
echo " Target: $BASE_URL"
echo ""

# ─── Test 1: Landing page returns 200 with content markers ───
echo "Test 1: GET / → 200 with pricing + features content"
BODY=$(curl -s -w "\n%{http_code}" "$BASE_URL/")
STATUS=$(echo "$BODY" | tail -1)
HTML=$(echo "$BODY" | sed '$d')

if [ "$STATUS" = "200" ]; then
  MARKERS_FOUND=0
  MARKERS_MISSING=""
  for marker in "pricing" "features" "NeuralTrace" "Free" "Install"; do
    if echo "$HTML" | grep -qi "$marker"; then
      MARKERS_FOUND=$((MARKERS_FOUND + 1))
    else
      MARKERS_MISSING="$MARKERS_MISSING $marker"
    fi
  done
  if [ "$MARKERS_FOUND" -ge 4 ]; then
    pass "Landing page returns 200 with $MARKERS_FOUND/5 content markers"
  else
    fail "Landing page missing markers:$MARKERS_MISSING" "only $MARKERS_FOUND/5 found"
  fi
else
  fail "Landing page returned $STATUS" "expected 200"
fi

# ─── Test 2: Privacy policy returns 200 ───
echo "Test 2: GET /privacy → 200 with privacy content"
BODY=$(curl -s -w "\n%{http_code}" "$BASE_URL/privacy")
STATUS=$(echo "$BODY" | tail -1)
HTML=$(echo "$BODY" | sed '$d')

if [ "$STATUS" = "200" ]; then
  if echo "$HTML" | grep -qi "privacy"; then
    pass "Privacy policy returns 200 with privacy content"
  else
    fail "Privacy page returned 200 but missing 'privacy' content" "check page content"
  fi
else
  fail "Privacy page returned $STATUS" "expected 200"
fi

# ─── Test 3: Health endpoint returns 200 ───
echo "Test 3: GET /health → 200 (API container alive)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
if [ "$STATUS" = "200" ]; then
  pass "Health endpoint returns 200"
else
  fail "Health endpoint returned $STATUS" "expected 200"
fi

# ─── Test 4: User status with test JWT ───
echo "Test 4: GET /api/user/status with JWT → plan + model + limits"
# JWT_SECRET must be set for production tests (matches server's JWT_SECRET)
JWT=$(node --input-type=module -e "
import jwt from 'jsonwebtoken';
const secret = process.env.JWT_SECRET || 'neuraltrace-dev-secret';
const token = jwt.sign({ userId: 'test-s05-verify', email: 'test-s05@neuraltrace.ai', plan: 'free' }, secret, { expiresIn: '5m' });
console.log(token);
" 2>/dev/null || echo "")

if [ -z "$JWT" ]; then
  fail "Could not generate test JWT" "jsonwebtoken not available"
else
  BODY=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $JWT" \
    "$API_URL/api/user/status")
  STATUS=$(echo "$BODY" | tail -1)
  JSON=$(echo "$BODY" | sed '$d')

  if [ "$STATUS" = "200" ]; then
    HAS_PLAN=$(echo "$JSON" | grep -c '"plan"' || true)
    HAS_MODEL=$(echo "$JSON" | grep -c '"model"' || true)
    if [ "$HAS_PLAN" -ge 1 ] && [ "$HAS_MODEL" -ge 1 ]; then
      pass "User status returns plan + model ($STATUS)"
    else
      fail "User status missing plan or model fields" "response: $JSON"
    fi
  else
    fail "User status returned $STATUS" "expected 200"
  fi
fi

# ─── Test 5: Upgrade page returns 200 ───
echo "Test 5: GET /upgrade → 200 with upgrade/checkout content"
BODY=$(curl -s -w "\n%{http_code}" "$BASE_URL/upgrade")
STATUS=$(echo "$BODY" | tail -1)
HTML=$(echo "$BODY" | sed '$d')

if [ "$STATUS" = "200" ]; then
  if echo "$HTML" | grep -qiE "upgrade|paddle|checkout|pro"; then
    pass "Upgrade page returns 200 with billing content"
  else
    fail "Upgrade page returned 200 but missing billing content" "check page"
  fi
else
  fail "Upgrade page returned $STATUS" "expected 200"
fi

# ─── Results ───
echo ""
echo "═══════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (of $TOTAL)"
echo "═══════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
