// charts.js — กราฟ SVG ล้วน (ไม่ใช้ไลบรารี)
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const CUR = "#2a78d6", CMP = "#eb6834";
  const PAL = ["#ee4d2d", "#2a78d6", "#eb6834", "#2e9e6b", "#8e5cd9", "#d9a600", "#6b7280"];
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const fmt = (n) => (n === null || n === undefined || isNaN(n) ? "–" : Number(n).toLocaleString("th-TH", { maximumFractionDigits: 2 }));
  const nice = (max) => { if (!max || max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; const s = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10; return s * p; };

  // series: [{label, values:[number|null], color, dashed}] ; labels: x labels
  function line(container, { series, labels, height = 240, unit = "" }) {
    container.innerHTML = "";
    const W = Math.max(320, container.clientWidth || 640), H = height, pad = { l: 56, r: 16, t: 16, b: 34 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart" }, container);
    const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined && !isNaN(v));
    const max = nice(Math.max(0, ...all) * 1.05);
    const n = Math.max(...series.map((s) => s.values.length), labels.length, 1);
    const x = (i) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
    for (let g = 0; g <= 4; g++) {
      const v = (max * g) / 4;
      el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid" }, svg);
      const t = el("text", { x: pad.l - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, svg); t.textContent = fmt(v);
    }
    const step = Math.ceil(n / Math.max(1, Math.floor((W - pad.l - pad.r) / 70)));
    labels.forEach((lb, i) => { if (i % step === 0 || i === n - 1) { const t = el("text", { x: x(i), y: H - 10, class: "tick", "text-anchor": "middle" }, svg); t.textContent = lb; } });
    series.forEach((s) => {
      let d = ""; let started = false;
      s.values.forEach((v, i) => { if (v === null || v === undefined || isNaN(v)) { started = false; return; } d += (started ? "L" : "M") + x(i) + "," + y(v) + " "; started = true; });
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.2, "stroke-dasharray": s.dashed ? "6 5" : "none", "stroke-linejoin": "round" }, svg);
      s.values.forEach((v, i) => { if (v === null || v === undefined || isNaN(v)) return; const c = el("circle", { cx: x(i), cy: y(v), r: 3.2, fill: "#fff", stroke: s.color, "stroke-width": 2 }, svg); const tt = el("title", {}, c); tt.textContent = `${s.label} — ${s.xlabels ? s.xlabels[i] : labels[i]}: ${fmt(v)}${unit}`; });
    });
    legend(container, series);
  }

  function bars(container, { values, labels, color = CUR, height = 200, unit = "", compare = null }) {
    container.innerHTML = "";
    const W = Math.max(320, container.clientWidth || 640), H = height, pad = { l: 56, r: 12, t: 12, b: 30 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart" }, container);
    const all = values.concat(compare || []).filter((v) => v !== null && !isNaN(v));
    const max = nice(Math.max(0, ...all) * 1.05);
    const n = values.length || 1; const bw = (W - pad.l - pad.r) / n;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
    for (let g = 0; g <= 4; g++) { const v = (max * g) / 4; el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid" }, svg); const t = el("text", { x: pad.l - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, svg); t.textContent = fmt(v); }
    values.forEach((v, i) => {
      const x0 = pad.l + i * bw;
      if (compare && compare[i] !== null && compare[i] !== undefined) { const r = el("rect", { x: x0 + bw * 0.5, y: y(compare[i]), width: bw * 0.35, height: Math.max(0, y(0) - y(compare[i])), fill: CMP, opacity: 0.7, rx: 2 }, svg); const tt = el("title", {}, r); tt.textContent = `เปรียบเทียบ ${labels[i]}: ${fmt(compare[i])}${unit}`; }
      if (v !== null && v !== undefined) { const r = el("rect", { x: x0 + bw * (compare ? 0.12 : 0.2), y: y(v), width: bw * (compare ? 0.35 : 0.6), height: Math.max(0, y(0) - y(v)), fill: color, rx: 2 }, svg); const tt = el("title", {}, r); tt.textContent = `${labels[i]}: ${fmt(v)}${unit}`; }
      const step = Math.ceil(n / Math.max(1, Math.floor((W - pad.l - pad.r) / 48)));
      if (i % step === 0) { const t = el("text", { x: x0 + bw / 2, y: H - 8, class: "tick", "text-anchor": "middle" }, svg); t.textContent = labels[i]; }
    });
  }

  function donut(container, { items, height = 220 }) {
    container.innerHTML = "";
    const total = items.reduce((a, b) => a + (Number(b.value) || 0), 0);
    const wrap = document.createElement("div"); wrap.className = "donut-wrap"; container.appendChild(wrap);
    const svg = el("svg", { viewBox: "0 0 200 200", width: height, height, class: "chart" }, wrap);
    if (!total) { const t = el("text", { x: 100, y: 105, class: "tick", "text-anchor": "middle" }, svg); t.textContent = "ไม่มีข้อมูล"; }
    let a0 = -Math.PI / 2; const R = 80, r = 50;
    items.forEach((it, i) => {
      const v = Number(it.value) || 0; if (!v || !total) return;
      const a1 = a0 + (2 * Math.PI * v) / total; const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, rad) => [100 + rad * Math.cos(a), 100 + rad * Math.sin(a)];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
      const path = el("path", { d: `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`, fill: it.color || PAL[i % PAL.length] }, svg);
      const tt = el("title", {}, path); tt.textContent = `${it.label}: ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`;
      a0 = a1;
    });
    const lg = document.createElement("div"); lg.className = "legend legend-col"; wrap.appendChild(lg);
    items.forEach((it, i) => { const d = document.createElement("div"); d.innerHTML = `<span class="sw" style="background:${it.color || PAL[i % PAL.length]}"></span>${it.label} <b>${fmt(it.value)}</b> <span class="muted">${total ? (((Number(it.value) || 0) / total) * 100).toFixed(1) + "%" : ""}</span>`; lg.appendChild(d); });
  }


  // แท่งแนวนอน: items = [{label, value, color?}]
  function hbars(container, { items, unit = "", color = CUR, height }) {
    container.innerHTML = "";
    const W = Math.max(320, container.clientWidth || 640); const rowH = 26; const pad = { l: 200, r: 70, t: 8, b: 8 };
    const H = height || pad.t + pad.b + rowH * Math.max(1, items.length);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart" }, container);
    const max = Math.max(0, ...items.map((i) => Number(i.value) || 0)) || 1;
    items.forEach((it, i) => {
      const y = pad.t + i * rowH; const v = Number(it.value) || 0; const w = ((W - pad.l - pad.r) * v) / max;
      const t = el("text", { x: pad.l - 8, y: y + rowH / 2 + 4, class: "tick", "text-anchor": "end" }, svg); t.textContent = String(it.label).length > 34 ? String(it.label).slice(0, 33) + "…" : it.label;
      const r = el("rect", { x: pad.l, y: y + 5, width: Math.max(0, w), height: rowH - 10, fill: it.color || color, rx: 3 }, svg); const tt = el("title", {}, r); tt.textContent = `${it.label}: ${fmt(v)}${unit}`;
      const vt = el("text", { x: pad.l + w + 6, y: y + rowH / 2 + 4, class: "tick" }, svg); vt.textContent = fmt(v) + unit;
    });
  }
  // แท่ง % เปลี่ยนแปลง (บวก=เขียว ลบ=แดง) items = [{label, value(ratio)}]
  function diffBars(container, { items, height }) {
    container.innerHTML = "";
    const W = Math.max(320, container.clientWidth || 640); const rowH = 24; const pad = { l: 190, r: 70, t: 8, b: 8 };
    const H = height || pad.t + pad.b + rowH * Math.max(1, items.length);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart" }, container);
    const vals = items.map((i) => (i.value === null || i.value === undefined || isNaN(i.value) ? 0 : Number(i.value) * 100));
    const max = Math.max(5, ...vals.map(Math.abs)); const cx = pad.l + (W - pad.l - pad.r) / 2; const scale = (W - pad.l - pad.r) / 2 / max;
    el("line", { x1: cx, x2: cx, y1: pad.t, y2: H - pad.b, class: "grid", stroke: "#9ca3af" }, svg);
    items.forEach((it, i) => {
      const y = pad.t + i * rowH; const v = vals[i]; const nil = it.value === null || it.value === undefined || isNaN(it.value);
      const t = el("text", { x: pad.l - 8, y: y + rowH / 2 + 4, class: "tick", "text-anchor": "end" }, svg); t.textContent = it.label;
      if (!nil) { const w = Math.abs(v) * scale; const r = el("rect", { x: v >= 0 ? cx : cx - w, y: y + 5, width: Math.max(1, w), height: rowH - 10, fill: v >= 0 ? "#16a34a" : "#dc2626", rx: 3 }, svg); const tt = el("title", {}, r); tt.textContent = `${it.label}: ${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
      const vt = el("text", { x: nil ? cx + 6 : v >= 0 ? cx + Math.abs(v) * scale + 6 : cx - Math.abs(v) * scale - 6, y: y + rowH / 2 + 4, class: "tick", "text-anchor": nil || v >= 0 ? "start" : "end" }, svg); vt.textContent = nil ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
    });
  }
  // กรวย (funnel) แนวตั้ง: steps = [{label, value}]
  function funnel(container, { steps, unit = "" }) {
    container.innerHTML = "";
    const W = Math.max(320, container.clientWidth || 640); const rowH = 44; const H = rowH * steps.length + 10;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart" }, container);
    const max = Math.max(0, ...steps.map((s) => Number(s.value) || 0)) || 1;
    steps.forEach((s, i) => {
      const v = Number(s.value) || 0; const w = Math.max(40, (W - 40) * (0.3 + 0.7 * (v / max))); const x = (W - w) / 2; const y = 5 + i * rowH;
      const r = el("rect", { x, y, width: w, height: rowH - 8, fill: PAL[(i + 1) % PAL.length], rx: 6, opacity: 0.9 }, svg); const tt = el("title", {}, r); tt.textContent = `${s.label}: ${fmt(v)}${unit}`;
      const t = el("text", { x: W / 2, y: y + rowH / 2 + 1, "text-anchor": "middle", fill: "#fff", "font-size": 13, "font-weight": 600 }, svg); t.textContent = `${s.label}  ${fmt(v)}${unit}`;
      if (i > 0) { const prev = Number(steps[i - 1].value) || 0; const rate = prev ? ((v / prev) * 100).toFixed(1) + "%" : "–"; const rt = el("text", { x: W - 4, y: y + rowH / 2 + 4, class: "tick", "text-anchor": "end" }, svg); rt.textContent = "→ " + rate; }
    });
  }

  function legend(container, series) {
    const lg = document.createElement("div"); lg.className = "legend";
    series.forEach((s) => { const d = document.createElement("span"); d.innerHTML = `<span class="sw ${s.dashed ? "dashed" : ""}" style="background:${s.dashed ? "transparent" : s.color};border-color:${s.color}"></span>${s.label}`; lg.appendChild(d); });
    container.appendChild(lg);
  }

  window.Charts = { line, bars, donut, hbars, diffBars, funnel, CUR, CMP, PAL };
})();
