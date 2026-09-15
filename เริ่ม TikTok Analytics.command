#!/bin/bash
# ดับเบิลคลิกเพื่อรัน TikTok Shop Analytics แล้วเปิดเบราว์เซอร์
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "ไม่พบ Node.js — ติดตั้งจาก https://nodejs.org (เวอร์ชัน 18 ขึ้นไป) แล้วลองใหม่"; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิด"; exit 1
fi
export PORT="${PORT:-3200}"
(sleep 1.5; open "http://127.0.0.1:$PORT") &
echo "กำลังรัน TikTok Shop Analytics ที่ http://127.0.0.1:$PORT  (ปิดหน้าต่างนี้เพื่อหยุด)"
node src/server.js
