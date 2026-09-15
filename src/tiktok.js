// src/tiktok.js — ดึงข้อมูลจริงจาก TikTok Seller Center (TH) + Affiliate Center ผ่าน session cookie
// กฎ: ไม่มีข้อมูลจำลอง ทุก error ส่งกลับตรง ๆ พร้อม endpoint ที่ล้มเหลว
// endpoint ทั้งหมดตรวจกับร้านจริงเมื่อ 15 ก.ย. 2569 — ดู docs/tiktok-endpoints.md
"use strict";
const fs = require("fs");
const path = require("path");

const SELLER = process.env.TIKTOK_SELLER_BASE || "https://seller-th.tiktok.com";
const AFFILIATE = process.env.TIKTOK_AFFILIATE_BASE || "https://affiliate.tiktok.com";
const METRIC = process.env.TIKTOK_METRIC_BASE || "https://tts-metric-center.tiktokshop.com";
const TZ = 7 * 3600; // Asia/Bangkok
const TZ_OFFSET = 25200;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_DAYS = 92;
const DATA_DIR = path.join(__dirname, "..", "data");
const SESSION_FILE = path.join(DATA_DIR, "session.json");

class TikTokError extends Error {
  constructor(msg, endpoint, status = 0, code = null, expired = false) {
    super(msg);
    this.endpoint = endpoint; this.status = status; this.code = code; this.session_expired = expired;
  }
}

// ---------- วันที่ (เวลาไทย) ----------
function ymdToUnix(ymd) { const [y, m, d] = String(ymd).split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 1000) - TZ; }
function unixToYmd(ts) { return new Date((ts + TZ) * 1000).toISOString().slice(0, 10); }
function todayYmd() { return unixToYmd(Math.floor(Date.now() / 1000)); }
function addDays(ymd, n) { return unixToYmd(ymdToUnix(ymd) + n * 86400); }
function dayList(start, end) {
  const s = ymdToUnix(start), e = ymdToUnix(end);
  if (isNaN(s) || isNaN(e) || e < s) throw new Error("ช่วงวันที่ไม่ถูกต้อง: " + start + " ถึง " + end);
  const out = []; for (let t = s; t <= e; t += 86400) out.push(unixToYmd(t));
  if (out.length > MAX_DAYS) throw new Error(`ช่วงวันที่ยาวเกิน ${MAX_DAYS} วัน`);
  return out;
}
const nowBkk = () => new Date(Date.now() + TZ * 1000).toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss" เวลาไทย

// ---------- session ----------
function loadSession() {
  try { const j = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); if (j.affiliate_cookie_used === "seller") AFFILIATE_COOKIE_PREF = "seller"; return j; } catch { /* no file */ }
  if (process.env.TIKTOK_COOKIE) {
    return { seller_cookie: process.env.TIKTOK_COOKIE.trim(), affiliate_cookie: (process.env.TIKTOK_AFFILIATE_COOKIE || "").trim(), shop_id: process.env.TIKTOK_SHOP_ID || "", shop_name: process.env.TIKTOK_SHOP_NAME || "(จาก TIKTOK_COOKIE)", saved_at: "env", from_env: true };
  }
  return null;
}
function saveSession(obj) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SESSION_FILE, JSON.stringify(obj, null, 2)); }
function clearSession() { try { fs.unlinkSync(SESSION_FILE); } catch { /* none */ } cache.clear(); }
function requireConn() {
  const c = loadSession();
  if (!c || !c.seller_cookie) throw new TikTokError("ยังไม่ได้เชื่อมต่อ TikTok — วาง cookie ในหน้าเชื่อมต่อก่อน", "-", 0, null, true);
  if (!c.shop_id) throw new TikTokError("ไม่ทราบ shop_id — บันทึก cookie ใหม่ในหน้าเชื่อมต่อ", "-", 0, null, true);
  return c;
}
function markOk() { const c = loadSession(); if (c && !c.from_env) { c.last_ok_at = new Date().toISOString(); c.last_error = ""; saveSession(c); } }
function markErr(e) { const c = loadSession(); if (c && !c.from_env) { c.last_error = String(e && e.message || e); saveSession(c); } }
const cleanCookie = (s) => String(s || "").replace(/^cookie:\s*/i, "").replace(/\s*\n+\s*/g, " ").trim();

// ---------- HTTP ----------
const cache = new Map();
// cookie ชุดไหนที่ affiliate.tiktok.com ยอมรับ: "affiliate" (ชุดที่วางไว้) หรือ "seller" — สลับอัตโนมัติเมื่อเจอ code 10000
let AFFILIATE_COOKIE_PREF = "affiliate";
// host: "seller" | "affiliate" | "metric"
async function tk(conn, host, p, opt = {}) {
  const base = host === "affiliate" ? AFFILIATE : host === "metric" ? METRIC : SELLER;
  const q = new URLSearchParams();
  if (host === "seller") { q.set("locale", "th-TH"); q.set("language", "th-TH"); q.set("oec_seller_id", conn.shop_id); q.set("seller_id", conn.shop_id); q.set("aid", "4068"); q.set("app_name", "i18n_ecom_shop"); q.set("use_content_type_definition", "1"); }
  if (host === "affiliate") { q.set("locale", "th-TH"); q.set("language", "th-TH"); q.set("shop_region", "TH"); q.set("shop_id", conn.shop_id); q.set("device_id", "0"); }
  for (const [k, v] of Object.entries(opt.query || {})) if (v !== undefined && v !== null) q.set(k, String(v));
  const url = base + p + (q.toString() ? (p.includes("?") ? "&" : "?") + q.toString() : "");
  const method = opt.method || (opt.body !== undefined ? "POST" : "GET");
  const bodyStr = opt.body !== undefined ? JSON.stringify(opt.body) : undefined;
  const key = method + " " + url + " " + (bodyStr || "");
  const ttl = opt.ttl ?? 45000;
  const c = cache.get(key);
  if (c && Date.now() - c.t < ttl) return c.v;
  // affiliate.tiktok.com รับ cookie ของ seller-th.tiktok.com ได้ (โดเมน .tiktok.com เดียวกัน)
  // ตรวจกับร้านจริง 15 ก.ย. 2569: cookie ชุด affiliate ที่คัดลอกมาอาจหมดอายุ → code 10000, ส่วน seller cookie ผ่าน
  const affCookies = host === "affiliate"
    ? (AFFILIATE_COOKIE_PREF === "seller" ? [conn.seller_cookie, conn.affiliate_cookie] : [conn.affiliate_cookie, conn.seller_cookie]).filter(Boolean)
    : [];
  const cookie = host === "affiliate" ? affCookies[0] : host === "metric" ? "" : conn.seller_cookie;
  if (host === "affiliate" && !cookie) throw new TikTokError("ยังไม่ได้เชื่อมต่อ TikTok — วาง cookie ในหน้าเชื่อมต่อก่อน", p, 0, null, true);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), "user-agent": UA, accept: "application/json, text/plain, */*", referer: base + "/", origin: base, ...(bodyStr !== undefined ? { "content-type": "application/json" } : {}) },
      body: bodyStr, redirect: "manual",
    });
  } catch (e) { throw new TikTokError("เชื่อมต่อ TikTok ไม่ได้: " + (e && e.message || e), p, 0); }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (res.status === 302 || res.status === 401 || res.status === 403 || (json === null && /login|<html/i.test(text))) {
    throw new TikTokError(`session TikTok (${host}) หมดอายุหรือไม่ได้ล็อกอิน (HTTP ${res.status})`, p, res.status, null, true);
  }
  if (json === null) throw new TikTokError(`TikTok ตอบกลับไม่ใช่ JSON (HTTP ${res.status}): ${text.slice(0, 120)}`, p, res.status);
  const code = json.code ?? json.status_code ?? 0;
  const msg = json.message ?? json.msg ?? json.status_msg ?? "";
  if (code !== 0) {
    // cookie ของ affiliate ใช้ไม่ได้ (10000 / 98001002) → สลับไปใช้ cookie อีกชุดแล้วยิงซ้ำครั้งเดียว
    if (host === "affiliate" && affCookies.length > 1 && !opt._retried && (code === 10000 || code === 98001002)) {
      AFFILIATE_COOKIE_PREF = AFFILIATE_COOKIE_PREF === "seller" ? "affiliate" : "seller";
      cache.delete(key);
      return tk(conn, host, p, { ...opt, _retried: true });
    }
    const expired = /login|logged|session|auth|permission|unauthor/i.test(String(msg)) || code === 401 || code === 403 || code === 10008 || code === 98001002;
    throw new TikTokError(`TikTok API error code=${code}: ${msg}`, p, res.status, code, expired);
  }
  cache.set(key, { t: Date.now(), v: json });
  return json;
}

