#!/bin/zsh
# 第三轮：把工具输出中出现的每一个短 SHA 逐个回 GitHub 校验存在性。
# 判定规则：HTTP 200 且返回的完整 SHA 以该短串开头 => 接地(grounded)；否则 => 编造(hallucinated)。
set -u
EV=/Users/odycai/WorkBuddy/BAYTECH26黑客松/outputs/evidence-verification
RAW=$EV/raw/probe
mkdir -p "$RAW"
RES=$EV/sha-probe.tsv
printf "repo\tshort_sha\thttp\tfull_sha\tprefix_match\tverdict\n" > "$RES"
TOKEN="$GITHUB_TOKEN"

probe () {
  local repo="$1" short="$2"
  local out="$RAW/${repo%%/*}-${short}.json"
  local code full match verdict
  code=$(curl -sS -o "$out" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -w "%{http_code}" "https://api.github.com/repos/${repo}/commits/${short}")
  full=$(/Users/odycai/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -c "
import json,sys
try:
    print(json.load(open('$out',encoding='utf-8')).get('sha',''))
except Exception:
    print('')
")
  if [ "$code" = "200" ] && [ "${full:0:${#short}}" = "$short" ]; then
    match="yes"; verdict="GROUNDED"
  else
    match="no"; verdict="UNRESOLVED"
  fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$repo" "$short" "$code" "$full" "$match" "$verdict" >> "$RES"
  printf "%-18s %s  http=%s  prefix=%s  %s\n" "$repo" "$short" "$code" "$match" "$verdict"
}

echo "=== chalk/chalk ==="
for s in 4c304dd 5729845 ff549c5 8a94e0e; do probe chalk/chalk "$s"; done
echo "=== ody-cai/oa-system ==="
for s in 1fbd843 bc4e63c 62d1b8d 109fd2c d8ca09f 8e09128; do probe ody-cai/oa-system "$s"; done

echo "--- summary ---"
awk 'NR>1{c[$6]++} END{for(k in c) printf "%s = %d\n", k, c[k]}' "$RES"
