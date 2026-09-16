"use strict";
// ---------- TikTok Shop Partner API (Open API) ----------
// ใช้ทดสอบว่า App Key / App Secret / service_id ที่ผู้ใช้มี ใช้งานได้จริงหรือไม่
// ไม่มีข้อมูลจำลองใด ๆ — ทุกค่าที่ส่งกลับมาจาก API ของ TikTok โดยตรง
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API_BASE = process.env.TTS_API_BASE || "https://open-api.tiktokglobalshop.com";
const AUTH_BASE = process.env.TTS_AUTH_BASE || "https://auth.tiktok-shops.com";
const SERVICES_BASE = "https://services.tiktokshop.com";

const APP_KEY = (process.env.TTS_APP_KEY || "").trim();
const APP_SECRET = (process.env.TTS_APP_SECRET || "").trim();
const SERVICE_ID = (process.env.TTS_SERVICE_ID || "").trim();

const DATA_DIR = path.join(__dirname, "..", "data");
const TOKEN_FILE = path.join(DATA_DIR, "tts-tokens.json");

class PartnerError extends Error {
  constructor(message, endpoint, httpStatus, code) {
    super(message);
    this.endpoint = endpoint; this.http_status = httpStatus || 0; this.status = httpStatus || 0; this.code = code == null ? null : code;
  }
}

function needKeys() {
  const missing = [];
  if (!APP_KEY) missing.push("TTS_APP_KEY");
  if (!APP_SECRET) missing.push("TTS_APP_SECRET");
  if (missing.length) throw new PartnerError("ยังไม่ได้ตั้งค่า " + missing.join(", "), "-", 0, null);
}

// ลายเซ็น: เรียง query (ยกเว้น sign/access_token) ตามตัวอักษร → {key}{value} → เติม path ไว้หน้า
// → ถ้ามี body ให้ต่อ JSON string ท้าย → ครอบด้วย app_secret หน้า-หลัง → HMAC-SHA256(key=app_secret) → hex
function sign(pathname, query, bodyString) {
  const keys = Object.keys(query).filter((k) => k !== "sign" && k !== "access_token").sort();
  let base = pathname;
  for (const k of keys) base += k + query[k];
  if (bodyString) base += bodyString;
  const wrapped = APP_SECRET + base + APP_SECRET;
  return crypto.createHmac("sha256", APP_SECRET).update(wrapped).digest("hex");
}

// เก็บ token 3 ชั้น: หน่วยความจำ (เร็วสุด) → ไฟล์ (รอดข้าม process แต่ไม่รอด deploy) → env (ถาวร)
let MEM = null;
const ENV_REFRESH = (process.env.TTS_REFRESH_TOKEN || "").trim();
const ENV_ACCESS = (process.env.TTS_ACCESS_TOKEN || "").trim();
const fingerprint = (v) => (v ? crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 12) : null);

function readTokens() {
  if (MEM) return MEM;
  try { MEM = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); return MEM; } catch { /* ไม่มีไฟล์ */ }
  if (ENV_REFRESH || ENV_ACCESS) { MEM = { access_token: ENV_ACCESS || "", refresh_token: ENV_REFRESH || "", source: "env", saved_at: null }; return MEM; }
  return null;
}
function writeTokens(t) {
  MEM = t;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2)); } catch { /* ดิสก์ชั่วคราวบน Render — เก็บในหน่วยความจำพอ */ }
}