// ---------- ตัวช่วย ----------
const num = (v) => { if (v === null || v === undefined || v === "") return null; if (typeof v === "object") { if ("amount" in v) return Number(v.amount); if ("value" in v) return Number(v.value); return null; } const n = Number(v); return isNaN(n) ? null : n; };
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const div = (a, b) => (b ? a / b : null);
const pct = (cur, prev) => (cur === null || cur === undefined || prev === null || prev === undefined || !prev ? null : (cur - prev) / Math.abs(prev));
// scenario 1 รองรับช่วงวันที่กำหนดเองทุกความยาว (scenario 4 รับเฉพาะ 7/28 วัน → 98001004 invalid params)
const td = (start, end, extra = {}) => ({ start, end, timezone_offset: TZ_OFFSET, scenario: 1, granularity: "ALL", with_previous_period: false, ...extra });
// พารามิเตอร์ time_descriptor ของกลุ่ม insights: end = วันสุดท้าย + 1 (exclusive) ตามที่ UI ส่ง (start 09-07, end 09-14 = 7 วัน)
const tdRange = (start, end, extra = {}) => td(start, addDays(end, 1), extra);
const normalizeError = (e) => ({ error: e && e.message ? e.message : String(e), endpoint: e && e.endpoint, code: e && e.code });
const soft = (p) => p.catch((e) => normalizeError(e));

// ---------- วันที่มีข้อมูล ----------
async function availableDate(conn, moduleName) {
  const r = await tk(conn, "seller", "/api/v2/insights/seller/shop/data/available/date", { body: { request: { module_names: [moduleName], timezone_offset: TZ_OFFSET } }, ttl: 600000 });
  const m = r.data && r.data.module_name_to_available_date_map && r.data.module_name_to_available_date_map[moduleName];
  return m ? m.available_date : null;
}

// ---------- ชื่อ metric (endpoint สาธารณะ) ----------
const METRIC_NAME_CACHE = {};
async function metricNames(ids) {
  const need = ids.filter((i) => !METRIC_NAME_CACHE[i]);
  if (need.length) {
    try {
      const r = await tk({}, "metric", "/api/v2/data_infra/metric_query/version_management/query_translated_snapshot", { body: { metric_id: need, starling_space_configs: [{ starling_project: "gec_metric_center", starling_namespace: "metric_center" }, { starling_project: "i18n_ecom_shop", starling_namespace: "fe" }], lang: "th-TH" }, ttl: 86400000 });
      for (const [k, v] of Object.entries((r.data && r.data.data) || {})) METRIC_NAME_CACHE[k] = (v.metric_name && v.metric_name.translation) || (v.metric_full_name && v.metric_full_name.translation) || String(k);
    } catch { /* ใช้ชื่อสำรอง */ }
  }
  const out = {}; for (const i of ids) out[i] = METRIC_NAME_CACHE[i] || FALLBACK_NAMES[i] || String(i); return out;
}
// ชื่อสำรองที่ตรวจจาก query_translated_snapshot (15 ก.ย. 2569)
const FALLBACK_NAMES = { 4024: "GMV", 4031: "คำสั่งซื้อ", 4022: "ลูกค้า", 4027: "สินค้าที่ขายได้", 4035: "คำสั่งซื้อ SKU", 4034: "การคืนเงิน", 8024: "AOV (คำสั่งซื้อ SKU)", 6070: "ผู้เข้าชม", 6068: "ยอดการดูหน้าเว็บ", 6072: "อัตราคอนเวอร์ชั่น", 8020: "ยอดการแสดงผลสินค้า", 8019: "ยอดคลิกสินค้า", 4029: "GMV ที่มาจาก LIVE", 4037: "GMV ที่มาจากวิดีโอ", 4033: "GMV จากการ์ดสินค้า", 7821: "GMV จากครีเอเตอร์", 7822: "GMV ที่มาจากผู้ขาย", 6019: "รายได้รวม", 4211: "GMV", 4214: "คำสั่งซื้อ", 4219: "ลูกค้า", 4202: "สินค้าที่ขายได้", 4203: "GMV จาก LIVE", 4210: "GMV จากวิดีโอ", 4204: "GMV จากการ์ดสินค้า", 4205: "การคืนเงิน", 8016: "ยอดการแสดงผลสินค้า", 8018: "ยอดคลิกสินค้า", 4025: "GMV", 4032: "คำสั่งซื้อ", 4023: "ลูกค้า", 4028: "สินค้าที่ขายได้", 4030: "GMV จาก LIVE", 4038: "GMV จากวิดีโอ", 4111: "GMV จากการ์ดสินค้า", 8014: "ยอดการแสดงผลสินค้า", 8012: "ยอดคลิกสินค้า" };

