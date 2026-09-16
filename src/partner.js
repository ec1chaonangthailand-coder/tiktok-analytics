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

function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch { return null; }
}
function writeTokens(t) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2)); } catch { /* ephemeral disk — ไม่เป็นไร */ }
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
  writeTokens({ ...t, access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, access_token_expire_in: d.access_token_expire_in, refresh_token_expire_in: d.refresh_token_expire_in, saved_at: new Date().toISOString() });
  return { refreshed: true, access_token_expire_in: d.access_token_expire_in };
}

function accessToken() {
  const envTok = (process.env.TTS_ACCESS_TOKEN || "").trim();
  if (envTok) return envTok;
  const t = readTokens();
  if (!t || !t.access_token) throw new PartnerError("ยังไม่มี access_token — ต้องอนุญาตร้านค้าก่อน (ttsAuthUrl → ttsExchange)", "-", 0, null);
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
  if (withToken) headers["x-tts-access-token"] = accessToken();
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
    const iv = ((r.data && r.data.intervals) || [])[0] || {};
    const sales = iv.sales || {};
    return {
      range: [ymd(start), ymd(end)],
      latest_available_date: r.data && r.data.latest_available_date,
      gmv: sales.gmv && sales.gmv.overall, orders_count: sales.orders_count, items_sold: sales.items_sold,
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

async function handlePartner(action, p) {
  switch (action) {
    case "ttsStatus": {
      const t = readTokens();
      return { app_key_set: !!APP_KEY, app_secret_set: !!APP_SECRET, service_id_set: !!SERVICE_ID, api_base: API_BASE, has_token: !!(t && t.access_token) || !!(process.env.TTS_ACCESS_TOKEN || "").trim(), token_saved_at: t ? t.saved_at : null, seller_name: t ? t.seller_name : null };
    }
    case "ttsAuthUrl": return { url: authUrl(p.state) };
    case "ttsExchange": return await exchangeCode(p.auth_code || p.code);
    case "ttsRefresh": return await refresh();
    case "ttsShops": return { shops: await shops() };
    case "ttsTest": return await selfTest();
    default: return null;
  }
}

module.exports = { handlePartner, exchangeCode, PartnerError };