async function jsonFetch(url, opt, endpoint) {
  const res = await fetch(url, opt);
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { /* */ }
  if (!j) throw new PartnerError(`ตอบกลับไม่ใช่ JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, endpoint, res.status, null);
  return { res, j };
}

// ---------- OAuth ----------
function authUrl(state) {
  needKeys();
  if (!SERVICE_ID) throw new PartnerError("ยังไม่ได้ตั้งค่า TTS_SERVICE_ID", "-", 0, null);
  return `${SERVICES_BASE}/open/authorize?service_id=${encodeURIComponent(SERVICE_ID)}&state=${encodeURIComponent(state || "tts")}`;
}

async function exchangeCode(authCode) {
  needKeys();
  const code = String(authCode || "").trim();
  if (!code) throw new PartnerError("ต้องระบุ auth_code", "-", 0, null);
  const p = "/api/v2/token/get";
  const url = `${AUTH_BASE}${p}?app_key=${encodeURIComponent(APP_KEY)}&app_secret=${encodeURIComponent(APP_SECRET)}&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
  const { res, j } = await jsonFetch(url, { method: "GET", headers: { accept: "application/json" } }, p);
  if (j.code !== 0) throw new PartnerError(`แลก token ไม่สำเร็จ code=${j.code}: ${j.message || ""}`, p, res.status, j.code);
  const d = j.data || {};
  const saved = {
    access_token: d.access_token, refresh_token: d.refresh_token,
    access_token_expire_in: d.access_token_expire_in, refresh_token_expire_in: d.refresh_token_expire_in,
    seller_name: d.seller_name, open_id: d.open_id, saved_at: new Date().toISOString(),
  };
  writeTokens(saved);
  return { seller_name: d.seller_name, access_token_expire_in: d.access_token_expire_in, refresh_token_expire_in: d.refresh_token_expire_in, has_refresh_token: !!d.refresh_token };
}

async function refresh() {
  needKeys();
  const t = readTokens();
  if (!t || !t.refresh_token) throw new PartnerError("ยังไม่มี refresh_token — ต้องอนุญาตร้านค้าก่อน", "-", 0, null);
  const p = "/api/v2/token/refresh";
  const url = `${AUTH_BASE}${p}?app_key=${encodeURIComponent(APP_KEY)}&app_secret=${encodeURIComponent(APP_SECRET)}&refresh_token=${encodeURIComponent(t.refresh_token)}&grant_type=refresh_token`;
  const { res, j } = await jsonFetch(url, { method: "GET", headers: { accept: "application/json" } }, p);
  if (j.code !== 0) throw new PartnerError(`รีเฟรช token ไม่สำเร็จ code=${j.code}: ${j.message || ""}`, p, res.status, j.code);
  const d = j.data || {};
  const rotated = !!(d.refresh_token && d.refresh_token !== t.refresh_token);
  writeTokens({ ...t, source: "refresh", access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, access_token_expire_in: d.access_token_expire_in, refresh_token_expire_in: d.refresh_token_expire_in, saved_at: new Date().toISOString() });
  return {
    refreshed: true,
    used_refresh_token_from: t.source || "file",
    refresh_token_rotated: rotated,
    old_refresh_fingerprint: fingerprint(t.refresh_token),
    new_refresh_fingerprint: fingerprint(d.refresh_token || t.refresh_token),
    access_token_expire_at: d.access_token_expire_in ? new Date(d.access_token_expire_in * 1000).toISOString() : null,
    refresh_token_expire_at: d.refresh_token_expire_in ? new Date(d.refresh_token_expire_in * 1000).toISOString() : null,
  };
}

const SAFETY = 6 * 3600; // รีเฟรชล่วงหน้า 6 ชม.
function tokenExpired(t) {
  if (!t || !t.access_token) return true;
  if (!t.access_token_expire_in) return false; // ไม่รู้วันหมดอายุ ก็ลองใช้ไปก่อน
  return Math.floor(Date.now() / 1000) > Number(t.access_token_expire_in) - SAFETY;
}
// คืน access token ที่ใช้ได้ — รีเฟรชอัตโนมัติถ้าหมดอายุหรือมีแต่ refresh_token (เช่นหลัง deploy ใหม่)
async function accessToken() {
  let t = readTokens();
  if (!t || (!t.access_token && !t.refresh_token)) {
    throw new PartnerError("ยังไม่มี access_token — ต้องอนุญาตร้านค้าก่อน (ttsAuthUrl → กดอนุญาต)", "-", 0, null);
  }
  if (tokenExpired(t)) {
    if (!t.refresh_token) throw new PartnerError("access_token หมดอายุและไม่มี refresh_token — ต้องอนุญาตร้านค้าใหม่", "-", 0, null);
    await refresh();
    t = readTokens();
  }
  if (!t.access_token) throw new PartnerError("ไม่มี access_token หลังรีเฟรช", "-", 0, null);
  return t.access_token;
}

// ---------- เรียก Open API ----------
async function call(pathname, { method = "GET", query = {}, body = null, withToken = true, shopCipher = null } = {}) {
  needKeys();
  const q = { app_key: APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)), ...query };
  if (shopCipher) q.shop_cipher = shopCipher;
  const bodyString = body ? JSON.stringify(body) : "";
  q.sign = sign(pathname, q, bodyString);
  const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (withToken) headers["x-tts-access-token"] = await accessToken();
  const { res, j } = await jsonFetch(`${API_BASE}${pathname}?${qs}`, { method, headers, body: bodyString || undefined }, pathname);
  if (j.code !== 0) throw new PartnerError(`TikTok Open API error code=${j.code}: ${j.message || ""}`, pathname, res.status, j.code);
  return { data: j.data, request_id: j.request_id };
}