// metric id: [id, metric_type, key]
const STATS_METRICS = [[4024, 201, "gmv"], [4031, 1, "orders"], [4022, 1, "customers"], [4027, 1, "items_sold"], [4035, 1, "sku_orders"], [4034, 201, "refunds"], [8024, 201, "aov"], [6070, 1, "visitors"], [6068, 1, "page_views"], [6072, 1, "conversion_rate"], [8020, 1, "impressions"], [8019, 1, "clicks"], [4029, 201, "gmv_live"], [4037, 201, "gmv_video"], [4033, 201, "gmv_card"], [7821, 201, "gmv_creators"], [7822, 201, "gmv_seller"], [6019, 201, "gross_revenue"]];
const DAY_METRICS = [[4211, 201, "gmv"], [4214, 1, "orders"], [4219, 1, "customers"], [4202, 1, "items_sold"], [4203, 201, "gmv_live"], [4210, 201, "gmv_video"], [4204, 201, "gmv_card"], [4205, 201, "refunds"], [8016, 1, "impressions"], [8018, 1, "clicks"]];
const HOUR_METRICS = [[4025, 201, "gmv"], [4032, 1, "orders"], [4023, 1, "customers"], [4028, 1, "items_sold"], [4030, 201, "gmv_live"], [4038, 201, "gmv_video"], [4111, 201, "gmv_card"], [8014, 1, "impressions"], [8012, 1, "clicks"]];
const rowValues = (row, defs) => { const out = {}; const v = (row && row.values) || {}; for (const [id, , key] of defs) { let x = v[String(id)]; if (typeof x === "string" && x.startsWith("{")) { try { x = JSON.parse(x); } catch { /* keep */ } } out[key] = num(x); } return out; };

async function unified(conn, module, start, end, defs, extra = {}) {
  const ready = await availableDate(conn, "US_SellerPC_Overview_MergeId_Offline_Part");
  const qc = { query_time: { start, end, timezone_offset: TZ_OFFSET, ...(extra.query_time || {}) }, date_completion: { enabled: true, granularity: extra.dc ?? 0 }, where_filter: ready ? { ready_time: { value_list: [ready] } } : {}, group_by: extra.group_by || [], metrics: defs.map(([id, t]) => ({ metric_id: id, metric_type: t })) };
  const r = await tk(conn, "seller", "/api/v2/insights/seller/unified/query/" + module, { body: { query_condition: [qc] } });
  return { data: (r.data && r.data[0]) || {}, ready };
}

// ---------- ภาพรวม ----------
async function overviewRange(conn, start, end) {
  const days = dayList(start, end);
  const [st, dt] = await Promise.all([
    unified(conn, "us_overview_stats", start, end, STATS_METRICS),
    unified(conn, "us_overview_day_trend", start, end, DAY_METRICS, { group_by: ["date"] }),
  ]);
  const totals = rowValues(((st.data.intervals || [])[0] || {}).rows && st.data.intervals[0].rows[0], STATS_METRICS);
  totals.aov_calc = div(totals.gmv, totals.orders);
  const byDate = new Map(); for (const it of dt.data.intervals || []) byDate.set(it.start_date, rowValues((it.rows || [])[0], DAY_METRICS));
  const daily = days.map((d) => ({ date: d, ...(byDate.get(d) || Object.fromEntries(DAY_METRICS.map(([, , k]) => [k, null]))) }));
  const names = await metricNames(STATS_METRICS.map((m) => m[0]));
  const sources = { live: totals.gmv_live, video: totals.gmv_video, card: totals.gmv_card };
  return { range: { start, end, days: days.length }, available_date: st.ready, totals, daily, sources, metric_names: Object.fromEntries(STATS_METRICS.map(([id, , k]) => [k, names[id]])) };
}

async function realtime(conn) {
  const today = todayYmd();
  const [av, hr, lives] = await Promise.all([
    tk(conn, "seller", "/api/v2/insights/seller/shop/us/overview/today/data/available", { body: { request: { today } }, ttl: 60000 }),
    unified(conn, "us_overview_hour_trend", today + " 00:00:00", nowBkk().replace("T", " "), HOUR_METRICS, { group_by: ["date", "hour"], dc: 2, query_time: { granularity: "hour" } }),
    soft(tk(conn, "seller", "/api/v2/insights/seller/shop/overview/performance/today/live/list", { body: { request: { params: [{ time_descriptor: { start: today, end: addDays(today, 1), with_previous_period: false, granularity: "1D", scenario: 2 }, stats_types: [1, 2, 3, 4] }] } }, ttl: 30000 })),
  ]);
  const hourly = (hr.data.intervals || []).map((it) => ({ hour: Number(((it.rows || [])[0] || { values: {} }).values.hour ?? it.start_date.slice(11, 13)), ...rowValues((it.rows || [])[0], HOUR_METRICS) }));
  const totals = {}; for (const [, , k] of HOUR_METRICS) totals[k] = sum(hourly.map((h) => h[k]));
  const liveList = lives && lives.data ? ((((lives.data.segments || [])[0] || {}).timed_list || [])[0] || {}).list || [] : [];
  return { today, available_hour: av.data && av.data.available_hour, has_data: av.data && av.data.has_data, hourly, totals, lives: liveList, lives_error: lives && lives.error, fetched_at: Math.floor(Date.now() / 1000) };
}

// ---------- LIVE ----------
const LIVE_STATS = [10, 11, 20, 21, 22, 23, 24, 30, 31, 25, 26];
async function liveRange(conn, start, end) {
  const days = dayList(start, end); const today = todayYmd();
  const includesToday = days.includes(today);
  const params = [
    { time_selector: { period: 10, granularity: 1 }, time_descriptor: tdRange(start, end, { granularity: "ALL", with_previous_period: false }), stats_types: LIVE_STATS, filter: { aggregated_creator_types: [10] } },
    { time_selector: { period: 10, granularity: 1 }, time_descriptor: tdRange(start, end, { granularity: "1D", with_previous_period: false }), stats_types: LIVE_STATS, filter: { aggregated_creator_types: [10] } },
  ];
  const [stats, list, traffic] = await Promise.all([
    tk(conn, "seller", "/api/v3/insights/seller/live/stats", { body: { request: { params } } }),
    soft(tk(conn, "seller", "/api/v4/insights/seller/live/list", { body: { request: { params: [{ list_control: { pagination: { size: 50, page: 0 }, rules: [{ direction: 2, field: "LIVE_LIST_REVENUE" }] }, filter: { creator_id: [], feature_type: 4 }, stats_types: [12, 20, 61, 86, 32, 81, 2, 3, 4, 5, 6, 10, 12, 13, 14, 7, 8, 120], time_selector: { period: 10, granularity: 1 }, time_descriptor: tdRange(start, end) }] } } })),
    soft(tk(conn, "seller", "/api/v3/insights/seller/shop/live/traffic/stats", { body: { request: { params: [{ filter: { creator_id: "" }, time_selector: { period: 31, granularity: 30, base_timestamp: ymdToUnix(end) + 86400, timezone_offset: TZ_OFFSET }, stats_types: [4, 10, 20, 24, 21, 22, 23] }] } } })),
  ]);
  const segs = (stats.data && stats.data.segments) || [];
  const conv = (s) => ({ revenue: num(s.revenue), gpm: num(s.show_gpm), sessions: num(s.sessions_cnt), sessions_with_revenue: num(s.sessions_with_revenue_cnt), items_sold: num(s.item_sold_cnt), orders: num(s.orders_cnt), buyers: num(s.buyer_cnt), views: num(s.view_cnt), avg_view_duration: num(s.avg_view_duration), ctr: num(s.ctr_rate), co_rate: num(s.c_o_rate) });
  const totalSeg = ((segs[0] || {}).timed_stats || []); const totals = conv(((totalSeg[totalSeg.length - 1] || {}).stats) || {});
  const daily = ((segs[1] || {}).timed_stats || []).map((t) => ({ date: unixToYmd(t.start_timestamp), ...conv(t.stats || {}) }));
  const sessions = list && list.data ? ((((list.data.segments || [])[0] || {}).timed_lists || [])[0] || {}).stats || [] : [];
  const total_sessions = list && list.data ? ((((list.data.segments || [])[0] || {}).list_control || {}).next_pagination || {}).total : null;
  const trafficNodes = traffic && traffic.data ? ((((((traffic.data.segments || [])[0] || {}).timed_stats || [])[0] || {}).stats_nodes) || []) : [];
  return { range: { start, end, days: days.length }, note: includesToday ? "ข้อมูล LIVE ของวันนี้เป็น real-time ตามที่ TikTok ให้" : undefined, totals, daily, sessions: sessions.map((s) => ({ live_id: s.live_id, name: s.live_name, creator: s.creator_handle, creator_alias: s.creator_alias, creator_type: s.creator_type, start_time: s.start_timestamp, end_time: s.end_timestamp, duration: s.duration, revenue: num(s.revenue), product_views: s.product_views_cnt, co_rate: num(s.co_rate), ctr: num(s.local_ctr_rate), views: s.local_views_cnt ?? s.local_viewers_cnt })), total_sessions, sessions_error: list && list.error, traffic: trafficNodes, traffic_error: traffic && traffic.error };
}

