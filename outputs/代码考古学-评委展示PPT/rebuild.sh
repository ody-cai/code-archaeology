#!/bin/zsh
# 重建全部幻灯片 → 写入 PPTX → 逐页 lint。用法：zsh rebuild.sh [build 脚本...]
set -e
export PATH="/Users/odycai/.workbuddy/binaries/node/versions/22.22.2-3/bin:$PATH"
cd "$(dirname "$0")"

BUILDS=("$@")
if [ ${#BUILDS[@]} -eq 0 ]; then BUILDS=(build-p1.mjs build-p2.mjs); fi
for b in $BUILDS; do [ -f "$b" ] && node "$b"; done

rm -f 代码考古学-评委展示PPT.pptx
slidep create 代码考古学-评委展示PPT.pptx > /dev/null

FILES=(slides/*.slide)
for f in $FILES; do
  R=$(slidep upsert-dsl 代码考古学-评委展示PPT.pptx --dsl-file "$f" 2>&1 | tail -1)
  case "$R" in
    *'"ok":true'*) echo "✓ $(basename $f)" ;;
    *) echo "✗ $(basename $f)"; echo "$R" | head -20 ;;
  esac
done

echo "──────── lint ────────"
i=0
for f in $FILES; do
  D=$(slidep lint 代码考古学-评委展示PPT.pptx --dsl-file "$f" --page-index $i 2>&1 | grep '"ok"' | tail -1)
  N=$(echo "$D" | grep -o 'ruleId' | wc -l | tr -d ' ')
  if [ "$N" = "0" ]; then echo "✓ $((i+1)) $(basename $f)  clean"; else echo "✗ $((i+1)) $(basename $f)  $N diagnostics"; fi
  echo "$D" | grep -o '"message":"[^"]*"' | head -6
  i=$((i+1))
done
