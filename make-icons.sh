#!/usr/bin/env bash
# 重新生成 FEST7 月结助手 / 月结后台 的 PWA 图标（v2 · F7 斜体字标）。
#
# 生成器位于 ../icon-src/：
#   gen_icons.py     用 Inter（wght 900）把「F7」转成路径，输出 SVG（不依赖字体）
#   render_icons.js  用 Chrome（Playwright）栅格化为透明圆角 PNG
#
# 输出（web-flat/）：
#   员工端  icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png  favicon-32.png  favicon.svg
#   后台    admin-icon-192.png  admin-icon-512.png  admin-icon-maskable-512.png  admin-apple-touch-icon.png
#           admin-favicon-32.png  admin-favicon.svg
#
# 依赖：python3 + fontTools；node + playwright；Google Chrome。
#   INTER_TTF=<Inter 可变字体路径>  NODE_PATH=<含 playwright 的 node_modules>  CHROME=<chrome 路径>
# 改完图标后记得把 sw.js 的 CACHE_VER 与 HTML 里的 ?v= 一起升级。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../icon-src"
if [[ ! -f "$SRC/gen_icons.py" ]]; then
  echo "找不到 $SRC/gen_icons.py（图标生成器不随网站部署，请在工作目录中运行）" >&2
  exit 1
fi
python3 "$SRC/gen_icons.py"
node "$SRC/render_icons.js"
echo "完成。"