// ---------- วิดีโอ ----------
async function videoRange(conn, start, end) {
  const days = dayList(start, end);
  const params = [
    { time_descriptor: tdRange(start, end, { granularity: "ALL" }), stats_types: [51, 63, 64, 61, 60, 41, 40], aggregated_creator_types: [10] },
    { time_descriptor: tdRange(start, end, { granularity: "1D" }), stats_types: [51, 63, 64, 61, 60, 41, 40], aggregated_creator_types: [10] },
  ];
  const [stats, list, accounts, traffic] = await Promise.all([
    tk(conn, "seller", "/api/v1/insights/seller/shop/video/analytics/video/stats", { body: { request: { params } } }),
    soft(tk(conn, "seller", "/api/v2/insights/seller/shop/video/analytics/video/list", { body: { request: { params: [{ list_control: { rules: [{ direction: 2, field: "SHOP_VIDEO_ANALYTICS_VIDEO_LIST_REVENUE" }], pagination: { size: 50, page: 0 } }, filter: { creator_ids: [], author_type: [1, 2] }, time_descriptor: tdRange(start, end, { granularity: "ALL" }), stats_types: [80, 20, 2, 3, 203, 21, 8] }] } } })),
    soft(tk(conn, "seller", "/api/v2/insights/seller/shop/video/analytics/account/performance/list", { body: { request: { params: [{ time_descriptor: tdRange(start, end, { granularity: "ALL" }) }] } } })),
    soft(tk(conn, "seller", "/api/v2/insights/seller/shop/video/analytics/traffic/stats", { body: { request: { params: [{ time_descriptor: tdRange(start, end, { granularity: "ALL" }), stats_types: [2, 10, 20, 21, 22, 23] }] } } })),
  ]);
  const conv = (s) => ({ gmv: num(s.video_gmv), co_rate: num(s.video_product_co), ctr: num(s.video_ctr), product_clicks: num(s.video_product_clicks), product_shows: num(s.video_product_show_cnt), sku_orders: num(s.video_sku_order_cnt), buyers: num(s.video_buyers) });
  const segs = (stats.data && stats.data.segments) || [];
  const t0 = (segs[0] || {}).timed_stats || []; const totals = conv(((t0[t0.length - 1] || {}).stats) || {});
  const daily = ((segs[1] || {}).timed_stats || []).map((t) => ({ date: String(t.start).slice(0, 10), ...conv(t.stats || {}) }));
  const videos = list && list.data ? ((((list.data.segments || [])[0] || {}).timed_lists || [])[0] || {}).stats || [] : [];
  const total_videos = list && list.data ? ((((list.data.segments || [])[0] || {}).list_control || {}).next_pagination || {}).total : null;
  const accs = accounts && accounts.data ? ((((accounts.data.segments || [])[0] || {}).timed_lists || [])[0] || {}).stats || [] : [];
  const trafficNodes = traffic && traffic.data ? ((((((traffic.data.segments || [])[0] || {}).timed_stats || [])[0] || {}).stats_nodes) || []) : [];
  return { range: { start, end, days: days.length }, totals, daily, videos: videos.map((v) => ({ id: v.video_meta && v.video_meta.id, name: v.video_meta && v.video_meta.name, publish_time: v.video_meta && v.video_meta.publish_time, cover: v.video_meta && v.video_meta.cover_image && v.video_meta.cover_image.thumb_url_list && v.video_meta.cover_image.thumb_url_list[0], creator: v.creator_meta && v.creator_meta.handle, creator_type: v.creator_meta && v.creator_meta.type, views: v.view_cnt, likes: v.like_cnt, revenue: num(v.revenue), co_rate: num(v.co_rate) })), total_videos, videos_error: list && list.error, accounts: accs.map((a) => ({ creator: a.creator && a.creator.handle, alias: a.creator && a.creator.alias, type: a.creator && a.creator.type, is_commissioned: a.creator && a.creator.is_commissioned, gmv: num(a.gmv) })), accounts_error: accounts && accounts.error, traffic: trafficNodes, traffic_error: traffic && traffic.error };
}

// ---------- สินค้า ----------
async function productsRange(conn, start, end, page = 0, size = 50) {
  const r = await tk(conn, "seller", "/api/v3/insights/seller/ttp/product/list", { body: { request: { time_descriptor: { start, end: addDays(end, 1) }, search: { channel_type: 0 }, list_control: { pagination: { page, size }, rules: [{ field: "gmv", direction: 2 }] } } } });
  const items = (r.data && r.data.items) || [];
  const money = (o) => num(o);
  const products = items.map((it) => { const t = (it.stats_v3 && it.stats_v3.total) || {}; const p = (it.stats_v3 && it.stats_v3.total_prev) || {}; const row = (s) => ({ gmv: money(s.gmv), orders: num(s.orders), sku_orders: num(s.sku_orders), items_sold: num(s.items_sold), customers: num(s.customers), impressions: num(s.product_impression_pv), clicks: num(s.product_click_pv), ctr: num(s.product_ctr_pv), add_to_cart: num(s.add_to_cart_cnt_pv), co_rate: num(s.click_to_orders_rate_sku_uv), aov: money(s.aov_sku), refunds: money(s.refunds), refund_items: num(s.items_canceled_and_returned), gmv_live: money(s.self_live_gmv), gmv_video: money(s.self_video_gmv), gmv_affiliate: money(s.affiliate_gmv), gmv_card: money(s.product_card_gmv), gmv_shop_tab: money(s.shop_tab_gmv) }); return { product_id: it.meta && it.meta.product_id, name: it.meta && it.meta.product_name, image: it.meta && it.meta.product_image, status: it.meta && it.meta.product_status, ...row(t), prev: row(p) }; });
  const pg = (r.data && r.data.list_control && r.data.list_control.next_pagination) || {};
  const totals = {}; for (const k of ["gmv", "orders", "items_sold", "impressions", "clicks", "refunds"]) totals[k] = sum(products.map((x) => x[k]));
  return { range: { start, end }, page, size, total: pg.total ?? null, total_page: pg.total_page ?? null, products, totals_on_page: totals };
}

