#!/bin/bash
# ダブルクリックで救急想定訓練シミュレータを起動します(Mac用)
cd "$(dirname "$0")"
PORT=8765
if command -v python3 >/dev/null 2>&1; then
  (sleep 1; open "http://localhost:$PORT/index.html") &
  echo "起動中: http://localhost:$PORT/index.html  (終了するにはこのウインドウを閉じる)"
  python3 -m http.server $PORT
else
  # python3 が無い場合は、ファイルを直接ブラウザで開く(これでも動作します)
  open index.html
fi
