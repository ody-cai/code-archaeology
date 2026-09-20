#!/usr/bin/env python
# 按 CSS 像素坐标裁剪 2x 截图，输出幻灯片可用的配图。
# 用法：python crop.py <src> <y0> <y1> <out> [x0] [x1] [targetW]
import sys
from PIL import Image

src, y0, y1, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
x0 = int(sys.argv[5]) if len(sys.argv) > 5 else 0
x1 = int(sys.argv[6]) if len(sys.argv) > 6 else 1440
targetW = int(sys.argv[7]) if len(sys.argv) > 7 else 0

S = 2
im = Image.open(src)
box = (x0 * S, y0 * S, x1 * S, y1 * S)
im = im.crop(box)
if targetW:
    h = round(im.height * targetW / im.width)
    im = im.resize((targetW, h), Image.LANCZOS)
im.save(out)
print(f"{out}  {im.width}x{im.height}")