// ---------- การ์ดสินค้า ----------
async function productCardRange(conn, start, end) {
  const days = dayList(start, end);
  const base = { time_selector: { period: 31, granularity: 30, base_timestamp: ymdToUnix(end) + 86400 }, stats_types: [20, 30, 31, 21, 22, 32, 33, 23, 10, 11, 64, 60, 61, 63, 62], filter: {} };
  const [stats, sources] = await Promise.all([
    tk(conn, "seller", "/api/v4/insights/seller/shop/product/card/traffic/stats", { body: { request: { params: [{ ...base, time_descriptor: tdRange(start, end, { granularity: "ALL" }) }, { ...base, time_descriptor: tdRange(start, end, { granularity: "1D" }) }] } } }),
    soft(tk(conn, "seller", "/api/v4/insights/seller/shop/product/card/traffic/sources/list", { body: { request: { params: [{ time_selector: base.time_selector, time_descriptor: tdRange(start, end, { granularity: "ALL" }), stats_types: [4, 30, 20, 31, 21, 22, 32, 33, 23, 10, 64, 60, 61, 63, 62, 3, 81, 82, 83], filter: {} }] } } })),
  ]);
  const conv = (s) => ({ revenue: num(s.revenue), influenced_revenue: num(s.influenced_revenue), views: num(s.view_cnt), clicks: num(s.click_cnt), add_to_cart: num(s.add_to_cart_cnt), sku_orders: num(s.sku_order_cnt), viewers: num(s.view_users_cnt), clickers: num(s.click_users_cnt), cart_users: num(s.add_to_cart_users_cnt), buyers: num(s.buyers_cnt), view_to_click: num(s.view_to_click_user_rate), click_to_cart: num(s.click_to_cart_user_rate), cart_to_order: num(s.cart_to_order_user_rate), click_to_order: num(s.click_to_order_user_rate), view_to_order: num(s.view_to_order_user_rate) });
  const segs = (stats.data && stats.data.segments) || [];
  const s0 = (segs[0] || {}).stats || []; const totals = conv(s0[s0.length - 1] || {});
  const daily = ((segs[1] || {}).stats || []).map((s) => ({ date: unixToYmd((s.time_info || {}).start_timestamp || 0), ...conv(s) }));
  const nodes = sources && sources.data ? ((((((sources.data.segments || [])[0] || {}).timed_stats || [])[0] || {}).stats_nodes) || []) : [];
  return { range: { start, end, days: days.length }, totals, daily, sources: nodes.map((n) => ({ traffic_source: n.traffic_source, main_traffic_source: n.main_traffic_source, revenue: num(n.revenue), views: n.view_cnt, clicks: n.click_cnt, buyers: n.buyers_cnt, sku_orders: n.sku_order_cnt })), sources_error: sources && sources.error };
}

