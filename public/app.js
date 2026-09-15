/* app.js — TikTok Shop Analytics (ข้อมูลจริงจาก Seller Center / Affiliate Center เท่านั้น ไม่มีตัวเลขจำลอง) */
(function () {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- format ----------
  const isNil = (v) => v === null || v === undefined || (typeof v === "number" && isNaN(v));
  const fmtNum = (v, d) => (isNil(v) || typeof v === "object" ? "–" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: typeof d === "number" ? d : 0 }));
  const fmtBaht = (v) => (isNil(v) || typeof v === "object" ? "–" : "฿" + Number(v).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
  const fmtPct = (v) => (isNil(v) ? "–" : (Number(v) * 100).toFixed(2) + "%");
  const fmtPct100 = (v) => (isNil(v) ? "–" : Number(v).toFixed(2) + "%"); // ค่าที่ TikTok ส่งมาเป็น % อยู่แล้ว
  const fmtRatio = (v) => (isNil(v) ? "–" : Number(v).toFixed(2));
  const fmtDT = (unix) => (isNil(unix) || !Number(unix) ? "–" : new Date(Number(unix) * 1000).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }));
  const fmtDTms = (ms) => (isNil(ms) || !Number(ms) ? "–" : new Date(Number(ms)).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }));
  const fmtDate = (ymd) => { if (!ymd) return "–"; const [y, m, d] = String(ymd).slice(0, 10).split("-"); return `${d}/${m}/${String(y).slice(2)}`; };
  const fmtDur = (sec) => (isNil(sec) ? "–" : sec >= 3600 ? `${Math.floor(sec / 3600)} ชม. ${Math.round((sec % 3600) / 60)} น.` : `${Math.round(sec / 60)} น.`);
  const diffHtml = (v) => { if (isNil(v)) return '<span class="diff flat">–</span>'; const p = Number(v) * 100; const cls = p > 0.05 ? "up" : p < -0.05 ? "down" : "flat"; return `<span class="diff ${cls}">${p > 0 ? "▲" : p < 0 ? "▼" : ""} ${Math.abs(p).toFixed(2)}%</span>`; };
  const errInline = (e) => `<div class="error">${esc(typeof e === "string" ? e : e && e.error)}${e && e.endpoint ? ` <code>${esc(e.endpoint)}</code>` : ""}</div>`;

  // ---------- date helpers (เวลาไทย) ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const todayTH = () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return ymd(d); };
  const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(Date.UTC(y, m - 1, d + n))); };
  const daysBetween = (a, b) => Math.round((Date.UTC(...b.split("-").map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split("-").map((x, i) => (i === 1 ? x - 1 : +x)))) / 86400000);
  const monthStart = (s) => s.slice(0, 8) + "01";
  const prevMonth = (s) => { const [y, m] = s.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return { start: ymd(d), end: addDays(monthStart(s), -1) }; };
  const PRESETS = [
    { key: "today", label: "วันนี้", fn: () => { const t = todayTH(); return { start: t, end: t }; } },
    { key: "yesterday", label: "เมื่อวาน", fn: () => { const t = addDays(todayTH(), -1); return { start: t, end: t }; } },
    { key: "7d", label: "7 วันล่าสุด", fn: () => ({ start: addDays(todayTH(), -6), end: todayTH() }) },
    { key: "30d", label: "30 วันล่าสุด", fn: () => ({ start: addDays(todayTH(), -29), end: todayTH() }) },
    { key: "mtd", label: "เดือนนี้", fn: () => ({ start: monthStart(todayTH()), end: todayTH() }) },
    { key: "pm", label: "เดือนก่อน", fn: () => prevMonth(todayTH()) },
  ];

  // ---------- state (เก็บใน URL hash) ----------
  const state = { route: "dashboard", start: addDays(todayTH(), -6), end: todayTH(), cmpMode: "auto", cmp_start: "", cmp_end: "", auto: false, page: 1, tab: "" };
  function readHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [route, qs] = raw.split("?");
    state.route = route || "dashboard";
    const q = new URLSearchParams(qs || "");
    for (const k of ["start", "end", "cmpMode", "cmp_start", "cmp_end"]) if (q.get(k)) state[k] = q.get(k);
    state.tab = q.get("tab") || "";
    state.auto = q.get("auto") === "1";
    state.page = Number(q.get("page") || 1);
  }
  function writeHash(replace) {
    const q = new URLSearchParams({ start: state.start, end: state.end, cmpMode: state.cmpMode });
    if (state.cmpMode === "custom") { q.set("cmp_start", state.cmp_start); q.set("cmp_end", state.cmp_end); }
    if (state.auto) q.set("auto", "1");
    if (state.tab && (state.route === "marketing" || state.route === "orders")) q.set("tab", state.tab);
    if ((state.route === "orders" || state.route === "products") && state.page > 1) q.set("page", state.page);
    const hash = `#/${state.route}?${q}`;
    if (replace) history.replaceState(null, "", hash); else location.hash = hash;
  }
  function compareRange() {
    if (state.cmpMode === "none") return null;
    if (state.cmpMode === "custom") return state.cmp_start && state.cmp_end ? { cmp_start: state.cmp_start, cmp_end: state.cmp_end } : null;
    const len = daysBetween(state.start, state.end) + 1;
    return { cmp_start: addDays(state.start, -len), cmp_end: addDays(state.start, -1) };
  }
  const rangeParams = () => ({ start: state.start, end: state.end, ...(compareRange() || {}) });

  // ---------- API ----------
  async function api(action, params = {}) {
    const res = await fetch("/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...params }) });
    const j = await res.json().catch(() => ({ ok: false, error: "เซิร์ฟเวอร์ตอบกลับไม่ใช่ JSON" }));
    if (!j.ok) { if (j.app_login) { location.href = "/login"; } const e = new Error(j.error || "unknown error"); Object.assign(e, j); throw e; }
    return j;
  }
  function errorBox(e, retry) {
    const box = h(`<div class="error"><b>ดึงข้อมูลไม่สำเร็จ:</b> ${esc(e.message || e.error)}${e.endpoint ? `<br><code>endpoint: ${esc(e.endpoint)}</code>` : ""}${e.http_status ? ` <code>HTTP ${e.http_status}</code>` : ""}${e.code ? ` <code>code ${esc(e.code)}</code>` : ""}${e.session_expired ? '<br><a href="#/connect">→ session หมดอายุ/ยังไม่เชื่อมต่อ ไปที่หน้าเชื่อมต่อ</a>' : ""}<div style="margin-top:8px"><button class="small">ลองใหม่</button></div></div>`);
    $("button", box).onclick = retry; return box;
  }
  function section(container, title, loader, render) {
    const card = h(`<section class="card"><div class="section-title"><h2>${title}</h2><span class="muted small" data-ts></span></div><div data-body><div class="skeleton"></div></div></section>`);
    container.appendChild(card);
    const body = $("[data-body]", card);
    const run = async () => {
      body.innerHTML = '<div class="skeleton"></div>';
      try { const r = await loader(); body.innerHTML = ""; render(body, r.data, r); $("[data-ts]", card).textContent = "ดึงข้อมูล " + fmtDT(r.fetched_at); }
      catch (e) { body.innerHTML = ""; body.appendChild(errorBox(e, run)); }
    };
    run(); return run;
  }

  // ---------- UI pieces ----------
  function kpi(label, cur, cmp, diff, f = fmtNum) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${f(cur)}</div>${cmp !== undefined ? `<div class="cmp">เทียบ: ${f(cmp)} ${diffHtml(diff)}</div>` : ""}</div>`;
  }
  function kpiGrid(defs, cur, cmp, diff) {
    return `<div class="grid">${defs.map(([k, label, f]) => kpi(label, cur ? cur[k] : null, cmp ? cmp[k] : undefined, diff ? diff[k] : null, f)).join("")}</div>`;
  }
  function table(rows, cols, opts = {}) {
    const wrap = h('<div class="table-wrap"></div>');
    let sortKey = opts.sortKey || null, desc = true;
    const draw = () => {
      const data = [...(rows || [])]; if (sortKey) data.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (isNil(x)) return 1; if (isNil(y)) return -1; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "th")) * (desc ? -1 : 1); });
      const t = h(`<table><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}" data-k="${c.key}">${c.label}${sortKey === c.key ? (desc ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead><tbody>${data.length ? data.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.f ? c.f(r[c.key], r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="muted">ไม่มีรายการในช่วงนี้</td></tr>`}</tbody></table>`);
      t.querySelectorAll("th").forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (sortKey === k) desc = !desc; else { sortKey = k; desc = true; } draw(); }));
      wrap.innerHTML = ""; wrap.appendChild(t);
    };
    draw(); return wrap;
  }
  const img = (url) => (url && /^https?:/.test(url) ? `<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(url)}" alt="">` : "");
  const tableOrError = (rows, err, cols, opts) => (err ? h(errInline(err)) : table(rows, cols, opts));
  function dailyLine(container, cur, cmp, key, label, unit = "") {
    const series = [{ label: `${label} (ช่วงที่เลือก)`, values: (cur || []).map((r) => r[key]), color: Charts.CUR, xlabels: (cur || []).map((r) => fmtDate(r.date)) }];
    if (cmp) series.push({ label: `${label} (ช่วงเปรียบเทียบ)`, values: cmp.map((r) => r[key]), color: Charts.CMP, dashed: true, xlabels: cmp.map((r) => fmtDate(r.date)) });
    Charts.line(container, { series, labels: (cur || []).map((r) => fmtDate(r.date)), unit });
  }
  function csvDownload(name, rows) {
    if (!rows || !rows.length) return;
    const cols = Object.keys(rows[0]); const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = name; a.click();
  }
  const trafficTable = (nodes, err) => tableOrError((nodes || []).map((n) => ({ ...n, label: n.traffic_source || n.name || n.source || n.main_traffic_source || "-" })), err, [{ key: "label", label: "แหล่งที่มา" }, { key: "revenue", label: "ยอดขาย", num: true, f: (v) => fmtBaht(numOf(v)) }, { key: "views", label: "วิว", num: true, f: (v) => fmtNum(numOf(v)) }, { key: "clicks", label: "คลิก", num: true, f: (v) => fmtNum(numOf(v)) }, { key: "buyers", label: "ผู้ซื้อ", num: true, f: (v) => fmtNum(numOf(v)) }, { key: "sku_orders", label: "ออเดอร์ SKU", num: true, f: (v) => fmtNum(numOf(v)) }]);
  const numOf = (v) => (v && typeof v === "object" ? ("amount" in v ? Number(v.amount) : "value" in v ? Number(v.value) : null) : isNil(v) ? null : Number(v));

  // ---------- toolbar ช่วงวันที่ ----------
  function toolbar(onChange) {
    const cmp = compareRange();
    const el = h(`<section class="card"><div class="toolbar">
      <div class="presets">${PRESETS.map((p) => `<button data-p="${p.key}">${p.label}</button>`).join("")}</div>
      <label>เริ่ม <input type="date" data-f="start" value="${state.start}" max="${todayTH()}"></label>
      <label>ถึง <input type="date" data-f="end" value="${state.end}" max="${todayTH()}"></label>
      <label>เปรียบเทียบกับ <select data-f="cmpMode"><option value="auto">ช่วงก่อนหน้า (อัตโนมัติ)</option><option value="custom">กำหนดเอง</option><option value="none">ไม่เปรียบเทียบ</option></select></label>
      <label class="cmp-custom">เริ่ม (เทียบ) <input type="date" data-f="cmp_start" value="${state.cmp_start || (cmp ? cmp.cmp_start : "")}"></label>
      <label class="cmp-custom">ถึง (เทียบ) <input type="date" data-f="cmp_end" value="${state.cmp_end || (cmp ? cmp.cmp_end : "")}"></label>
      <button class="primary" data-go>แสดงข้อมูล</button>
    </div>
    <div class="meta"><span>ช่วงที่เลือก: <b>${fmtDate(state.start)} – ${fmtDate(state.end)}</b> (${daysBetween(state.start, state.end) + 1} วัน)</span>
      <span>เปรียบเทียบ: <b>${cmp ? `${fmtDate(cmp.cmp_start)} – ${fmtDate(cmp.cmp_end)}` : "ไม่เปรียบเทียบ"}</b></span>
      <label class="toggle"><input type="checkbox" data-f="auto" ${state.auto ? "checked" : ""}> อัปเดตอัตโนมัติทุก 60 วินาที</label>
      <span class="muted">เวลาไทย (Asia/Bangkok) · ช่วงสูงสุด 92 วัน</span></div></section>`);
    $("[data-f=cmpMode]", el).value = state.cmpMode;
    const syncCustom = () => el.querySelectorAll(".cmp-custom").forEach((x) => (x.style.display = $("[data-f=cmpMode]", el).value === "custom" ? "" : "none"));
    syncCustom();
    $("[data-f=cmpMode]", el).onchange = syncCustom;
    el.querySelectorAll("[data-p]").forEach((b) => { const p = PRESETS.find((x) => x.key === b.dataset.p); const r = p.fn(); if (r.start === state.start && r.end === state.end) b.classList.add("active"); b.onclick = () => { $("[data-f=start]", el).value = r.start; $("[data-f=end]", el).value = r.end; $("[data-go]", el).click(); }; });
    $("[data-go]", el).onclick = () => {
      state.start = $("[data-f=start]", el).value; state.end = $("[data-f=end]", el).value; state.cmpMode = $("[data-f=cmpMode]", el).value;
      state.cmp_start = $("[data-f=cmp_start]", el).value; state.cmp_end = $("[data-f=cmp_end]", el).value; state.page = 1;
      if (!state.start || !state.end || state.end < state.start) { alert("ช่วงวันที่ไม่ถูกต้อง"); return; }
      writeHash();
    };
    $("[data-f=auto]", el).onchange = (e) => { state.auto = e.target.checked; writeHash(true); setupAuto(onChange); };
    return el;
  }
  let autoTimer = null;
  function setupAuto(fn) { clearInterval(autoTimer); autoTimer = null; if (state.auto && fn) autoTimer = setInterval(fn, 60000); }

  // ---------- คอลัมน์/นิยามที่ใช้ซ้ำ ----------
  const OVERVIEW_KPIS = [["gmv", "GMV", fmtBaht], ["orders", "คำสั่งซื้อ"], ["customers", "ลูกค้า"], ["items_sold", "สินค้าที่ขายได้"], ["sku_orders", "คำสั่งซื้อ SKU"], ["aov", "AOV (ยอด/ออเดอร์ SKU)", fmtBaht], ["refunds", "การคืนเงิน", fmtBaht], ["visitors", "ผู้เข้าชม"], ["page_views", "ยอดดูหน้า"], ["conversion_rate", "อัตราคอนเวอร์ชั่น", fmtPct], ["impressions", "การแสดงผลสินค้า"], ["clicks", "คลิกสินค้า"], ["gmv_live", "GMV จาก LIVE", fmtBaht], ["gmv_video", "GMV จากวิดีโอ", fmtBaht], ["gmv_card", "GMV จากการ์ดสินค้า", fmtBaht], ["gmv_creators", "GMV จากครีเอเตอร์", fmtBaht], ["gmv_seller", "GMV จากผู้ขาย", fmtBaht], ["gross_revenue", "รายได้รวม", fmtBaht]];
  const LIVE_KPIS = [["revenue", "ยอดขายจาก LIVE", fmtBaht], ["sessions", "จำนวนไลฟ์"], ["sessions_with_revenue", "ไลฟ์ที่มียอดขาย"], ["orders", "คำสั่งซื้อ"], ["items_sold", "ชิ้นที่ขาย"], ["buyers", "ผู้ซื้อ"], ["views", "ยอดวิว"], ["avg_view_duration", "เวลาชมเฉลี่ย (วิ)", (v) => fmtNum(v, 1)], ["gpm", "GPM (ยอดขาย/1,000 วิว)", fmtBaht], ["ctr", "CTR", fmtPct], ["co_rate", "C-O rate", fmtPct]];
  const VIDEO_KPIS = [["gmv", "GMV จากวิดีโอ", fmtBaht], ["sku_orders", "คำสั่งซื้อ SKU"], ["buyers", "ผู้ซื้อ"], ["product_shows", "การแสดงผลสินค้า"], ["product_clicks", "คลิกสินค้า"], ["ctr", "CTR", fmtPct], ["co_rate", "C-O rate", fmtPct]];
  const CARD_KPIS = [["revenue", "ยอดขายจากการ์ดสินค้า", fmtBaht], ["influenced_revenue", "ยอดขายที่ได้รับอิทธิพล", fmtBaht], ["views", "วิว"], ["clicks", "คลิก"], ["add_to_cart", "ใส่ตะกร้า"], ["sku_orders", "ออเดอร์ SKU"], ["buyers", "ผู้ซื้อ"], ["view_to_click", "วิว→คลิก", fmtPct], ["click_to_order", "คลิก→ออเดอร์", fmtPct], ["view_to_order", "วิว→ออเดอร์", fmtPct]];
  const ADS_KPIS = [["cost", "ค่าโฆษณา GMV Max", fmtBaht], ["gmv", "ยอดขายจากโฆษณา", fmtBaht], ["roas", "ROAS", fmtRatio], ["cir", "CIR (ค่าโฆษณา ÷ ยอดจากโฆษณา)", fmtPct], ["orders", "ออเดอร์ SKU จากโฆษณา"], ["cost_per_order", "ค่าโฆษณา/ออเดอร์", fmtBaht]];
  // key = stats_type_str ของ TikTok (ตัวพิมพ์เล็ก) ตาม docs/tiktok-endpoints.md
  const PROMO_KPIS = [["revenue", "ยอดขายผ่านโปรโมชั่น", fmtBaht], ["main_orders_cnt", "ออเดอร์"], ["unit_sales_cnt", "ชิ้น"], ["discount_amt", "ส่วนลดที่ให้", fmtBaht], ["roi", "ROI", fmtRatio], ["aov", "AOV", fmtBaht], ["avg_buyers_per_day", "ผู้ซื้อเฉลี่ย/วัน", (v) => fmtNum(v, 1)], ["avg_discount_rate", "ส่วนลดเฉลี่ย", fmtPct], ["claimed_voucher_cnt", "คูปองที่เก็บ"], ["used_voucher_cnt", "คูปองที่ใช้"], ["coupon_used_rate", "อัตราใช้คูปอง", fmtPct]];
  // key = ชื่อ metric ใน core_performance ของ Affiliate Center
  const AFF_KPIS = [["affiliate_gmv", "GMV แอฟฟิลิเอต", fmtBaht], ["estimated_commission", "คอมมิชชั่น (ประมาณ)", fmtBaht], ["affiliate_items_sold_cnt", "ชิ้นที่ขาย"], ["affiliate_refunded_gmv", "GMV ที่คืนเงิน", fmtBaht], ["distinct_affiliate_buyers_cnt", "ผู้ซื้อ"], ["distinct_sales_creators_cnt", "ครีเอเตอร์ที่ทำยอด"], ["distinct_promoting_creators_cnt", "ครีเอเตอร์ที่โปรโมท"], ["average_order_value", "AOV", fmtBaht], ["affiliate_video_cnt", "วิดีโอแอฟฟิลิเอต"], ["affiliate_live_cnt", "LIVE แอฟฟิลิเอต"], ["product_ctr", "CTR สินค้า", fmtPct], ["click_to_order_rate", "คลิก→ออเดอร์", fmtPct], ["samples_shipped_cnt", "ตัวอย่างที่ส่ง"]];

  // ---------- หน้า: แดชบอร์ด ----------
  function pageDashboard(root) {
    const runners = [];
    root.appendChild(h("<h1>แดชบอร์ด TikTok Shop</h1>"));
    root.appendChild(toolbar(() => runners.forEach((r) => r())));
    let rtTimer = null;
    runners.push(section(root, "Real-time วันนี้ (รายชั่วโมง)", () => api("realtime"), (body, d) => {
      const t = d.totals || {};
      body.innerHTML = `<div class="meta" style="margin:0 0 10px">วันที่ ${fmtDate(d.today)} · TikTok มีข้อมูลถึงชั่วโมงที่ <b>${esc(d.available_hour ?? "–")}</b>${d.has_data === false ? ' · <span class="diff down">TikTok แจ้งว่ายังไม่มีข้อมูลวันนี้</span>' : ""} · รีเฟรชอัตโนมัติทุก 30 วิ</div>
        <div class="grid">${kpi("GMV วันนี้", t.gmv, undefined, null, fmtBaht)}${kpi("คำสั่งซื้อ", t.orders)}${kpi("ลูกค้า", t.customers)}${kpi("สินค้าที่ขายได้", t.items_sold)}${kpi("GMV จาก LIVE", t.gmv_live, undefined, null, fmtBaht)}${kpi("GMV จากวิดีโอ", t.gmv_video, undefined, null, fmtBaht)}${kpi("GMV จากการ์ดสินค้า", t.gmv_card, undefined, null, fmtBaht)}${kpi("การแสดงผลสินค้า", t.impressions)}${kpi("คลิกสินค้า", t.clicks)}</div>
        <div class="grid-2" style="margin-top:14px"><div><h3>GMV รายชั่วโมงวันนี้</h3><div data-c></div></div><div><h3>คำสั่งซื้อรายชั่วโมงวันนี้</h3><div data-c2></div></div></div>
        <h3 style="margin-top:14px">LIVE วันนี้</h3><div data-l></div>`;
      const hrs = d.hourly || [];
      Charts.bars($("[data-c]", body), { values: hrs.map((r) => r.gmv), labels: hrs.map((r) => pad2(r.hour) + ":00"), unit: " บาท" });
      Charts.bars($("[data-c2]", body), { values: hrs.map((r) => r.orders), labels: hrs.map((r) => pad2(r.hour) + ":00"), color: Charts.PAL[3] });
      $("[data-l]", body).appendChild(d.lives_error ? h(errInline(d.lives_error)) : (d.lives || []).length ? h(`<pre class="muted" style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(d.lives, null, 1).slice(0, 4000))}</pre>`) : h('<div class="muted">ไม่มี LIVE วันนี้ (ตามที่ TikTok ส่งมา)</div>'));
      clearInterval(rtTimer); rtTimer = setInterval(() => { if (state.route === "dashboard") runners[0](); else clearInterval(rtTimer); }, 30000);
    }));
    runners.push(section(root, "ภาพรวมร้าน (Analytics › ภาพรวม)", () => api("overview", rangeParams()), (body, d) => {
      const c = d.current, p = d.compare, df = d.diff || {};
      body.innerHTML = `<div class="meta" style="margin:0 0 10px">ข้อมูลออฟไลน์ของ TikTok พร้อมถึงวันที่ <b>${fmtDate(c.available_date)}</b> — วันหลังจากนั้นในตารางรายวันมาจากข้อมูลล่าสุดที่ TikTok ให้</div>`
        + kpiGrid(OVERVIEW_KPIS, c.totals, p && p.totals, df)
        + `<div class="grid-2" style="margin-top:14px"><div><h3>GMV รายวัน</h3><div data-c1></div></div><div><h3>คำสั่งซื้อรายวัน</h3><div data-c2></div></div></div>
           <div class="grid-2" style="margin-top:14px"><div><h3>ที่มาของ GMV (รวมช่วง)</h3><div data-c4></div></div><div><h3>ที่มาของ GMV รายวัน</h3><div data-t4></div></div></div>`;
      dailyLine($("[data-c1]", body), c.daily, p && p.daily, "gmv", "GMV", " บาท");
      dailyLine($("[data-c2]", body), c.daily, p && p.daily, "orders", "คำสั่งซื้อ");
      const s = c.sources || {};
      Charts.donut($("[data-c4]", body), { items: [{ label: "LIVE", value: s.live }, { label: "วิดีโอ", value: s.video }, { label: "การ์ดสินค้า", value: s.card }] });
      $("[data-t4]", body).appendChild(table(c.daily, [{ key: "date", label: "วันที่", f: fmtDate }, { key: "gmv", label: "GMV", num: true, f: fmtBaht }, { key: "gmv_live", label: "LIVE", num: true, f: fmtBaht }, { key: "gmv_video", label: "วิดีโอ", num: true, f: fmtBaht }, { key: "gmv_card", label: "การ์ดสินค้า", num: true, f: fmtBaht }, { key: "refunds", label: "คืนเงิน", num: true, f: fmtBaht }, { key: "impressions", label: "แสดงผล", num: true, f: fmtNum }, { key: "clicks", label: "คลิก", num: true, f: fmtNum }]));
      body.appendChild(h('<div class="note" style="margin-top:10px">GMV จาก LIVE/วิดีโอ/การ์ดสินค้า เป็นค่าที่ TikTok แยกให้โดยตรง (ช่องทางอื่น ๆ เช่น Shop Tab ไม่รวมในโดนัท)</div>'));
    }));
    runners.push(section(root, "สินค้าขายดี (Top 10 ตาม GMV)", () => api("products", { start: state.start, end: state.end, size: 10 }), (body, d) => {
      body.innerHTML = `<div class="meta" style="margin:0 0 10px">สินค้าทั้งหมดที่มีข้อมูลในช่วง ${fmtNum(d.total)} รายการ · ดูทั้งหมดที่แท็บ <a href="#/products">สินค้า</a></div><div data-t></div>`;
      $("[data-t]", body).appendChild(table(d.products, [{ key: "name", label: "สินค้า", f: (v, r) => img(r.image) + esc(v) }, { key: "gmv", label: "GMV", num: true, f: fmtBaht }, { key: "orders", label: "ออเดอร์", num: true, f: fmtNum }, { key: "items_sold", label: "ชิ้น", num: true, f: fmtNum }, { key: "impressions", label: "แสดงผล", num: true, f: fmtNum }, { key: "clicks", label: "คลิก", num: true, f: fmtNum }, { key: "ctr", label: "CTR", num: true, f: fmtPct }, { key: "co_rate", label: "คลิก→ออเดอร์", num: true, f: fmtPct }], { sortKey: "gmv" }));
    }));
    setupAuto(() => runners.forEach((r) => r()));
  }

  // ---------- หน้า: LIVE ----------
  function pageLive(root) {
    const runners = [];
    root.appendChild(h("<h1>LIVE</h1>"));
    root.appendChild(toolbar(() => runners.forEach((r) => r())));
    runners.push(section(root, "ภาพรวม LIVE (ร้าน + ครีเอเตอร์)", () => api("live", rangeParams()), (body, d) => {
      const c = d.current, p = d.compare, df = d.diff || {};
      body.innerHTML = (c.note ? `<div class="note">${esc(c.note)}</div>` : "") + kpiGrid(LIVE_KPIS, c.totals, p && p.totals, df)
        + `<div class="grid-2" style="margin-top:14px"><div><h3>ยอดขายจาก LIVE รายวัน</h3><div data-c1></div></div><div><h3>ยอดวิว LIVE รายวัน</h3><div data-c2></div></div></div>
           <h3 style="margin-top:14px">รายการไลฟ์ในช่วง (${fmtNum(c.sessions.length)} จาก ${fmtNum(c.total_sessions)} · เรียงตามยอดขาย)</h3><div data-t1></div>
           <h3 style="margin-top:14px">ช่องทางเข้าชม LIVE (นับถึงวันสุดท้ายของช่วง)</h3><div data-t2></div>`;
      dailyLine($("[data-c1]", body), c.daily, p && p.daily, "revenue", "ยอดขาย", " บาท");
      dailyLine($("[data-c2]", body), c.daily, p && p.daily, "views", "วิว");
      $("[data-t1]", body).appendChild(tableOrError(c.sessions, c.sessions_error, [{ key: "name", label: "ไลฟ์", f: (v, r) => `${esc(v)}<br><span class="badge">${esc(r.creator_alias || r.creator || "")}</span>` }, { key: "start_time", label: "เริ่ม", f: fmtDT }, { key: "duration", label: "ความยาว", num: true, f: fmtDur }, { key: "views", label: "วิว", num: true, f: fmtNum }, { key: "product_views", label: "ดูสินค้า", num: true, f: fmtNum }, { key: "ctr", label: "CTR", num: true, f: fmtPct }, { key: "co_rate", label: "C-O", num: true, f: fmtPct }, { key: "revenue", label: "ยอดขาย", num: true, f: fmtBaht }], { sortKey: "revenue" }));
      $("[data-t2]", body).appendChild(tableOrError(c.traffic, c.traffic_error, [{ key: "traffic_source", label: "แหล่งที่มา" }, { key: "view_cnt", label: "วิว", num: true, f: (v) => fmtNum(numOf(v)) }, { key: "view_share", label: "สัดส่วนวิว", num: true, f: (v) => fmtPct(numOf(v)) }, { key: "viewer_cnt", label: "ผู้ชม", num: true, f: (v) => fmtNum(numOf(v)) }, { key: "enter_room_rate", label: "อัตราเข้าห้อง", num: true, f: (v) => fmtPct(numOf(v)) }, { key: "product_ctr", label: "CTR สินค้า", num: true, f: (v) => fmtPct(numOf(v)) }, { key: "product_co", label: "C-O", num: true, f: (v) => fmtPct(numOf(v)) }]));
    }));
    setupAuto(() => runners.forEach((r) => r()));
  }

  // ---------- หน้า: วิดีโอ ----------
  function pageVideo(root) {
    const runners = [];
    root.appendChild(h("<h1>วิดีโอ</h1>"));
    root.appendChild(toolbar(() => runners.forEach((r) => r())));
    runners.push(section(root, "ภาพรวมวิดีโอ (ร้าน + ครีเอเตอร์)", () => api("video", rangeParams()), (body, d) => {
      const c = d.current, p = d.compare, df = d.diff || {};
      body.innerHTML = kpiGrid(VIDEO_KPIS, c.totals, p && p.totals, df)
        + `<div class="grid-2" style="margin-top:14px"><div><h3>GMV จากวิดีโอรายวัน</h3><div data-c1></div></div><div><h3>คลิกสินค้าจากวิดีโอรายวัน</h3><div data-c2></div></div></div>
           <h3 style="margin-top:14px">วิดีโอในช่วง (${fmtNum(c.videos.length)} จาก ${fmtNum(c.total_videos)} · เรียงตามยอดขาย)</h3><div data-t1></div>
           <div class="grid-2" style="margin-top:14px"><div><h3>บัญชีที่ทำยอด</h3><div data-t2></div></div><div><h3>ช่องทางเข้าชมวิดีโอ</h3><div data-t3></div></div></div>`;
      dailyLine($("[data-c1]", body), c.daily, p && p.daily, "gmv", "GMV", " บาท");
      dailyLine($("[data-c2]", body), c.daily, p && p.daily, "product_clicks", "คลิกสินค้า");
      $("[data-t1]", body).appendChild(tableOrError(c.videos, c.videos_error, [{ key: "name", label: "วิดีโอ", f: (v, r) => img(r.cover) + esc(v || r.id) + `<br><span class="badge">${esc(r.creator || "")}</span>` }, { key: "publish_time", label: "เผยแพร่", f: fmtDT }, { key: "views", label: "วิว", num: true, f: fmtNum }, { key: "likes", label: "ไลก์", num: true, f: fmtNum }, { key: "co_rate", label: "C-O", num: true, f: fmtPct }, { key: "revenue", label: "ยอดขาย", num: true, f: fmtBaht }], { sortKey: "revenue" }));
      $("[data-t2]", body).appendChild(tableOrError(c.accounts, c.accounts_error, [{ key: "creator", label: "บัญชี", f: (v, r) => `${esc(v)}${r.alias ? `<br><span class="muted">${esc(r.alias)}</span>` : ""}` }, { key: "is_commissioned", label: "แอฟฟิลิเอต", f: (v) => (v ? "ใช่" : "–") }, { key: "gmv", label: "GMV", num: true, f: fmtBaht }], { sortKey: "gmv" }));
      $("[data-t3]", body).appendChild(tableOrError(c.traffic, c.traffic_error, [{ key: "traffic_source", label: "แหล่งที่มา" }, { key: "view_cnt", label: "วิว", num: true, f: (v) => fmtNum(numOf(v)) }, { key: "view_share", label: "สัดส่วนวิว", num: true, f: (v) => fmtPct(numOf(v)) }, { key: "product_ctr", label: "CTR สินค้า", num: true, f: (v) => fmtPct(numOf(v)) }, { key: "product_co", label: "C-O", num: true, f: (v) => fmtPct(numOf(v)) }]));
    }));
    setupAuto(() => runners.forEach((r) => r()));
  }

  // ---------- หน้า: สินค้า ----------
  function pageProducts(root) {
    const runners = [];
    root.appendChild(h("<h1>สินค้า</h1>"));
    root.appendChild(toolbar(() => runners.forEach((r) => r())));
    runners.push(section(root, "ประสิทธิภาพสินค้า (Analytics › สินค้า)", () => api("products", { start: state.start, end: state.end, page: state.page - 1, size: 50 }), (body, d) => {
      body.innerHTML = `<div class="meta" style="margin:0 0 10px">ทั้งหมด ${fmtNum(d.total)} รายการ · หน้า ${state.page} / ${fmtNum(d.total_page)} · เรียงตาม GMV · คอลัมน์ "เทียบ" คือช่วงก่อนหน้าที่ TikTok คำนวณให้ (total_prev)</div>
        <h3>Top 10 ตาม GMV (หน้านี้)</h3><div data-c></div><div data-t style="margin-top:12px"></div>
        <div class="pager"><button class="small" data-prev ${state.page <= 1 ? "disabled" : ""}>◀ ก่อนหน้า</button><span>หน้า ${state.page}</span><button class="small" data-next ${d.total_page && state.page >= d.total_page ? "disabled" : ""}>ถัดไป ▶</button></div>`;
      Charts.hbars($("[data-c]", body), { items: d.products.slice(0, 10).map((x) => ({ label: x.name, value: x.gmv })), unit: " ฿" });
      $("[data-t]", body).appendChild(table(d.products, [{ key: "name", label: "สินค้า", f: (v, r) => img(r.image) + esc(v) + `<br><span class="badge">${esc(r.product_id)}</span>` }, { key: "gmv", label: "GMV", num: true, f: (v, r) => `${fmtBaht(v)}<br><span class="muted">เทียบ ${fmtBaht(r.prev && r.prev.gmv)}</span>` }, { key: "orders", label: "ออเดอร์", num: true, f: fmtNum }, { key: "items_sold", label: "ชิ้น", num: true, f: fmtNum }, { key: "customers", label: "ลูกค้า", num: true, f: fmtNum }, { key: "impressions", label: "แสดงผล", num: true, f: fmtNum }, { key: "clicks", label: "คลิก", num: true, f: fmtNum }, { key: "ctr", label: "CTR", num: true, f: fmtPct }, { key: "add_to_cart", label: "ใส่ตะกร้า", num: true, f: fmtNum }, { key: "co_rate", label: "คลิก→ออเดอร์", num: true, f: fmtPct }, { key: "aov", label: "AOV", num: true, f: fmtBaht }, { key: "refunds", label: "คืนเงิน", num: true, f: fmtBaht }, { key: "gmv_live", label: "LIVE ร้าน", num: true, f: fmtBaht }, { key: "gmv_video", label: "วิดีโอร้าน", num: true, f: fmtBaht }, { key: "gmv_affiliate", label: "แอฟฟิลิเอต", num: true, f: fmtBaht }, { key: "gmv_card", label: "การ์ดสินค้า", num: true, f: fmtBaht }], { sortKey: "gmv" }));
      $("[data-prev]", body).onclick = () => { state.page = Math.max(1, state.page - 1); writeHash(); };
      $("[data-next]", body).onclick = () => { state.page += 1; writeHash(); };
    }));
    runners.push(section(root, "การ์ดสินค้า (Product Card)", () => api("productCard", rangeParams()), (body, d) => {
      const c = d.current, p = d.compare, df = d.diff || {};
      body.innerHTML = kpiGrid(CARD_KPIS, c.totals, p && p.totals, df)
        + `<div class="grid-2" style="margin-top:14px"><div><h3>ยอดขายจากการ์ดสินค้ารายวัน</h3><div data-c1></div></div><div><h3>กรวย: วิว → คลิก → ตะกร้า → ผู้ซื้อ</h3><div data-c2></div></div></div>
           <h3 style="margin-top:14px">แหล่งที่มาของการ์ดสินค้า</h3><div data-t></div>`;
      dailyLine($("[data-c1]", body), c.daily, p && p.daily, "revenue", "ยอดขาย", " บาท");
      Charts.funnel($("[data-c2]", body), { steps: [{ label: "ผู้ชม", value: c.totals.viewers }, { label: "ผู้คลิก", value: c.totals.clickers }, { label: "ใส่ตะกร้า", value: c.totals.cart_users }, { label: "ผู้ซื้อ", value: c.totals.buyers }] });
      $("[data-t]", body).appendChild(trafficTable(c.sources, c.sources_error));
    }));
    setupAuto(() => runners.forEach((r) => r()));
  }

  // ---------- หน้า: การตลาด & GMV Max ----------
  function pageMarketing(root) {
    const runners = [];
    root.appendChild(h("<h1>การตลาด &amp; GMV Max</h1>"));
    root.appendChild(toolbar(() => runners.forEach((r) => r())));
    runners.push(section(root, "โปรโมชั่นและโฆษณา", () => api("marketing", rangeParams()), (body, d) => {
      const c = d.current, p = d.compare || {}, df = d.diff || {};
      const toolIds = Object.keys(c.tools || {});
      const tabs = [["promo", "โปรโมชั่นทั้งหมด"], ["tools", "แยกตามเครื่องมือ"], ["list", "รายโปรโมชั่น"], ["ads", "GMV Max (โฆษณา)"], ["campaigns", "แคมเปญแพลตฟอร์ม"]];
      body.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("")}</div><div data-panel></div>`;
      const panel = $("[data-panel]", body);
      const show = (k) => {
        state.tab = k; writeHash(true);
        body.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === k));
        panel.innerHTML = "";
        if (k === "promo") {
          panel.innerHTML = kpiGrid(PROMO_KPIS, c.totals, p.totals, df) + '<h3 style="margin-top:14px">ยอดขายผ่านโปรโมชั่นรายวัน (ทุกเครื่องมือ)</h3><div data-c></div><h3 style="margin-top:14px">รายวัน</h3><div data-t></div>';
          dailyLine($("[data-c]", panel), c.daily, p.daily, "revenue", "ยอดขาย", " บาท");
          $("[data-t]", panel).appendChild(table(c.daily, [{ key: "date", label: "วันที่", f: fmtDate }, { key: "revenue", label: "ยอดขาย", num: true, f: fmtBaht }, { key: "main_orders_cnt", label: "ออเดอร์", num: true, f: fmtNum }, { key: "unit_sales_cnt", label: "ชิ้น", num: true, f: fmtNum }, { key: "discount_amt", label: "ส่วนลด", num: true, f: fmtBaht }, { key: "roi", label: "ROI", num: true, f: fmtRatio }]));
        } else if (k === "tools") {
          const rows = toolIds.filter((id) => id !== "6").map((id) => ({ id, name: c.tools[id], ...(c.by_tool[id] || {}), _cmp: p.by_tool && p.by_tool[id] }));
          panel.innerHTML = '<h3>ยอดขายตามเครื่องมือการตลาด</h3><div data-c></div><div data-t style="margin-top:12px"></div>';
          Charts.hbars($("[data-c]", panel), { items: rows.map((r) => ({ label: r.name, value: r.revenue })), unit: " ฿" });
          $("[data-t]", panel).appendChild(table(rows, [{ key: "name", label: "เครื่องมือ" }, { key: "revenue", label: "ยอดขาย", num: true, f: (v, r) => `${fmtBaht(v)}${r._cmp ? `<br><span class="muted">เทียบ ${fmtBaht(r._cmp.revenue)}</span>` : ""}` }, { key: "main_orders_cnt", label: "ออเดอร์", num: true, f: fmtNum }, { key: "unit_sales_cnt", label: "ชิ้น", num: true, f: fmtNum }, { key: "discount_amt", label: "ส่วนลด", num: true, f: fmtBaht }, { key: "roi", label: "ROI", num: true, f: fmtRatio }, { key: "aov", label: "AOV", num: true, f: fmtBaht }, { key: "claimed_voucher_cnt", label: "คูปองเก็บ", num: true, f: fmtNum }, { key: "used_voucher_cnt", label: "คูปองใช้", num: true, f: fmtNum }], { sortKey: "revenue" }));
        } else if (k === "list") {
          panel.innerHTML = '<div data-t></div>';
          $("[data-t]", panel).appendChild(tableOrError(c.promotions, c.promotions_error, [{ key: "name", label: "โปรโมชั่น", f: (v, r) => `${esc(v)}<br><span class="badge">${esc(r.type)} · ${esc(r.status)}</span>` }, { key: "period", label: "ช่วงเวลา", f: (v) => esc(typeof v === "object" ? JSON.stringify(v) : v) }, { key: "revenue", label: "ยอดขาย", num: true, f: fmtBaht }, { key: "orders", label: "ออเดอร์", num: true, f: fmtNum }, { key: "units", label: "ชิ้น", num: true, f: fmtNum }, { key: "discount", label: "ส่วนลด", num: true, f: fmtBaht }, { key: "roi", label: "ROI", num: true, f: fmtRatio }, { key: "aov", label: "AOV", num: true, f: fmtBaht }, { key: "avg_discount_rate", label: "ส่วนลดเฉลี่ย", num: true, f: fmtPct }], { sortKey: "revenue" }));
        } else if (k === "ads") {
          const A = c.ads || {}, PA = p.ads || {}, da = df.ads || {};
          if (A.error) panel.appendChild(h(errInline(A.error)));
          panel.appendChild(h(`<div>${kpiGrid(ADS_KPIS, A.totals, PA.totals, da)}<div class="note">ยอดขายจากโฆษณาและ ROAS เป็นค่าระดับร้านที่ TikTok Ads ส่งมา (บาท) · ค่าโฆษณา(บาท) คำนวณจาก ยอดขาย ÷ ROAS เพราะ API ส่งค่าโฆษณาดิบมาเป็น USD · CIR = ค่าโฆษณา ÷ ยอดขายจากโฆษณา = 1/ROAS (ยิ่งต่ำยิ่งดี) · ตารางแคมเปญด้านล่างจะมีข้อมูลเฉพาะร้านที่ใช้แคมเปญแบบ GMV Max</div>
            <div class="grid-2" style="margin-top:14px"><div><h3>ค่าโฆษณา vs ยอดขายจากโฆษณา รายวัน</h3><div data-c1></div></div><div><h3>CIR รายวัน</h3><div data-c2></div></div></div>
            <h3 style="margin-top:14px">แคมเปญ GMV Max (${fmtNum(A.total_campaigns)} รายการ · ยอดตามช่วงที่เลือก)</h3><div data-t></div></div>`));
          const dl = A.daily || [];
          Charts.line($("[data-c1]", panel), { series: [{ label: "ค่าโฆษณา", values: dl.map((r) => r.cost), color: Charts.PAL[2] }, { label: "ยอดขายจากโฆษณา", values: dl.map((r) => r.gmv), color: Charts.CUR }], labels: dl.map((r) => fmtDate(r.date)), unit: " บาท" });
          Charts.bars($("[data-c2]", panel), { values: dl.map((r) => (isNil(r.cir) ? null : r.cir * 100)), labels: dl.map((r) => fmtDate(r.date)), unit: "%", color: Charts.PAL[4] });
          $("[data-t]", panel).appendChild(table(A.campaigns || [], [{ key: "name", label: "แคมเปญ", f: (v, r) => `${esc(v)}<br><span class="badge">${esc(r.primary_status || r.status)}</span>` }, { key: "roas_bid", label: "ROAS เป้าหมาย", num: true, f: fmtRatio }, { key: "budget", label: "งบ/วัน", num: true, f: fmtBaht }, { key: "cost", label: "ค่าโฆษณา", num: true, f: fmtBaht }, { key: "gmv", label: "ยอดขาย", num: true, f: fmtBaht }, { key: "orders", label: "ออเดอร์", num: true, f: fmtNum }, { key: "roas", label: "ROAS", num: true, f: fmtRatio }, { key: "cir", label: "CIR", num: true, f: fmtPct }, { key: "cost_per_order", label: "ค่าโฆษณา/ออเดอร์", num: true, f: fmtBaht }], { sortKey: "cost" }));
        } else {
          panel.innerHTML = '<div class="note">แคมเปญของแพลตฟอร์ม TikTok ที่เปิดรับสมัคร/ใช้งานได้ตอนนี้ (ไม่ขึ้นกับช่วงวันที่)</div><div data-t></div>';
          $("[data-t]", panel).appendChild(tableOrError(c.platform_campaigns, c.platform_campaigns_error, [{ key: "title", label: "แคมเปญ" }, { key: "status", label: "สถานะ", f: (v) => esc(typeof v === "object" ? JSON.stringify(v) : v) }, { key: "period", label: "ช่วงเวลา", f: (v) => esc(typeof v === "object" ? JSON.stringify(v) : v) }, { key: "sub_count", label: "แคมเปญย่อย", num: true, f: fmtNum }]));
        }
      };
      body.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => show(b.dataset.tab)));
      show(tabs.some(([k]) => k === state.tab) ? state.tab : "promo");
    }));
    setupAuto(() => runners.forEach((r) => r()));
  }

  // ---------- หน้า: แอฟฟิลิเอต ----------
  function pageAffiliate(root) {
    const runners = [];
    root.appendChild(h("<h1>แอฟฟิลิเอต (Affiliate Center)</h1>"));
    root.appendChild(toolbar(() => runners.forEach((r) => r())));
    runners.push(section(root, "ภาพรวมแอฟฟิลิเอต", () => api("affiliate", rangeParams()), (body, d) => {
      const c = d.current, p = d.compare, df = d.diff || {};
      body.innerHTML = `<div class="meta" style="margin:0 0 10px">Affiliate Center มีข้อมูลถึงวันที่ <b>${fmtDate(c.available_until)}</b></div>` + kpiGrid(AFF_KPIS, c.totals, p && p.totals, df)
        + `<div class="grid-2" style="margin-top:14px"><div><h3>GMV แอฟฟิลิเอตรายวัน</h3><div data-c1></div></div><div><h3>คอมมิชชั่นรายวัน</h3><div data-c2></div></div></div>
           <div class="grid-2" style="margin-top:14px"><div><h3>GMV ตามประเภทการร่วมงาน</h3><div data-c3></div></div><div><h3>ครีเอเตอร์ Top 10 (GMV)</h3><div data-c4></div></div></div>
           <h3 style="margin-top:14px">ครีเอเตอร์ที่ทำยอด (${fmtNum(c.creators.length)} จาก ${fmtNum(c.total_creators)})</h3><div data-t1></div>
           <h3 style="margin-top:14px">คำสั่งซื้อแอฟฟิลิเอตในช่วง (แสดง ${fmtNum(c.orders.list.length)} จาก ${fmtNum(c.orders.total)})</h3><div data-t2></div>`;
      dailyLine($("[data-c1]", body), c.daily, p && p.daily, "affiliate_gmv", "GMV", " บาท");
      dailyLine($("[data-c2]", body), c.daily, p && p.daily, "estimated_commission", "คอมมิชชั่น", " บาท");
      const COLLAB = { 1: "แผนเปิด (Open)", 2: "แผนเป้าหมาย (Target)", 3: "แผนร้านค้า (Shop)" };
      Charts.donut($("[data-c3]", body), { items: (c.collaboration || []).map((x) => ({ label: COLLAB[x.collaboration_type] || `ประเภท ${x.collaboration_type}`, value: x.gmv })) });
      Charts.hbars($("[data-c4]", body), { items: c.creators.slice(0, 10).map((x) => ({ label: x.nickname || x.handle, value: x.gmv })), unit: " ฿", color: Charts.PAL[1] });
      $("[data-t1]", body).appendChild(tableOrError(c.creators, c.creators_error, [{ key: "handle", label: "ครีเอเตอร์", f: (v, r) => `${esc(r.nickname || v)}<br><span class="muted">@${esc(v)} · ผู้ติดตาม ${fmtNum(r.followers)}</span>` }, { key: "gmv", label: "GMV", num: true, f: fmtBaht }, { key: "orders_cnt", label: "ออเดอร์", num: true, f: fmtNum }, { key: "items_sold_cnt", label: "ชิ้น", num: true, f: fmtNum }, { key: "estimated_commission", label: "คอมมิชชั่น", num: true, f: fmtBaht }, { key: "video_cnt", label: "วิดีโอ", num: true, f: fmtNum }, { key: "live_cnt", label: "LIVE", num: true, f: fmtNum }, { key: "video_gmv", label: "GMV วิดีโอ", num: true, f: fmtBaht }, { key: "live_gmv", label: "GMV LIVE", num: true, f: fmtBaht }, { key: "refunded_gmv", label: "คืนเงิน", num: true, f: fmtBaht }], { sortKey: "gmv" }));
      $("[data-t2]", body).appendChild(tableOrError(c.orders.list, c.orders.error, [{ key: "main_order_id", label: "เลขที่คำสั่งซื้อ" }, { key: "create_time", label: "เวลาสั่งซื้อ", f: (v) => (Number(v) > 1e12 ? fmtDTms(v) : fmtDT(v)) }, { key: "creator", label: "ครีเอเตอร์", f: (v, r) => esc(r.creator_nickname || v) }, { key: "product", label: "สินค้า" }, { key: "qty", label: "จำนวน", num: true, f: fmtNum }, { key: "sale_price", label: "ราคาขาย", num: true, f: fmtBaht }, { key: "commission_rate", label: "อัตราคอม", f: (v) => esc(v) }, { key: "commission", label: "คอมมิชชั่น", num: true, f: fmtBaht }, { key: "settlement_status", label: "สถานะชำระ", f: (v) => esc(v) }]));
    }));
    setupAuto(() => runners.forEach((r) => r()));
  }

  // ---------- หน้า: คำสั่งซื้อ ----------
  function pageOrders(root) {
    root.appendChild(h("<h1>คำสั่งซื้อ</h1>"));
    root.appendChild(toolbar(null));
    const tab = state.tab || "0";
    const run = section(root, `รายการคำสั่งซื้อ (หน้า ${state.page})`, () => api("orders", { start: state.start, end: state.end, page: state.page, tab }), (body, d) => {
      const tabs = Object.entries(d.tabs || {});
      const cnt = d.status_counts || {};
      body.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === d.tab ? "active" : ""}">${esc(l)}${cnt[k] !== undefined ? ` (${fmtNum(cnt[k])})` : ""}</button>`).join("")}</div>
        <div class="meta" style="margin:0 0 10px">ในช่วง ${fmtDate(d.range.start)} – ${fmtDate(d.range.end)} ทั้งหมด ${fmtNum(d.total)} รายการ · เรียงใหม่→เก่า · จำนวนในวงเล็บคือสถานะปัจจุบันทั้งร้าน (ไม่ขึ้นกับช่วงวันที่)${d.status_counts_error ? errInline(d.status_counts_error) : ""}</div><div data-t></div>
        <div class="pager"><button class="small" data-prev ${state.page <= 1 ? "disabled" : ""}>◀ ก่อนหน้า</button><span>หน้า ${state.page}</span><button class="small" data-next ${d.has_more === false ? "disabled" : ""}>ถัดไป ▶</button></div>`;
      $("[data-t]", body).appendChild(table(d.orders, [{ key: "order_id", label: "เลขที่", f: (v) => `<a target="_blank" rel="noopener" href="https://seller-th.tiktok.com/order/detail?order_no=${esc(v)}">${esc(v)}</a>` }, { key: "create_time", label: "สั่งซื้อ", f: fmtDTms }, { key: "buyer", label: "ผู้ซื้อ" }, { key: "items", label: "สินค้า", f: (v) => (v || []).map((i) => `${esc(i.name)} <span class="muted">${esc(i.sku || "")}</span> ×${fmtNum(i.qty)}${i.creator_note ? `<br><span class="badge">${esc(i.creator_note)}</span>` : ""}`).join("<br>") }, { key: "total", label: "ยอดรวม", num: true, f: fmtBaht }, { key: "shipping_fee", label: "ค่าส่ง", num: true, f: fmtBaht }, { key: "pay_method", label: "ชำระ", f: (v) => esc(v) }, { key: "status", label: "สถานะ", f: (v, r) => `${esc(v)}${r.sku_status ? `<br><span class="muted">${esc(r.sku_status)}</span>` : ""}` }, { key: "carrier", label: "ขนส่ง" }]));
      body.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; state.page = 1; writeHash(); }));
      $("[data-prev]", body).onclick = () => { state.page = Math.max(1, state.page - 1); writeHash(); };
      $("[data-next]", body).onclick = () => { state.page += 1; writeHash(); };
    });
    setupAuto(run);
  }

  // ---------- หน้า: รายงาน ----------
  function pageReport(root) {
    root.appendChild(h("<h1>รายงานข้อมูล TikTok Shop</h1>"));
    root.appendChild(toolbar(null));
    const bar = h('<div class="toolbar" style="margin-bottom:12px"><button class="primary" data-print>พิมพ์ / บันทึก PDF</button><button data-csv>ดาวน์โหลด CSV รายวัน</button></div>');
    root.appendChild(bar);
    const rp = rangeParams(); const cmp = compareRange();
    root.appendChild(h(`<section class="card"><h2>ช่วงข้อมูล</h2><div>ช่วงที่เลือก <b>${fmtDate(rp.start)} – ${fmtDate(rp.end)}</b>${cmp ? ` เปรียบเทียบกับ <b>${fmtDate(cmp.cmp_start)} – ${fmtDate(cmp.cmp_end)}</b>` : ""} · สร้างเมื่อ ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</div></section>`));
    const summary = h(`<section class="card"><h2>สรุปภาพรวม</h2><div class="grid" data-kpis></div><div class="grid-2" style="margin-top:14px"><div><h3>GMV ตามช่องทาง</h3><div data-mix><div class="skeleton"></div></div></div><div><h3>เปลี่ยนแปลงเทียบช่วงก่อน (%)</h3><div data-diff><div class="skeleton"></div></div></div></div><h3 style="margin-top:14px">GMV รายวัน</h3><div data-trend><div class="skeleton"></div></div></section>`);
    root.appendChild(summary);
    const sum = { kpis: {}, diffs: [], mix: {} };
    const drawSummary = () => {
      const k = sum.kpis;
      $("[data-kpis]", summary).innerHTML = [["GMV", k.gmv, fmtBaht], ["คำสั่งซื้อ", k.orders, fmtNum], ["ผู้เข้าชม", k.visitors, fmtNum], ["GMV จาก LIVE", k.live, fmtBaht], ["GMV แอฟฟิลิเอต", k.aff, fmtBaht], ["คอมมิชชั่นแอฟฟิลิเอต", k.aff_comm, fmtBaht], ["ค่าโฆษณา GMV Max", k.ads_cost, fmtBaht], ["ยอดขายจากโฆษณา", k.ads_gmv, fmtBaht], ["CIR โฆษณา (ค่าโฆษณา÷ยอดจากโฆษณา)", k.ads_cir, fmtPct], ["CIR ต่อ GMV ร้าน (ค่าโฆษณา÷GMV ทั้งร้าน)", k.gmv && k.ads_cost !== undefined && k.ads_cost !== null ? k.ads_cost / k.gmv : undefined, fmtPct]].filter((x) => x[1] !== undefined).map(([l, v, f]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${f(v)}</div></div>`).join("");
      if (Object.keys(sum.mix).length) Charts.donut($("[data-mix]", summary), { items: Object.entries(sum.mix).map(([label, value]) => ({ label, value })) });
      if (sum.diffs.length) Charts.diffBars($("[data-diff]", summary), { items: sum.diffs }); else if (!cmp) $("[data-diff]", summary).innerHTML = '<div class="muted">ไม่ได้เลือกช่วงเปรียบเทียบ</div>';
    };
    const dailyAll = {};
    const kpiTable = (defs, cur, cmpT, diff) => table(defs.map(([k, l, f]) => ({ metric: l, cur: cur ? cur[k] : null, cmp: cmpT ? cmpT[k] : null, diff: diff ? diff[k] : null, _f: f || fmtNum })), [{ key: "metric", label: "ตัวชี้วัด" }, { key: "cur", label: "ช่วงที่เลือก", num: true, f: (v, r) => r._f(v) }, ...(cmpT ? [{ key: "cmp", label: "ช่วงเปรียบเทียบ", num: true, f: (v, r) => r._f(v) }, { key: "diff", label: "เปลี่ยนแปลง", num: true, f: diffHtml }] : [])]);
    const dailyTable = (rows, keys) => table(rows, [{ key: "date", label: "วันที่", f: fmtDate }, ...keys.map(([k, l, f]) => ({ key: k, label: l, num: true, f: f || fmtNum }))]);
    const two = (b, t1, t2) => { const g = h(`<div class="grid-2" style="margin:12px 0"><div><h3>${t1}</h3><div data-a></div></div><div><h3>${t2}</h3><div data-b></div></div></div>`); b.appendChild(g); return [$("[data-a]", g), $("[data-b]", g)]; };
    const one = (b, t) => { const g = h(`<div style="margin:12px 0"><h3>${t}</h3><div data-a></div></div>`); b.appendChild(g); return $("[data-a]", g); };
    const cmpBars = (el, defs, cur, prev) => Charts.bars(el, { values: defs.map(([k]) => (cur ? cur[k] : null)), labels: defs.map(([, l]) => l), compare: prev ? defs.map(([k]) => prev[k]) : null });

    section(root, "1. ภาพรวมร้าน", () => api("overview", rp), (b, d) => {
      const c = d.current, p = d.compare;
      sum.kpis.gmv = c.totals.gmv; sum.kpis.orders = c.totals.orders; sum.kpis.visitors = c.totals.visitors; sum.kpis.live = c.totals.gmv_live;
      sum.mix = { "LIVE": c.sources.live, "วิดีโอ": c.sources.video, "การ์ดสินค้า": c.sources.card };
      if (d.diff) sum.diffs.push({ label: "GMV", value: d.diff.gmv }, { label: "คำสั่งซื้อ", value: d.diff.orders }, { label: "ผู้เข้าชม", value: d.diff.visitors }, { label: "คลิกสินค้า", value: d.diff.clicks }, { label: "Conversion", value: d.diff.conversion_rate }, { label: "GMV จาก LIVE", value: d.diff.gmv_live }, { label: "GMV จากวิดีโอ", value: d.diff.gmv_video });
      drawSummary();
      const [a1, a2] = two(b, "GMV รายวัน", "คำสั่งซื้อและลูกค้ารายวัน");
      dailyLine(a1, c.daily, p && p.daily, "gmv", "GMV", " บาท");
      Charts.line(a2, { series: [{ label: "คำสั่งซื้อ", values: c.daily.map((r) => r.orders), color: Charts.CUR }, { label: "ลูกค้า", values: c.daily.map((r) => r.customers), color: Charts.PAL[3] }], labels: c.daily.map((r) => fmtDate(r.date)) });
      dailyLine($("[data-trend]", summary), c.daily, p && p.daily, "gmv", "GMV", " บาท");
      if (p) { const e = one(b, "เทียบช่วงที่เลือก (น้ำเงิน) กับช่วงเปรียบเทียบ (ส้ม)"); cmpBars(e, [["gmv", "GMV"], ["gmv_live", "LIVE"], ["gmv_video", "วิดีโอ"], ["gmv_card", "การ์ดสินค้า"], ["refunds", "คืนเงิน"]], c.totals, p.totals); }
      b.appendChild(kpiTable(OVERVIEW_KPIS, c.totals, p && p.totals, d.diff));
      b.appendChild(h('<h3 style="margin-top:12px">รายวัน</h3>')); b.appendChild(dailyTable(c.daily, [["gmv", "GMV", fmtBaht], ["orders", "ออเดอร์"], ["customers", "ลูกค้า"], ["items_sold", "ชิ้น"], ["gmv_live", "LIVE", fmtBaht], ["gmv_video", "วิดีโอ", fmtBaht], ["gmv_card", "การ์ดสินค้า", fmtBaht], ["refunds", "คืนเงิน", fmtBaht], ["impressions", "แสดงผล"], ["clicks", "คลิก"]])); dailyAll.overview = c.daily;
    });
    section(root, "2. สินค้า", () => api("products", { start: rp.start, end: rp.end, size: 20 }), (b, d) => {
      const a = one(b, "สินค้าขายดี Top 10 (GMV)");
      Charts.hbars(a, { items: d.products.slice(0, 10).map((x) => ({ label: x.name, value: x.gmv })), unit: " ฿", color: Charts.PAL[0] });
      b.appendChild(h(`<h3 style="margin-top:12px">สินค้า Top 20 จาก ${fmtNum(d.total)} รายการ</h3>`)); b.appendChild(table(d.products, [{ key: "name", label: "สินค้า" }, { key: "gmv", label: "GMV", num: true, f: fmtBaht }, { key: "orders", label: "ออเดอร์", num: true, f: fmtNum }, { key: "items_sold", label: "ชิ้น", num: true, f: fmtNum }, { key: "clicks", label: "คลิก", num: true, f: fmtNum }, { key: "ctr", label: "CTR", num: true, f: fmtPct }, { key: "co_rate", label: "คลิก→ออเดอร์", num: true, f: fmtPct }, { key: "refunds", label: "คืนเงิน", num: true, f: fmtBaht }]));
    });
    section(root, "3. LIVE", () => api("live", rp), (b, d) => {
      const c = d.current, p = d.compare; if (c.note) b.appendChild(h(`<div class="note">${esc(c.note)}</div>`));
      if (d.diff) sum.diffs.push({ label: "ยอดวิว LIVE", value: d.diff.views }); drawSummary();
      const [a1, a2] = two(b, "ยอดขายจาก LIVE รายวัน", "ยอดวิวรายวัน");
      dailyLine(a1, c.daily, p && p.daily, "revenue", "ยอดขาย", " บาท"); dailyLine(a2, c.daily, p && p.daily, "views", "วิว");
      if (!c.sessions_error && c.sessions.length) { const a3 = one(b, "ไลฟ์ในช่วง: ยอดขายต่อรอบ (Top 10)"); Charts.hbars(a3, { items: c.sessions.slice(0, 10).map((s) => ({ label: `${fmtDT(s.start_time)} ${s.name || ""}`, value: s.revenue })), unit: " ฿", color: Charts.PAL[4] }); }
      b.appendChild(kpiTable(LIVE_KPIS, c.totals, p && p.totals, d.diff)); dailyAll.live = c.daily;
    });
    section(root, "4. วิดีโอ", () => api("video", rp), (b, d) => {
      const c = d.current, p = d.compare;
      const [a1, a2] = two(b, "GMV จากวิดีโอรายวัน", "วิดีโอ Top 10 (ยอดขาย)");
      dailyLine(a1, c.daily, p && p.daily, "gmv", "GMV", " บาท");
      Charts.hbars(a2, { items: (c.videos || []).slice(0, 10).map((v) => ({ label: v.name || v.id, value: v.revenue })), unit: " ฿", color: Charts.PAL[1] });
      b.appendChild(kpiTable(VIDEO_KPIS, c.totals, p && p.totals, d.diff)); dailyAll.video = c.daily;
    });
    section(root, "5. โปรโมชั่นและ GMV Max", () => api("marketing", rp), (b, d) => {
      const c = d.current, p = d.compare || {}, df = d.diff || {};
      const A = c.ads || {}, PA = p.ads || {};
      if (A.totals) { sum.kpis.ads_cost = A.totals.cost; sum.kpis.ads_gmv = A.totals.gmv; sum.kpis.ads_cir = A.totals.cir; if (df.ads) sum.diffs.push({ label: "ค่าโฆษณา", value: df.ads.cost }, { label: "CIR โฆษณา", value: df.ads.cir }); }
      if (df.revenue !== undefined) sum.diffs.push({ label: "ยอดขายผ่านโปรโมชั่น", value: df.revenue });
      drawSummary();
      const toolRows = Object.keys(c.tools || {}).filter((id) => id !== "6").map((id) => ({ label: c.tools[id], value: (c.by_tool[id] || {}).revenue }));
      const [a1, a2] = two(b, "ยอดขายตามเครื่องมือการตลาด", "GMV Max: ค่าโฆษณา vs ยอดขายจากโฆษณา");
      Charts.hbars(a1, { items: toolRows, unit: " ฿" });
      if (A.error) a2.appendChild(h(errInline(A.error))); else Charts.bars(a2, { values: [A.totals && A.totals.cost, A.totals && A.totals.gmv], labels: ["ค่าโฆษณา", "ยอดขายจากโฆษณา"], compare: PA.totals ? [PA.totals.cost, PA.totals.gmv] : null, unit: " บาท" });
      if (A.campaigns && A.campaigns.length) { const a3 = one(b, "แคมเปญ GMV Max ที่ใช้งบสูงสุด 10 อันดับ"); Charts.hbars(a3, { items: A.campaigns.slice(0, 10).map((x) => ({ label: x.name, value: x.cost })), unit: " ฿", color: Charts.PAL[2] }); }
      b.appendChild(h('<h3 style="margin-top:12px">โปรโมชั่น (ทุกเครื่องมือ)</h3>')); b.appendChild(kpiTable(PROMO_KPIS, c.totals, p.totals, df));
      b.appendChild(h('<h3 style="margin-top:12px">GMV Max</h3>')); b.appendChild(A.error ? h(errInline(A.error)) : kpiTable(ADS_KPIS, A.totals, PA.totals, df.ads));
      if (A.campaigns) { b.appendChild(h('<h3 style="margin-top:12px">แคมเปญ GMV Max</h3>')); b.appendChild(table(A.campaigns, [{ key: "name", label: "แคมเปญ" }, { key: "primary_status", label: "สถานะ" }, { key: "cost", label: "ค่าโฆษณา", num: true, f: fmtBaht }, { key: "gmv", label: "ยอดขาย", num: true, f: fmtBaht }, { key: "orders", label: "ออเดอร์", num: true, f: fmtNum }, { key: "roas", label: "ROAS", num: true, f: fmtRatio }, { key: "cir", label: "CIR", num: true, f: fmtPct }])); }
      dailyAll.promotion = c.daily; if (A.daily) dailyAll.ads = A.daily;
    });
    section(root, "6. แอฟฟิลิเอต", () => api("affiliate", rp), (b, d) => {
      const c = d.current, p = d.compare;
      sum.kpis.aff = c.totals.affiliate_gmv; sum.kpis.aff_comm = c.totals.estimated_commission; if (d.diff) sum.diffs.push({ label: "GMV แอฟฟิลิเอต", value: d.diff.affiliate_gmv }, { label: "คอมมิชชั่น", value: d.diff.estimated_commission }); drawSummary();
      const [a1, a2] = two(b, "GMV แอฟฟิลิเอตรายวัน", "ครีเอเตอร์ Top 10 (GMV)");
      dailyLine(a1, c.daily, p && p.daily, "affiliate_gmv", "GMV", " บาท");
      Charts.hbars(a2, { items: c.creators.slice(0, 10).map((x) => ({ label: x.nickname || x.handle, value: x.gmv })), unit: " ฿", color: Charts.PAL[1] });
      b.appendChild(kpiTable(AFF_KPIS, c.totals, p && p.totals, d.diff)); dailyAll.affiliate = c.daily;
    });
    $("[data-print]", bar).onclick = () => window.print();
    $("[data-csv]", bar).onclick = () => { for (const [k, rows] of Object.entries(dailyAll)) csvDownload(`tiktok-${k}-${rp.start}_${rp.end}.csv`, rows); if (!Object.keys(dailyAll).length) alert("ยังไม่มีข้อมูลรายวันที่โหลดสำเร็จ"); };
  }

  // ---------- หน้า: เชื่อมต่อ ----------
  function pageConnect(root) {
    root.appendChild(h("<h1>เชื่อมต่อ TikTok Seller Center / Affiliate Center</h1>"));
    const card = h(`<section class="card"><h2>สถานะ</h2><div data-status><div class="skeleton"></div></div></section>`); root.appendChild(card);
    const form = h(`<section class="card"><h2>วาง Cookie ของ session</h2>
      <div class="steps">1. เปิด Chrome ไปที่ <a href="https://seller-th.tiktok.com" target="_blank" rel="noopener">seller-th.tiktok.com</a> และล็อกอินให้เรียบร้อย<br>
      2. กด <b>F12</b> (หรือ ⌥⌘I บน Mac) → แท็บ <b>Network</b> → รีเฟรชหน้า (F5)<br>
      3. คลิก request ใดก็ได้ที่ขึ้นต้นด้วย <code>api/</code> → ดูส่วน <b>Request Headers</b> → คัดลอกค่าทั้งบรรทัดของ <code>Cookie:</code> มาวางในช่องแรก<br>
      4. ช่องที่สอง (affiliate.tiktok.com) <b>ไม่จำเป็นต้องวาง</b> — cookie ของ seller ใช้กับ Affiliate Center ได้ ระบบจะสลับให้อัตโนมัติถ้าชุดใดใช้ไม่ได้<br>
      5. กด "บันทึกและทดสอบ" — ระบบจะตรวจ shop_id และชื่อร้านจาก TikTok ให้อัตโนมัติ<br>
      <span class="muted">Cookie เป็นข้อมูลลับเทียบเท่ารหัสผ่าน — เก็บในไฟล์ <code>data/session.json</code> บนเซิร์ฟเวอร์นี้เท่านั้น และหมดอายุได้เป็นระยะ (ถ้าหมดอายุ แอปจะแจ้ง error ให้วางใหม่) · ถ้าใส่ช่องใดว่างไว้ จะใช้ค่าเดิมที่บันทึกไว้</span></div>
      <label class="muted small">Cookie ของ seller-th.tiktok.com</label>
      <textarea data-seller placeholder="sessionid=...; sid_tt=...; ..."></textarea>
      <label class="muted small" style="margin-top:8px;display:block">Cookie ของ affiliate.tiktok.com (ไม่บังคับ)</label>
      <textarea data-aff placeholder="sessionid=...; ..."></textarea>
      <div class="toolbar" style="margin-top:8px"><button class="primary" data-save>บันทึกและทดสอบ</button><button data-logout>ตัดการเชื่อมต่อ</button></div><div data-msg></div></section>`);
    root.appendChild(form);
    const loadStatus = async () => {
      const box = $("[data-status]", card);
      try { const r = await api("status"); const s = r.data; box.innerHTML = `<div class="grid">${kpi("Seller Center", s.connected ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ", undefined, null, (v) => v)}${kpi("Affiliate Center", s.affiliate_connected ? (s.affiliate_cookie_used === "seller" ? "เชื่อมต่อแล้ว (ใช้ cookie ของ seller)" : "เชื่อมต่อแล้ว") : "ยังไม่เชื่อมต่อ", undefined, null, (v) => v)}${kpi("ร้าน", s.shop_name || "–", undefined, null, esc)}${kpi("Shop ID", s.shop_id || "–", undefined, null, esc)}${kpi("บันทึก cookie เมื่อ", s.saved_at && s.saved_at !== "env" ? new Date(s.saved_at).toLocaleString("th-TH") : s.saved_at === "env" ? "จาก environment" : "–", undefined, null, (v) => v)}${kpi("ดึงข้อมูลสำเร็จล่าสุด", s.last_ok_at ? new Date(s.last_ok_at).toLocaleString("th-TH") : "–", undefined, null, (v) => v)}</div>${s.last_error ? `<div class="error" style="margin-top:10px">error ล่าสุด: ${esc(s.last_error)}</div>` : ""}${s.cookie_from_env ? '<div class="note" style="margin-top:10px">cookie ถูกตั้งจาก environment ของโฮสต์ (TIKTOK_COOKIE) — การวางใหม่ที่นี่จะใช้จนกว่าเซิร์ฟเวอร์รีสตาร์ต</div>' : ""}`; setPill(s); }
      catch (e) { box.innerHTML = ""; box.appendChild(errorBox(e, loadStatus)); }
    };
    loadStatus();
    $("[data-save]", form).onclick = async () => {
      const msg = $("[data-msg]", form); msg.innerHTML = '<div class="skeleton" style="height:40px"></div>';
      try { const r = await api("saveSession", { seller_cookie: $("[data-seller]", form).value, affiliate_cookie: $("[data-aff]", form).value }); msg.innerHTML = `<div class="note" style="background:#e7f6ec;border-color:#9ad4ac;color:#14532d">เชื่อมต่อ Seller Center สำเร็จ: <b>${esc(r.data.shop_name)}</b> (shop_id ${esc(r.data.shop_id)})<br>Affiliate Center: ${r.data.affiliate_ok ? (r.data.affiliate_cookie_used === "seller" ? "สำเร็จ (ใช้ cookie ของ seller)" : "สำเร็จ") : r.data.affiliate_error ? `ล้มเหลว — ${esc(r.data.affiliate_error)}` : "ยังไม่วาง cookie"}</div>`; $("[data-seller]", form).value = ""; $("[data-aff]", form).value = ""; loadStatus(); }
      catch (e) { msg.innerHTML = ""; msg.appendChild(errorBox(e, () => $("[data-save]", form).click())); }
    };
    $("[data-logout]", form).onclick = async () => { if (!confirm("ลบ cookie ที่บันทึกไว้ทั้งหมด?")) return; await api("logout"); loadStatus(); };
  }

  // ---------- router ----------
  function setPill(s) { const p = $("#statusPill"); const lo = $("#logoutLink"); if (lo) lo.style.display = s && s.auth_enabled ? "" : "none"; if (!s) { p.textContent = "ตรวจสอบไม่ได้"; p.className = "status-pill bad"; return; } p.textContent = s.connected ? `เชื่อมต่อ: ${s.shop_name || s.shop_id}` : "ยังไม่เชื่อมต่อ TikTok"; p.className = "status-pill " + (s.connected ? "ok" : "bad"); }
  const PAGES = { dashboard: pageDashboard, live: pageLive, video: pageVideo, products: pageProducts, marketing: pageMarketing, affiliate: pageAffiliate, orders: pageOrders, report: pageReport, connect: pageConnect };
  function render() {
    readHash();
    if (!PAGES[state.route]) state.route = "dashboard";
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === state.route));
    document.querySelectorAll("#nav a").forEach((a) => { const q = new URLSearchParams({ start: state.start, end: state.end, cmpMode: state.cmpMode }); if (state.cmpMode === "custom") { q.set("cmp_start", state.cmp_start); q.set("cmp_end", state.cmp_end); } a.href = `#/${a.dataset.route}?${q}`; });
    setupAuto(null);
    const root = $("#app"); root.innerHTML = "";
    PAGES[state.route](root);
    writeHash(true);
  }
  window.addEventListener("hashchange", render);
  api("status").then((r) => setPill(r.data)).catch(() => setPill(null));
  render();
})();
