#!/bin/zsh
# 实测工程自检数据，产出 final/selftest.json —— PPT 里所有工程类数字的唯一来源。
set -e
NODE=/Users/odycai/.workbuddy/binaries/node/versions/22.22.2-3/bin/node
ROOT=/Users/odycai/WorkBuddy/BAYTECH26黑客松/code-archaeology
OUT=/Users/odycai/WorkBuddy/BAYTECH26黑客松/outputs/judge-evidence/final/selftest.json
cd "$ROOT"

# ── 1. 单元测试 ──
TESTRAW=$(node --test tests/*.test.mjs 2>&1)
TESTS=$(echo "$TESTRAW" | sed -n 's/^# tests \([0-9]*\)$/\1/p' | tail -1)
PASS=$(echo "$TESTRAW"  | sed -n 's/^# pass \([0-9]*\)$/\1/p'  | tail -1)
FAIL=$(echo "$TESTRAW"  | sed -n 's/^# fail \([0-9]*\)$/\1/p'  | tail -1)
TDUR=$(echo "$TESTRAW"  | sed -n 's/^# duration_ms \([0-9.]*\)$/\1/p' | tail -1)

# ── 2. 代码规模 ──
lines_of() { find $@ -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.html' -o -name '*.css' \) -exec cat {} + 2>/dev/null | wc -l | tr -d ' '; }
files_of() { find $@ -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.html' -o -name '*.css' \) 2>/dev/null | wc -l | tr -d ' '; }
S=$( (lines_of src) ); P=$(lines_of public); T=$(lines_of tests); B=$(lines_of bin); C=$(lines_of scripts)
SF=$(files_of src); PF=$(files_of public); TF=$(files_of tests); BF=$(files_of bin); CF=$(files_of scripts)

# ── 3. API 端点 ──
EP=$(node bin/ca.mjs capabilities 2>/dev/null | grep -cE '^  (GET|POST) ')

cat > "$OUT" <<JSON
{
  "tests": { "total": $TESTS, "pass": $PASS, "fail": $FAIL, "durationMs": $TDUR },
  "code": {
    "srcLines": $S, "srcFiles": $SF,
    "publicLines": $P, "publicFiles": $PF,
    "testsLines": $T, "testsFiles": $TF,
    "binLines": $B, "binFiles": $BF,
    "scriptsLines": $C, "scriptsFiles": $CF,
    "totalLines": $((S+P+T+B+C)),
    "totalFiles": $((SF+PF+TF+BF+CF))
  },
  "apiEndpoints": $EP,
  "measuredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "已写出 $OUT"
cat "$OUT"