async function shops() {
  const r = await call("/authorization/202309/shops", { method: "GET" });
  return (r.data && r.data.shops) || [];
}

const ymd = (d) => d.toISOString().slice(0, 10);

// ทดสอบครบวงจร: token → ร้านค้า → ภาพรวมร้าน 7 วัน → แอฟฟิลิเอต
async function selfTest() {
  const out = { app_key_set: !!APP_KEY, app_secret_set: !!APP_SECRET, service_id_set: !!SERVICE_ID, steps: [] };
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const value = await fn(); out.steps.push({ step: name, ok: true, ms: Date.now() - t0, value }); return value; }
    catch (err) { out.steps.push({ step: name, ok: false, ms: Date.now() - t0, error: err.message, endpoint: err.endpoint, http_status: err.http_status, code: err.code }); return null; }
  };

  const tok = readTokens();
  out.token_saved_at = tok ? tok.saved_at : null;
  out.token_source = (process.env.TTS_ACCESS_TOKEN || "").trim() ? "env" : (tok ? "file" : "none");

  const list = await step("รายชื่อร้านที่อนุญาตแล้ว (GET /authorization/202309/shops)", async () => {
    const s = await shops();
    return s.map((x) => ({ id: x.id, name: x.name, region: x.region, seller_type: x.seller_type, has_cipher: !!x.cipher }));
  });
  const cipher = list && list.length ? (await shops())[0].cipher : null;
  out.shop_cipher_found = !!cipher;
  if (!cipher) return out;

  const today = new Date();
  const end = new Date(today.getTime() - 86400000);
  const start = new Date(end.getTime() - 6 * 86400000);

  await step("ภาพรวมร้าน 7 วัน (GET /analytics/202509/shop/performance)", async () => {
    const r = await call("/analytics/202509/shop/performance", {
      query: { start_date_ge: ymd(start), end_date_lt: ymd(new Date(end.getTime() + 86400000)), granularity: "ALL", currency: "LOCAL" },
      shopCipher: cipher,
    });
    const perf = (r.data && (r.data.performance || r.data)) || {};
    const iv = ((perf.intervals) || [])[0] || {};
    const sales = iv.sales || {};
    return {
      range: [ymd(start), ymd(end)],
      latest_available_date: r.data && r.data.latest_available_date,
      gmv: sales.gmv && sales.gmv.overall ? Number(sales.gmv.overall.amount) : null,
      gmv_breakdown: ((sales.gmv && sales.gmv.breakdowns) || []).map((b) => ({ type: b.type, amount: Number(b.gmv.amount) })),
      gross_revenue: sales.gross_revenue && sales.gross_revenue.overall ? Number(sales.gross_revenue.overall.amount) : null,
      orders_count: sales.orders_count, items_sold: sales.items_sold, refunds: sales.refunds ? Number(sales.refunds.amount) : null,
      request_id: r.request_id,
    };
  });

  await step("คำสั่งซื้อแอฟฟิลิเอต (POST /affiliate_seller/202410/orders/search)", async () => {
    const r = await call("/affiliate_seller/202410/orders/search", {
      method: "POST", query: { page_size: "10" }, shopCipher: cipher,
      body: { order_create_time_ge: Math.floor(start.getTime() / 1000), order_create_time_lt: Math.floor((end.getTime() + 86400000) / 1000) },
    });
    const orders = (r.data && (r.data.orders || r.data.affiliate_orders)) || [];
    return { returned: orders.length, total_count: r.data && r.data.total_count, next_page_token: !!(r.data && r.data.next_page_token), request_id: r.request_id };
  });

  return out;
}


// ---------- แอฟฟิลิเอตจาก Partner API (แทน Affiliate Center ที่ต้องใช้ cookie) ----------
const AFF_MAX_PAGES = Number(process.env.TTS_AFF_MAX_PAGES || 80); // 80 หน้า x 100 = 8,000 ออเดอร์ต่อช่วง
const money = (m) => (m && m.amount != null ? Number(m.amount) : 0);
const ymdBangkok = (unix) => new Date((unix + 25200) * 1000).toISOString().slice(0, 10);