// ---------- การตลาด: โปรโมชั่น + GMV Max ----------
const PROMO_TOOLS = { 6: "เครื่องมือทั้งหมด", 1: "ส่วนลดสินค้า", 8: "ของขวัญจากการซื้อ", 4: "คูปอง", 12: "แฟลชเซล", 13: "ไลฟ์แฟลชเซล", 25: "คูปองสำหรับลูกค้าใหม่", 11: "ดีลใน LIVE จากครีเอเตอร์", 26: "คูปองพิเศษสำหรับครีเอเตอร์" };
const PROMO_STATS = [10, 31, 27, 18, 21, 12, 32, 23, 29, 30, 19];
async function marketingRange(conn, start, end) {
  const days = dayList(start, end);
  const tools = [6, 1, 8, 4, 12, 13, 25, 11, 26];
  const tdp = (g) => ({ start, end: addDays(end, 1), timezone_offset: TZ_OFFSET, scenario: 1, granularity: g, with_previous_period: false });
  const [period, list, ads, adsList, campaigns] = await Promise.all([
    tk(conn, "seller", "/api/v1/insights/seller/shop/promotion/period/stats", { body: { request: { params: [{ time_descriptor: tdp(""), filter: { promotion_tools: tools, content_type: 1 }, stats_types: PROMO_STATS }, { time_descriptor: tdp("1D"), filter: { promotion_tools: [6], content_type: 1 }, stats_types: PROMO_STATS }], usecase: "key_metric_trend_chart" } } }),
    soft(tk(conn, "seller", "/api/v3/insights/seller/shop/promotion/list", { body: { request: { params: [{ time_selector: { period: 31, granularity: 30, base_timestamp: ymdToUnix(end) + 86400 }, filter: { search_keyword: "", promotion_tool: 6 }, list_control: { rules: [{ direction: 2, field: "SHOP_PROMOTION_LIST_REVENUE" }], pagination: { size: 50, page: 0 } }, time_descriptor: tdp(""), stats_types: [2, 3, 4, 5, 6, 10, 25, 26, 24, 15, 18, 11, 20, 19] }] } } })),
    soft(tk(conn, "seller", "/oec_ads/shopping/v1/oec/stat/post_shop_overview_stat", { body: { query_list: ["overall_onsite_shopping_value", "overall_onsite_order_count", "dollar_cost", "overall_onsite_roas"], start_time: start, end_time: end } })),
    soft(tk(conn, "seller", "/oec_ads/shopping/v1/oec/stat/post_campaign_list", { body: { query_list: ["campaign_name", "campaign_status", "campaign_primary_status", "template_ad_roas_bid", "campaign_target_roi_budget", "cost", "billed_cost", "onsite_roi2_shopping_sku", "cost_per_onsite_roi2_shopping_sku", "onsite_roi2_shopping_value", "onsite_roi2_shopping", "template_ad_start_time", "template_ad_end_time", "gmv_max_bid_type"], start_time: start, end_time: end, order_field: "cost", order_type: 1, page: 1, campaign_shop_automation_type: 2, external_type_list: ["304", "307"], filters: [{ field: "campaign_status", in_field_values: ["no_delete"], filter_type: 0 }, { field: "gmv_roi_mode", in_field_values: ["2"], filter_type: 10 }] } })),
    soft(tk(conn, "seller", "/api/v1/promotion/campaign/seller/parents_campaigns/list", { body: { page_index: 1, page_size: 20, is_available: true, is_registration_period: true }, ttl: 300000 })),
  ]);
  const convMetrics = (metrics) => { const o = {}; for (const m of metrics || []) o[String(m.stats_type_str || m.stats_type).toLowerCase()] = num(m.stats); return o; };
  const segs = (period.data && period.data.segments) || [];
  const totSeg = ((segs[0] || {}).timed_stats || [])[0] || {};
  const by_tool = {}; for (const t of totSeg.stats_promotion_tools || []) by_tool[t.promotion_tools] = { name: PROMO_TOOLS[t.promotion_tools] || String(t.promotion_tools), ...convMetrics(t.metrics) };
  const totals = by_tool[6] || {};
  const daily = ((segs[1] || {}).timed_stats || []).map((t) => ({ date: String(t.start_timestamp).slice(0, 10), ...convMetrics(((t.stats_promotion_tools || [])[0] || {}).metrics) }));
  const promos = list && list.data ? ((((list.data.segments || [])[0] || {}).timed_list || [])[0] || {}).stats || [] : [];
  // ระดับร้าน (post_shop_overview_stat): ยอดขายจากโฆษณา/ROAS เป็นบาท, dollar_cost เป็น USD → ค่าโฆษณาจริง(บาท)=ยอดขาย/ROAS
  const adsStat = ads && ads.data ? ads.data.statistics || {} : {};
  let adsTotals = null;
  if (ads && ads.data) {
    const gmv = num(adsStat.overall_onsite_shopping_value), roas = num(adsStat.overall_onsite_roas), orders = num(adsStat.overall_onsite_order_count);
    const cost = gmv !== null && roas ? gmv / roas : null;
    adsTotals = { cost, gmv, roas, orders, cost_per_order: cost !== null && orders ? cost / orders : null, cir: roas ? 1 / roas : null, dollar_cost: num(adsStat.dollar_cost) };
  }
  const adsChart = ads && ads.data && ads.data.chart ? ads.data.chart : null;
  const adsDaily = adsChart ? (adsChart.categories || []).map((d, i) => { const by = {}; for (const s of adsChart.series || []) by[s.name] = num((s.data || [])[i]); const gmv = by.overall_onsite_shopping_value, roas = by.overall_onsite_roas; const cost = gmv !== null && roas ? gmv / roas : null; return { date: d, gmv, roas, orders: by.overall_onsite_order_count, cost, cir: roas ? 1 / roas : null }; }) : [];
  const adsRows = adsList && adsList.data ? (adsList.data.table || []).map((c) => ({ campaign_id: c.campaign_id, name: c.campaign_name, status: c.campaign_status, primary_status: c.campaign_primary_status, roas_bid: num(c.template_ad_roas_bid), budget: num(c.campaign_target_roi_budget), cost: num(c.cost), billed_cost: num(c.billed_cost), gmv: num(c.onsite_roi2_shopping_value), roas: num(c.onsite_roi2_shopping), orders: num(c.onsite_roi2_shopping_sku), cost_per_order: num(c.cost_per_onsite_roi2_shopping_sku), cir: div(num(c.cost), num(c.onsite_roi2_shopping_value)), start_time: c.template_ad_start_time, end_time: c.template_ad_end_time })) : [];
  const camps = campaigns && campaigns.data ? (campaigns.data.campaigns_list || []).map((c) => ({ id: c.campaign_info && c.campaign_info.campaign_id, title: c.campaign_info && c.campaign_info.title, status: c.campaign_info && c.campaign_info.status, period: c.campaign_info && c.campaign_info.period, sub_count: c.com_campaign_total_count })) : [];
  return {
    range: { start, end, days: days.length }, tools: PROMO_TOOLS, totals, by_tool, daily,
    promotions: promos.map((p) => ({ promotion_id: p.promotion_id, name: p.promotion_name, status: p.promotion_status, period: p.promotion_period, type: p.promotion_type, revenue: num(p.revenue), units: num(p.unit_sales_cnt), discount: num(p.discount_amt), roi: num(p.roi), aov: num(p.aov), orders: num(p.main_orders_cnt), avg_buyers_per_day: num(p.avg_buyers_per_day), avg_discount_rate: num(p.avg_discount_rate) })), promotions_error: list && list.error,
    ads: { totals: adsTotals, daily: adsDaily, campaigns: adsRows, total_campaigns: adsList && adsList.data && adsList.data.pagination ? adsList.data.pagination.total_count : null, error: (ads && ads.error) || (adsList && adsList.error) },
    platform_campaigns: camps, platform_campaigns_error: campaigns && campaigns.error,
  };
}

// ---------- แอฟฟิลิเอต (affiliate.tiktok.com) ----------
const AFF_METRICS = [1, 2, 3, 12, 16, 18, 5, 6, 20, 10, 24, 22, 19, 25, 28, 27, 26, 29, 4, 11];
async function affiliateRange(conn, start, end) {
  const days = dayList(start, end);
  const s = ymdToUnix(start), e = ymdToUnix(end) + 86400;
  const tdesc = (g) => ({ timezone_offset: TZ_OFFSET, start_time: s, end_time: e, granularity_type: g, time_option_type: 1, time_context: "101" }); // time_option_type 1 = ช่วงกำหนดเอง (6 รับเฉพาะ 7 วัน → 16048004)
  const [core, decomp, creators, orders, avail] = await Promise.all([
    tk(conn, "affiliate", "/api/v1/oec/affiliate/compass/transaction/core_performance/get", { body: { params: [{ time_descriptor: tdesc(1), metric_types: AFF_METRICS }, { time_descriptor: tdesc(2), metric_types: AFF_METRICS }] } }),
    soft(tk(conn, "affiliate", "/api/v1/oec/affiliate/compass/transaction/decomposition/get", { body: { params: [{ time_descriptor: tdesc(1), dimension_type: 1, metric_types: [1] }] } })),
    soft(tk(conn, "affiliate", "/api/v1/oec/affiliate/compass/transaction/detail_list/get", { body: { params: { detail_list_type: 1, creator_list_params: [{ time_descriptor: tdesc(1), metric_types: [2, 26, 27, 3, 5, 6, 7, 10, 28, 18, 9, 8, 17, 12, 24, 14, 15, 19, 20, 21, 4], page_param: { page_no: 1, page_size: 50 }, sorter: { sort_type: 2, order_type: 1 }, filter: {} }] }, module_type: 103 } })),
    soft(tk(conn, "affiliate", "/api/oec/pay/statement/order/seller/orders/list", { body: { query_size: 50, page_size: 50, affiliate_seller_search_condition: { cod_type: 0, campaign_type: 1, op_assist_order_type: 2, order_create_time: { start_time: s * 1000, end_time: e * 1000 - 1 } } }, ttl: 15000 })),
    soft(tk(conn, "affiliate", "/api/v1/oec/affiliate/compass/available_date/get", { body: { module_types: [101, 103] }, ttl: 600000 })),
  ]);
  const conv = (m) => { const o = {}; for (const [k, v] of Object.entries(m || {})) o[k] = num(v); return o; };
  const segs = (core.data && core.data.segments) || [];
  const totals = conv((((segs[0] || {}).time_split_metrics_list || [])[0] || {}).metrics);
  const daily = ((segs[1] || {}).time_split_metrics_list || []).map((t) => ({ date: unixToYmd(t.time_descriptor.start_time), ...conv(t.metrics) }));
  const collab = decomp && decomp.data ? ((((decomp.data.segments || [])[0] || {}).dimension_split_metrics_list) || []).map((d) => ({ collaboration_type: d.collaboration_type, gmv: num((((d.time_split_metrics_list || [])[0] || {}).metrics || {}).affiliate_gmv) })) : [];
  const crs = creators && creators.data ? ((((creators.data.creator_list_segments || [])[0] || {}).creator_performances) || []) : [];
  const total_creators = creators && creators.data ? (((creators.data.creator_list_segments || [])[0] || {}).total) : null;
  const ords = orders && orders.data ? (orders.data.sku_order_list || []) : [];
  const availRange = avail && avail.data ? ((avail.data.available_time_range_list || []).find((x) => x.module_type === 101) || null) : null;
  return {
    range: { start, end, days: days.length }, available_until: availRange ? unixToYmd(availRange.end_time - 1) : null, totals, daily, collaboration: collab,
    creators: crs.map((c) => ({ handle: c.creator_base && c.creator_base.handle_name, nickname: c.creator_base && c.creator_base.nick_name, followers: num(c.creator_base && c.creator_base.follower_cnt), ...Object.fromEntries(Object.entries(c.creator_metrics || {}).map(([k, v]) => [k.replace(/^creator_/, ""), num(v)])) })), total_creators, creators_error: creators && creators.error,
    orders: { total: orders && orders.data ? orders.data.total_count : null, has_more: orders && orders.data ? orders.data.has_more : null, error: orders && orders.error, list: ords.map((o) => { const b = o.sku_order_base_info_for_affiliate_seller || {}; const c = o.sku_order_commission_info_for_affiliate_seller || {}; const so = b.sku_order_info || {}; return { main_order_id: so.main_order_id, create_time: so.create_time, creator: b.creator_info && b.creator_info.creator_username, creator_nickname: b.creator_info && b.creator_info.creator_nickname, product: b.product_info && b.product_info.product_name, sale_price: num(so.sale_price), qty: so.sale_quantity, settlement_status: so.settlement_status, refund_number: so.refund_number, commission: num(c.est_standard_commission), commission_rate: c.standard_cos_ratio }; }) },
  };
}


