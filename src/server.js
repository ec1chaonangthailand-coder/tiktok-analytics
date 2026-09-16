// src/server.js — เว็บเซิร์ฟเวอร์ (Node 18+ ไม่ใช้ไลบรารีภายนอก)
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// ---------- โหลดไฟล์ .env (ถ้ามี) — ใช้ตอนรันในเครื่อง; บน Render ใช้ Environment Variables ----------
try {
  const envFiles = [path.join(__dirname, "..", ".env"), path.join(__dirname, "..", "tiktok-api-keys.txt")];
  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v !== "" && !process.env[m[1]]) process.env[m[1]] = v; // ค่าว่างไม่นับ (กันไฟล์ .env เปล่าบังไฟล์อื่น)
    }
  }
} catch { /* ไม่มี .env ก็ข้ามไป */ }

const { handle } = require("./tiktok");

// ---------- ล็อกอินเข้าเว็บ (เปิดเมื่อตั้ง APP_PASSWORD) ----------
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const APP_USER = process.env.APP_USER || "admin";
const SECRET = process.env.APP_SECRET || crypto.createHash("sha256").update("sa:" + APP_PASSWORD).digest("hex");
const token = () => crypto.createHmac("sha256", SECRET).update(APP_USER + ":" + APP_PASSWORD).digest("hex");
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const isAuthed = (req) => !APP_PASSWORD || parseCookies(req).sa_auth === token();
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const loginPage = (msg = "") => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เข้าสู่ระบบ — TikTok Analytics</title><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:420px;margin:60px auto"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="logo">T</span> TikTok Analytics</div><h2>เข้าสู่ระบบ</h2>${msg ? `<div class="error">${msg}</div>` : ""}<form method="post" action="/login"><label style="display:block;margin-bottom:8px">ผู้ใช้<br><input name="user" value="${APP_USER}" style="width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></label><label style="display:block;margin-bottom:12px">รหัสผ่าน<br><input name="password" type="password" autofocus style="width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px"></label><button class="primary" style="width:100%">เข้าสู่ระบบ</button></form></div></main></body></html>`;

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || (process.env.APP_PASSWORD ? "0.0.0.0" : "127.0.0.1");
const PUBLIC = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon" };

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ""; req.on("data", (c) => { d += c; if (d.length > 2e6) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(new Error("invalid JSON body")); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    // ---- ล็อกอิน ----
    if (url.pathname === "/login") {
      if (req.method === "POST") {
        const raw = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
        const f = Object.fromEntries(new URLSearchParams(raw));
        if (APP_PASSWORD && safeEq(String(f.user || ""), APP_USER) && safeEq(String(f.password || ""), APP_PASSWORD)) {
          res.writeHead(302, { "set-cookie": `sa_auth=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`, location: "/" }); return res.end();
        }
        return send(res, 401, loginPage("ผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"), MIME[".html"]);
      }
      return send(res, 200, APP_PASSWORD ? loginPage() : "ไม่ได้ตั้งรหัสผ่าน (APP_PASSWORD) — เข้าใช้ได้เลย", MIME[".html"]);
    }
    if (url.pathname === "/logout") { res.writeHead(302, { "set-cookie": "sa_auth=; Path=/; Max-Age=0", location: "/login" }); return res.end(); }
    // ---- OAuth callback ของ TikTok Shop Partner API ----
    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code") || url.searchParams.get("auth_code") || "";
      const page = (title, detail) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:640px;margin:60px auto"><div class="card"><h2>${title}</h2><pre style="white-space:pre-wrap;word-break:break-word">${detail}</pre><p><a href="/">กลับหน้าแอป</a></p></div></main></body></html>`;
      if (!code) return send(res, 400, page("ไม่พบ auth_code", "TikTok ไม่ได้ส่งพารามิเตอร์ code กลับมา"), MIME[".html"]);
      try {
        const r = await require("./partner").exchangeCode(code);
        return send(res, 200, page("เชื่อมต่อ Partner API สำเร็จ", JSON.stringify(r, null, 2)), MIME[".html"]);
      } catch (e) {
        return send(res, 502, page("แลก token ไม่สำเร็จ", `${e.message}\nendpoint: ${e.endpoint || "-"}\nhttp: ${e.http_status || "-"}\ncode: ${e.code ?? "-"}`), MIME[".html"]);
      }
    }
    // ---- หน้าแสดง refresh token ให้ผู้ใช้คัดลอกไปใส่เป็น env var (ล็อกอินก่อนถึงจะเข้าได้) ----
    if (url.pathname === "/token" && isAuthed(req)) {
      const tok = require("./partner").refreshTokenForDisplay();
      const body = tok
        ? `<p>คัดลอกค่าข้างล่างนี้ไปใส่เป็น Environment Variable ชื่อ <code>TTS_REFRESH_TOKEN</code> บน Render แล้วกด Save<br><small>เก็บเป็นความลับเหมือนรหัสผ่าน อย่าแชร์ใคร</small></p><textarea id="t" readonly style="width:100%;height:120px;font-family:monospace;font-size:12px">${tok}</textarea><p><button class="primary" onclick="document.getElementById('t').select();document.execCommand('copy');this.textContent='คัดลอกแล้ว'">คัดลอก</button></p>`
        : `<p>ยังไม่มี refresh token — ต้องกดอนุญาตร้านค้าก่อน</p>`;
      const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Refresh token</title><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:720px;margin:48px auto"><div class="card"><h2>TikTok Partner API — refresh token</h2>${body}<p><a href="/">กลับหน้าแอป</a></p></div></main></body></html>`;
      return send(res, 200, html, MIME[".html"]);
    }
    if (!isAuthed(req) && url.pathname !== "/app.css") {
      if (url.pathname.startsWith("/api")) return send(res, 401, { ok: false, error: "กรุณาเข้าสู่ระบบ", app_login: true });
      res.writeHead(302, { location: "/login" }); return res.end();
    }
    if (url.pathname === "/api" || url.pathname === "/api/") {
      const p = req.method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams);
      const action = p.action || "status";
      try {
        let data;
        // หน้าแอฟฟิลิเอต: ใช้ Partner API ถ้าตั้งค่าไว้ (ข้อมูลเสถียรกว่า cookie) — ถ้าไม่ได้ตั้งค่าค่อยใช้ cookie เดิม
        if (action === "affiliate" && require("./partner").partnerConfigured() && p.source !== "cookie") {
          data = await require("./partner").affiliateWithCompare(p);
        } else if (String(action).startsWith("tts")) {
          data = await require("./partner").handlePartner(action, p);
          if (data === null) throw Object.assign(new Error(`unknown action: ${action}`), { status: 400 });
        } else data = await handle(action, p);
        return send(res, 200, { ok: true, action, fetched_at: Math.floor(Date.now() / 1000), data });
      } catch (e) {
        const status = e.session_expired ? 401 : (e.status || 502);
        try { fs.mkdirSync(path.join(__dirname, "..", "data"), { recursive: true }); fs.appendFileSync(path.join(__dirname, "..", "data", "errors.log"), JSON.stringify({ time: new Date().toISOString(), action, params: { start: p.start, end: p.end, cmp_start: p.cmp_start, cmp_end: p.cmp_end, page: p.page }, error: e.message, endpoint: e.endpoint || null, http_status: e.status ?? null, code: e.code ?? null }) + "\n"); } catch { /* ignore */ }
        console.error(`[${new Date().toISOString()}] ${action} ล้มเหลว: ${e.message} (${e.endpoint || "-"})`);
        return send(res, status, { ok: false, action, error: e.message || String(e), endpoint: e.endpoint || null, http_status: e.status ?? null, code: e.code ?? null, session_expired: !!e.session_expired });
      }
    }
    // static
    let file = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC)) return send(res, 403, "forbidden", "text/plain");
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html")), MIME[".html"]); }
    return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || "application/octet-stream");
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TikTok Analytics พร้อมใช้งานที่ http://${HOST}:${PORT}`);
  console.log(`ข้อมูล session เก็บที่ data/session.json (seller + affiliate) (อยู่ในเครื่องนี้เท่านั้น)`);
  console.log(APP_PASSWORD ? `เปิดล็อกอินเว็บ: ผู้ใช้ ${APP_USER}` : "ไม่ได้ตั้ง APP_PASSWORD — เว็บเปิดโดยไม่ต้องล็อกอิน (เหมาะกับใช้ในเครื่องเท่านั้น)");
});
