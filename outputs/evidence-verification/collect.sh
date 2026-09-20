#!/bin/zsh
# 只读采集 GitHub REST 原始响应，逐条记录 HTTP 状态码 / 响应 SHA-256 / 字节数 / 时间戳。
# TOKEN 由调用方通过环境变量注入，不落盘。
set -u
EV=/Users/odycai/WorkBuddy/BAYTECH26黑客松/outputs/evidence-verification
RAW=$EV/raw
LOG=$RAW/manifest.tsv
: > "$LOG"
printf "id\tmethod\turl\thttp_status\tbytes\tsha256\tutc_time\tsaved_as\n" >> "$LOG"

TOKEN="$GITHUB_TOKEN"

fetch () {
  local id="$1" url="$2" out="$RAW/$3"
  local hdr="$RAW/${3%.json}.headers.txt"
  local code utc n hash
  code=$(curl -sS -D "$hdr" -o "$out" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -w "%{http_code}" "$url")
  utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  n=$(wc -c < "$out" | tr -d ' ')
  hash=$(shasum -a 256 "$out" | awk '{print $1}')
  printf "%s\tGET\t%s\t%s\t%s\t%s\t%s\t%s\n" "$id" "$url" "$code" "$n" "$hash" "$utc" "$3" >> "$LOG"
  echo "[$id] status=$code bytes=$n sha256=${hash:0:16}… -> $3"
}

fetch E1 "https://api.github.com/repos/chalk/chalk"                                chalk-repo.json
fetch E2 "https://api.github.com/repos/chalk/chalk/commits/5729845"                chalk-commit-5729845.json
fetch E3 "https://api.github.com/repos/chalk/chalk/commits/4c304dd"                chalk-commit-4c304dd.json
fetch E4 "https://api.github.com/repos/chalk/chalk/contents/source/index.js?ref=main" chalk-index-js.json
fetch E5 "https://api.github.com/repos/ody-cai/oa-system"                          oa-repo.json
fetch E6 "https://api.github.com/repos/ody-cai/oa-system/commits?per_page=100"      oa-commits.json
fetch E7 "https://api.github.com/rate_limit"                                       rate-limit.json

echo "--- manifest ---"
cat "$LOG"