// ---------- ตรวจสอบการเรียก affiliate จาก Node (ใช้แก้ error code 10000) ----------
async function affiliateProbe(conn) {
  if (!conn.affiliate_cookie) throw new TikTokError("ยังไม่ได้วาง cookie ของ affiliate.tiktok.com", "-", 0, null, true);
  const s = ymdToUnix(addDays(todayYmd(), -8)), e = ymdToUnix(addDays(todayYmd(), -1));
  const body = JSON.stringify({ params: [{ time_descriptor: { timezone_offset: TZ_OFFSET, start_time: s, end_time: e, granularity_type: 1, time_option_type: 1, time_context: "101" }, metric_types: [1, 3, 4] }] });
  const base = AFFILIATE, p = "/api/v1/oec/affiliate/compass/transaction/core_performance/get";
  const qA = `locale=th-TH&language=th-TH&shop_region=TH&shop_id=${conn.shop_id}&device_id=0`;
  const qB = `user_language=th-TH&aid=4331&app_name=i18n_ecom_alliance&device_id=0&oec_seller_id=${conn.shop_id}&shop_region=TH`;
  const H = { cookie: conn.affiliate_cookie, "user-agent": UA, accept: "application/json, text/plain, */*", "content-type": "application/json" };
  const variants = [
    ["A: เหมือนแอป (referer root + origin)", qA, { ...H, referer: base + "/", origin: base }],
    ["B: ไม่ส่ง origin/referer", qA, H],
    ["C: referer หน้า data-compass", qA, { ...H, referer: base + "/connection/data-compass?shop_region=TH", origin: base }],
    ["D: query แบบเว็บ (aid=4331)", qB, { ...H, referer: base + "/connection/data-compass?shop_region=TH", origin: base }],
    ["E: + accept-language", qA, { ...H, referer: base + "/connection/data-compass?shop_region=TH", origin: base, "accept-language": "th-TH,th;q=0.9,en;q=0.8" }],
    ["F: cookie ของ seller แทน", qA, { ...H, cookie: conn.seller_cookie, referer: base + "/", origin: base }],
  ];
  const out = [];
  for (const [name, q, headers] of variants) {
    try {
      const res = await fetch(`${base}${p}?${q}`, { method: "POST", headers, body, redirect: "manual" });
      const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
      out.push({ variant: name, http: res.status, code: j ? j.code : null, message: j ? (j.message || j.msg || "") : text.slice(0, 200), gmv: j && j.data && j.data.segments && j.data.segments[0] && j.data.segments[0].time_split_metrics_list && j.data.segments[0].time_split_metrics_list[0] && j.data.segments[0].time_split_metrics_list[0].metrics && j.data.segments[0].time_split_metrics_list[0].metrics.affiliate_gmv ? j.data.segments[0].time_split_metrics_list[0].metrics.affiliate_gmv.amount : null, resp_headers: { "x-tt-logid": res.headers.get("x-tt-logid"), "content-type": res.headers.get("content-type") } });
    } catch (err) { out.push({ variant: name, error: err.message }); }
  }
  const names = (c) => String(c || "").split(";").map((x) => x.trim().split("=")[0]).filter(Boolean);
  return { range: [unixToYmd(s), unixToYmd(e - 1)], affiliate_cookie_count: names(conn.affiliate_cookie).length, affiliate_cookie_has: { sessionid: names(conn.affiliate_cookie).includes("sessionid"), sid_tt: names(conn.affiliate_cookie).includes("sid_tt"), sid_guard: names(conn.affiliate_cookie).includes("sid_guard"), uid_tt: names(conn.affiliate_cookie).includes("uid_tt") }, results: out };
}