async function affiliateOrders(start, end, cipher) {
  const ge = Math.floor(new Date(`${start}T00:00:00+07:00`).getTime() / 1000);
  const lt = Math.floor(new Date(`${end}T00:00:00+07:00`).getTime() / 1000) + 86400;
  const orders = [];
  let pageToken = "", pages = 0, total = null;
  do {
    const query = { page_size: "100" };
    if (pageToken) query.page_token = pageToken;
    const r = await call("/affiliate_seller/202410/orders/search", { method: "POST", query, body: { create_time_ge: ge, create_time_lt: lt }, shopCipher: cipher });
    const d = r.data || {};
    if (total === null) total = d.total_count ?? null;
    for (const o of d.orders || []) orders.push(o);
    pageToken = d.next_page_token || "";
    pages += 1;
  } while (pageToken && pages < AFF_MAX_PAGES);
  return { orders, total_count: total, pages, truncated: !!pageToken };
}

// รวมยอดจากออเดอร์จริง — ตัวชี้วัดใดที่ API ไม่ได้ให้ จะเป็น null (ไม่เดา ไม่ใส่ 0)
function aggregateAffiliate(orders) {
  const byDay = new Map(), byCreator = new Map(), byProduct = new Map(), byContent = new Map(), byStatus = new Map();
  let gmv = 0, commission = 0, adsCommission = 0, items = 0, refundGmv = 0, skuLines = 0, multiQtyLines = 0;
  const creators = new Set();
  for (const o of orders) {
    const day = ymdBangkok(o.create_time);
    let orderGmv = 0, orderComm = 0, orderItems = 0;
    for (const s of o.skus || []) {
      const qty = Number(s.quantity || 0);
      const line = money(s.price);           // ยอดขายของบรรทัดนี้ (สกุลตาม currency ที่ API ส่งมา)
      const comm = money(s.estimated_paid_commission);
      const ads = money(s.estimated_paid_shop_ads_commission);
      const returned = String(s.fully_return || "").toLowerCase() === "yes";
      skuLines += 1; if (qty > 1) multiQtyLines += 1;
      orderGmv += line; orderComm += comm; orderItems += qty;
      adsCommission += ads;
      if (returned) refundGmv += line;
      if (s.creator_username) creators.add(s.creator_username);
      const ck = s.creator_username || "(ไม่ระบุ)";
      const c = byCreator.get(ck) || { creator: ck, gmv: 0, commission: 0, items: 0, orders: new Set() };
      c.gmv += line; c.commission += comm; c.items += qty; c.orders.add(o.id); byCreator.set(ck, c);
      const pk = s.product_id || "(ไม่ระบุ)";
      const pr = byProduct.get(pk) || { product_id: pk, gmv: 0, commission: 0, items: 0, orders: new Set() };
      pr.gmv += line; pr.commission += comm; pr.items += qty; pr.orders.add(o.id); byProduct.set(pk, pr);
      const tk2 = s.content_type || "(ไม่ระบุ)";
      const t = byContent.get(tk2) || { content_type: tk2, gmv: 0, commission: 0, items: 0 };
      t.gmv += line; t.commission += comm; t.items += qty; byContent.set(tk2, t);
      const sk = s.settlement_status || "(ไม่ระบุ)";
      byStatus.set(sk, (byStatus.get(sk) || 0) + 1);
    }
    gmv += orderGmv; commission += orderComm; items += orderItems;
    const dd = byDay.get(day) || { date: day, affiliate_gmv: 0, estimated_commission: 0, affiliate_items_sold_cnt: 0, orders: 0 };
    dd.affiliate_gmv += orderGmv; dd.estimated_commission += orderComm; dd.affiliate_items_sold_cnt += orderItems; dd.orders += 1;
    byDay.set(day, dd);
  }
  const shrink = (m) => [...m.values()].map((x) => ({ ...x, orders: x.orders instanceof Set ? x.orders.size : x.orders })).sort((a, b) => b.gmv - a.gmv);
  return {
    totals: {
      affiliate_gmv: gmv,
      estimated_commission: commission,
      estimated_shop_ads_commission: adsCommission,
      affiliate_items_sold_cnt: items,
      affiliate_orders_cnt: orders.length,
      affiliate_refunded_gmv: refundGmv,
      distinct_sales_creators_cnt: creators.size,
      average_order_value: orders.length ? gmv / orders.length : null,
      // ตัวชี้วัดที่ Partner API ไม่ได้ให้ — ต้องเป็น null เพื่อไม่ให้หน้าเว็บแสดงเลขที่ไม่มีจริง
      distinct_affiliate_buyers_cnt: null, distinct_promoting_creators_cnt: null,
      affiliate_video_cnt: null, affiliate_live_cnt: null,
      product_ctr: null, click_to_order_rate: null, samples_shipped_cnt: null,
    },
    daily: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    creators: shrink(byCreator).slice(0, 200),
    products: shrink(byProduct).slice(0, 200),
    by_content_type: [...byContent.values()].sort((a, b) => b.gmv - a.gmv),
    settlement_status: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    sku_lines: skuLines, multi_quantity_lines: multiQtyLines,
  };
}

