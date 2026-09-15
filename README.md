# TikTok Shop Analytics (Chaonang)

เว็บวิเคราะห์ข้อมูลร้าน TikTok Shop — ดึง **ข้อมูลจริง** จาก TikTok Seller Center (seller-th.tiktok.com) และ Affiliate Center (affiliate.tiktok.com) ผ่าน session cookie ของบัญชีที่ล็อกอิน ไม่ต้องใช้ Partner API / ไม่มีข้อมูลจำลอง ถ้าดึงไม่ได้จะแสดง error ของ TikTok พร้อม endpoint

Node 18+ ไม่มี dependency

## หน้าในแอป
| แท็บ | ข้อมูล |
|---|---|
| แดชบอร์ด | real-time รายชั่วโมงวันนี้ · ภาพรวม (GMV, คำสั่งซื้อ, ลูกค้า, ผู้เข้าชม, conversion, GMV ตามช่องทาง) · สินค้าขายดี |
| LIVE | ยอดขาย/วิว/GPM รายวัน, รายการไลฟ์, ช่องทางเข้าชม |
| วิดีโอ | GMV จากวิดีโอ, รายการวิดีโอ, บัญชีที่ทำยอด, ช่องทางเข้าชม |
| สินค้า | ประสิทธิภาพสินค้าทุกตัว (แบ่งหน้า) + การ์ดสินค้า (กรวยวิว→คลิก→ตะกร้า→ซื้อ) |
| การตลาด & GMV Max | โปรโมชั่นรวม/แยกเครื่องมือ/รายโปรโมชั่น, โฆษณา GMV Max (ค่าโฆษณา, ROAS, **CIR**), แคมเปญแพลตฟอร์ม |
| แอฟฟิลิเอต | GMV/คอมมิชชั่น, ประเภทการร่วมงาน, ครีเอเตอร์, คำสั่งซื้อแอฟฟิลิเอต (ต้องวาง cookie ของ affiliate.tiktok.com) |
| คำสั่งซื้อ | รายการคำสั่งซื้อกรองตามช่วงวันที่ + สถานะ |
| รายงาน | สรุปกราฟทุกหมวด + ตาราง · พิมพ์ PDF · CSV รายวัน |
| เชื่อมต่อ | วาง cookie 2 ชุด (ตรวจ shop_id อัตโนมัติ) |

ทุกหน้าเลือกช่วงวันที่ได้เอง (สูงสุด 92 วัน) และเลือกช่วงเปรียบเทียบ (อัตโนมัติ = ช่วงก่อนหน้าที่ยาวเท่ากัน / กำหนดเอง) — TikTok รองรับช่วงวันที่กำหนดเองโดยตรง

## รันในเครื่อง
```bash
node src/server.js          # เปิด http://127.0.0.1:3200
```
แล้วไปแท็บ **เชื่อมต่อ** วาง cookie (ดูวิธีในหน้านั้น) — cookie เก็บที่ `data/session.json` (ไม่ขึ้น git)

## เปิดให้ทีมใช้ (Render free)
ตั้ง env: `APP_PASSWORD` (บังคับ — เปิดหน้าล็อกอิน), `APP_USER` (default admin), `APP_SECRET`, และถ้าไม่อยากวาง cookie ใหม่ทุกครั้งที่รีสตาร์ต: `TIKTOK_COOKIE`, `TIKTOK_AFFILIATE_COOKIE`, `TIKTOK_SHOP_ID` — ดู `render.yaml`

## โครงสร้าง
```
src/server.js      HTTP server + static + POST /api {action,...} + ล็อกอินทีม + data/errors.log
src/tiktok.js      ดึงข้อมูล TikTok ทุก action (cache 45 วิ) · withCompare() คืน {current, compare, diff}
public/            SPA: index.html, app.js, charts.js (SVG), app.css
docs/tiktok-endpoints.md   endpoint ที่ตรวจกับร้านจริง + รูปแบบ request/response
```

## หมายเหตุข้อมูล
- ภาพรวม/สินค้า: ข้อมูลออฟไลน์ของ TikTok พร้อมประมาณ T-2 วัน (แสดง "พร้อมถึงวันที่" ในหน้า) · วันนี้ใช้ real-time รายชั่วโมง
- ค่าโฆษณา GMV Max เป็นบาท · CIR = ค่าโฆษณา ÷ ยอดขายจากโฆษณา
- session หมดอายุ → ทุกหน้าจะขึ้น error พร้อมลิงก์ไปหน้าเชื่อมต่อ