// ---------- คำสั่งซื้อ ----------
const ORDER_TABS = { 0: "ทั้งหมด", 101: "ที่จะจัดส่ง", 102: "จัดส่งแล้ว", 103: "เสร็จสิ้น", 110: "รอดำเนินการ", 104: "ยกเลิกแล้ว", 105: "การจัดส่งไม่สำเร็จ" };
async function ordersRange(conn, start, end, page = 1, tab = "0") {
  const s = ymdToUnix(start) * 1000, e = (ymdToUnix(end) + 86400) * 1000 - 1;
  const count = 20;
  const [list, counts] = await Promise.all([
    tk(conn, "seller", "/api/fulfillment/order/list", { body: { search_condition: { condition_list: { time_order_created: { value: [String(s), String(e)] }, search_tab: { value: [String(tab)] } } }, offset: (page - 1) * count, count, sort_info: "6", search_cursor: "", pagination_type: 0 }, ttl: 15000 }),
    soft(tk(conn, "seller", "/api/fulfillment/order/search_count", { body: { search_key_list: ["101", "102", "103", "110", "104", "105"] }, ttl: 30000 })),
  ]);
  const orders = ((list.data && list.data.main_orders) || []).map((o) => {
    const t = o.trade_order_module || {}; const price = o.price_module || {}; const st = (o.order_status_module || [])[0] || {}; const dl = (o.delivery_module || [])[0] || {};
    return { order_id: o.main_order_id, create_time: Number(t.create_time), payment_time: t.payment_time ? Number(t.payment_time) : null, pay_method: t.pay_method, status: st.main_order_status, sku_status: st.sku_display_status, total: num(price.grand_total && price.grand_total.price_val), sub_total: num(price.sub_total && price.sub_total.price_val), shipping_fee: num(t.shipping_fee && t.shipping_fee.price_val), buyer: o.buyer_info_module && o.buyer_info_module.buyer_nickname, carrier: dl.shipment_provider_info && dl.shipment_provider_info.name, items: (o.sku_module || []).map((s) => ({ name: s.product_name, sku: s.sku_name, seller_sku: s.seller_sku_name, qty: s.quantity, price: num(s.sku_unit_price && s.sku_unit_price.price_val), total: num(s.sku_total_price && s.sku_total_price.price_val), creator_note: s.creator_info_name && s.creator_info_name.items ? s.creator_info_name.items.map((i) => i.message_content).join(" ") : null })) };
  });
  return { range: { start, end }, page, count, tab: String(tab), tabs: ORDER_TABS, total: list.data ? list.data.total_count : null, has_more: list.data ? list.data.has_more : null, orders, status_counts: counts && counts.data ? counts.data.count_map : null, status_counts_error: counts && counts.error };
}

// ---------- เปรียบเทียบ ----------
function diffTotals(cur, prev) { const out = {}; if (!cur || !cur.totals || !prev || !prev.totals) return out; for (const k of Object.keys(cur.totals)) out[k] = pct(cur.totals[k], prev.totals[k]); return out; }
async function withCompare(fn, conn, p, nested) {
  if (!p.start || !p.end) throw new Error("ต้องระบุ start และ end (YYYY-MM-DD)");
  const cur = await fn(conn, p.start, p.end);
  let compare = null, diff = null;
  if (p.cmp_start && p.cmp_end) {
    compare = await fn(conn, p.cmp_start, p.cmp_end);
    diff = diffTotals(cur, compare);
    if (nested) for (const k of nested) diff[k] = diffTotals(cur[k], compare[k]);
  }
  return { current: cur, compare, diff };
}

// ---------- ตรวจ cookie / ข้อมูลร้าน ----------
async function detectShop(sellerCookie) {
  const tmp = { seller_cookie: sellerCookie, shop_id: "" };
  const r = await tk(tmp, "seller", "/api/v1/seller/workbench/get_all_sellers", { body: {}, ttl: 0 });
  const sellers = (r.data && r.data.sellers_data) || {};
  for (const [gid, v] of Object.entries(sellers)) {
    const map = (v.global_seller && v.global_seller.seller_map) || [];
    const th = map.find((m) => m.region === "TH") || map[0];
    if (th) return { shop_id: String(th.seller_id), shop_name: th.shop_name, region: th.region, global_seller_id: gid };
  }
  throw new TikTokError("ไม่พบร้านค้าใน session นี้ (get_all_sellers ว่าง)", "/api/v1/seller/workbench/get_all_sellers");
}

// ---------- API dispatcher ----------
async function handle(action, p) {
  if (action === "status") {
    const c = loadSession();
    return { connected: !!(c && c.seller_cookie), affiliate_connected: !!(c && (c.affiliate_cookie || c.seller_cookie)), affiliate_cookie_used: c ? (c.affiliate_cookie_used || "") : "", shop_id: c ? c.shop_id : null, shop_name: c ? c.shop_name : null, saved_at: c ? c.saved_at : null, last_ok_at: c ? c.last_ok_at : null, last_error: c ? c.last_error : null, server_time: Math.floor(Date.now() / 1000), today: todayYmd(), base: SELLER, auth_enabled: !!process.env.APP_PASSWORD, cookie_from_env: !!(c && c.from_env) };
  }
  if (action === "saveSession") {
    const prev = loadSession() || {};
    const seller_cookie = cleanCookie(p.seller_cookie) || prev.seller_cookie || "";
    const affiliate_cookie = cleanCookie(p.affiliate_cookie) || prev.affiliate_cookie || "";
    if (!seller_cookie) throw new Error("ไม่มี cookie ของ seller-th.tiktok.com");
    const shop = await detectShop(seller_cookie);
    // ทดสอบ affiliate.tiktok.com: ลอง cookie ชุด affiliate ก่อน ถ้าไม่ผ่านลองใช้ cookie ของ seller (ใช้ได้เพราะโดเมนเดียวกัน)
    let affiliate_ok = false, affiliate_error = "", affiliate_cookie_used = "";
    const tryAff = async (ck) => { AFFILIATE_COOKIE_PREF = "affiliate"; await tk({ affiliate_cookie: ck, seller_cookie: "", shop_id: shop.shop_id }, "affiliate", "/api/v1/oec/affiliate/compass/available_date/get", { body: { module_types: [101] }, ttl: 0, _retried: true }); };
    if (affiliate_cookie) {
      try { await tryAff(affiliate_cookie); affiliate_ok = true; affiliate_cookie_used = "affiliate"; }
      catch (e) { affiliate_error = e.message; }
    }
    if (!affiliate_ok) {
      try { await tryAff(seller_cookie); affiliate_ok = true; affiliate_cookie_used = "seller"; affiliate_error = ""; }
      catch (e) { affiliate_error = affiliate_error || e.message; }
    }
    AFFILIATE_COOKIE_PREF = affiliate_cookie_used === "seller" ? "seller" : "affiliate";
    cache.clear();
    const data = { seller_cookie, affiliate_cookie, ...shop, affiliate_ok, affiliate_error, affiliate_cookie_used, saved_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_error: "" };
    saveSession(data);
    return { ok: true, shop_id: shop.shop_id, shop_name: shop.shop_name, affiliate_ok, affiliate_error, affiliate_cookie_used };
  }
  if (action === "logout") { clearSession(); return { ok: true }; }
  const c = requireConn();
  try {
    let out;
    switch (action) {
      case "realtime": out = await realtime(c); break;
      case "overview": out = await withCompare(overviewRange, c, p); break;
      case "live": out = await withCompare(liveRange, c, p); break;
      case "video": out = await withCompare(videoRange, c, p); break;
      case "products": out = await productsRange(c, p.start, p.end, Number(p.page || 0), Number(p.size || 50)); break;
      case "productCard": out = await withCompare(productCardRange, c, p); break;
      case "marketing": out = await withCompare(marketingRange, c, p, ["ads"]); break;
      case "affiliate": out = await withCompare(affiliateRange, c, p); break;
      case "affiliateProbe": out = await affiliateProbe(c); break;
      case "orders": out = await ordersRange(c, p.start, p.end, Number(p.page || 1), p.tab || "0"); break;
      default: { const err = new Error("unknown action: " + action); err.status = 400; throw err; }
    }
    markOk();
    return out;
  } catch (e) { markErr(e); throw e; }
}

module.exports = { handle, TikTokError, todayYmd, ymdToUnix, unixToYmd };
