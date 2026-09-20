#!/bin/zsh
# 第二轮取证：针对「工具输出里出现的具体提交 SHA」回 GitHub 逐条复核。
set -u
EV=/Users/odycai/WorkBuddy/BAYTECH26黑客松/outputs/evidence-verification
RAW=$EV/raw
LOG=$RAW/manifest.tsv
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

# 工具声称 oa-system 存在「整仓回滚」到 acd42d0，落点提交为 109fd2c
fetch E8  "https://api.github.com/repos/ody-cai/oa-system/commits/109fd2c"  oa-commit-109fd2c.json
# 工具声称 oa-system 复核未通过的一条：布局文件 1fbd843 → bc4e63c
fetch E9  "https://api.github.com/repos/ody-cai/oa-system/commits/bc4e63c"  oa-commit-bc4e63c.json
# 工具声称 chalk 复核未通过的第二条：test/chalk.js ff549c5 → 8a94e0e
fetch E10 "https://api.github.com/repos/chalk/chalk/commits/8a94e0e"        chalk-commit-8a94e0e.json
fetch E11 "https://api.github.com/repos/chalk/chalk/commits/ff549c5"        chalk-commit-ff549c5.json

echo "--- tail manifest ---"
tail -4 "$LOG"