async function affiliateRangePartner(start, end) {
  const cipher = (await shops())[0]?.cipher;
  if (!cipher) throw new PartnerError("ไม่พบร้านที่อนุญาตแล้ว", "/authorization/202309/shops", 0, null);
  const { orders, total_count, pages, truncated } = await affiliateOrders(start, end, cipher);
  const agg = aggregateAffiliate(orders);
  return { range: { start, end }, source: "partner_api", api_total_count: total_count, fetched_orders: orders.length, pages, truncated, ...agg };
}

async function affiliateWithCompare(p) {
  if (!p.start || !p.end) throw new PartnerError("ต้องระบุ start และ end (YYYY-MM-DD)", "-", 0, null);
  const current = await affiliateRangePartner(p.start, p.end);
  let compare = null, diff = null;
  if (p.cmp_start && p.cmp_end) {
    compare = await affiliateRangePartner(p.cmp_start, p.cmp_end);
    diff = {};
    for (const k of Object.keys(current.totals)) {
      const a = current.totals[k], b = compare.totals[k];
      diff[k] = a == null || b == null || !b ? null : (a - b) / b;
    }
  }
  return { current, compare, diff };
}

async function handlePartner(action, p) {
  switch (action) {
    case "ttsStatus": {
      const t = readTokens();
      const now = Math.floor(Date.now() / 1000);
      return {
        app_key_set: !!APP_KEY, app_secret_set: !!APP_SECRET, service_id_set: !!SERVICE_ID, api_base: API_BASE,
        has_access_token: !!(t && t.access_token), has_refresh_token: !!(t && t.refresh_token),
        token_source: t ? (t.source || "file") : "none",
        env_refresh_token_set: !!ENV_REFRESH,
        access_token_expire_at: t && t.access_token_expire_in ? new Date(t.access_token_expire_in * 1000).toISOString() : null,
        access_token_days_left: t && t.access_token_expire_in ? Math.round(((t.access_token_expire_in - now) / 86400) * 10) / 10 : null,
        refresh_token_expire_at: t && t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
        refresh_token_days_left: t && t.refresh_token_expire_in ? Math.round(((t.refresh_token_expire_in - now) / 86400) * 10) / 10 : null,
        refresh_token_fingerprint: t ? fingerprint(t.refresh_token) : null,
        token_saved_at: t ? t.saved_at : null, seller_name: t ? t.seller_name : null,
      };
    }
    // เรียก endpoint ใด ๆ ของ Open API ตรง ๆ (ใช้สำรวจโครงสร้าง response ก่อนเขียนหน้าเว็บ)
    case "ttsRaw": {
      if (!p.path) throw new PartnerError("ต้องระบุ path เช่น /analytics/202509/shop/performance", "-", 0, null);
      const cipher = p.shop_cipher === false ? null : (p.shop_cipher || (await shops())[0]?.cipher || null);
      const r = await call(p.path, { method: p.method || "GET", query: p.query || {}, body: p.body || null, shopCipher: cipher });
      return { path: p.path, request_id: r.request_id, data: r.data };
    }
    case "ttsAuthUrl": return { url: authUrl(p.state) };
    case "ttsExchange": return await exchangeCode(p.auth_code || p.code);
    case "ttsRefresh": return await refresh();
    case "ttsShops": return { shops: await shops() };
    case "ttsTest": return await selfTest();
    case "ttsAffiliate": return await affiliateWithCompare(p);
    default: return null;
  }
}

function refreshTokenForDisplay() {
  const t = readTokens();
  return t ? (t.refresh_token || "") : "";
}

const partnerConfigured = () => !!(APP_KEY && APP_SECRET);

module.exports = { handlePartner, exchangeCode, refreshTokenForDisplay, affiliateWithCompare, partnerConfigured, PartnerError };
