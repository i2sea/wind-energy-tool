import * as pdfjsLib from './lib/pdf.min.mjs';
import COAST_KR from './lib/coast-kr.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
const W = window.WindCore;

/* ================= 상태 ================= */
const uid = () => Math.random().toString(36).slice(2, 9);
const newSite = () => ({ id: uid(), name: '', lat: '', lon: '', elev: '', note: '', src: {}, datasets: [], sel: null, design: null });
let P = { name: '새 프로젝트', sites: [newSite()], active: null, tolM: 1000, zones: [] };
const siteName = s => s.name || '(이름 없음)';
const isEmpty = v => v === '' || v == null || (typeof v === 'number' && !Number.isFinite(v));
const SRCNAME = f => String(f || '').replace(/^[0-9a-f]{8}-/, '');
function autofill(S, key, value, src) { if (!S.src) S.src = {}; if (!isEmpty(S[key]) || isEmpty(value) || value === '') return false; S[key] = value; S.src[key] = src; return true; }
P.active = P.sites[0].id;
const site = () => P.sites.find(s => s.id === P.active) || P.sites[0];
const dsSel = () => { const s = site(); return s.datasets.find(d => d.id === s.sel) || null; };
const ui = { rose: 'freq', month: 'ym', wgHeight: null, secH: null, tab: 'wind', turbSel: null };
const ensureTurbines = () => { if (!Array.isArray(P.turbines) || !P.turbines.length) P.turbines = [JSON.parse(JSON.stringify(W.DOOSAN_DS205_10))]; };

/* ================= 도우미 ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-';
const fi = v => Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '-';
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', ms); }
const tip = $('#tip');
document.addEventListener('mousemove', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el) { tip.style.display = 'none'; return; }
  tip.innerHTML = el.getAttribute('data-tip'); tip.style.display = 'block';
  const w = tip.offsetWidth; tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 34) + 'px';
});
const rhoDefault = 1.225;
// 기온(측정 높이 zs, 해발)과 표준 해면기압으로 높이 z의 공기밀도
const rhoFromT = (T, zs, z) => { const Tz = T + 273.15 - 0.0065 * (z - zs); const Pz = 101325 * Math.pow(1 - 0.0065 * z / 288.15, 5.2559); return Pz / (287.05 * Tz); };

/* ================= 그래프 (SVG) ================= */
const RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const rampAt = (i, n) => RAMP[n <= 1 ? 6 : Math.round(i * (RAMP.length - 1) / (n - 1))];
function nice(min, max, n = 5) {
  if (!(max > min)) { max = min + 1; }
  const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = []; for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks, step };
}
function frame(w, h, m) { return { w, h, m, iw: w - m.l - m.r, ih: h - m.t - m.b }; }
function axes(F, xs, ys, xl, yl, xfmt = v => v, yfmt = v => v) {
  let s = `<g class="grid">`;
  for (const t of ys.ticks) s += `<line x1="${F.m.l}" x2="${F.w - F.m.r}" y1="${ys.y(t)}" y2="${ys.y(t)}"/>`;
  s += `</g><g class="ax">`;
  s += `<line x1="${F.m.l}" x2="${F.w - F.m.r}" y1="${F.h - F.m.b}" y2="${F.h - F.m.b}"/>`;
  for (const t of ys.ticks) s += `<text x="${F.m.l - 5}" y="${ys.y(t) + 3}" text-anchor="end">${yfmt(t)}</text>`;
  for (const t of xs.ticks) s += `<text x="${xs.x(t)}" y="${F.h - F.m.b + 13}" text-anchor="middle">${xfmt(t)}</text>`;
  s += `</g>`;
  if (xl) s += `<text class="lbl" x="${F.m.l + F.iw / 2}" y="${F.h - 2}" text-anchor="middle">${xl}</text>`;
  if (yl) s += `<text class="lbl" transform="translate(9,${F.m.t + F.ih / 2}) rotate(-90)" text-anchor="middle">${yl}</text>`;
  return s;
}
function chartHist(hist, k, A, title) {
  const F = frame(420, 230, { l: 40, r: 10, t: 10, b: 30 });
  let maxV = 0; hist.forEach((v, i) => { if (v > 0.01) maxV = i; }); const vmax = Math.max(15, maxV + 2);
  const pdfMax = Math.max(...hist.slice(0, vmax), ...Array.from({ length: vmax * 4 }, (_, i) => 100 * W.weibullPdf(i / 4, k, A)));
  const ys = nice(0, pdfMax), xs = nice(0, vmax, 6);
  ys.y = v => F.m.t + F.ih - (v - ys.lo) / (ys.hi - ys.lo) * F.ih; xs.x = v => F.m.l + (v - xs.lo) / (xs.hi - xs.lo) * F.iw;
  let s = axes(F, xs, ys, '풍속 (m/s)', '빈도 (%)');
  const bw = F.iw / (xs.hi - xs.lo);
  for (let i = 0; i < vmax; i++) { const v = hist[i] || 0; if (!v) continue; const y = ys.y(v); s += `<rect x="${xs.x(i) + 1}" y="${y}" width="${Math.max(1, bw - 2)}" height="${ys.y(0) - y}" rx="2" fill="#86b6ef" data-tip="${i}–${i + 1} m/s: ${f(v, 1)}%"/>`; }
  if (Number.isFinite(k)) { let d = ''; for (let i = 0; i <= vmax * 10; i++) { const v = i / 10; d += (i ? 'L' : 'M') + xs.x(v).toFixed(1) + ',' + ys.y(100 * W.weibullPdf(v + 0.0001, k, A)).toFixed(1); } s += `<path d="${d}" fill="none" stroke="#0d366b" stroke-width="2"/>`; }
  return `<div class="chart"><div class="ct">${title}</div><svg viewBox="0 0 ${F.w} ${F.h}">${s}</svg><div class="legend"><span><i style="background:#86b6ef"></i>측정</span><span><i style="background:#0d366b"></i>Weibull k=${f(k, 3)}, A=${f(A, 2)} m/s</span></div></div>`;
}
function chartRose(sectors, mode, title, act) {
  const S = 260, c = S / 2, R = 104;
  const val = x => mode === 'energy' ? x.energyPct : mode === 'mean' ? x.mean : x.freq;
  const vals = sectors.map(val).map(v => Number.isFinite(v) ? v : 0);
  const vmax = nice(0, Math.max(...vals), 4);
  const n = sectors.length, sw = 2 * Math.PI / n;
  let s = '';
  for (const t of vmax.ticks.slice(1)) { const r = R * t / vmax.hi; s += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e6e5df"/><text x="${c + 3}" y="${c - r - 2}" class="ax" style="font-size:9px;fill:#8a8984;font-family:var(--mono)">${t}${mode === 'mean' ? '' : '%'}</text>`; }
  for (let i = 0; i < n; i++) { const a = i * sw - Math.PI / 2; s += `<line x1="${c}" y1="${c}" x2="${c + R * Math.cos(a)}" y2="${c + R * Math.sin(a)}" stroke="#efeee9"/>`; }
  ['N', 'E', 'S', 'W'].forEach((l, i) => { const a = i * Math.PI / 2 - Math.PI / 2; s += `<text x="${c + (R + 13) * Math.cos(a)}" y="${c + (R + 13) * Math.sin(a) + 4}" text-anchor="middle" class="lbl" style="font-weight:500">${l}</text>`; });
  sectors.forEach((x, i) => {
    const r = R * vals[i] / vmax.hi; if (r <= 0) return;
    const a0 = i * sw - sw / 2 * 0.86 - Math.PI / 2, a1 = i * sw + sw / 2 * 0.86 - Math.PI / 2;
    s += `<path d="M${c},${c}L${c + r * Math.cos(a0)},${c + r * Math.sin(a0)}A${r},${r} 0 0 1 ${c + r * Math.cos(a1)},${c + r * Math.sin(a1)}Z" fill="#2a78d6" fill-opacity=".85" stroke="#fcfcfb" stroke-width="1.5" data-tip="${x.dir}°: 빈도 ${f(x.freq, 1)}% · 평균 ${f(x.mean, 2)} m/s · 에너지 ${f(x.energyPct, 1)}%"/>`;
  });
  const b = (m, l) => `<button data-act="${act}" data-v="${m}" class="${mode === m ? 'on' : ''}">${l}</button>`;
  return `<div class="chart"><div class="ct">${title}<span class="seg">${b('freq', '빈도')}${b('energy', '에너지')}${b('mean', '평균풍속')}</span></div><svg viewBox="0 0 ${S} ${S}" style="max-width:300px;margin:0 auto">${s}</svg></div>`;
}
function chartBars(labels, vals, title, yl, tipFmt, ns) {
  const F = frame(420, 230, { l: 50, r: 10, t: 10, b: 44 });
  const ok = vals.filter(Number.isFinite); if (!ok.length) return '';
  const ys = nice(0, Math.max(...ok)); ys.y = v => F.m.t + F.ih - v / ys.hi * F.ih;
  const n = labels.length, bw = F.iw / n;
  let s = axes(F, { ticks: [] }, ys, '', yl);
  vals.forEach((v, i) => {
    const x = F.m.l + i * bw;
    if (Number.isFinite(v)) { const y = ys.y(v); s += `<rect x="${x + bw * 0.15}" y="${y}" width="${bw * 0.7}" height="${ys.y(0) - y}" rx="2" fill="${ns && ns[i] != null && ns[i] < 0.8 ? '#b7d3f6' : '#2a78d6'}" data-tip="${esc(tipFmt(i, v))}"/>`; }
    if (n <= 16 || i % Math.ceil(n / 16) === 0) s += `<text x="${x + bw / 2}" y="${F.h - F.m.b + 12}" text-anchor="end" transform="rotate(-40 ${x + bw / 2} ${F.h - F.m.b + 12})" class="ax" style="font-size:9.5px;fill:#8a8984;font-family:var(--mono)">${labels[i]}</text>`;
  });
  return `<div class="chart"><div class="ct">${title}</div><svg viewBox="0 0 ${F.w} ${F.h}">${s}</svg>${ns ? '<div class="legend"><span><i style="background:#b7d3f6"></i>회수율 80% 미만 기간</span></div>' : ''}</div>`;
}
function chartLines(xvals, series, title, xl, yl, extra) {
  const F = frame(420, 230, { l: 40, r: 10, t: 10, b: 30 });
  const all = series.flatMap(s => s.y.filter(Number.isFinite)); if (!all.length) return '';
  const ys = nice(Math.min(...all) * (extra?.zero ? 0 : 0.95), Math.max(...all)), xs = nice(Math.min(...xvals), Math.max(...xvals), 6);
  if (extra?.xticks) xs.ticks = extra.xticks;
  ys.y = v => F.m.t + F.ih - (v - ys.lo) / (ys.hi - ys.lo) * F.ih; xs.x = v => F.m.l + (v - xs.lo) / (xs.hi - xs.lo) * F.iw;
  let s = axes(F, xs, ys, xl, yl, v => v, extra?.yfmt || (v => v));
  for (const S of series) {
    let d = '', pen = false;
    S.y.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + xs.x(xvals[i]).toFixed(1) + ',' + ys.y(v).toFixed(1); pen = true; });
    s += `<path d="${d}" fill="none" stroke="${S.c}" stroke-width="${S.w || 2}" ${S.dash ? 'stroke-dasharray="4 3"' : ''}/>`;
    S.y.forEach((v, i) => { if (Number.isFinite(v)) s += `<circle cx="${xs.x(xvals[i])}" cy="${ys.y(v)}" r="6" fill="transparent" data-tip="${esc(S.name)} · ${xl.replace(/ \(.*/, '')} ${xvals[i]}: ${f(v, extra?.d ?? 2)}"/>`; });
  }
  const lg = series.length > 1 ? `<div class="legend">${series.map(S => `<span><i style="background:${S.c}"></i>${esc(S.name)}</span>`).join('')}</div>` : '';
  return `<div class="chart"><div class="ct">${title}</div><svg viewBox="0 0 ${F.w} ${F.h}">${s}</svg>${lg}</div>`;
}
function chartProfile(pts, alpha, fitV, hub, title) {
  // pts: [{z, v}], z = 해발
  const F = frame(420, 250, { l: 44, r: 12, t: 10, b: 30 });
  const zs = pts.map(p => p.z).concat(hub ? [hub.z] : []), vs = pts.map(p => p.v).concat(hub ? [hub.v] : []);
  const ys = nice(0, Math.max(...zs) * 1.05), xs = nice(Math.min(...vs) * 0.9, Math.max(...vs) * 1.04, 5);
  ys.y = v => F.m.t + F.ih - (v - ys.lo) / (ys.hi - ys.lo) * F.ih; xs.x = v => F.m.l + (v - xs.lo) / (xs.hi - xs.lo) * F.iw;
  let s = axes(F, xs, ys, '평균풍속 (m/s)', '높이 (해발 m)');
  if (fitV) { let d = ''; for (let z = Math.max(5, ys.lo); z <= ys.hi; z += (ys.hi - ys.lo) / 60) { const v = fitV(z); if (v < xs.lo || v > xs.hi) continue; d += (d ? 'L' : 'M') + xs.x(v).toFixed(1) + ',' + ys.y(z).toFixed(1); } s += `<path d="${d}" fill="none" stroke="#8a8984" stroke-width="1.5" stroke-dasharray="4 3"/>`; }
  pts.forEach(p => s += `<circle cx="${xs.x(p.v)}" cy="${ys.y(p.z)}" r="4.5" fill="#2a78d6" stroke="#fcfcfb" stroke-width="2" data-tip="해발 ${f(p.z, 1)} m: ${f(p.v, 3)} m/s"/>`);
  if (hub) s += `<path d="M${xs.x(hub.v)},${ys.y(hub.z) - 6}l6,6l-6,6l-6,-6z" fill="#eb6834" stroke="#fcfcfb" stroke-width="1.5" data-tip="허브 해발 ${f(hub.z, 1)} m: ${f(hub.v, 3)} m/s"/>`;
  return `<div class="chart"><div class="ct">${title}</div><svg viewBox="0 0 ${F.w} ${F.h}">${s}</svg><div class="legend"><span><i style="background:#2a78d6"></i>측정 평균</span><span><i style="background:#8a8984"></i>멱법칙 α = ${f(alpha, 3)}</span>${hub ? '<span><i style="background:#eb6834"></i>허브높이</span>' : ''}</div></div>`;
}

/* ================= 파일 읽기 ================= */
async function pdfPages(buf) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push(W.itemsToLines(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))));
  }
  return out;
}
function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { try { return new TextDecoder('euc-kr').decode(u8); } catch (e2) { return new TextDecoder('utf-8').decode(u8); } }
}
async function expandFiles(fileList) {
  const out = [];
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) {
      const z = await JSZip.loadAsync(await file.arrayBuffer());
      for (const [name, ent] of Object.entries(z.files)) { if (ent.dir || /(^|\/)(__MACOSX|\.)/.test(name)) continue; out.push({ name: name.split('/').pop(), buf: await ent.async('arraybuffer') }); }
    } else out.push({ name: file.name, buf: await file.arrayBuffer() });
  }
  return out;
}
// 좌표로 지점 찾기/만들기. loc: {lat, lon, label, src, elev?}
const TOL = () => +P.tolM > 0 ? +P.tolM : 1000;
const siteCoord = s => { const lat = W.num(s.lat), lon = W.num(s.lon); return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null; };
function nearestSite(loc) { let best = null, bd = Infinity; for (const s of P.sites) { const c = siteCoord(s); if (!c) continue; const d = W.distM(c, loc); if (d < bd) { bd = d; best = s; } } return { site: best, dist: bd }; }
function siteForLoc(loc, created) {
  const { site: ns, dist } = nearestSite(loc);
  if (ns && dist <= TOL()) return ns;
  const A = site(); migrateSite(A);
  if (!siteCoord(A) && !A.datasets.length) { fillLoc(A, loc); return A; }
  const S = newSite(); fillLoc(S, loc); P.sites.push(S); if (created) created.push(S); return S;
}
function fillLoc(S, loc) {
  autofill(S, 'lat', +loc.lat.toFixed(6), loc.src); autofill(S, 'lon', +loc.lon.toFixed(6), loc.src);
  if (loc.label) autofill(S, 'name', loc.label, loc.src);
  if (Number.isFinite(loc.elev)) autofill(S, 'elev', loc.elev, loc.elevSrc || loc.src);
}
function siteByTokens(tokens) { if (!tokens.length) return null; for (const s of P.sites) { const st = W.nameTokens([s.name, s.note, ...(s.labels || [])].join(' ')); if (tokens.some(t => st.includes(t))) return s; } return null; }

/* ===== 터빈 파일 (기초 설계도구와 공용): {app:"gbs-tool-turbine", ver:1, saved, turbines:[{id,name,MW,hub,rotor,rna,tower,Wdirect,ifz,rpmMin,rpmMax,fref,twL,twDb,twDt,axis,src,uls,sls, power:{...}}]}
   기초용 칸은 기초 설계도구 그대로, 발전량용(출력곡선·Ct·기준 공기밀도 등)은 power 안에 넣는다. 서로 모르는 칸은 건드리지 않고 그대로 넘긴다. */
const TF_APP = 'gbs-tool-turbine';
const FND_KEYS = ['MW', 'hub', 'rotor', 'rna', 'tower', 'Wdirect', 'ifz', 'rpmMin', 'rpmMax', 'fref', 'twL', 'twDb', 'twDt', 'axis', 'src', 'uls', 'sls', 'scaled'];
// 출력곡선이 없을 때: 정격·로터·시동·정지 풍속으로 추정 곡선(두산·유니슨 추정 터빈과 같은 방법: Cp(전기) 0.45, 정격 부근 완만한 꺾임, Ct는 대형 해상 터빈 Ct 모양을 정격풍속 비율로)
function estCurve(ratedKW, rotor, vin = 3, vout = 25) {
  const H = [[3, .75], [4, .75], [5, .75], [6, .75], [7, .74], [8, .72], [9, .65], [10, .51], [11, .38], [12, .28], [13, .22], [14, .17], [15, .14], [16, .12], [17, .10], [18, .09], [19, .07], [20, .07], [21, .06], [22, .05]];
  const ctH = v => { if (v <= 3) return .75; if (v >= 22) return Math.max(.04, .05 - (v - 22) * .003); for (let i = 1; i < H.length; i++) if (v <= H[i][0]) { const [a, b] = H[i - 1], [c, d] = H[i]; return b + (d - b) * (v - a) / (c - a); } return .05; };
  const A = Math.PI * rotor * rotor / 4, P = v => { let q = Math.pow(Math.pow(0.5 * 1.225 * A * 0.45 * v ** 3 / 1000, -10) + Math.pow(ratedKW, -10), -0.1); if (v < vin + 1) q *= 0.8; return q > ratedKW * 0.999 ? ratedKW : Math.round(q); };
  let vr = vin; while (vr < vout && P(vr) < ratedKW * 0.99) vr += 0.1;
  const vs = [vin]; for (let v = Math.ceil(vin + 0.01); v <= vout; v++) vs.push(v);
  return { curve: vs.map(v => [v, P(v), Math.round(ctH(v * 11 / vr) * 100) / 100]), vr };
}
function turbFromFile(t) {
  const pw = t.power && typeof t.power === 'object' ? t.power : {};
  const fnd = {}; FND_KEYS.forEach(k => { if (t[k] !== undefined) fnd[k] = t[k]; });
  Object.keys(t).forEach(k => { if (!FND_KEYS.includes(k) && !['id', 'name', 'power'].includes(k)) fnd[k] = t[k]; }); // 모르는 칸도 보관
  const ratedKW = +pw.ratedKW || (+t.MW > 0 ? t.MW * 1000 : 0), rotor = +pw.rotor || +t.rotor || 0, hub = +pw.hub || +t.hub || 0;
  const T = { id: String(t.id || uid()), name: String(t.name || '터빈'), maker: pw.maker || '', model: pw.model || '', ratedKW, rotor, hub, rhoRef: +pw.rhoRef || 1.225, rhoRefNote: pw.rhoRefNote || (pw.rhoRef ? '' : '터빈 파일에 기준 공기밀도 없음 — 1.225(표준)로 가정'),
    curveType: pw.curveType || 'unknown', curveTypeNote: pw.curveTypeNote || '', regulation: pw.regulation || 'pitch', source: pw.source || `터빈 파일 (${t.src ? String(t.src).slice(0, 80) : '기초 설계도구'})`, fnd };
  if (Array.isArray(pw.curve) && pw.curve.length >= 3) { T.curve = pw.curve.map(r => [+r[0], +r[1], r[2] == null ? NaN : +r[2]]); if (pw.estimated) T.estimated = true; }
  else if (ratedKW > 0 && rotor > 0) { const e = estCurve(ratedKW, rotor, +pw.cutIn || 3, +pw.cutOut || 25); T.curve = e.curve; T.estimated = true; T.curveType = 'calc'; T.curveTypeNote = `터빈 파일에 출력곡선이 없어 정격 ${f(ratedKW / 1000, 2)} MW·로터 ${f(rotor, 0)} m로 만든 추정 곡선(정격풍속 약 ${f(e.vr, 1)} m/s) — 제조사 곡선으로 바꿔야 함`; }
  else return null;
  return T;
}
function turbToFile(T) {
  const fnd = T.fnd || {};
  const o = { ...fnd, id: T.id, name: T.name, MW: +(T.ratedKW / 1000).toFixed(4), hub: T.hub || fnd.hub || 0, rotor: T.rotor || fnd.rotor || 0 };
  if (!Number.isFinite(+o.ifz) || o.ifz === undefined) { o.ifz = 15; o.ifzNote = '발전량 계산 도구에서 만든 파일 — 인터페이스 높이 15 m는 가정값(기초 설계도구에서 고치세요)'; }
  ['rna', 'tower', 'Wdirect', 'rpmMin', 'rpmMax', 'fref', 'twL', 'twDb', 'twDt'].forEach(k => { if (o[k] === undefined) o[k] = 0; });
  if (!o.axis) o.axis = 'z'; if (!o.src) o.src = T.source || '발전량 계산 도구';
  if (o.uls === undefined) o.uls = null; if (o.sls === undefined) o.sls = null;
  o.power = { ratedKW: T.ratedKW, rotor: T.rotor, hub: T.hub, maker: T.maker || '', model: T.model || '', rhoRef: T.rhoRef, rhoRefNote: T.rhoRefNote || '', curveType: T.curveType || 'unknown', curveTypeNote: T.curveTypeNote || '', regulation: T.regulation || 'pitch', estimated: !!T.estimated, source: T.source || '', curve: T.curve.map(r => [r[0], r[1], Number.isFinite(r[2]) ? r[2] : null]) };
  return o;
}
const turbFileText = arr => JSON.stringify({ app: TF_APP, ver: 1, saved: new Date().toISOString().slice(0, 10), from: '발전량 계산 도구', turbines: arr.map(turbToFile) }, null, 1);
const safeNm = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
function importTurbFiles(objs) {
  let got = 0, rep = 0, est = 0, bad = 0, names = [];
  for (const o of objs) {
    const arr = Array.isArray(o) ? o : o.turbines ? o.turbines : (o.P && o.P.customT) ? o.P.customT : o.customT ? o.customT : [o];
    for (const t of arr) {
      const T = t && t.name ? turbFromFile(t) : null; if (!T) { bad++; continue; }
      let i = P.turbines.findIndex(x => x.id === T.id || x.id + '_f' === T.id); if (i < 0) i = P.turbines.findIndex(x => x.name === T.name); if (i >= 0) T.id = P.turbines[i].id; // 기초 설계도구는 기본 터빈과 id가 겹치면 끝에 _f를 붙임
      if (i >= 0) { const old = P.turbines[i]; if (T.estimated && old.curve && !old.estimated && !(t.power && t.power.curve)) { T.curve = old.curve; T.estimated = false; T.curveType = old.curveType; T.curveTypeNote = old.curveTypeNote; T.rhoRef = old.rhoRef; } P.turbines[i] = { ...old, ...T, req: old.req }; rep++; }
      else P.turbines.push(T);
      if (T.estimated) est++; got++; names.push(T.name); ui.turbSel = T.id;
    }
  }
  return { got, rep, est, bad, names };
}

async function handleFiles(fileList) {
  const prog = $('#prog'); if (prog) { prog.style.display = 'block'; }
  const setP = (i, n) => { const b = $('#prog i'); if (b) b.style.width = (100 * i / n) + '%'; };
  let files;
  try { files = await expandFiles(fileList); } catch (e) { toast('압축 파일을 열지 못했습니다: ' + e.message); return; }
  const wg = [], ts = [], tables = [], msgs = [];
  { const tf = []; files = files.filter(F => { if (!/\.json$/i.test(F.name)) return true; try { const o = JSON.parse(new TextDecoder().decode(F.buf)); if (o && (o.app === TF_APP || Array.isArray(o.turbines) || (o.app === 'gbs-tool' && o.P && Array.isArray(o.P.customT) && o.P.customT.length))) { tf.push(o); return false; } /* 기초 설계도구 설계 저장 파일(gbs-tool)도 그 안의 터빈(P.customT)만 읽음 */ } catch (e) { } return true; });
    if (tf.length) { const r = importTurbFiles(tf); msgs.push(`터빈 파일: ${r.got}개 가져옴${r.rep ? ` (같은 터빈 ${r.rep}개는 새 자료로 바꿈)` : ''}${r.est ? ` · 출력곡선 없는 ${r.est}개는 추정 곡선` : ''}${r.bad ? ` · 읽지 못한 항목 ${r.bad}개` : ''}: ${r.names.join(', ')}`); save(); } }
  for (let i = 0; i < files.length; i++) {
    const F = files[i]; setP(i, files.length);
    try {
      if (/\.pdf$/i.test(F.name)) {
        const pages = await pdfPages(F.buf);
        const txt = pages.flat().map(l => l.text).join('\n');
        if (W.isWindographer(txt)) { const R = W.parseWindographer(pages, F.name); if (R.sensors.length) wg.push(R); else msgs.push(`${F.name}: 풍속 센서 표를 찾지 못했습니다.`); }
        else {
          const locs = W.findLocations(pages, F.name), ev = W.findElevation(pages);
          const src = `보고서 (${SRCNAME(F.name)})`;
          locs.forEach(l => { l.src = `${src} 좌표 "${l.label}"`; if (Number.isFinite(l.elev)) l.elevSrc = `${src} 표고 표 "${l.label} ${l.elev} m"`; });
          if (ev && locs.length === 1 && !Number.isFinite(locs[0].elev)) { locs[0].elev = ev.value; locs[0].elevSrc = `${src} ${ev.page}쪽 "${ev.text}"`; }
          const pcs = W.findPowerCurves(pages); if (pcs.length) { const sp = W.findTurbineSpec(pages); let n = 0; pcs.forEach(pc => { if (addTurbine(pc, sp, F.name)) n++; }); msgs.push(n ? `${SRCNAME(F.name)}: 출력곡선 ${n}개를 터빈 목록에 추가했습니다.` : `${SRCNAME(F.name)}: 출력곡선이 이미 터빈 목록에 있습니다.`); }
          const T = W.findSectorTables(pages, F.name);
          const wr = W.findWeibullRows(pages); const rhos = W.findAirDensity(pages); const ltI = W.findLtInfo(pages);
          T.forEach(t => {
            t.lt = ltI;
            const th = W.num((t.caption.match(/(\d+(?:\.\d+)?)\s*m\b(?!\/)/) || [])[1]);
            const rh = rhos.find(r => Number.isFinite(th) && Math.abs(r.height - th) < 1) || rhos.find(r => r.height === 0);
            if (rh) t.rho = { value: Math.abs(rh.height - th) < 1 ? rh.rho : +(rh.rho - 0.113 * th / 1000).toFixed(4), src: `${SRCNAME(F.name)} "${rh.text}"${Math.abs(rh.height - th) < 1 ? '' : ` → ${th} m로 보정(0.113 kg/m³/km)`}` };
            if (wr.length && (t.guess.k < 0 || t.guess.A < 0)) {
              const tk = W.nameTokens(t.caption + ' ' + (t.loc ? t.loc.label : ''));
              const row = wr.length === 1 ? wr[0] : wr.find(r => W.nameTokens(r.label).some(x => tk.includes(x)));
              if (row) t.weib = { ...row, src: `${SRCNAME(F.name)} ${row.page}쪽 ${row.caption || ''} "${row.label}"`.trim() };
            }
            if (locs.length === 1) t.loc = locs[0];
            else { const tk = W.nameTokens(t.caption); t.loc = locs.find(l => W.nameTokens(l.label).some(x => tk.includes(x))) || null; }
            if (!t.loc && ev) t.elevHint = { ...ev, file: F.name };
          });
          if (T.length) tables.push(...T); else msgs.push(`${F.name}: 알아볼 수 있는 풍황 표가 없습니다. 표를 복사해 "표 붙여넣기"로 넣어 주세요.`);
        }
      } else if (/\.(sta|txt|csv|tsv|dat|rtd)$/i.test(F.name)) {
        const ser = W.parseTimeSeriesText(decodeText(F.buf), F.name);
        if (!ser.ts.length) msgs.push(`${F.name}: 시계열 자료가 없습니다.`); else ts.push(ser);
      } else msgs.push(`${F.name}: 지원하지 않는 형식입니다.`);
    } catch (e) { console.error(e); msgs.push(`${F.name}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 0));
  }
  setP(1, 1); setTimeout(() => { const p = $('#prog'); if (p) p.style.display = 'none'; }, 400);
  const created = [], touched = new Set();
  // 1) Windographer: 보고서 좌표별로 지점 배정
  if (wg.length) {
    wg.sort((a, b) => b.endTs - a.endTs); // 최신 보고서 제목을 지점·자료 이름으로
    for (const R of wg) {
      const S = Number.isFinite(R.lat) ? siteForLoc({ lat: R.lat, lon: R.lon, label: R.title, src: `Windographer 보고서 (${SRCNAME(R.file)})` }, created) : site();
      let D = S.datasets.find(d => d.type === 'wg');
      if (!D) { D = { id: uid(), type: 'wg', name: 'Windographer 보고서', reports: [] }; S.datasets.push(D); }
      const i = D.reports.findIndex(r => r.file === R.file || (r.endTs === R.endTs && r.startTs === R.startTs)); if (i >= 0) D.reports[i] = R; else D.reports.push(R);
      D.reports.sort((a, b) => a.endTs - b.endTs); D.sel = D.reports.length - 1;
      if (!D.name || D.name === 'Windographer 보고서') D.name = (R.title || 'Windographer') + ' 보고서';
      S.sel = D.id; touched.add(S);
    }
    msgs.push(`Windographer 보고서 ${wg.length}개를 읽었습니다.`);
  }
  // 2) 보고서 방향별 표 (확인 창) → 표마다 좌표로 지점 배정
  if (tables.length) { const r = await pickTables(tables, created); r.forEach(S => touched.add(S)); }
  // 3) 시계열: 파일 GPS가 지점과 맞으면 그 지점, 아니면 장비 번호로 찾거나 현재 지점
  for (const ser of ts) {
    const gps = W.parseGps(ser.gps); const tokens = W.nameTokens(ser.device);
    let S = null, note = '';
    if (gps) {
      const { site: ns, dist } = nearestSite(gps);
      if (ns && dist <= TOL()) S = ns;
      else if (ns && dist <= 100000) S = siteForLoc({ ...gps, label: [ser.meta['ID Client'], ser.device].filter(Boolean).join(' '), src: `시계열 파일 GPS (${SRCNAME(ser.file)})` }, created);
      else note = `${SRCNAME(ser.file)}: 파일 속 GPS(${gps.lat.toFixed(3)}, ${gps.lon.toFixed(3)})가 ${ns ? '가장 가까운 지점과 ' + fi(dist / 1000) + ' km 떨어져' : '비교할 지점 좌표가 없어'} 장비 기본값으로 보고 쓰지 않았습니다.`;
    }
    if (!S) { const byTok = siteByTokens(tokens); S = byTok || site(); if (note) note += byTok ? ` 장비 번호(${ser.device})가 같은 "${siteName(byTok)}" 지점에 넣었습니다.` : ` 현재 지점 "${siteName(S)}"에 넣었습니다.`; }
    if (note) msgs.push(note);
    const dev = ser.device;
    let D = S.datasets.find(d => d.type === 'ts' && d.ser && d.ser.device === dev && dev);
    const merged = W.mergeSeries(D ? [D.ser, ser] : [ser]);
    if (!D) { D = { id: uid(), type: 'ts', name: (dev ? dev + ' ' : '') + '시계열', opt: { minAvail: 80, nSec: 12, weibull: 'MLE', dirOffset: 0, hub: null, from: null, to: null } }; S.datasets.push(D); }
    D.ser = merged; D.files = merged.files; D.cache = null; D.qcRes = null; S.sel = D.id; touched.add(S);
    autofillSite(S, [ser]);
  }
  if (ts.length) msgs.push(`시계열 ${ts.length}개 파일을 읽었습니다.`);
  // 지점 정보 채우기
  const filled = new Set(); touched.forEach(S => autofillSite(S).forEach(x => filled.add(siteName(S) + ' ' + x)));
  if (created.length) msgs.unshift(`좌표가 다른 지점 ${created.length}곳을 새로 만들었습니다: ${created.map(siteName).join(', ')}`);
  const first = [...touched][0]; if (first) P.active = first.id;
  render(); save();
  if (msgs.length) toast(msgs.join(' / '), 8000);
}

/* ================= 지점 정보 자동 채우기 ================= */
// 이전 버전 기본값(지점 1, 새 지점, 표고 0)은 빈 값으로 본다
function migrateSite(S) {
  if (!S.src) S.src = {};
  if (!S.src.name && /^(지점\s*\d+|새 지점)$/.test(S.name || '')) S.name = '';
  if (!S.src.elev && (S.elev === 0 || S.elev === '0')) S.elev = '';
  for (const k of ['lat', 'lon', 'note']) if (!S.src[k] && S[k] === '') S[k] = '';
}
// 들어 있는 자료(+ 새로 읽은 시계열·보고서 표고)에서 빈 칸만 채움
function autofillSite(S, newTs = [], newElevs = []) {
  migrateSite(S); const filled = [];
  const wgD = S.datasets.find(d => d.type === 'wg');
  if (wgD) {
    for (const R of wgD.reports.slice().sort((a, b) => b.endTs - a.endTs)) {
      const src = `Windographer 보고서 (${SRCNAME(R.file)})`;
      if (autofill(S, 'name', R.title, src)) filled.push('지점 이름');
      if (Number.isFinite(R.lat) && autofill(S, 'lat', R.lat, src)) filled.push('위도');
      if (Number.isFinite(R.lon) && autofill(S, 'lon', R.lon, src)) filled.push('경도');
      const ev = W.num(String(R.props.elev || '').replace(/m$/i, ''));
      if (ev > 0 && autofill(S, 'elev', ev, src)) filled.push('설치 표고');
    }
    const all = wgD.reports;
    if (autofill(S, 'note', `Windographer 보고서 ${all.length}개 · ${W.fmtDate(all[0].startTs)} ~ ${W.fmtDate(all[all.length - 1].endTs)}`, '자료에서 작성')) filled.push('메모');
  }
  const tsList = [...newTs.map(t => ({ meta: t.meta || {}, location: t.location, device: t.device, file: t.file, t0: t.ts[0], t1: t.ts[t.ts.length - 1] })),
    ...S.datasets.filter(d => d.type === 'ts').map(d => ({ meta: d.ser.meta || {}, location: d.ser.location, device: d.ser.device, file: d.files[0], t0: d.ser.ts[0], t1: d.ser.ts[d.ser.ts.length - 1] }))];
  for (const t of tsList) {
    const src = `시계열 파일 (${SRCNAME(t.file)})`; const cl = t.meta['ID Client'] || '', loc = t.location || '';
    if (autofill(S, 'name', [cl, loc && `(${loc})`].filter(Boolean).join(' '), src)) filled.push('지점 이름');
    if (autofill(S, 'note', `${t.device || '측정기'} 시계열 · ${W.fmtDate(t.t0)} ~ ${W.fmtDate(t.t1)}`, '자료에서 작성')) filled.push('메모');
  }
  const elevs = [...newElevs, ...S.datasets.filter(d => d.type === 'sec' && d.elevHint).map(d => d.elevHint)];
  for (const e of elevs) if (autofill(S, 'elev', e.value, `보고서 (${SRCNAME(e.file)} ${e.page}쪽: "${e.text}")`)) filled.push('설치 표고');
  return [...new Set(filled)];
}

/* ================= 방향별 표 선택 대화상자 ================= */
function pickTables(tables, created) {
  return new Promise(resolve => {
  const roles = [['', '사용 안 함'], ['freq', '빈도 %'], ['mean', '평균풍속'], ['k', 'Weibull k'], ['A', 'Weibull A']];
  // 표마다 기본 지점: 좌표가 맞는 기존 지점 → 같은 좌표의 다른 표와 같은 새 지점 → 좌표 없으면 현재 지점
  const newKeys = [];
  tables.forEach(T => {
    if (!T.loc) { T.siteKey = 'site:' + P.active; return; }
    const { site: ns, dist } = nearestSite(T.loc);
    if (ns && dist <= TOL()) { T.siteKey = 'site:' + ns.id; return; }
    let k = newKeys.find(n => W.distM(n.loc, T.loc) <= TOL());
    if (!k) { k = { key: 'new:' + newKeys.length, loc: T.loc }; newKeys.push(k); }
    T.siteKey = k.key;
  });
  const opts = cur => [...P.sites.map(s => [`site:${s.id}`, siteName(s) + (siteCoord(s) ? '' : ' (좌표 없음)')]), ...newKeys.map(n => [n.key, `새 지점: ${n.loc.label || '이름 없음'} (${n.loc.lat.toFixed(4)}, ${n.loc.lon.toFixed(4)})`])].map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box"><h3>PDF에서 찾은 방향별 표 ${tables.length}개</h3>
  <div class="hint" style="margin-bottom:8px">가져올 표를 고르고, 각 열이 무엇인지 확인해 주세요. 빈도(%)는 꼭 있어야 합니다. 높이는 해발 기준입니다. 지점은 보고서의 측정기 좌표로 정했습니다(${fi(TOL())} m 안이면 같은 지점).</div>
  ${tables.map((T, ti) => `<div class="card" style="padding:10px 12px">
    <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" data-ti="${ti}" ${T.guess.freq >= 0 ? 'checked' : ''}> ${esc(T.caption || '방향별 표')} <span class="hint">${esc(SRCNAME(T.file))} · ${T.page}쪽 · ${T.nSec}구간</span></label>
    <div class="row" style="margin:6px 0"><div class="fld"><label>이름</label><input data-name="${ti}" value="${esc((T.caption || '방향별 표').replace(/^(Table|Figure)\s*[\d-]+\s*/i, '').slice(0, 90))}" style="width:320px"></div><div class="fld"><label>높이 (해발 m)</label><input class="n" data-h="${ti}" value="${(T.caption.match(/(\d+(?:\.\d+)?)\s*m\b(?!\/)/) || [])[1] || ''}"></div>
    <div class="fld"><label>지점 ${T.loc ? `<span class="hint">— 좌표 "${esc(T.loc.label)}"</span>` : '<span class="hint">— 표에 맞는 좌표 없음</span>'}</label><select data-tsite="${ti}" style="max-width:330px">${opts(T.siteKey)}</select></div></div>
    ${T.rho ? `<div class="hint" style="margin:2px 0">공기밀도 ${T.rho.value} kg/m³ — ${esc(T.rho.src)}</div>` : ''}${T.weib ? `<div class="info" style="margin:4px 0 6px">방향별 k·A가 없어 같은 측정기의 전체 Weibull을 함께 넣습니다: A ${T.weib.A} m/s, k ${T.weib.k}${Number.isFinite(T.weib.mean) ? `, 평균 ${T.weib.mean} m/s` : ''}${Number.isFinite(T.weib.height) ? ` (${T.weib.height} m)` : ''} — ${esc(T.weib.src)}</div>` : ''}
    <div class="tw" style="max-height:200px"><table class="t"><tr><th>방향</th>${T.cols.map((c, ci) => `<th><select data-role="${ti}:${ci}">${roles.map(([v, l]) => `<option value="${v}" ${T.guess[v] === ci ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="hint" style="white-space:normal;max-width:110px">${esc(c)}</div></th>`).join('')}</tr>
    ${T.rows.map(r => `<tr><td>${r.dir}°</td>${r.vals.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</table></div></div>`).join('')}
  <div class="row" style="justify-content:flex-end"><button class="btn" data-x="cancel">취소</button><button class="btn pri" data-x="ok">가져오기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => {
    const x = e.target.dataset.x; if (!x) return;
    const touched = new Set();
    if (x === 'ok') {
      let added = 0; const madeNew = {};
      tables.forEach((T, ti) => {
        if (!box.querySelector(`[data-ti="${ti}"]`).checked) return;
        const role = {}; T.cols.forEach((_, ci) => { const v = box.querySelector(`[data-role="${ti}:${ci}"]`).value; if (v) role[v] = ci; });
        if (role.freq == null) { toast('빈도(%) 열이 지정되지 않은 표는 건너뜁니다.'); return; }
        const key = box.querySelector(`[data-tsite="${ti}"]`).value; let S;
        if (key.startsWith('site:')) { S = P.sites.find(s => s.id === key.slice(5)) || site(); if (T.loc && !siteCoord(S)) fillLoc(S, T.loc); }
        else { if (!madeNew[key]) { const nk = newKeys.find(n => n.key === key); madeNew[key] = siteForLoc(nk.loc, created); } S = madeNew[key]; }
        if (T.loc && Number.isFinite(T.loc.elev)) autofill(S, 'elev', T.loc.elev, T.loc.elevSrc);
        if (T.loc && T.loc.label) { S.labels = [...new Set([...(S.labels || []), T.loc.label])]; }
        const D = { id: uid(), type: 'sec', name: box.querySelector(`[data-name="${ti}"]`).value || '방향별 표', source: `${T.file} ${T.page}쪽`, elevHint: T.elevHint || null, height: W.num(box.querySelector(`[data-h="${ti}"]`).value), rows: T.rows.map(r => ({ dir: r.dir, freq: r.vals[role.freq], mean: role.mean != null ? r.vals[role.mean] : NaN, k: role.k != null ? r.vals[role.k] : NaN, A: role.A != null ? r.vals[role.A] : NaN })), total: null };
        if (T.total) D.total = { mean: role.mean != null ? T.total[role.mean] : NaN, k: role.k != null ? T.total[role.k] : NaN, A: role.A != null ? T.total[role.A] : NaN };
        if (T.rho) { D.rho = T.rho.value; D.rhoSrc = T.rho.src; }
        if (T.lt) D.lt = T.lt;
        if (T.weib && (role.k == null || role.A == null)) { D.wk = T.weib.k; D.wA = T.weib.A; D.wMean = T.weib.mean; D.wHeight = T.weib.height; D.wSrc = T.weib.src; }
        S.datasets.push(D); S.sel = D.id; touched.add(S); added++;
      });
      if (added) toast(`방향별 표 ${added}개를 가져왔습니다.`);
    }
    box.remove(); resolve([...touched]);
  });
  });
}

/* ================= 계산 (시계열) ================= */
function tsCompute(D) {
  const S = site(), raw = D.ser, o = D.opt; const elev = +S.elev || 0;
  if (!o.qc) o.qc = { ...W.QC_DEFAULT };
  const qkey = JSON.stringify([o.qc, o.minAvail, raw.ts.length, raw.columns.map(c => c.role + c.height)]);
  if (!D.qcRes || D.qcRes.key !== qkey) { D.qcRes = { key: qkey, ...W.qcClean(raw, o.qc, +o.minAvail || 0) }; D.cache = null; }
  const ser = { ...raw, data: D.qcRes.data };
  const H = W.seriesHeights(ser);
  if (!o.hub) o.hub = Math.round((H[Math.floor(H.length / 2)] + elev) / 10) * 10;
  const opt = { minAvail: 0, nSec: +o.nSec || 12, weibull: o.weibull, dirOffset: +o.dirOffset || 0, from: o.from ? W.parseDate(o.from + ' 00:00') : null, to: o.to ? W.parseDate(o.to + ' 23:59') : null };
  const key = JSON.stringify([opt, o.hub, elev, ser.ts.length, ser.columns.map(c => c.role + c.height)]);
  if (D.cache && D.cache.key === key) return D.cache;
  const heights = H.map(h => { const st = W.statsFor(ser, { ws: W.colOf(ser, 'ws', h), dir: W.colOf(ser, 'dir', h), std: W.colOf(ser, 'std', h), mask: W.validMask(ser, h, opt) }, opt); return { h, z: h + elev, st }; }).filter(x => x.st);
  const sh = heights.length >= 2 ? W.shear(ser, heights.map(x => x.h), opt, elev) : null;
  const hubS = W.hubSeries(ser, o.hub - elev, opt);
  const hub = W.statsFor(ser, hubS, opt);
  const rho = W.airDensity(ser, opt, o.hub, elev + 2);
  D.cache = { key, opt, heights, sh, hub, rho, hubZ: +o.hub, qc: D.qcRes.report };
  return D.cache;
}

/* ================= 화면 ================= */
function render() {
  try { if (fixCRS(P)) { toast('TM 좌표(' + [...new Set((P.zones || []).concat(P.farms || []).filter(z => z.crsFrom).map(z => W.TM_ORIGINS[z.crsFrom].name.replace(/ \(.*/, '')))].join(', ') + ')를 알아보고 UTM 52N으로 바꿨습니다.', 5000); save(); } } catch (e) { console.warn('fixCRS', e); }
  $('#projName').value = P.name; ensureTurbines();
  document.querySelectorAll('#tabs .tab[data-v]').forEach(t => t.classList.toggle('on', t.dataset.v === ui.tab));
  $('#siteList').innerHTML = P.sites.map(s => `<div class="site ${s.id === P.active ? 'on' : ''}" data-act="site" data-id="${s.id}"><span>${esc(siteName(s))}${siteCoord(s) ? '' : ' <small style="color:#a4500f">좌표 없음</small>'}</span><small>${s.datasets.length ? s.datasets.length + '개' : ''}${s.design ? ' ●' : ''}</small></div>`).join('');
  const S = site();
  if (ui.tab === 'turb') { $('#view').innerHTML = viewTurbine(S); return; }
  if (ui.tab === 'zone') { $('#view').innerHTML = viewZone(); return; }
  if (ui.tab === 'farm') { $('#view').innerHTML = viewFarm(); return; }
  if (ui.tab === 'aep') { $('#view').innerHTML = viewAep(); return; }
  if (ui.tab === 'report') { $('#view').innerHTML = viewReport(); return; }
  const srcTag = k => { const src = (S.src || {})[k]; if (isEmpty(S[k])) return `<span class="tag blank">비어 있음${k === 'elev' ? ' — 0 m로 계산' : ''}</span>`; return src ? `<span class="srcl" title="${esc(src)}">${esc(src)}</span>` : ''; };
  const fld = (k, label, w, cls) => `<div class="fld"><label>${label}</label><input ${cls ? 'class="n"' : ''} data-site="${k}" value="${esc(S[k] ?? '')}" style="width:${w}">${srcTag(k)}</div>`;
  let h = `<div class="card"><h2>지점 정보 <span class="sub">제공 자료에 있으면 자동으로 채우고, 없으면 비워 둡니다</span></h2><div class="row" style="align-items:flex-start">
    ${fld('name', '지점 이름', '200px')}${fld('lat', '위도', '120px', 1)}${fld('lon', '경도', '120px', 1)}${fld('elev', '측정기 설치 표고 (해발 m)', '120px', 1)}
    ${(() => { const am = siteMeasAuto(S); const ph = k => am ? new Date(k === 'to' ? endDay(am[k]) : am[k]).toISOString().slice(0, 10) : 'YYYY-MM-DD'; return `<div class="fld"><label>측정 시작일</label><input data-site="measFrom" value="${esc(S.measFrom ?? '')}" placeholder="${ph('from')}" style="width:110px">${S.measFrom ? '<span class="srcl">직접 입력</span>' : am ? `<span class="srcl" title="${esc(am.src)}">자동: ${esc(am.kind)}</span>` : '<span class="tag blank">비어 있음</span>'}</div><div class="fld"><label>측정 종료일</label><input data-site="measTo" value="${esc(S.measTo ?? '')}" placeholder="${ph('to')}" style="width:110px"></div>`; })()}
    <div class="fld" style="flex:1;min-width:220px"><label>메모</label><input data-site="note" value="${esc(S.note ?? '')}" style="width:100%">${srcTag('note')}</div>
    <button class="btn ghost" data-act="delSite" style="margin-top:17px" ${P.sites.length < 2 ? 'disabled' : ''}>지점 삭제</button></div>
    <div class="hint" style="margin-top:8px">측정높이(40 m, 100 m …)는 장비 바닥 기준입니다. 등대·섬 위에 설치했다면 그 표고를 넣어야 해발 기준으로 시어·허브높이를 계산합니다. 위도·경도는 지금은 기록용입니다(배치 단계에서 사용 예정).</div></div>`;
  h += `<div class="card"><h2>풍황자료 넣기 <span class="sub">PDF · WindCube .sta · CSV/TXT 시계열 · zip</span></h2>
    <div class="drop" id="drop"><b>파일을 끌어다 놓거나 눌러서 고르세요</b><br><span class="hint">Windographer 요약 보고서(PDF) 여러 개, 라이다/계측탑 10분 자료(.sta/.csv/.txt), 발전량·풍황 평가 보고서(PDF, 방향별 표 자동 탐지), zip 묶음</span></div>
    <input type="file" id="fileIn" multiple hidden accept=".pdf,.sta,.txt,.csv,.tsv,.dat,.rtd,.zip">
    <div class="prog" id="prog"><i></i></div>
    <div class="row" style="margin-top:8px;align-items:center"><button class="btn sm" data-act="manual">직접 입력 / 표 붙여넣기</button><span class="sp"></span>
      <span class="hint">자료의 측정기 좌표가 기존 지점과 <input class="n" id="tolM" value="${TOL()}" style="width:64px;border:1px solid var(--line);border-radius:4px;padding:2px 5px;text-align:right;font-family:var(--mono)"> m 안이면 같은 지점, 더 멀면 새 지점을 만듭니다</span></div>
    <div class="dslist">${S.datasets.map(d => dsCard(d, S)).join('') || ''}</div></div>`;
  const D = dsSel();
  if (D) h += D.type === 'wg' ? viewWG(D) : D.type === 'ts' ? viewTS(D) : viewSec(D);
  else if (!S.datasets.length) h += `<div class="card empty">아직 자료가 없습니다. 위에 파일을 넣어 주세요.</div>`;
  h += viewDesign(S);
  $('#view').innerHTML = h;
}
function dsCard(d, S) {
  let tag = '', meta = '';
  if (d.type === 'wg') { const r = d.reports[d.reports.length - 1]; tag = '<span class="tag wg">PDF 요약</span>'; meta = `보고서 ${d.reports.length}개 · ${W.fmtDate(d.reports[0].startTs)} ~ ${W.fmtDate(r.endTs)}`; }
  if (d.type === 'ts') { tag = '<span class="tag ts">시계열</span>'; meta = `${d.files.length}개 파일 · ${W.fmtDate(d.ser.ts[0])} ~ ${W.fmtDate(d.ser.ts[d.ser.ts.length - 1])} · ${fi(d.ser.ts.length)}줄`; }
  if (d.type === 'sec') { tag = '<span class="tag sec">방향별 표</span>'; meta = `${d.rows.length}구간 · ${Number.isFinite(d.height) ? '해발 ' + d.height + ' m' : '높이 미입력'}${d.source ? ' · ' + esc(d.source.replace(/^[0-9a-f]{8}-/, '')) : ''}`; }
  const isD = S.design && S.design.dsId === d.id;
  return `<div class="ds ${S.sel === d.id ? 'on' : ''}" data-act="selds" data-id="${d.id}"><span class="x" data-act="delds" data-id="${d.id}" title="삭제">×</span><div class="t">${tag}${isD ? '<span class="tag design">대표</span>' : ''}<span>${esc(d.name)}</span></div><div class="m">${meta}</div></div>`;
}

/* ---------- Windographer ---------- */
function viewWG(D) {
  const S = site(), elev = +S.elev || 0;
  const r = D.reports[D.sel ?? D.reports.length - 1];
  const hs = r.sensors.map(s => s.height); const hSel = hs.includes(ui.wgHeight) ? ui.wgHeight : hs[Math.floor(hs.length / 2)] ?? hs[0];
  const inc = W.deriveIncrements(D.reports);
  const cumul = D.reports.length > 1 && D.reports.every(x => x.startTs === D.reports[0].startTs);
  let h = `<div class="card"><h2><span class="tag wg">PDF 요약</span><input data-dsname value="${esc(D.name)}" style="border:none;font-weight:700;font-size:14px;background:transparent;width:360px"></h2>`;
  h += `<h4>보고서 목록 <span class="hint">— 줄을 누르면 아래 표가 그 보고서로 바뀝니다</span></h4><div class="tw" style="max-height:260px"><table class="t"><tr><th>파일</th><th>제목</th><th>시작</th><th>종료</th><th>기간</th><th>${hSel} m 유효자료</th><th>회수율 %</th><th>평균 m/s</th><th>k</th><th>A m/s</th></tr>`;
  D.reports.forEach((x, i) => { const s = x.sensors.find(s => s.height === hSel) || {}; h += `<tr class="click ${i === (D.sel ?? D.reports.length - 1) ? 'sel' : ''}" data-act="wgsel" data-i="${i}"><td class="txt">${esc(x.file.replace(/^[0-9a-f]{8}-/, ''))}</td><td class="txt">${esc(x.title)}</td><td>${W.fmtDate(x.startTs, 1)}</td><td>${W.fmtDate(x.endTs, 1)}</td><td class="txt">${esc(x.props.duration || '')}</td><td>${fi(s.valid)}</td><td>${f(s.recovery, 1)}</td><td>${f(s.mean, 3)}</td><td>${f(s.k, 3)}</td><td>${f(s.c, 3)}</td></tr>`; });
  h += `</table></div>`;
  if (cumul) h += `<div class="info">모든 보고서의 시작일이 같아서 <b>누적 보고서</b>로 판단했습니다. 마지막 보고서(${W.fmtDate(D.reports[D.reports.length - 1].endTs)})가 전체 기간을 담고 있고, 이웃 보고서의 차이로 기간별 값을 역산합니다.</div>`;
  if (r.warnings.length) h += `<div class="warnbox">${r.warnings.map(w => `<div>${esc(w)}</div>`).join('')}<div style="margin-top:4px">PDF 요약값은 이미 평균을 낸 값이라 오류값만 골라 뺄 수 없습니다. 오류값이 섞인 기압·공기밀도는 쓰지 않고, 대표 풍황의 공기밀도는 평균 기온과 표준기압으로 계산합니다(아래에서 바꿀 수 있음). 오류값을 정확히 빼려면 10분 원자료를 넣어 주세요.</div></div>`;
  h += `<h4>높이별 요약 — ${esc(r.file.replace(/^[0-9a-f]{8}-/, ''))} (${W.fmtDate(r.startTs)} ~ ${W.fmtDate(r.endTs)})</h4>`;
  h += `<div class="tw"><table class="t"><tr><th>측정높이 m</th><th>해발 m</th><th>평균</th><th>중앙</th><th>최소</th><th>최대</th><th>Weibull k</th><th>Weibull A</th><th>에너지 패턴계수</th><th>에너지밀도 W/m²</th><th>TI 평균</th><th>유효자료</th><th>회수율 %</th></tr>`;
  r.sensors.forEach(s => h += `<tr class="click ${s.height === hSel ? 'sel' : ''}" data-act="wgh" data-h="${s.height}"><td>${s.height}</td><td>${f(s.height + elev, 0)}</td><td>${f(s.mean, 3)}</td><td>${f(s.median, 2)}</td><td>${f(s.min, 2)}</td><td>${f(s.max, 2)}</td><td>${f(s.k, 3)}</td><td>${f(s.c, 3)}</td><td>${f(s.epf, 3)}</td><td>${fi(s.pd)}</td><td>${f(s.ti, 2)}</td><td>${fi(s.valid)}</td><td>${f(s.recovery, 2)}</td></tr>`);
  h += `</table></div>`;
  h += `<div class="row" style="margin-top:10px;gap:30px;align-items:flex-start"><div class="kv">
    <span>위치</span><span>${f(r.lat, 6)}, ${f(r.lon, 6)}</span><span>시간 간격</span><span>${esc(r.props.step || '-')}</span>
    <span>멱법칙 지수 (보고서)</span><span>${f(r.alpha, 4)}</span><span>조도</span><span>${esc(r.props.z0 || '-')}</span></div>
    <div class="kv"><span>기온 평균/최소/최대</span><span>${r.env.T ? `${f(r.env.T.mean, 1)} / ${f(r.env.T.min, 1)} / ${f(r.env.T.max, 1)} ℃` : '-'}</span>
    <span>기압 평균</span><span>${r.env.P ? f(r.env.P.mean, 1) + ' hPa' + (r.env.P.min < 500 ? ' <span class="ng">(오류값 포함)</span>' : '') : '-'}</span><span>공기밀도 평균</span><span>${f(r.meanRho, 3)} kg/m³${r.env.rho && r.env.rho.min < 0.9 ? ' <span class="ng">(오류값 포함)</span>' : ''}</span>
    <span>보고서 작성</span><span>${esc(r.created)}</span></div></div>`;
  h += `<div class="hint" style="margin-top:8px">풍배도·월별·시간대별 그래프는 PDF 안에 그림으로만 들어 있어서 숫자로 읽을 수 없습니다. 방향별 값이 필요하면 10분 원자료(.sta 등)나 평가 보고서의 방향별 표를 넣어 주세요.</div></div>`;
  // 그래프
  const pts = r.sensors.map(s => ({ z: s.height + elev, v: s.mean }));
  const X = pts.map(p => Math.log(p.z)), Y = pts.map(p => Math.log(p.v)); const mx = X.reduce((a, b) => a + b) / X.length, my = Y.reduce((a, b) => a + b) / Y.length; let sxy = 0, sxx = 0; X.forEach((x, i) => { sxy += (x - mx) * (Y[i] - my); sxx += (x - mx) ** 2; }); const al = sxy / sxx, b0 = my - al * mx;
  const hRow = inc.map(x => x.rows.find(q => q.height === hSel));
  h += `<div class="card"><h2>기간별 값 <span class="sub">${cumul ? '누적 보고서 차이로 역산' : '보고서별 값'} · ${hSel} m (해발 ${hSel + elev} m)</span></h2><div class="grid2">`;
  h += chartBars(inc.map(x => W.fmtDate(x.from).slice(2, 7) + '~'), hRow.map(q => q ? q.mean : NaN), `기간별 평균풍속 (${hSel} m)`, '평균풍속 (m/s)', (i, v) => `${W.fmtDate(inc[i].from)} ~ ${W.fmtDate(inc[i].to)}: ${f(v, 2)} m/s, 회수율 ${f(hRow[i].recovery, 1)}%`, hRow.map(q => q && q.recovery / 100));
  h += chartProfile(pts, al, z => Math.exp(b0) * Math.pow(z, al), null, `높이별 평균풍속 (${W.fmtDate(r.endTs)} 보고서)`);
  h += `</div><h4>기간별 표</h4><div class="tw"><table class="t"><tr><th>기간</th><th>자료 수</th><th>회수율 %</th><th>평균 m/s</th><th>k</th><th>A m/s</th><th>구분</th></tr>`;
  inc.forEach((x, i) => { const q = hRow[i]; if (!q) return; h += `<tr><td>${W.fmtDate(x.from, 1)} ~ ${W.fmtDate(x.to, 1)}</td><td>${fi(q.n)}</td><td>${f(q.recovery, 1)}</td><td>${f(q.mean, 3)}</td><td>${f(q.k, 3)}</td><td>${f(q.A, 3)}</td><td class="txt">${q.derived ? '역산' : '보고서 값'}</td></tr>`; });
  h += `</table></div><div class="hint" style="margin-top:6px">역산: 평균은 유효자료 수 가중으로 정확히 구하고, k·A는 평균풍속과 에너지 패턴계수(평균 v³)로 맞춘 근사값입니다. 보고서 숫자가 반올림돼 있어 자료 수가 적은 기간은 오차가 커질 수 있습니다.</div></div>`;
  h += designFromWG(D, r, hSel, al);
  return h;
}
function wgRhoBad(r) { return (r.env.P && r.env.P.min < 500) || (r.env.rho && r.env.rho.min < 0.9) || !(r.meanRho > 1); }
function wgRho(r, mode, z, manual) {
  const elev = +site().elev || 0;
  if (mode === 'manual') return W.num(manual);
  if (mode === 'pdf') return r.meanRho - 0.113 * (z - elev) / 1000;
  const T = r.env.T ? r.env.T.mean : r.meanT; if (!Number.isFinite(T)) return rhoDefault;
  return rhoFromT(T, elev + 2, z);
}
function designFromWG(D, r, hSel, al) {
  const elev = +site().elev || 0;
  if (!ui.wgRho) ui.wgRho = wgRhoBad(r) ? 'temp' : 'pdf';
  const z = ui.wgHub || hSel + elev;
  return `<div class="card"><h2>대표 풍황으로 지정</h2><div class="row">
   <div class="fld"><label>허브높이 (해발 m)</label><input class="n" id="wgHub" value="${z}"></div>
   <div class="fld"><label>시어 지수 α</label><input class="n" id="wgAlpha" value="${f(al, 4)}"></div>
   <div class="fld"><label>공기밀도</label><select id="wgRhoMode">
     <option value="temp" ${ui.wgRho === 'temp' ? 'selected' : ''}>평균 기온 + 표준기압 (${f(wgRho(r, 'temp', z), 3)})</option>
     <option value="pdf" ${ui.wgRho === 'pdf' ? 'selected' : ''}>PDF 평균 공기밀도 (${f(wgRho(r, 'pdf', z), 3)})${wgRhoBad(r) ? ' — 오류값 포함' : ''}</option>
     <option value="manual" ${ui.wgRho === 'manual' ? 'selected' : ''}>직접 입력</option></select></div>
   ${ui.wgRho === 'manual' ? `<div class="fld"><label>공기밀도 (kg/m³)</label><input class="n" id="wgRhoVal" value="${ui.wgRhoVal || ''}"></div>` : ''}
   <button class="btn pri" data-act="wgDesign">이 보고서로 대표 풍황 지정</button></div>
   <div class="hint" style="margin-top:6px">가장 가까운 측정높이의 Weibull k를 쓰고, A는 α로 허브높이까지 보정합니다. PDF 요약에는 방향별 값이 없어서 방향 분포 없이 지정됩니다(후류 계산에는 방향별 자료 필요).</div></div>`;
}

/* ---------- 시계열 ---------- */
function viewTS(D) {
  const S = site(), o = D.opt, ser = D.ser, elev = +S.elev || 0;
  const C = tsCompute(D);
  const hub = C.hub;
  let h = `<div class="card"><h2><span class="tag ts">시계열</span><input data-dsname value="${esc(D.name)}" style="border:none;font-weight:700;font-size:14px;background:transparent;width:360px"></h2>`;
  h += `<div class="kv" style="margin-bottom:10px"><span>파일</span><span>${D.files.length}개 (${esc(D.files.slice(0, 3).map(x => x.replace(/^[0-9a-f]{8}-/, '')).join(', '))}${D.files.length > 3 ? ' …' : ''})</span>
   <span>기간</span><span>${W.fmtDate(ser.ts[0], 1)} ~ ${W.fmtDate(ser.ts[ser.ts.length - 1], 1)} (시각은 구간 끝 기준${ser.timezone ? ', ' + esc(ser.timezone) : ''})</span>
   <span>자료</span><span>${fi(ser.ts.length)}줄 · 간격 ${ser.step / 60000}분 · 중복 ${ser.duplicates}줄 제외 · 빠진 칸 ${fi(ser.gaps)}개</span>
   ${ser.device ? `<span>장비</span><span>${esc(ser.device)} ${ser.location ? '· ' + esc(ser.location) : ''}</span>` : ''}
   ${ser.gps ? `<span>파일 속 GPS</span><span>${esc(ser.gps)} <span class="hint">(장비 기본값이 남아 있는 경우가 많으니 지점 좌표를 따로 확인하세요)</span></span>` : ''}</div>`;
  h += `<div class="row">
   <div class="fld"><label>시작일</label><input type="date" data-opt="from" value="${o.from || ''}"></div>
   <div class="fld"><label>종료일</label><input type="date" data-opt="to" value="${o.to || ''}"></div>
   <div class="fld"><label>풍향 보정 (°)</label><input class="n" data-opt="dirOffset" value="${o.dirOffset}"></div>
   <div class="fld"><label>방향 구간</label><select data-opt="nSec">${[8, 12, 16].map(n => `<option ${+o.nSec === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
   <div class="fld"><label>Weibull 맞춤</label><select data-opt="weibull">${[['MLE', '최대우도 (MLE)'], ['WAsP', 'WAsP (v³·초과확률)'], ['MOM', '모멘트']].map(([v, l]) => `<option value="${v}" ${o.weibull === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
   <div class="fld"><label>허브높이 (해발 m)</label><input class="n" data-opt="hub" value="${o.hub}"></div></div>
   <div class="hint" style="margin-top:6px">허브높이 풍속은 10분마다 위아래 측정높이 사이를 멱법칙으로 보간합니다(측정 범위 밖은 위·아래 두 높이로 외삽).</div>`;
  h += `<details><summary>열 지정 확인 (${ser.columns.length}개 열)</summary><div class="tw" style="max-height:260px"><table class="t"><tr><th>열 이름</th><th>종류</th><th>높이 m</th></tr>${ser.columns.map((c, i) => `<tr><td class="txt">${esc(c.name)}</td><td><select data-col="${i}" data-k="role">${[['ws', '풍속 평균'], ['std', '풍속 표준편차'], ['max', '풍속 최대'], ['min', '풍속 최소'], ['dir', '풍향'], ['avail', '가용률'], ['cnr', 'CNR'], ['temp', '기온'], ['press', '기압'], ['rh', '습도'], ['wz', '연직풍속'], ['ti', 'TI'], ['', '사용 안 함']].map(([v, l]) => `<option value="${v}" ${c.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td><input data-col="${i}" data-k="height" value="${c.height ?? ''}"></td></tr>`).join('')}</table></div></details></div>`;
  h += viewQC(D, C);
  if (!hub) return h + `<div class="card empty">조건에 맞는 자료가 없습니다. 기간·오류값 기준을 확인해 주세요.</div>`;
  // 요약
  const rho = C.rho ? C.rho.rhoHub : rhoDefault;
  h += `<div class="card"><h2>허브높이 해발 ${f(C.hubZ, 1)} m 결과</h2><div class="big">
   <div><b>${f(hub.mean, 2)}</b><span>평균풍속 m/s</span></div><div><b>${f(hub.k, 3)}</b><span>Weibull k</span></div><div><b>${f(hub.A, 2)}</b><span>Weibull A (m/s)</span></div>
   <div><b>${fi(0.5 * rho * hub.m3)}</b><span>에너지밀도 W/m²</span></div><div><b>${C.sh ? f(C.sh.alpha, 3) : '-'}</b><span>시어 지수 α</span></div>
   <div><b>${f(hub.tiRep15, 3)}</b><span>대표 TI (15 m/s)</span></div><div><b>${C.rho ? f(C.rho.rhoHub, 3) : '-'}</b><span>공기밀도 kg/m³</span></div><div><b>${f(hub.recovery, 1)}</b><span>회수율 %</span></div></div>`;
  if (hub.n < 52000) h += `<div class="warnbox"><div>측정 기간이 1년이 안 됩니다 (${f(hub.n * ser.step / 86400000, 0)}일분). 계절 편차가 있어 장기 보정(MCP) 없이 발전량에 바로 쓰면 오차가 큽니다.</div></div>`;
  h += `<h4>높이별 요약</h4><div class="tw"><table class="t"><tr><th>측정높이 m</th><th>해발 m</th><th>평균</th><th>중앙</th><th>최대</th><th>표준편차</th><th>Weibull k</th><th>Weibull A</th><th>에너지 패턴계수</th><th>TI 평균</th><th>대표 TI@15</th><th>유효자료</th><th>회수율 %</th></tr>`;
  const rowT = (lbl, z, st, cls) => `<tr class="${cls || ''}"><td>${lbl}</td><td>${f(z, 1)}</td><td>${f(st.mean, 3)}</td><td>${f(st.median, 2)}</td><td>${f(st.max, 2)}</td><td>${f(st.std, 2)}</td><td>${f(st.k, 3)}</td><td>${f(st.A, 3)}</td><td>${f(st.epf, 3)}</td><td>${f(st.tiAll, 3)}</td><td>${f(st.tiRep15, 3)}</td><td>${fi(st.n)}</td><td>${f(st.recovery, 2)}</td></tr>`;
  C.heights.forEach(x => h += rowT(x.h, x.z, x.st));
  h += rowT('허브', C.hubZ, hub, 'hub') + `</table></div></div>`;
  // 그래프
  const yms = hub.yearMonth;
  h += `<div class="card"><h2>그래프 <span class="sub">허브높이 기준</span></h2><div class="grid2">`;
  if (hub.sectors) h += chartRose(hub.sectors, ui.rose, '풍배도', 'rose');
  h += chartHist(hub.hist, hub.k, hub.A, '풍속 분포');
  if (C.sh) h += chartProfile(C.sh.z.map((z, i) => ({ z, v: C.sh.means[i] })), C.sh.alpha, C.sh.vAt, { z: C.hubZ, v: C.sh.vAt(C.hubZ) }, `높이별 평균풍속 (동시 자료 ${fi(C.sh.n)}개)`);
  h += chartBars(yms.map(x => String(x.ym).replace(/(\d{4})(\d\d)/, '$1-$2').slice(2)), yms.map(x => x.mean), '월별 평균풍속', '평균풍속 (m/s)', (i, v) => `${String(yms[i].ym).replace(/(\d{4})(\d\d)/, '$1-$2')}: ${f(v, 2)} m/s (${fi(yms[i].n)}개)`, yms.map(x => { const y = Math.floor(x.ym / 100), m = x.ym % 100; return x.n / (new Date(Date.UTC(y, m, 0)).getUTCDate() * 86400000 / ser.step); }));
  const lo = C.heights[0], hi = C.heights[C.heights.length - 1];
  h += chartLines([...Array(24).keys()], [{ name: `해발 ${f(lo.z, 0)} m`, y: lo.st.diurnal, c: '#86b6ef' }, { name: `허브 ${f(C.hubZ, 0)} m`, y: hub.diurnal, c: '#eb6834' }, { name: `해발 ${f(hi.z, 0)} m`, y: hi.st.diurnal, c: '#0d366b' }], '시간대별 평균풍속', '시각 (h)', '평균풍속 (m/s)', { xticks: [0, 3, 6, 9, 12, 15, 18, 21] });
  const tiv = hub.ti.filter(x => x.v >= 2 && x.v <= 25);
  h += chartLines(tiv.map(x => x.v), [{ name: '평균 TI', y: tiv.map(x => x.mean), c: '#2a78d6' }, { name: '대표 TI (평균+1.28σ)', y: tiv.map(x => x.rep), c: '#0d366b', dash: 1 }], '풍속별 난류강도', '풍속 (m/s)', 'TI', { d: 3, zero: 1 });
  h += `</div><div class="hint" style="margin-top:6px">라이다 TI는 컵 풍속계보다 0.4~3%p 높게 나오는 경향이 있습니다(보정 전 값).</div></div>`;
  // 방향별
  if (hub.sectors) {
    h += `<div class="card"><h2>방향별 통계 <span class="sub">허브 해발 ${f(C.hubZ, 1)} m · 풍향 보정 ${o.dirOffset}°</span></h2><div class="tw"><table class="t"><tr><th>방향 °</th><th>빈도 %</th><th>평균 m/s</th><th>Weibull k</th><th>Weibull A</th><th>에너지 %</th><th>시어 α</th><th>자료 수</th></tr>`;
    hub.sectors.forEach((x, i) => h += `<tr><td>${x.dir}</td><td>${f(x.freq, 2)}</td><td>${f(x.mean, 2)}</td><td>${f(x.k, 3)}</td><td>${f(x.A, 3)}</td><td>${f(x.energyPct, 1)}</td><td>${C.sh && C.sh.sectors[i] ? f(C.sh.sectors[i].alpha, 3) : '-'}</td><td>${fi(x.n)}</td></tr>`);
    h += `<tr class="sum"><td>전체</td><td>100.00</td><td>${f(hub.mean, 2)}</td><td>${f(hub.k, 3)}</td><td>${f(hub.A, 3)}</td><td>100.0</td><td>${C.sh ? f(C.sh.alpha, 3) : '-'}</td><td>${fi(hub.n)}</td></tr></table></div></div>`;
  }
  h += mcpCard(D, C);
  h += `<div class="card"><h2>대표 풍황으로 지정</h2><div class="row"><button class="btn pri" data-act="tsDesign">이 시계열의 허브높이 결과를 대표 풍황으로 지정</button><span class="hint">허브 해발 ${f(C.hubZ, 1)} m, 방향별 Weibull ${hub.sectors ? '포함' : '없음'}, 공기밀도 ${C.rho ? '측정 기온·기압으로 계산' : '자료 없음 → 1.225'}</span></div></div>`;
  return h;
}

function viewQC(D, C) {
  const q = D.opt.qc, rep = C.qc, ser = D.ser;
  const hasAv = ser.columns.some(c => c.role === 'avail'), hasCnr = ser.columns.some(c => c.role === 'cnr');
  const ck = (k, l) => `<label style="display:flex;gap:5px;align-items:center"><input type="checkbox" data-qc="${k}" ${q[k] ? 'checked' : ''}>${l}</label>`;
  const nm = (k, v, w = 60) => `<input class="n" data-qc="${k}" value="${v}" style="width:${w}px;border:1px solid var(--line);border-radius:4px;padding:2px 5px;text-align:right;font-family:var(--mono)">`;
  const roleName = { ws: '풍속', dir: '풍향', std: '표준편차', max: '최대풍속', min: '최소풍속', temp: '기온', press: '기압', rh: '습도', avail: '가용률', cnr: 'CNR', wz: '연직풍속', ti: 'TI' };
  const groups = {}; rep.forEach(r => { if (!['ws', 'dir', 'temp', 'press'].includes(r.role)) return; const g = groups[r.role] || (groups[r.role] = { total: 0, range: 0, stuck: 0, avail: 0, cnr: 0, kept: 0 }); for (const k in g) g[k] += r[k]; });
  const sumTxt = Object.entries(groups).map(([k, g]) => { const out = g.total - g.kept; return `${roleName[k]} ${fi(out)}개 (${f(100 * out / Math.max(1, g.total), 1)}%)`; }).join(' · ');
  let h = `<div class="card"><h2>오류값 제거 <span class="sub">원자료에서 아래 기준에 걸린 10분 값은 빼고 계산합니다</span></h2>
   <div class="row" style="gap:18px;align-items:center">
    ${ck('range', '범위 밖 값')} <span class="hint">풍속 0~${nm('wsMax', q.wsMax, 50)} m/s · 풍향 0~360° · 기온 −40~50 ℃ · 기압 850~1,090 hPa · 습도 0~100%</span></div>
   <div class="row" style="gap:18px;align-items:center;margin-top:6px">
    ${ck('stuck', '같은 값이 계속')} <span class="hint">${nm('stuckN', q.stuckN, 44)}개(${f(q.stuckN * ser.step / 60000, 0)}분) 이상 연속이면 센서 멈춤으로 보고 제외 (풍속·풍향·기온·기압)</span></div>
   <div class="row" style="gap:18px;align-items:center;margin-top:6px">
    <span>라이다 가용률 기준</span> <span class="hint">${nm('minAvail', D.opt.minAvail, 50)}% 미만인 높이의 풍속·풍향 제외 ${hasAv ? '' : '(가용률 열 없음)'}</span>
    ${hasCnr ? ck('cnr', 'CNR 기준') + ` <span class="hint">${nm('cnrMin', q.cnrMin, 50)} dB 미만 제외</span>` : ''}</div>
   <div class="info" style="margin-top:10px">제외: ${sumTxt || '없음'}</div>
   <details><summary>열별 제외 내역</summary><div class="tw" style="max-height:300px"><table class="t"><tr><th>열</th><th>원자료</th><th>범위 밖</th><th>같은 값 연속</th><th>가용률 미달</th><th>CNR 미달</th><th>남은 값</th><th>제외율 %</th></tr>
   ${rep.filter(r => ['ws', 'dir', 'std', 'temp', 'press', 'rh'].includes(r.role)).map(r => `<tr><td class="txt">${esc(r.name)}</td><td>${fi(r.total)}</td><td>${fi(r.range)}</td><td>${fi(r.stuck)}</td><td>${fi(r.avail)}</td><td>${fi(r.cnr)}</td><td>${fi(r.kept)}</td><td>${f(100 * (r.total - r.kept) / Math.max(1, r.total), 2)}</td></tr>`).join('')}</table></div></details></div>`;
  return h;
}

/* ---------- 방향별 표 / 직접 입력 ---------- */
function secTotals(D) {
  const rows = D.rows.filter(r => r.freq > 0); const fs = rows.reduce((a, r) => a + r.freq, 0);
  let mean = 0, m3 = 0, okW = rows.every(r => Number.isFinite(r.k) && Number.isFinite(r.A));
  rows.forEach(r => { const w = r.freq / fs; const m = okW ? W.weibullMean(r.k, r.A) : r.mean; mean += w * m; if (okW) m3 += w * Math.pow(r.A, 3) * W.gamma(1 + 3 / r.k); });
  let k = NaN, A = NaN; if (okW && mean > 0) { k = W.kFromEPF(m3 / mean ** 3); A = mean / W.gamma(1 + 1 / k); }
  if (!okW && D.wk > 0 && D.wA > 0) return { fs, mean: W.weibullMean(D.wk, D.wA), k: D.wk, A: D.wA, okW: true, overall: true };
  return { fs, mean, k, A, okW, overall: false };
}
function viewSec(D) {
  const T = secTotals(D);
  let h = `<div class="card"><h2><span class="tag sec">방향별 표</span><input data-dsname value="${esc(D.name)}" style="border:none;font-weight:700;font-size:14px;background:transparent;width:420px"></h2>
   <div class="row"><div class="fld"><label>높이 (해발 m)</label><input class="n" data-sec="height" value="${D.height ?? ''}"></div>
   <div class="fld"><label>공기밀도 (kg/m³)</label><input class="n" data-sec="rho" value="${Number.isFinite(W.num(D.rho)) ? D.rho : ''}">${D.rhoSrc ? `<span class="srcl" title="${esc(D.rhoSrc)}">${esc(D.rhoSrc)}</span>` : '<span class="tag blank">비어 있음 — 1.225로 계산</span>'}</div>
   <div class="fld" style="flex:1"><label>출처</label><input data-sec="source" value="${esc(D.source || '')}"></div></div>`;
  const rowsW = D.rows.filter(r => r.freq > 0).every(r => Number.isFinite(r.k) && Number.isFinite(r.A));
  if (!rowsW) {
    h += `<div class="row" style="margin-top:10px;align-items:flex-end"><div class="fld"><label>전체 Weibull k</label><input class="n" data-sec="wk" value="${Number.isFinite(D.wk) ? D.wk : ''}"></div>
     <div class="fld"><label>전체 Weibull A (m/s)</label><input class="n" data-sec="wA" value="${Number.isFinite(D.wA) ? D.wA : ''}"></div>
     <div class="fld"><label>평균풍속 (보고서, m/s)</label><input class="n" data-sec="wMean" value="${Number.isFinite(D.wMean) ? D.wMean : ''}"></div>
     <div class="hint" style="flex:1;min-width:240px">방향별 k·A가 없는 표입니다. 전체 Weibull을 넣으면 모든 방향에 같은 k·A를 쓰고 빈도로 방향 분포를 반영합니다.${D.wSrc ? `<br>출처: ${esc(D.wSrc)}` : (D.wk ? '' : ' <span class="tag blank">비어 있음</span>')}</div></div>`;
    if (Number.isFinite(D.wHeight) && Number.isFinite(D.height) && Math.abs(D.wHeight - D.height) > 0.5) h += `<div class="warnbox"><div>전체 Weibull 높이(${D.wHeight} m)와 표 높이(${D.height} m)가 다릅니다.</div></div>`;
    if (Number.isFinite(D.wMean) && D.wk > 0) { const m = W.weibullMean(D.wk, D.wA); if (Math.abs(m - D.wMean) / D.wMean > 0.02) h += `<div class="info">Weibull로 계산한 평균 ${f(m, 2)} m/s와 보고서 평균 ${f(D.wMean, 2)} m/s가 ${f(100 * (m - D.wMean) / D.wMean, 1)}% 다릅니다. 보고서에서도 실제 분포가 Weibull과 다르다고 적는 경우가 있습니다. 발전량은 Weibull 기준으로 계산됩니다.</div>`; }
  }
  if (Math.abs(T.fs - 100) > 0.5) h += `<div class="warnbox"><div>빈도 합계가 ${f(T.fs, 2)}%입니다. 계산할 때는 합이 100%가 되도록 비례 조정합니다.</div></div>`;
  h += `<div class="grid2" style="margin-top:10px"><div><div class="tw" style="max-height:none"><table class="t"><tr><th>방향 °</th><th>빈도 %</th><th>평균 m/s</th><th>Weibull k</th><th>Weibull A</th><th></th></tr>`;
  D.rows.forEach((r, i) => h += `<tr><td><input data-r="${i}" data-k="dir" value="${r.dir}"></td><td><input data-r="${i}" data-k="freq" value="${Number.isFinite(r.freq) ? r.freq : ''}"></td><td><input data-r="${i}" data-k="mean" value="${Number.isFinite(r.mean) ? r.mean : ''}"></td><td><input data-r="${i}" data-k="k" value="${Number.isFinite(r.k) ? r.k : ''}"></td><td><input data-r="${i}" data-k="A" value="${Number.isFinite(r.A) ? r.A : ''}"></td><td><span class="btn ghost sm" data-act="secDel" data-i="${i}">×</span></td></tr>`);
  h += `<tr class="sum"><td>합계/전체</td><td>${f(T.fs, 2)}</td><td>${f(T.mean, 3)}</td><td>${f(T.k, 3)}</td><td>${f(T.A, 3)}</td><td></td></tr>`;
  if (D.total) h += `<tr><td class="txt">표의 전체값</td><td></td><td>${f(D.total.mean, 2)}</td><td>${f(D.total.k, 2)}</td><td>${f(D.total.A, 2)}</td><td></td></tr>`;
  h += `</table></div><div class="row" style="margin-top:6px"><button class="btn sm" data-act="secAdd">줄 추가</button><button class="btn sm" data-act="secPaste">표 붙여넣기</button></div>
  <div class="hint" style="margin-top:6px">전체 k·A는 방향별 Weibull을 빈도로 섞은 분포의 평균풍속과 평균 v³로 다시 맞춘 값입니다.</div></div>`;
  const secs = D.rows.map(r => ({ dir: r.dir, freq: r.freq * 100 / T.fs, mean: Number.isFinite(r.k) ? W.weibullMean(r.k, r.A) : r.mean, energyPct: 0 }));
  const e = D.rows.map(r => Number.isFinite(r.k) ? r.freq * Math.pow(r.A, 3) * W.gamma(1 + 3 / r.k) : Number.isFinite(r.mean) ? r.freq * r.mean ** 3 * 1.9 : r.freq); const et = e.reduce((a, b) => a + b, 0); secs.forEach((s, i) => s.energyPct = 100 * e[i] / et);
  h += `<div>${chartRose(secs, ui.rose, '풍배도', 'rose')}</div></div>`;
  h += `<div class="row" style="margin-top:12px"><button class="btn pri" data-act="secDesign" ${T.okW && Number.isFinite(D.height) ? '' : 'disabled'}>이 표를 대표 풍황으로 지정</button>${!T.okW ? '<span class="hint">방향별 k·A나 전체 Weibull k·A가 있어야 지정할 수 있습니다.</span>' : !Number.isFinite(D.height) ? '<span class="hint">높이를 넣어 주세요.</span>' : T.overall ? '<span class="hint">전체 Weibull을 모든 방향에 적용합니다. 방향별 k·A가 있을 때보다 후류 계산 정확도가 낮습니다.</span>' : ''}</div></div>`;
  return h;
}
function pasteDialog(D) {
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box"><h3>표 붙여넣기</h3><div class="hint">엑셀이나 PDF에서 방향별 표를 복사해 붙여 넣으세요. 한 줄에 한 방향, 열 순서: <b>방향 · 빈도(%) · 평균풍속 · k · A</b> (없는 값은 비워 두거나 빼도 됩니다). 순서가 다르면 아래에서 바꿔 주세요.</div>
   <textarea class="paste" id="pasteTxt" placeholder="0\t15.26\t8.21\t1.81\t9.23&#10;30\t10.84\t7.49\t1.86\t8.44"></textarea>
   <div class="row" style="margin:8px 0">열 순서 <input id="pasteOrder" value="dir freq mean k A" style="width:220px;font-family:var(--mono)"> <span class="hint">dir / freq / mean / k / A / skip</span></div>
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">넣기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => {
    const x = e.target.dataset.x; if (!x) return;
    if (x === 'ok') {
      const order = $('#pasteOrder').value.trim().split(/\s+/);
      const rows = $('#pasteTxt').value.split(/\r?\n/).map(l => l.trim().split(/[\t;,]|\s{1,}/).filter(s => s !== '')).filter(c => c.length >= 2 && Number.isFinite(W.num(c[0])));
      if (rows.length) { D.rows = rows.map(c => { const r = { dir: NaN, freq: NaN, mean: NaN, k: NaN, A: NaN }; order.forEach((k, i) => { if (k in r) r[k] = W.num(c[i]); }); return r; }); toast(`${rows.length}줄을 넣었습니다.`); }
    }
    box.remove(); render(); save();
  });
}

/* ---------- 장기 보정 (MCP) ---------- */
function mcpCompute(D, C) {
  const M = D.mcp; if (!M || !M.ref) return null; const o = M.opt || (M.opt = { method: 'vr', lag: 0, from: '', to: '' });
  const key = JSON.stringify([C.key, D.qcRes && D.qcRes.key, M.ref.t.length, o]);
  if (D._mcp && D._mcp.key === key) return D._mcp.res;
  const S = site(), elev = +S.elev || 0, ser = { ...D.ser, data: D.qcRes.data };
  const hs = W.hubSeries(ser, C.hubZ - elev, C.opt);
  const res = W.mcp({ ts: ser.ts, ws: hs.ws, dir: hs.dir, step: ser.step }, M.ref, { nSec: C.opt.nSec, method: o.method, lag: +o.lag || 0, from: o.from ? W.parseDate(o.from + ' 00:00') : null, to: o.to ? W.parseDate(o.to + ' 23:59') : null });
  if (!res.err) res.st = W.statsFor({ ts: res.lt.ts, step: res.lt.step, columns: [] }, { ws: res.lt.ws, dir: res.lt.dir }, { nSec: C.opt.nSec, weibull: C.opt.weibull, dirOffset: C.opt.dirOffset });
  D._mcp = { key, res }; return res;
}
function mcpCard(D, C) {
  const M = D.mcp;
  let h = `<div class="card" id="mcpCard"><h2>장기 보정 (MCP) <span class="sub">기상청 등 장기 기준 자료로 측정 기간 풍황을 장기값으로 보정</span></h2>`;
  if (!M || !M.ref) return h + `<div class="drop" id="dropMcp"><b>기상청 장기 자료를 끌어다 놓거나 눌러서 고르세요</b><br><span class="hint">기상자료개방포털(data.kma.go.kr) → 기상관측 → 종관기상관측(ASOS)·방재기상관측(AWS)·해양기상부이 → <b>시간자료</b> CSV. 여러 해 파일을 한꺼번에 넣어도 되고 zip도 됩니다. 풍속·풍향·일시 열만 읽습니다.</span></div>
   <input type="file" id="mcpIn" multiple hidden accept=".csv,.txt,.zip">
   <div class="hint" style="margin-top:6px">측정기 자료와 기준 자료가 겹치는 시간으로 방향별 관계식을 구하고, 기준 자료 전체 기간(예: 10년)에 적용해 측정기 허브높이의 장기 풍황을 만듭니다. 두 자료의 시각은 같은 기준(보통 KST)이어야 합니다.</div></div>`;
  const R = M.ref, o = M.opt, r = mcpCompute(D, C), hub = C.hub;
  h += `<div class="kv" style="margin-bottom:8px"><span>기준 자료</span><span><b>${esc(R.name || '기준 자료')}</b>${R.id ? ` (지점 ${esc(R.id)})` : ''} · ${R.files.length}개 파일 · 열: ${esc(R.cols.t)} / ${esc(R.cols.v)} / ${esc(R.cols.d || '풍향 없음')}</span>
   <span>기간</span><span>${W.fmtDate(R.t[0], 1)} ~ ${W.fmtDate(R.t[R.t.length - 1], 1)} · ${fi(R.t.length)}개 · 간격 ${f(R.step / 3600000, R.step % 3600000 ? 2 : 0)}시간 · 약 ${f((R.t[R.t.length - 1] - R.t[0]) / 3.15576e10, 1)}년</span></div>
   <div class="row"><div class="fld"><label>보정 방법</label><select data-mcp="method"><option value="vr" ${o.method !== 'lin' ? 'selected' : ''}>분산비 (권장)</option><option value="lin" ${o.method === 'lin' ? 'selected' : ''}>선형 회귀</option></select></div>
   <div class="fld"><label>시각 맞춤 (시간)</label><select data-mcp="lag">${[-3, -2, -1, 0, 1, 2, 3].map(L => `<option value="${L}" ${+o.lag === L ? 'selected' : ''}>${L > 0 ? '+' + L : L}</option>`).join('')}</select></div>
   <div class="fld"><label>장기 기간 시작</label><input type="date" data-mcp="from" value="${o.from || ''}"></div><div class="fld"><label>장기 기간 끝</label><input type="date" data-mcp="to" value="${o.to || ''}"></div>
   <span class="sp"></span><button class="btn sm" data-act="mcpAdd">파일 더 넣기</button><button class="btn ghost sm" data-act="mcpClear">기준 자료 지우기</button></div><input type="file" id="mcpIn" multiple hidden accept=".csv,.txt,.zip">`;
  if (!r) return h + '</div>';
  if (r.err) return h + `<div class="warnbox"><div>${esc(r.err)}</div>${r.best ? `<div>시각을 ${r.best.lag}시간 옮기면 ${fi(r.best.n)}개가 겹칩니다.</div>` : ''}</div></div>`;
  const st = r.st, chg = 100 * (st.mean / hub.mean - 1), idx = 100 * (r.refLT / r.conc.ref - 1), warn = [];
  if (r.all.r < 0.7) warn.push(`상관계수가 ${f(r.all.r, 2)}로 낮습니다(0.7 미만). 기준 관측소가 멀거나 지형 영향이 커서 장기 보정의 불확도가 큽니다.`);
  if (r.best && r.best.lag !== (+o.lag || 0) && r.best.r - r.all.r > 0.01) warn.push(`시각을 ${r.best.lag > 0 ? '+' : ''}${r.best.lag}시간 맞추면 상관이 더 높습니다(r ${f(r.best.r, 3)}). 두 자료의 시간대(UTC·KST)와 시각 기준(구간 시작·끝)을 확인하세요.`);
  if (r.conc.n * (R.step / 3600000) < 0.8 * 8766) warn.push(`겹친 기간이 1년이 안 됩니다(${fi(r.conc.n)}시간). 계절 편향이 남을 수 있습니다.`);
  if ((r.ltTo - r.ltFrom) / 3.15576e10 < 5) warn.push('장기 기간이 5년보다 짧습니다. 보통 10년 이상을 씁니다.');
  h += `<div class="big" style="margin-top:10px"><div><b>${fi(r.conc.n)}</b><span>겹친 시간 (${W.fmtDate(r.conc.from)} ~ ${W.fmtDate(r.conc.to)})</span></div><div><b>${f(r.all.r, 3)}</b><span>상관계수 r</span></div>
   <div><b>${f(hub.mean, 2)}</b><span>측정 기간 평균 m/s</span></div><div><b>${f(st.mean, 2)}</b><span>장기 보정 평균 m/s</span></div><div><b>${chg >= 0 ? '+' : ''}${f(chg, 1)}%</b><span>측정 기간 대비</span></div>
   <div><b>${f(st.k, 3)}</b><span>장기 Weibull k</span></div><div><b>${f(st.A, 2)}</b><span>장기 Weibull A</span></div><div><b>${idx >= 0 ? '+' : ''}${f(idx, 1)}%</b><span>기준 자료: 장기 / 겹친 기간</span></div></div>`;
  h += `<div class="hint">기준 자료의 겹친 기간 평균 ${f(r.conc.ref, 2)} m/s, 장기(${W.fmtDate(r.ltFrom)} ~ ${W.fmtDate(r.ltTo)}) 평균 ${f(r.refLT, 2)} m/s. ${Math.abs(idx) < 1 ? '측정 기간의 바람이 장기 평균과 비슷해서 보정 폭이 작습니다.' : idx > 0 ? '측정 기간의 바람이 장기 평균보다 약했던 편이라 장기값이 측정값보다 높아집니다.' : '측정 기간의 바람이 장기 평균보다 강했던 편이라 장기값이 측정값보다 낮아집니다.'}</div>`;
  if (warn.length) h += `<div class="warnbox">${warn.map(w => `<div>${esc(w)}</div>`).join('')}</div>`;
  h += `<details style="margin-top:8px"><summary>방향별 관계식 (측정기 = a + b × 기준)</summary><div class="tw"><table class="t" style="max-width:720px"><tr><th>기준 풍향 °</th><th>겹친 수</th><th>r</th><th>a</th><th>b</th><th>풍향 차이 °</th><th>식</th></tr>${r.sec.map(s => `<tr><td>${s.dir}</td><td>${fi(s.n)}</td><td>${f(s.r, 3)}</td><td>${f(s.a, 3)}</td><td>${f(s.b, 3)}</td><td>${f(s.veer, 1)}</td><td class="txt">${s.own ? '방향별' : '전체 식 (자료 부족)'}</td></tr>`).join('')}<tr class="sum"><td>전체</td><td>${fi(r.all.n)}</td><td>${f(r.all.r, 3)}</td><td>${f(r.all.a, 3)}</td><td>${f(r.all.b, 3)}</td><td></td><td></td></tr></table></div>
   <div class="hint">시각 맞춤별 상관: ${r.lags.map(x => `${x.lag > 0 ? '+' : ''}${x.lag}h ${f(x.r, 3)}`).join(' · ')}</div></details>`;
  const yr = new Map(); for (let i = 0; i < R.t.length; i++) { const y = new Date(R.t[i] - 1).getUTCFullYear(); const q = yr.get(y) || { s: 0, n: 0 }; q.s += R.v[i]; q.n++; yr.set(y, q); }
  const ys = [...yr.entries()].filter(([, q]) => q.n > 0.8 * 8766 * 3600000 / R.step).sort((a, b) => a[0] - b[0]);
  if (ys.length >= 2) h += `<div class="grid2" style="margin-top:8px">${chartBars(ys.map(([y]) => String(y)), ys.map(([, q]) => q.s / q.n), '기준 자료 연평균풍속 (자료 80% 이상인 해)', '평균풍속 (m/s)', (i, v) => `${ys[i][0]}: ${f(v, 2)} m/s`)}${st.sectors ? chartRose(st.sectors, ui.rose, '장기 보정 풍배도', 'rose') : ''}</div>`;
  h += `<div class="row" style="margin-top:10px"><button class="btn pri" data-act="mcpDesign">장기 보정 결과를 대표 풍황으로 지정</button><span class="hint">허브 해발 ${f(C.hubZ, 1)} m · 공기밀도·시어는 측정 자료 값을 씁니다.</span></div>`;
  return h + '</div>';
}
async function mcpLoad(D, fileList) {
  let files; try { files = await expandFiles(fileList); } catch (e) { toast('파일을 열지 못했습니다: ' + e.message); return; }
  const parts = [], names = [], bad = [];
  for (const x of files) { if (!/\.(csv|txt|tsv)$/i.test(x.name)) { bad.push(x.name); continue; } const p = W.parseKmaWind(decodeText(x.buf)); if (p) { parts.push(p); names.push(x.name); } else bad.push(x.name); }
  if (!parts.length) { toast('풍속·일시 열을 찾지 못했습니다. 기상청 시간자료 CSV인지 확인하세요.', 5000); return; }
  const old = D.mcp && D.mcp.ref; if (old) parts.unshift({ t: Array.from(old.t), v: Array.from(old.v), d: Array.from(old.d) });
  const m = W.mergeKma(parts); const p0 = parts.find(p => p.cols) || {};
  const nm = new Set(parts.filter(p => p.name).map(p => p.name));
  D.mcp = { opt: (D.mcp && D.mcp.opt) || { method: 'vr', lag: 0, from: '', to: '' }, ref: { name: [...nm].join(', ') || (old && old.name) || '', id: p0.id || (old && old.id) || '', cols: (old && old.cols) || p0.cols, files: [...(old ? old.files : []), ...names], ...m } };
  if (nm.size > 1) toast(`관측소가 ${nm.size}곳 섞여 있습니다: ${[...nm].join(', ')}. 한 관측소 자료만 넣어 주세요.`, 7000);
  else toast(`기준 자료 ${fi(m.t.length)}개(${W.fmtDate(m.t[0])} ~ ${W.fmtDate(m.t[m.t.length - 1])})를 넣었습니다.${bad.length ? ` 읽지 못한 파일 ${bad.length}개.` : ''}`, 5000);
  D._mcp = null; busy(() => { render(); save(); });
}
/* ---------- 대표 풍황 ---------- */
function viewDesign(S) {
  const d = S.design;
  if (!d) return `<div class="card"><h2>대표 풍황 <span class="sub">다음 단계(발전량 계산)에 넘길 값</span></h2><div class="hint">아직 지정하지 않았습니다. 위 자료 화면 아래의 "대표 풍황으로 지정" 버튼으로 정합니다.</div></div>`;
  let h = `<div class="card design"><h2>대표 풍황 <span class="sub">${esc(d.src)} · ${new Date(d.at).toLocaleString('ko-KR')}</span><span class="sp"></span><button class="btn ghost sm" data-act="clearDesign">지정 해제</button></h2>
  <div class="big"><div><b>${f(d.z, 1)}</b><span>허브높이 (해발 m)</span></div><div><b>${f(d.mean, 2)}</b><span>평균풍속 m/s</span></div><div><b>${f(d.k, 3)}</b><span>Weibull k</span></div><div><b>${f(d.A, 2)}</b><span>Weibull A</span></div><div><b>${f(d.rho, 3)}</b><span>공기밀도 kg/m³</span></div><div><b>${d.sectors ? d.sectors.length + '구간' : '없음'}</b><span>방향 분포${d.sectorMode ? ' · ' + esc(d.sectorMode) : ''}</span></div></div>`;
  if (d.note) h += `<div class="hint">${esc(d.note)}</div>`;
  if (d.sectors) h += `<details><summary>방향별 값 보기</summary><table class="t" style="max-width:520px"><tr><th>방향 °</th><th>빈도 %</th><th>k</th><th>A</th></tr>${d.sectors.map(s => `<tr><td>${s.dir}</td><td>${f(s.freq, 2)}</td><td>${f(s.k, 3)}</td><td>${f(s.A, 3)}</td></tr>`).join('')}</table></details>`;
  return h + `</div>`;
}
function setDesign(obj) { const S = site(); S.design = { ...obj, at: Date.now() }; render(); save(); toast('대표 풍황으로 지정했습니다.'); }

// ===== 장기 공기밀도: 기상청 평년값(1991~2020 연평균기온) =====
// 평년 기온: 기상청 날씨누리 "한국 지역별 기후특성" 1991~2020 평년값. 좌표·표고는 기상청 종관기상관측소 대략값(확인 필요)
// [이름, 지점번호, 위도, 경도, 표고 m, 평년 기온 ℃, 종류(coast 해안·island 섬·inland 육지), 바다까지 대략 km]
const KMA_STATIONS = [
  ['속초', 90, 38.2509, 128.5647, 18, 12.5, 'coast', 0.5], ['강릉', 105, 37.7515, 128.8910, 26, 13.5, 'coast', 2], ['울진', 130, 36.9918, 129.4128, 50, 12.8, 'coast', 1],
  ['영덕', 277, 36.5333, 129.4093, 42, 13.1, 'coast', 2], ['포항', 138, 36.0320, 129.3800, 3, 14.6, 'coast', 1], ['울산', 152, 35.5601, 129.3201, 35, 14.4, 'coast', 5],
  ['부산', 159, 35.1047, 129.0320, 70, 15.0, 'coast', 1.5], ['창원', 155, 35.1702, 128.5728, 37, 14.8, 'coast', 3], ['통영', 162, 34.8455, 128.4356, 33, 14.6, 'coast', 0.5],
  ['거제', 294, 34.8882, 128.6046, 45, 14.4, 'island', 1], ['남해', 295, 34.8166, 127.9264, 45, 14.3, 'island', 2], ['여수', 168, 34.7393, 127.7406, 65, 14.6, 'coast', 0.5],
  ['고흥', 262, 34.6181, 127.2757, 53, 13.7, 'coast', 5], ['완도', 170, 34.3959, 126.7018, 35, 14.3, 'island', 0.5], ['해남', 261, 34.5537, 126.5689, 13, 13.5, 'coast', 5],
  ['목포', 165, 34.8169, 126.3812, 38, 14.0, 'coast', 1], ['흑산도', 169, 34.6872, 125.4510, 76, 13.5, 'island', 0.5], ['보령', 235, 36.3272, 126.5577, 16, 12.7, 'coast', 3],
  ['서산', 129, 36.7766, 126.4939, 29, 12.1, 'coast', 8], ['인천', 112, 37.4777, 126.6249, 71, 12.5, 'coast', 2], ['백령도', 102, 37.9662, 124.6305, 145, 11.3, 'island', 1],
  ['울릉도', 115, 37.4813, 130.8986, 223, 12.7, 'island', 0.5], ['제주', 184, 33.5141, 126.5297, 21, 16.2, 'island', 1], ['고산', 185, 33.2938, 126.1628, 74, 15.7, 'island', 1],
  ['성산', 188, 33.3868, 126.8802, 18, 15.6, 'island', 0.5], ['서귀포', 189, 33.2462, 126.5653, 50, 16.9, 'island', 1],
  ['서울', 108, 37.5714, 126.9658, 86, 12.8, 'inland', 30], ['대구', 143, 35.8779, 128.6530, 64, 14.5, 'inland', 60], ['광주', 156, 35.1729, 126.8916, 72, 14.1, 'inland', 40],
  ['진주', 192, 35.1638, 128.0400, 30, 13.4, 'inland', 25], ['밀양', 288, 35.4915, 128.7441, 13, 13.6, 'inland', 35], ['대전', 133, 36.3720, 127.3721, 69, 13.1, 'inland', 80]
].map(([name, no, lat, lon, elev, T, kind, sea]) => ({ name, no, lat, lon, elev, T, kind, sea }));
const KIND_KO = { coast: '해안', island: '섬', inland: '육지' };
const havKm = (a, b, c, d) => { const R = 6371, r = Math.PI / 180; const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
// 평년 기온 + 표준기압 → 높이 z(해발 m) 공기밀도
const rhoFromStation = (st, z) => { const T = st.T + 273.15 - 0.0065 * (z - st.elev); const Pz = 101325 * Math.pow(1 - 0.0065 * z / 288.15, 5.2559); return Pz / (287.05 * T); };
function stationsNear(S) { const c = siteCoord(S); if (!c) return []; return KMA_STATIONS.map(st => ({ ...st, dist: havKm(c.lat, c.lon, st.lat, st.lon) })).sort((a, b) => a.dist - b.dist); }
function stationPick(S) { const list = stationsNear(S); if (!list.length) return null; const t = S.turb || {}; if (t.station) { const s = list.find(x => x.no === +t.station); if (s) return s; } return list.find(x => x.kind !== 'inland') || list[0]; }
// 대표 풍황 공기밀도의 성격: 보고서 장기값 / 1년 측정값 / 기본값
function designRhoKind(d) { if (!d) return 'default'; if (d.rhoKind) return d.rhoKind; if (!Number.isFinite(d.rho) || Math.abs(d.rho - 1.225) < 1e-9) return 'default'; if (/^방향별 표/.test(d.src || '')) return 'report'; if (/^PDF 요약|^시계열/.test(d.src || '')) return 'measured'; return 'report'; }

/* ================= 2단계: 터빈 ================= */
const turbOf = id => P.turbines.find(t => t.id === id) || P.turbines[0];
function siteAlpha(S) {
  const d = S.design || {};
  if (Number.isFinite(d.alpha)) return { a: d.alpha, src: '대표 풍황의 시어 지수' };
  const wg = S.datasets.find(x => x.type === 'wg');
  if (wg) { const r = wg.reports[wg.reports.length - 1], elev = +S.elev || 0; const X = r.sensors.map(q => Math.log(q.height + elev)), Y = r.sensors.map(q => Math.log(q.mean)); const mx = X.reduce((a, b) => a + b) / X.length, my = Y.reduce((a, b) => a + b) / Y.length; let a = 0, b = 0; X.forEach((x, i) => { a += (x - mx) * (Y[i] - my); b += (x - mx) ** 2; }); if (b > 0) return { a: a / b, src: `Windographer 보고서 높이별 평균풍속 (${SRCNAME(r.file)})` }; }
  return { a: 0.10, src: '자료 없음 — 해상 일반값 0.10 가정', assumed: true };
}
function rhoCompareHtml(S, c) {
  const RI = c.rhoInfo, list = stationsNear(S).slice(0, 8); const z = c.t.hub;
  const rows = [[`대표 풍황 값 (${RI.dk === 'report' ? '보고서 장기값' : RI.dk === 'measured' ? '1년 측정값' : '표준값'})`, RI.rhoD, esc(S.design.src), RI.use === 'design']];
  let h = `<details style="margin-top:8px" ${RI.dk === 'measured' ? 'open' : ''}><summary>공기밀도 근거 비교 (허브높이 해발 ${f(z, 1)} m) — 사용 중: <b>${f(c.rho, 3)} kg/m³</b> · ${esc(RI.src)}</summary>
   <div class="hint" style="margin:6px 0">발전량은 20년 이상 운영기간의 평균을 보므로 공기밀도도 장기값을 씁니다. 자동 선택 순서: 보고서 장기값 → 기상청 관측소 평년값(1991~2020) → 1년 측정값. 관측소 값은 평년 기온을 고도감률(0.65℃/100 m)로 허브높이에 옮기고 표준대기 기압으로 계산합니다(습도 미반영, 습하면 0.3~0.5% 낮음). 해상 단지는 해안·섬 관측소를 고릅니다.</div>
   <table class="t"><tr><th>근거</th><th>공기밀도 kg/m³</th><th>사용 중 대비</th><th>설명</th></tr>${rows.map(r => `<tr class="${r[3] ? 'sel' : ''}"><td class="txt">${r[0]}</td><td>${f(r[1], 3)}</td><td>${f(100 * (r[1] / c.rho - 1), 2)}%</td><td class="txt"><span class="srcl" style="max-width:260px">${r[2]}</span></td></tr>`).join('')}</table>
   ${list.length ? `<table class="t" style="margin-top:8px"><tr><th>관측소</th><th>종류</th><th>바다까지 km</th><th>지점까지 km</th><th>표고 m</th><th>평년 기온 ℃</th><th>허브 공기밀도</th><th>사용 중 대비</th><th></th></tr>${list.map(st => { const r = rhoFromStation(st, z); const on = RI.use === 'station' && RI.st && RI.st.no === st.no; const pick = (S.turb || {}).station ? +S.turb.station === st.no : RI.st && RI.st.no === st.no; return `<tr class="${on ? 'sel' : ''}"><td class="txt">${st.name} (${st.no})</td><td>${KIND_KO[st.kind]}</td><td>${st.sea}</td><td>${f(st.dist, 0)}</td><td>${st.elev}</td><td>${st.T}</td><td>${f(r, 3)}</td><td>${f(100 * (r / c.rho - 1), 2)}%</td><td>${pick ? '<span class="tag">선택</span>' : `<span class="btn ghost sm" data-act="stpick" data-v="${st.no}">고르기</span>`}</td></tr>`; }).join('')}</table><div class="hint">평년 기온: 기상청 날씨누리 한국 지역별 기후특성(1991~2020). 관측소 좌표·표고는 대략값입니다. 표고 20 m 차이는 공기밀도 약 0.2%입니다. ${(S.turb || {}).station ? '<span class="btn ghost sm" data-act="stpick" data-v="">자동 선택으로</span>' : '기본은 가장 가까운 해안·섬 관측소입니다.'}</div>` : '<div class="hint">지점 좌표가 없어 관측소를 찾을 수 없습니다.</div>'}</details>`;
  if (RI.use === 'design' && RI.dk === 'measured') h += `<div class="warnbox"><div>공기밀도가 1년 측정값입니다(장기값 아님). 관측소 평년값이나 보고서 장기값을 쓰는 것이 원칙입니다.</div></div>`;
  return h;
}
function turbSet(S) {
  ensureTurbines();
  if (!S.turb) S.turb = {};
  const t = S.turb; if (!P.turbines.find(x => x.id === t.tid)) t.tid = P.turbines[0].id;
  const T = turbOf(t.tid);
  if (!Number.isFinite(t.hub)) t.hub = T.hub;
  if (!t.dens) t.dens = T.regulation === 'stall' ? 'power' : 'iec';
  if (!t.rhoMode || (t.rhoMode === 'design' && !t.rhoV2)) { t.rhoMode = 'auto'; } t.rhoV2 = 1;
  if (!t.hours) t.hours = 8760;
  return t;
}
function turbCalc(S, ov) {
  const d = S.design; if (!d) return null; let t = turbSet(S);
  if (ov && (ov.tid || Number.isFinite(ov.hub))) { t = { ...t }; if (ov.tid) { t.tid = ov.tid; t.hub = turbOf(ov.tid).hub; } if (Number.isFinite(ov.hub)) t.hub = ov.hub; }
  const T = turbOf(t.tid);
  const al = Number.isFinite(t.alpha) ? { a: t.alpha, src: '직접 입력' } : siteAlpha(S);
  const s = Math.pow(t.hub / d.z, al.a);
  const st = stationPick(S), dk = designRhoKind(d); const rhoD = Number.isFinite(d.rho) ? d.rho - 0.113 * (t.hub - d.z) / 1000 : 1.225; const rhoSt = st ? rhoFromStation(st, t.hub) : NaN;
  let rhoUse = t.rhoMode === 'manual' && Number.isFinite(t.rho) ? 'manual' : t.rhoMode === 'station' && Number.isFinite(rhoSt) ? 'station' : t.rhoMode === 'design' ? 'design' : (dk === 'report' || !Number.isFinite(rhoSt) ? 'design' : 'station');
  const rho = rhoUse === 'manual' ? t.rho : rhoUse === 'station' ? rhoSt : rhoD;
  const rhoInfo = { use: rhoUse, dk, rhoD, rhoSt, st, src: rhoUse === 'manual' ? '직접 입력' : rhoUse === 'station' ? `기상청 ${st.name} 평년 기온 ${st.T}℃(1991~2020) + 표준기압 · ${KIND_KO[st.kind]} · 지점에서 ${f(st.dist, 0)} km` : dk === 'report' ? '대표 풍황 값 (보고서 장기값)' : dk === 'measured' ? '대표 풍황 값 (1년 측정값 — 장기값 아님)' : '표준값 1.225 (자료 없음)' };
  const P_ = W.powerFn(T, rho, t.dens);
  const sectors = d.sectors && d.sectors.length ? d.sectors : [{ dir: 0, freq: 100, k: d.k, A: d.A }];
  const useHist = t.dist === 'hist' && d.hist && d.sectors && d.hist.f.length === d.sectors.length;
  const r = useHist ? W.aepHist(d.hist, sectors, P_, s, t.hours) : W.aep(sectors, P_, s, t.hours);
  const fsum = sectors.reduce((b, y) => b + y.freq, 0);
  const meanV = useHist ? r.sectors.reduce((a, x) => a + x.freq / 100 * x.meanV, 0) : sectors.reduce((a, x) => a + x.freq / fsum * W.weibullMean(x.k, x.A * s), 0);
  return { t, T, al, s, rho, rhoInfo, P: P_, sectors, r, meanV, useHist, hist: useHist ? d.hist : null, cf: r.mwh / (T.ratedKW / 1000 * t.hours), flh: r.mwh * 1000 / T.ratedKW };
}
const CMP_COL = ['#2a78d6', '#eb6834', '#2e9e5b', '#a347c2', '#c43c3c', '#8a6d1f'];
// 여러 계열을 한 그래프에: series = [{ name, pts: [[x, y]...], dash }]
function chartMulti(series, title, xl, yl, o = {}) {
  const F = frame(420, 230, { l: 50, r: 10, t: 10, b: 30 });
  const all = series.flatMap(q => q.pts); if (!all.length) return '';
  const xmax = o.xmax || Math.max(...all.map(p => p[0])), ymax = o.ymax || Math.max(...all.map(p => p[1])) * 1.05;
  const xs = nice(0, xmax, 6), ys = nice(0, ymax);
  xs.x = v => F.m.l + (v - xs.lo) / (xs.hi - xs.lo) * F.iw; ys.y = v => F.m.t + F.ih - v / ys.hi * F.ih;
  let sv = axes(F, xs, ys, xl, yl, v => v, o.yfmt || (v => v >= 1000 ? (v / 1000) + 'k' : v));
  series.forEach((q, k) => { const col = CMP_COL[k % CMP_COL.length]; let d = ''; q.pts.forEach((p, i) => d += (i ? 'L' : 'M') + xs.x(p[0]).toFixed(1) + ',' + ys.y(p[1]).toFixed(1)); sv += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${k ? 1.7 : 2.2}" ${q.dash ? 'stroke-dasharray="5 3"' : ''}/>`; q.pts.forEach(p => sv += `<circle cx="${xs.x(p[0]).toFixed(1)}" cy="${ys.y(p[1]).toFixed(1)}" r="5" fill="transparent" data-tip="${esc(q.name)} · ${p[0]} ${o.xu || 'm/s'}: ${o.tip ? o.tip(p[1]) : f(p[1], 1)}"/>`); });
  const lg = series.map((q, k) => `<span><i style="background:${CMP_COL[k % CMP_COL.length]}"></i>${esc(q.name)}</span>`).join('');
  return `<div class="chart"><div class="ct">${title}</div><svg viewBox="0 0 ${F.w} ${F.h}">${sv}</svg><div class="legend">${lg}</div></div>`;
}
// 터빈 탭: 목록의 모든 터빈을 지점 대표 풍황으로 1기씩 계산
function turbCompareHtml(S) {
  if (!S.design || P.turbines.length < 2) return '';
  const hubMode = ui.tcmpHub || 'own', hubSame = turbCalc(S).t.hub;
  const L = P.turbines.map(T => { const c = turbCalc(S, { tid: T.id, hub: hubMode === 'same' ? hubSame : NaN }); return { T, c }; }).filter(x => x.c);
  const base = L.find(x => x.T.id === ui.tcmpBase) || L[0];
  const area = T => Math.PI * (T.rotor || 0) ** 2 / 4;
  const rel = (v, b) => b > 0 ? `${v >= b ? '+' : ''}${f(100 * (v / b - 1), 1)}%` : '-';
  let h = `<div class="card"><h2>터빈 비교 <span class="sub">${esc(siteName(S))} 대표 풍황 · 터빈 1기 · 손실·후류 빼기 전</span></h2>
   <div class="row" style="margin-bottom:8px"><div class="fld"><label>허브높이</label><select id="tcmpHub"><option value="own" ${hubMode === 'own' ? 'selected' : ''}>각 터빈 기본 허브높이</option><option value="same" ${hubMode === 'same' ? 'selected' : ''}>모두 같은 허브높이 (${f(hubSame, 1)} m, 지점 설정)</option></select></div>
   <div class="fld"><label>기준 터빈</label><select id="tcmpBase">${L.map(x => `<option value="${x.T.id}" ${x === base ? 'selected' : ''}>${esc(x.T.name)}</option>`).join('')}</select></div></div>
   <div class="tw"><table class="t"><tr><th>터빈</th><th>정격 MW</th><th>로터 m</th><th>비출력 W/m²</th><th>허브 m</th><th>허브 평균풍속</th><th>공기밀도</th><th>1기 총발전량 MWh/년</th><th>기준 대비</th><th>이용률 %</th><th>전부하시간 h</th><th>MW당 MWh</th><th>곡선</th></tr>
   ${L.map(({ T, c }) => `<tr class="click ${T.id === base.T.id ? 'sel' : ''}" data-act="tsel" data-id="${T.id}"><td class="txt">${esc(T.name)}</td><td>${f(T.ratedKW / 1000, 1)}</td><td>${f(T.rotor, 0)}</td><td>${fi(T.ratedKW * 1000 / area(T))}</td><td>${f(c.t.hub, 1)}</td><td>${f(c.meanV, 2)}</td><td>${f(c.rho, 3)}</td><td><b>${fi(c.r.mwh)}</b></td><td>${T.id === base.T.id ? '기준' : rel(c.r.mwh, base.c.r.mwh)}</td><td>${f(100 * c.cf, 1)}</td><td>${fi(c.flh)}</td><td>${fi(c.r.mwh / (T.ratedKW / 1000))}</td><td>${T.estimated ? '<span class="tag blank">추정</span>' : T.curveType === 'measured' ? '실측' : T.curveType === 'warranted' ? '보증' : '계산'}</td></tr>`).join('')}</table></div>
   <div class="hint">비출력이 낮을수록(로터가 클수록) 저풍속에서 유리하고 이용률이 높습니다. 정격출력이 다르면 1기 발전량보다 <b>MW당 발전량</b>(= 전부하시간)으로 비교하세요. 단지 전체(후류·간격 포함) 비교는 4 배치·후류 탭의 "터빈별 비교"에서 합니다.${L.some(x => x.T.estimated) ? ' <b>추정</b> 곡선은 공개 사양으로 만든 값이라 참고용입니다.' : ''}</div>`;
  const vmax = Math.max(25, ...L.map(x => x.T.curve[x.T.curve.length - 1][0]));
  const pc = L.map(({ T, c }) => { const pts = []; for (let v = 0; v <= vmax + 0.01; v += 0.5) pts.push([+v.toFixed(1), c.P(v)]); return { name: T.name, pts }; });
  const ct = L.map(({ T }) => ({ name: T.name, pts: T.curve.filter(q => Number.isFinite(q[2])).map(q => [q[0], q[2]]) }));
  const nb = Math.ceil(vmax) + 1; const bins = L.map(({ T, c }) => ({ name: T.name, pts: c.r.bins.slice(0, nb).map((v, i) => [i + 0.5, v]) }));
  h += `<div class="grid2" style="margin-top:12px">${chartMulti(pc, '출력곡선 (지점 공기밀도 보정)', '풍속 (m/s)', '출력 (kW)', { xmax: vmax, tip: v => fi(v) + ' kW' })}${chartMulti(ct, '추력계수 Ct', '풍속 (m/s)', 'Ct', { xmax: vmax, ymax: 1, yfmt: v => v, tip: v => f(v, 2) })}</div>
   <div class="grid2" style="margin-top:12px">${chartMulti(bins, '풍속 구간별 발전량', '풍속 (m/s)', '발전량 (MWh/년)', { xmax: vmax, tip: v => fi(v) + ' MWh/년' })}<div></div></div></div>`;
  return h;
}
// 배치·후류 탭: 같은 배치에 터빈만 바꿔 단지 계산
// 허가량을 채우려면 자리가 더 필요할 때: 구역 경계 안·제외 구역 밖에서 기존 터빈과 간격 기준(주풍향 main D × 직각 cross D)을 지키는 자리 중
// 간격 타원 1.5배 이상 떨어지면서 단지 중심에 가까운 곳부터 하나씩 추가(후류·케이블 균형). 기준을 지킬 자리가 없으면 최소 거리(min(cross,3)·D)만 지키는 자리로
function addPositions(F, k, T, dir) {
  const Z = zoneOf(F), D = T.rotor || 100, rule = F.spRule || { main: 7, cross: 4 }, cfg = { blade: true, dir: Number.isFinite(dir) ? dir : 0 };
  const th = cfg.dir * Math.PI / 180, ux = Math.sin(th), uy = Math.cos(th), hardMin = Math.min(rule.cross, 3) * D;
  const B = Z ? Z.bounds.filter(b => b.pts.length >= 3) : []; const allP = B.flatMap(b => b.pts);
  const rows = F.rows;
  const bx = allP.length ? [Math.min(...allP.map(q => q[0])), Math.max(...allP.map(q => q[0])), Math.min(...allP.map(q => q[1])), Math.max(...allP.map(q => q[1]))]
    : [Math.min(...rows.map(r => r.x)) - 2 * rule.main * D, Math.max(...rows.map(r => r.x)) + 2 * rule.main * D, Math.min(...rows.map(r => r.y)) - 2 * rule.main * D, Math.max(...rows.map(r => r.y)) + 2 * rule.main * D];
  const step = Math.max(D / 2, Math.sqrt((bx[1] - bx[0]) * (bx[3] - bx[2]) / 6000));
  const cand = []; for (let x = bx[0]; x <= bx[1]; x += step) for (let y = bx[2]; y <= bx[3]; y += step) cand.push([x, y]);
  const Tl = () => rows.map(() => T).concat([T]);
  const score = (x, y) => { let m = Infinity; for (const r of rows) { const dx = r.x - x, dy = r.y - y; const a = (dx * ux + dy * uy) / D, b = (-dx * uy + dy * ux) / D; m = Math.min(m, Math.hypot(a / rule.main, b / rule.cross)); } const cx = rows.reduce((t, r) => t + r.x, 0) / rows.length, cy = rows.reduce((t, r) => t + r.y, 0) / rows.length; return Math.min(m, 1.5) * 1000 - Math.hypot(x - cx, y - cy) / D; }; // 간격 타원의 1.5배까지는 멀수록, 그 이상이면 단지 중심에 가까울수록(케이블 짧게)
  const field = rows.filter(r => r.vRep > 0).map(r => ({ x: r.x, y: r.y, v: r.vRep })), sfield = rows.filter(r => r.scale > 0).map(r => ({ x: r.x, y: r.y, v: r.scale }));
  const added = []; let relaxed = 0; let maxOrd = Math.max(0, ...rows.map(r => r._ord ?? 0));
  for (let q = 0; q < k; q++) {
    const Ti = Tl(); const i = rows.length; let best = null, bs = -1, strict = true;
    for (const [x, y] of cand) { if (!optFeasible(F, Z, rows, i, x, y, cfg, Ti)) continue; const sc = score(x, y); if (sc > bs) { bs = sc; best = [x, y]; } }
    if (!best) { strict = false; for (const [x, y] of cand) { if (!optFeasible(F, Z, [], i, x, y, cfg, Ti)) continue; if (rows.some(r => Math.hypot(r.x - x, r.y - y) < hardMin)) continue; const sc = score(x, y); if (sc > bs) { bs = sc; best = [x, y]; } } }
    if (!best) break; if (!strict) relaxed++;
    let n = added.length + 1, nm; do { nm = `추가${n++}`; } while (rows.some(r => r.name === nm));
    const r = { name: nm, x: Math.round(best[0]), y: Math.round(best[1]), added: true, _ord: ++maxOrd };
    if (field.length) r.vRep = +idwSpeed(field, r.x, r.y).toFixed(3); if (sfield.length) r.scale = +idwSpeed(sfield, r.x, r.y).toFixed(4);
    rows.push(r); added.push(nm);
  }
  return { added, relaxed };
}
function permitIn(mwTot, permit) { return mwTot >= PERMIT_TOL_LO * permit - 1e-6 && mwTot <= PERMIT_TOL_HI * permit + 1e-6; }
function permitNeed(permit, mw) { const lo = Math.ceil(PERMIT_TOL_LO * permit / mw - 1e-9), hi = Math.floor(PERMIT_TOL_HI * permit / mw + 1e-9); return Math.min(Math.max(Math.round(permit / mw), lo), Math.max(lo, hi)); }
function farmFitPermit(F) {
  // 먼저 전에 뺀 자리를 되돌림
  F.rows = F.rows.filter(r => !r.added); // 전에 자동으로 추가한 자리는 지움
  if (F.parked && F.parked.length) { F.rows.push(...F.parked); F.rows.sort((a, b) => (a._ord ?? 0) - (b._ord ?? 0)); F.parked = []; }
  F.rows.forEach((r, i) => { if (r._ord == null) r._ord = i; });
  F._cache = null; F.fitMsg = null;
  const permit = +F.permitMW || 0; if (!(permit > 0) || F.noFit || F.rows.some(r => r.tid)) return;
  const S = P.sites.find(x => x.id === F.siteId); if (!S || !S.design) return;
  const T = turbOf(F.tid || turbSet(S).tid), mw = T.ratedKW / 1000, n0 = F.rows.length;
  // 지금 기수가 허가 ±10% 안이면 그대로. 벗어나면 허가량에 가장 가까운 기수로 맞춤. 정확히 맞출 수 없는 나머지는 허가 대비 %로 표시
  if (permitIn(n0 * mw, permit)) return;
  const need = permitNeed(permit, mw); if (need === n0) return;
  if (need > n0) { let dir = 0; try { dir = farmCalc(F).sp.dir; } catch (e) { } const ad = addPositions(F, need - n0, T, dir); F._cache = null; F.fitMsg = { addedN: ad.added, relaxed: ad.relaxed, n0, need, short: need - F.rows.length }; return; }
  const out = [];
  while (F.rows.length > need) { F._cache = null; const Rq = farmCalc(F, { dd: 5, dv: 1 }); if (!Rq) break; let k = 0; Rq.r.net.forEach((v, i) => { if (v < Rq.r.net[k]) k = i; }); out.push(F.rows.splice(k, 1)[0]); }
  F.parked = out; F._cache = null; F.fitMsg = { removed: out.map(r => r.name), n0, need };
}
function farmWithTurb(F, T, hubMode) {
  const R0 = farmCalc(F); if (!R0) return null; const c0 = R0.c;
  const hub = hubMode === 'same' ? c0.t.hub : T.hub;
  const G = structuredClone({ ...F, _cache: undefined }); G.id = F.id + '~' + T.id; G.tid = T.id; G.hub = hub;
  // 터빈별 풍속은 원래 단지 배율을 그대로 두고 허브높이 차이만 시어로 반영
  G.rows = F.rows.map((r, i) => ({ ...r, tid: undefined, scale: R0.scale[i] / c0.s })).filter(r => !r.added); G.speed = 'manual';
  // 허가량 맞춤으로 뺀 자리도 후보로 되돌림(풍속 배율은 그 자리 원래 값: 보고서 풍속이면 vRep 기준)
  for (const r of F.parked || []) { const sc = F.speed === 'report' && r.vRep > 0 ? r.vRep / c0.meanV : F.speed === 'manual' && r.scale > 0 ? r.scale : 1; G.rows.push({ ...r, tid: undefined, scale: sc }); } G.rows.sort((a, b) => (a._ord ?? 0) - (b._ord ?? 0)); G.parked = [];
  // 허가 설비용량이 있으면 기수 = 허가 ±10% 안에서 허가량에 가장 가까운 기수(지금 단지 터빈이 이미 범위 안이면 그 기수 그대로). 자리가 남으면 발전량이 가장 적은 자리부터 하나씩 뺌
  const permit = +F.permitMW || 0, mw = T.ratedKW / 1000; let need = G.rows.length; const removed = [];
  if (permit > 0) { if (!permitIn(G.rows.length * mw, permit)) need = permitNeed(permit, mw); }
  let addedN = [], relaxed = 0; G.rows = G.rows.filter(r => !r.added || true);
  if (G.rows.length < need) { const ad = addPositions(G, need - G.rows.length, T, R0.sp ? R0.sp.dir : 0); addedN = ad.added; relaxed = ad.relaxed; }
  while (G.rows.length > need) { G._cache = null; const Rq = farmCalc(G, { dd: 5, dv: 1 }); let k = 0; Rq.r.net.forEach((v, i) => { if (v < Rq.r.net[k]) k = i; }); removed.push(G.rows[k].name); G.rows.splice(k, 1); }
  G._cache = null; const R = farmCalc(G); const A = R ? aepCalc(G) : null; return R && A ? { T, G, R, A, hub, need, removed, addedN, relaxed, short: need > G.rows.length ? need - G.rows.length : 0 } : null;
}
function farmTurbCmpHtml(F) {
  if (!F || P.turbines.length < 2) return '';
  const hubMode = ui.fcmpHub || 'own'; const key = JSON.stringify([F.id, hubMode, F.permitMW, P.turbines.map(t => [t.id, t.hub, t.curve.length, t.rhoRef]), (farmCalc(F) || {}).key]);
  let h = `<div class="card"><h2>터빈별 비교 <span class="sub">${esc(F.name)} 배치 그대로, 터빈만 바꿔 계산 (후류·손실·불확도 포함)</span></h2>
   <div class="row"><div class="fld"><label>허브높이</label><select id="fcmpHub"><option value="own" ${hubMode === 'own' ? 'selected' : ''}>각 터빈 기본 허브높이</option><option value="same" ${hubMode === 'same' ? 'selected' : ''}>현재 단지 허브높이 그대로</option></select></div>
   <button class="btn ${ui.fcmp && ui.fcmp.key === key ? '' : 'pri'}" data-act="fcmpRun">${ui.fcmp && ui.fcmp.key === key ? '다시 계산' : ui.fcmp && ui.fcmp.fid === F.id ? '바뀐 내용으로 다시 계산' : `터빈 ${P.turbines.length}개 비교 계산`}</button></div>`;
  const X = ui.fcmp && ui.fcmp.fid === F.id ? ui.fcmp : null;
  if (X) {
    const base = X.list.find(x => x.T.id === (F.tid || turbSet(P.sites.find(s => s.id === F.siteId)).tid)) || X.list[0];
    const rel = (v, b) => b > 0 ? `${v >= b ? '+' : ''}${f(100 * (v / b - 1), 1)}%` : '-';
    const p90 = A => (A.pv.find(q => q.p === 90) || {}).mwh;
    h += `${X.key !== key ? '<div class="warnbox"><div>단지나 터빈이 바뀌었습니다. 다시 계산해 주세요.</div></div>' : ''}<div class="tw" style="margin-top:8px"><table class="t"><tr><th>터빈</th><th>기수</th><th>기당 MW</th><th>MW</th>${+F.permitMW > 0 ? '<th>허가 대비</th>' : ''}<th>허브 m</th><th>총발전량 MWh</th><th>후류 %</th><th>출력 상한 %</th><th>총손실 %</th><th>순발전량 P50 MWh</th><th>현재 대비</th><th>P90 MWh</th><th>이용률 %</th><th>MW당 P50</th><th>불확도 %</th><th>최소 간격 D</th><th>간격 미달 쌍</th><th></th></tr>
     ${X.list.map(x => { const { T, R, A } = x; return `<tr class="${x === base ? 'sel' : ''}"><td class="txt" style="white-space:nowrap">${esc(T.name)}${T.estimated ? ' <span class="tag blank">추정</span>' : ''}</td><td>${x.G.rows.length}${(x.addedN || []).length ? ` <span class="hint">(+${x.addedN.length})</span>` : ''}${x.short ? ` <span class="ng" title="허가 용량을 채우려면 ${x.need}기 필요 — 놓을 자리를 못 찾음">(${x.need}기 필요)</span>` : ''}</td><td>${R.derate ? `${f(R.derate.perMW[0], 2)} <span class="hint">/ ${f(T.ratedKW / 1000, 1)}</span>` : f(T.ratedKW / 1000, 1)}</td><td>${f(R.capMW, 1)}</td>${R.permit ? `<td${R.permit.st === 'in' ? '' : ' class="ng"'}>${f(100 * R.permit.ratio, 1)}%</td>` : ''}<td>${f(x.hub, 1)}</td><td>${fi(R.G)}</td><td>${f(100 * R.wake, 2)}</td><td>${R.curt > 0 ? f(R.curtPct, 2) : '-'}</td><td>${f(100 * A.total, 2)}</td><td><b>${fi(A.net)}</b></td><td>${x === base ? '현재' : rel(A.net, base.A.net)}</td><td>${fi(p90(A))}</td><td>${f(100 * A.net / (R.capMW * R.c.t.hours), 1)}</td><td>${fi(A.net / R.capMW)}</td><td>${f(A.U.total, 2)}</td><td>${f(Math.min(...R.spacing), 2)}</td><td>${R.sp.bad.length ? `<span class="ng">${R.sp.bad.length}</span>` : '0'}</td><td><span class="btn ghost sm" data-act="fcmpMake" data-id="${T.id}">새 단지로</span></td></tr>`; }).join('')}</table></div>
     ${+F.permitMW > 0 ? `<div class="info" style="margin-top:6px">허가 설비용량 ${f(+F.permitMW, 1)} MW 기준: 배치 자리 수 그대로 정격 합계가 허가의 ±10%(${f(PERMIT_TOL_LO * F.permitMW, 1)}~${f(PERMIT_TOL_HI * F.permitMW, 1)} MW) 안이면 그 기수 그대로, 벗어나면 허가량에 가장 가까운 기수로 정하고, 정확히 맞출 수 없는 나머지는 "허가 대비" %로 보여 주며, 허가 용량 적용 방식("${{ cap: '단지 출력 상한', tol: '정격 그대로', derate: '기당 출력 제한' }[F.permitMode || 'cap']}")대로 계산했습니다. 자리가 남으면 지금 배치에서 발전량이 가장 적은 자리부터 빼고, 모자라면 구역 안에 자리를 추가했습니다. ${X.list.filter(x => x.removed.length || (x.addedN || []).length).map(x => `${esc(x.T.model || x.T.name)}: ${x.removed.length ? x.removed.map(esc).join(', ') + ' 제외' : ''}${(x.addedN || []).length ? `${x.addedN.length}자리 추가(간격 기준 1.5배 이상·단지 중심 가까이${x.relaxed ? `, ${x.relaxed}기는 최소 거리만` : ''})` : ''}`).join(' · ')}${X.list.some(x => x.short) ? ' · <span class="ng">자리가 모자란 터빈은 배치 최적화로 자리를 늘려야 합니다.</span>' : ''}</div>` : '<div class="hint" style="margin-top:6px">단지에 "허가 설비용량"을 넣으면 터빈마다 기수와 기당 출력을 허가 용량에 맞춰 비교합니다.</div>'}
     <div class="hint">"현재"는 이 단지에 지정된 터빈입니다. 같은 자리에 로터가 큰 터빈을 넣으면 간격(D 배수)이 줄어 후류가 커지고 간격 미달 쌍이 늘어납니다 — 이 경우 4 배치·후류의 배치 최적화로 다시 배치해 보세요. 기수가 같아도 정격출력이 다르면 설비용량이 달라지므로 <b>MW당 P50</b>도 함께 보세요. "새 단지로"를 누르면 그 터빈으로 바꾼 단지가 새로 만들어져 보고서·도면까지 낼 수 있습니다.</div>`;
    const bars = X.list.map(x => ({ name: x.T.name, pts: [] }));
    h += `<div class="grid2" style="margin-top:12px">${chartBars(X.list.map(x => x.T.model || x.T.name.replace(/\s*\(추정\)/, '')), X.list.map(x => x.A.net), '순발전량 P50', 'MWh/년', (i, v) => `${X.list[i].T.name}: ${fi(v)} MWh/년`)}${chartBars(X.list.map(x => x.T.model || x.T.name.replace(/\s*\(추정\)/, '')), X.list.map(x => 100 * x.R.wake), '후류 손실', '%', (i, v) => `${X.list[i].T.name}: ${f(v, 2)}%`)}</div>`;
  }
  return h + '</div>';
}
function chartCurve(T, rho, mode) {
  const F = frame(420, 230, { l: 46, r: 10, t: 10, b: 30 });
  const vmax = Math.max(25, Math.ceil(T.curve[T.curve.length - 1][0] + 2));
  const xs = nice(0, vmax, 6), ys = nice(0, T.ratedKW * 1.05);
  xs.x = v => F.m.l + (v - xs.lo) / (xs.hi - xs.lo) * F.iw; ys.y = v => F.m.t + F.ih - v / ys.hi * F.ih;
  let s = axes(F, xs, ys, '풍속 (m/s)', '출력 (kW)', v => v, v => v >= 1000 ? (v / 1000) + 'k' : v);
  let d = ''; T.curve.forEach((c, i) => d += (i ? 'L' : 'M') + xs.x(c[0]).toFixed(1) + ',' + ys.y(c[1]).toFixed(1));
  s += `<path d="${d}" fill="none" stroke="#2a78d6" stroke-width="2"/>`;
  T.curve.forEach(c => s += `<circle cx="${xs.x(c[0])}" cy="${ys.y(c[1])}" r="6" fill="transparent" data-tip="${c[0]} m/s: ${f(c[1], 1)} kW · Ct ${f(c[2], 3)}"/>`);
  let lg = `<span><i style="background:#2a78d6"></i>기준 (${f(T.rhoRef || 1.225, 3)} kg/m³)</span>`;
  if (rho && mode !== 'none' && Math.abs(rho - (T.rhoRef || 1.225)) > 0.0005) {
    const Pf = W.powerFn(T, rho, mode); let d2 = ''; for (let v = 0; v <= vmax; v += 0.1) d2 += (d2 ? 'L' : 'M') + xs.x(v).toFixed(1) + ',' + ys.y(Pf(v)).toFixed(1);
    s += `<path d="${d2}" fill="none" stroke="#eb6834" stroke-width="1.5" stroke-dasharray="4 3"/>`; lg += `<span><i style="background:#eb6834"></i>지점 보정 (${f(rho, 3)} kg/m³)</span>`;
  }
  return `<div class="chart"><div class="ct">출력곡선</div><svg viewBox="0 0 ${F.w} ${F.h}">${s}</svg><div class="legend">${lg}</div></div>`;
}
// ===== 제조사 요청 항목 점검표 =====
// [키, 구분, 항목, 도구에서 쓰는 곳, 자동 판단(T) → true면 있음]
const TURB_REQ = [
  ['curve', '필수', '출력곡선 표 (0.5 m/s 간격, kW, 시동~정지 풍속)', '총발전량', T => !T.estimated && T.curve && T.curve.length >= 5 && !/TÜV|보고서|EYA|report/i.test(T.source || '')],
  ['ctype', '필수', '출력곡선 종류 (IEC 61400-12-1 실측 인증 / 보증 / 계산)', '불확도: 출력곡선 (계산 6.5% ↔ 실측 약 3%)', T => !!T.curveType && !T.curveTypeNote],
  ['rho', '필수', '출력곡선 기준 공기밀도, 공기밀도별 출력곡선 표 (1.15~1.27 kg/m³)', '공기밀도 보정', T => Number.isFinite(T.rhoRef) && !T.rhoRefNote],
  ['ct', '필수', '추력계수(Ct) 곡선 (출력곡선과 같은 풍속 간격)', '후류 계산', T => !T.estimated && T.curve && T.curve.some(c => Number.isFinite(c[2]) && c[2] > 0) && !/TÜV|보고서|EYA|report/i.test(T.source || '')],
  ['cond', '필수', '곡선 적용 조건 (기준 난류강도, 시어 범위, 경사 유입)', '불확도: 난류 조건', null],
  ['spec', '기본 사양', '정격출력, 로터 직경, 선택 가능한 허브높이', '터빈 사양', T => !T.estimated && T.ratedKW > 0 && T.rotor > 0 && T.hub > 0],
  ['ctrl', '기본 사양', '시동·정격·정지 풍속, 출력 제어 방식 (피치·가변속 등)', '출력곡선 확인, 밀도 보정 방법', T => !!T.regulation && T.curve && T.curve.length >= 5],
  ['avail', '손실', '보증 가용률 (운영 연차별, 해상 기준)', '손실: 터빈 가용률', null],
  ['hyst', '손실', '고풍속 운전 방식 (정지·재시동 풍속, 소프트 컷아웃 여부)', '손실: 고풍속 히스테리시스', null],
  ['degr', '손실', '성능 저하 예상치 또는 보증 조건 (블레이드 침식·오염)', '손실: 성능 저하', null],
  ['temp', '손실', '운전 온도 범위, 결빙 감지·대응 기능', '손실: 극한 기온·결빙', null],
  ['cons', '손실', '자체 소비 전력 (대기·운전 중)', '손실: 단지 자체 소비', null],
  ['load', '배치', '최소 터빈 간격, 방향별 운전 제한 (사이트 하중 검토)', '간격 기준, 손실: 방향별 운전 제한', null],
  ['fmt', '자료 형식', '엑셀·CSV 원본 (스캔 PDF 아님)', '표 붙여넣기', null]
];
function turbReqStatus(T) { const m = T.req || {}; return TURB_REQ.map(([k, g, item, use, auto]) => { const a = auto ? !!auto(T) : false; return { k, g, item, use, auto: a, manual: !!m[k], ok: a || !!m[k] }; }); }
function turbReqHtml(T) {
  const st = turbReqStatus(T), miss = st.filter(x => !x.ok).length;
  return `<div class="card"><h2>제조사 요청 항목 — ${esc(T.name)} <span class="sub">${miss ? `요청 필요 ${miss}개 / ${st.length}개` : '모두 받음'}</span></h2>
   <div class="hint" style="margin-bottom:6px">자동 판단: 도구에 들어온 자료로 확인한 항목(✓ 자동). 보고서에서 옮긴 곡선은 제작사 원본이 아니라 "요청 필요"로 둡니다. 받은 항목은 "받음"에 체크하세요.</div>
   <div class="tw"><table class="t"><tr><th>구분</th><th>항목</th><th>도구에서 쓰는 곳</th><th>상태</th><th>받음</th></tr>${st.map(x => `<tr><td>${x.g}</td><td class="txt">${esc(x.item)}</td><td class="txt">${esc(x.use)}</td><td>${x.auto ? '<span class="tag">✓ 자동</span>' : x.manual ? '<span class="tag">✓ 받음</span>' : '<span class="tag blank">요청 필요</span>'}</td><td><input type="checkbox" data-treq="${x.k}" ${x.manual ? 'checked' : ''} ${x.auto ? 'disabled' : ''}></td></tr>`).join('')}</table></div>
   <div class="row" style="margin-top:6px"><button class="btn sm pri" data-act="treqdl" ${miss ? '' : 'disabled'}>요청 목록 내려받기 (${miss}개)</button><button class="btn sm" data-act="treqcopy" ${miss ? '' : 'disabled'}>요청 목록 복사</button></div></div>`;
}
function turbReqText(T) {
  const miss = turbReqStatus(T).filter(x => !x.ok);
  return [`[${T.name}] 발전량 평가용 자료 요청`, `프로젝트: ${P.name || ''}`, `작성일: ${reportCfg().date}`, '',
    '아래 자료를 엑셀 또는 CSV 원본으로 보내 주시기 바랍니다.', '',
    ...miss.map((x, i) => `${i + 1}. [${x.g}] ${x.item}\n   - 용도: ${x.use}`), '',
    '※ 출력곡선은 곡선 종류(실측 인증·보증·계산)와 기준 공기밀도, 적용 조건(난류강도·시어)을 함께 명시해 주시기 바랍니다.'].join('\n');
}

function viewTurbine(S) {
  ensureTurbines();
  const T0 = P.turbines.find(t => t.id === ui.turbSel) || P.turbines[0]; ui.turbSel = T0.id;
  let h = `<div class="card"><h2>터빈 목록 <span class="sub">출력곡선은 PDF에서 읽거나 붙여 넣습니다</span></h2>
   <div class="dslist" style="margin-top:0">${P.turbines.map(t => { const ci = W.curveInfo(t.curve); return `<div class="ds ${t.id === T0.id ? 'on' : ''}" data-act="tsel" data-id="${t.id}">${P.turbines.length > 1 ? `<span class="x" data-act="tdel" data-id="${t.id}" title="삭제">×</span>` : ''}<div class="t"><span class="tag ts">터빈</span><span>${esc(t.name)}</span></div><div class="m">${f(t.ratedKW / 1000, 1)} MW · 로터 ${f(t.rotor, 0)} m · 허브 ${f(t.hub, 1)} m · ${ci.cutIn}/${ci.ratedV}/${ci.cutOut} m/s</div></div>`; }).join('')}</div>
   <div class="row" style="margin-top:10px"><button class="btn sm" data-act="tpdf">PDF에서 출력곡선 가져오기</button><button class="btn sm" data-act="tnew">새 터빈 (표 붙여넣기)</button><button class="btn sm" data-act="tdup">선택한 터빈 복제</button><select class="sm" id="tpreset" style="margin-left:6px"><option value="">기본 제공 터빈 추가…</option>${W.TURB_PRESETS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><input type="file" id="turbPdf" accept=".pdf" multiple hidden></div>
   <div class="row" style="margin-top:6px"><button class="btn sm" data-act="tfImp">터빈 파일 가져오기 (.json)</button><button class="btn sm" data-act="tfExp">선택한 터빈 내보내기</button><button class="btn sm" data-act="tfExpAll">터빈 목록 전체 내보내기</button><input type="file" id="turbJson" accept=".json,application/json" multiple hidden>
   <span class="hint" style="margin-left:6px">해상풍력발전기 기초 설계도구와 같은 터빈 파일(gbs-tool-turbine) — 한 파일에 기초용 제원·하중표와 발전량용 출력곡선·Ct가 같이 들어갑니다.</span></div></div>`;
  // 편집
  const ci = W.curveInfo(T0.curve);
  if (T0.estimated) h += `<div class="warnbox"><div><b>추정 곡선입니다.</b> 공개 사양(정격출력·로터 직경·시동·정지 풍속)으로 만든 곡선이라 실제와 다를 수 있습니다. 검토·비교용으로만 쓰고, 보고서에는 제조사 출력곡선·Ct 곡선을 받아 바꿔 넣어 주세요. 출처: ${esc(T0.source)}</div></div>`;
  const tf = (k, l, w, n) => `<div class="fld"><label>${l}</label><input ${n ? 'class="n"' : ''} data-turb="${k}" value="${esc(T0[k] ?? '')}" style="width:${w}"></div>`;
  h += `<div class="card"><h2>${esc(T0.name)} <span class="sub">${esc(T0.source || '')}</span></h2><div class="row">
   ${tf('name', '이름', '230px')}${tf('maker', '제작사', '110px')}${tf('ratedKW', '정격출력 (kW)', '90px', 1)}${tf('rotor', '로터 직경 (m)', '80px', 1)}${tf('hub', '기본 허브높이 (m)', '80px', 1)}
   <div class="fld"><label>출력곡선 기준 공기밀도 (kg/m³)</label><input class="n" data-turb="rhoRef" value="${T0.rhoRef ?? 1.225}">${T0.rhoRefNote ? `<span class="srcl" title="${esc(T0.rhoRefNote)}">${esc(T0.rhoRefNote)}</span>` : ''}</div>
   <div class="fld"><label>출력곡선 종류</label><select data-turb="curveType"><option value="" ${!T0.curveType ? 'selected' : ''}>모름</option><option value="measured" ${T0.curveType === 'measured' ? 'selected' : ''}>실측 인증 곡선</option><option value="warranted" ${T0.curveType === 'warranted' ? 'selected' : ''}>보증 곡선</option><option value="calc" ${T0.curveType === 'calc' ? 'selected' : ''}>계산 곡선</option></select>${T0.curveTypeNote ? `<span class="srcl" title="${esc(T0.curveTypeNote)}">${esc(T0.curveTypeNote)}</span>` : ''}</div>
   <div class="fld"><label>출력 제어</label><select data-turb="regulation"><option value="pitch" ${T0.regulation !== 'stall' ? 'selected' : ''}>피치 제어</option><option value="stall" ${T0.regulation === 'stall' ? 'selected' : ''}>실속 제어</option></select></div></div>
   <div class="kv" style="margin-top:8px"><span>시동 / 정격 / 정지 풍속</span><span>${ci.cutIn} / ${ci.ratedV} / ${ci.cutOut} m/s (출력곡선에서 읽음)</span><span>로터 면적</span><span>${fi(Math.PI * (T0.rotor || 0) ** 2 / 4)} m² · 비출력 ${f(T0.ratedKW * 1000 / (Math.PI * (T0.rotor || 1) ** 2 / 4), 0)} W/m²</span></div>
   <div class="grid2" style="margin-top:10px"><div><div class="tw" style="max-height:420px"><table class="t"><tr><th>풍속 m/s</th><th>출력 kW</th><th>추력계수 Ct</th><th></th></tr>
   ${T0.curve.map((c, i) => `<tr><td><input data-cv="${i}" data-k="0" value="${c[0]}"></td><td><input data-cv="${i}" data-k="1" value="${c[1]}" style="width:80px"></td><td><input data-cv="${i}" data-k="2" value="${Number.isFinite(c[2]) ? c[2] : ''}"></td><td><span class="btn ghost sm" data-act="cvdel" data-i="${i}">×</span></td></tr>`).join('')}</table></div>
   <div class="row" style="margin-top:6px"><button class="btn sm" data-act="cvadd">줄 추가</button><button class="btn sm" data-act="cvpaste">표 붙여넣기</button></div>
   <div class="hint" style="margin-top:6px">표 사이는 직선 보간, 첫 풍속 미만과 마지막 풍속 초과는 출력 0(정지)으로 계산합니다.</div></div>
   <div>${chartCurve(T0)}${chartLines(T0.curve.map(c => c[0]), [{ name: 'Ct', y: T0.curve.map(c => c[2]), c: '#0d366b' }], '추력계수 (후류 계산용)', '풍속 (m/s)', 'Ct', { d: 3, zero: 1 })}</div></div></div>`;
  // 지점 적용
  h += viewTurbSite(S);
  h += turbCompareHtml(S);
  h += turbReqHtml(T0);
  // 전 지점 요약
  h += `<div class="card"><h2>지점별 터빈 1기 총발전량 <span class="sub">손실·후류 빼기 전</span></h2><div class="tw"><table class="t"><tr><th>지점</th><th>대표 풍황</th><th>터빈</th><th>허브 (해발 m)</th><th>허브 평균풍속</th><th>공기밀도</th><th>총발전량 MWh/년</th><th>이용률 %</th><th>전부하시간 h</th></tr>
   ${P.sites.map(s2 => { const c = turbCalc(s2); if (!c) return `<tr><td class="txt">${esc(siteName(s2))}</td><td class="txt" colspan="8"><span class="tag blank">대표 풍황 없음</span></td></tr>`; return `<tr class="click ${s2.id === S.id ? 'sel' : ''}" data-act="site" data-id="${s2.id}"><td class="txt">${esc(siteName(s2))}</td><td class="txt">${f(s2.design.z, 1)} m · ${esc(s2.design.sectorMode || (s2.design.sectors ? '방향별' : '방향 없음'))}</td><td class="txt">${esc(c.T.name)}</td><td>${f(c.t.hub, 1)}</td><td>${f(c.meanV, 2)}</td><td>${f(c.rho, 3)}</td><td>${fi(c.r.mwh)}</td><td>${f(100 * c.cf, 1)}</td><td>${fi(c.flh)}</td></tr>`; }).join('')}</table></div></div>`;
  return h;
}
function viewTurbSite(S) {
  const d = S.design;
  if (!d) return `<div class="card"><h2>${esc(siteName(S))} — 터빈 적용</h2><div class="warnbox"><div>이 지점은 대표 풍황이 지정되지 않았습니다. 1단계 풍황자료 탭에서 먼저 지정해 주세요.</div></div><button class="btn sm" data-act="tab" data-v="wind">풍황자료 탭으로</button></div>`;
  const c = turbCalc(S), t = c.t, T = c.T;
  let h = `<div class="card design"><h2>${esc(siteName(S))} — 터빈 1기 총발전량 <span class="sub">대표 풍황: ${esc(d.src)}</span></h2><div class="row">
   <div class="fld"><label>터빈</label><select data-ts="tid">${P.turbines.map(x => `<option value="${x.id}" ${x.id === t.tid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
   <div class="fld"><label>허브높이 (해발 m)</label><input class="n" data-ts="hub" value="${t.hub}"></div>
   <div class="fld"><label>시어 지수 α</label><input class="n" data-ts="alpha" value="${Number.isFinite(t.alpha) ? t.alpha : ''}" placeholder="${f(c.al.a, 4)}"><span class="srcl" title="${esc(c.al.src)}">${esc(c.al.src)}</span></div>
   <div class="fld"><label>공기밀도</label><select data-ts="rhoMode"><option value="auto" ${t.rhoMode === 'auto' ? 'selected' : ''}>자동 (보고서 장기값 → 관측소 평년값 → 측정값)</option><option value="design" ${t.rhoMode === 'design' ? 'selected' : ''}>대표 풍황 값 (허브높이 보정)</option><option value="station" ${t.rhoMode === 'station' ? 'selected' : ''} ${c.rhoInfo.st ? '' : 'disabled'}>기상청 관측소 평년값</option><option value="manual" ${t.rhoMode === 'manual' ? 'selected' : ''}>직접 입력</option></select><span class="srcl" title="${esc(c.rhoInfo.src)}">${f(c.rho, 3)} · ${esc(c.rhoInfo.src)}</span></div>
   ${t.rhoMode === 'manual' ? `<div class="fld"><label>공기밀도 (kg/m³)</label><input class="n" data-ts="rho" value="${Number.isFinite(t.rho) ? t.rho : ''}"></div>` : ''}
   <div class="fld"><label>밀도 보정 방법</label><select data-ts="dens"><option value="iec" ${t.dens === 'iec' ? 'selected' : ''}>IEC 61400-12-1 풍속 보정 (피치)</option><option value="power" ${t.dens === 'power' ? 'selected' : ''}>출력 비례 보정 (실속)</option><option value="none" ${t.dens === 'none' ? 'selected' : ''}>보정 안 함</option></select></div>
   <div class="fld"><label>풍속 분포</label><select data-ts="dist"><option value="weibull" ${t.dist !== 'hist' ? 'selected' : ''}>Weibull</option><option value="hist" ${t.dist === 'hist' ? 'selected' : ''} ${d.hist ? '' : 'disabled'}>실측 분포${d.hist ? '' : ' (시계열 대표 풍황만)'}</option></select></div>
   <div class="fld"><label>연간 시간</label><select data-ts="hours"><option ${t.hours === 8760 ? 'selected' : ''}>8760</option><option ${t.hours === 8766 ? 'selected' : ''}>8766</option></select></div></div>`;
  h += rhoCompareHtml(S, c);
  if (Math.abs(c.s - 1) > 1e-6) h += `<div class="info">대표 풍황 높이 ${f(d.z, 1)} m → 허브 ${f(t.hub, 1)} m: 풍속 × ${f(c.s, 4)} (α ${f(c.al.a, 4)})${c.al.assumed ? ' — <b>α가 가정값</b>이니 시어 자료로 확인해 주세요' : ''}</div>`;
  if (d.sectorMode === '전체 Weibull 공통') h += `<div class="info">이 지점은 방향별 k·A가 없어 전체 Weibull을 모든 방향에 썼습니다. 1기 총발전량은 방향과 관계없어 영향이 없고, 3단계 후류 계산에서만 영향이 있습니다.</div>`;
  if (!d.sectors) h += `<div class="info">대표 풍황에 방향 분포가 없어 전체 Weibull 하나로 계산했습니다.</div>`;
  h += `<div class="big" style="margin-top:10px"><div><b>${f(c.meanV, 2)}</b><span>허브 평균풍속 m/s</span></div><div><b>${fi(c.r.mwh)}</b><span>총발전량 MWh/년</span></div><div><b>${f(100 * c.cf, 1)}</b><span>이용률 %</span></div><div><b>${fi(c.flh)}</b><span>전부하시간 h</span></div><div><b>${f(c.rho, 3)}</b><span>공기밀도 kg/m³</span></div></div>
   <div class="hint">${c.useHist ? '총발전량은 출력곡선 × 실측 풍속 분포(방향별, 0.5 m/s 구간)로 계산한 값입니다' : '총발전량은 출력곡선 × Weibull 분포로 계산한 값입니다'}(후류·가용률·전기 손실 빼기 전).${c.useHist ? '' : ' 실측 풍속 분포가 Weibull과 다르면 차이가 생깁니다 (Weibull 방식이 실측 분포보다 몇 % 낮게 나올 수 있습니다). 시계열로 대표 풍황을 정했다면 "실측 분포"를 고를 수 있습니다.'}</div>`;
  const bins = c.r.bins.slice(0, Math.max(26, Math.ceil(T.curve[T.curve.length - 1][0]) + 2));
  h += `<div class="grid2" style="margin-top:12px">${chartBars(bins.map((_, i) => `${i}`), bins, '풍속 구간별 발전량', '발전량 (MWh/년)', (i, v) => `${i}–${i + 1} m/s: ${fi(v)} MWh/년 (${f(100 * v / c.r.mwh, 1)}%)`)}${chartCurve(T, c.rho, t.dens)}</div>`;
  if (c.sectors.length > 1) {
    h += `<h4>방향별</h4><div class="tw"><table class="t"><tr><th>방향 °</th><th>빈도 %</th><th>허브 평균풍속</th><th>k</th><th>A (허브)</th><th>발전량 MWh/년</th><th>발전량 비율 %</th></tr>
    ${c.r.sectors.map((x, i) => `<tr><td>${x.dir}</td><td>${f(x.freq, 2)}</td><td>${f(x.meanV, 2)}</td><td>${f(c.sectors[i].k, 3)}</td><td>${f(c.sectors[i].A * c.s, 3)}</td><td>${fi(x.freq / 100 * x.mwh)}</td><td>${f(100 * x.freq / 100 * x.mwh / c.r.mwh, 1)}</td></tr>`).join('')}
    <tr class="sum"><td>전체</td><td>100.00</td><td>${f(c.meanV, 2)}</td><td></td><td></td><td>${fi(c.r.mwh)}</td><td>100.0</td></tr></table></div>`;
  }
  return h + `</div>`;
}
async function importTurbinePdf(files) {
  let added = 0, same = 0; const msgs = [];
  for (const file of files) {
    try {
      const pages = await pdfPages(await file.arrayBuffer());
      const pcs = W.findPowerCurves(pages), sp = W.findTurbineSpec(pages);
      if (!pcs.length) { msgs.push(`${file.name}: 출력곡선 표를 찾지 못했습니다.`); continue; }
      for (const pc of pcs) { if (addTurbine(pc, sp, file.name)) added++; else same++; }
    } catch (e) { msgs.push(`${file.name}: ${e.message}`); }
  }
  render(); save();
  toast([added ? `터빈 ${added}개를 추가했습니다.` : '', same ? `같은 출력곡선 ${same}개는 이미 있어 건너뛰었습니다.` : '', ...msgs].filter(Boolean).join(' / '), 6000);
}
function addTurbine(pc, sp, file) {
  ensureTurbines();
  const key = JSON.stringify(pc.curve.map(c => [c[0], c[1]]));
  const ex = P.turbines.find(t => JSON.stringify(t.curve.map(c => [c[0], c[1]])) === key);
  if (ex) { ui.turbSel = ex.id; return false; }
  const ci = W.curveInfo(pc.curve);
  const T = { id: uid(), name: pc.name || [sp.maker, sp.model].filter(Boolean).join(' ') || `터빈 ${P.turbines.length + 1}`, maker: sp.maker || '', model: sp.model || '', ratedKW: sp.ratedKW || ci.rated, rotor: sp.rotor || NaN, hub: sp.hub || NaN, rhoRef: 1.225, rhoRefNote: '자료에 기준 공기밀도 표기 없음 — 1.225(표준)로 가정', regulation: sp.regulation || 'pitch', source: `${SRCNAME(file)} ${pc.page}쪽`, curve: pc.curve };
  P.turbines.push(T); ui.turbSel = T.id; return true;
}
function curvePasteDialog(T) {
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box"><h3>출력곡선 붙여넣기 — ${esc(T.name)}</h3><div class="hint">엑셀이나 PDF에서 복사해 붙여 넣으세요. 한 줄에 한 풍속: <b>풍속 · 출력(kW) · Ct</b>. 출력이 MW 단위면 아래에서 고르세요. 기존 표를 바꿉니다.</div>
   <textarea class="paste" id="cvTxt" placeholder="3\t197.7\t0.75&#10;4\t632.5\t0.75"></textarea>
   <div class="row" style="margin:8px 0">출력 단위 <select id="cvUnit"><option value="1">kW</option><option value="1000">MW</option></select></div>
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">넣기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => {
    const x = e.target.dataset.x; if (!x) return;
    if (x === 'ok') { const u = +$('#cvUnit').value; const rows = $('#cvTxt').value.split(/\r?\n/).map(l => l.trim().split(/[\t;]|\s+/).map(W.num)).filter(r => r.length >= 2 && Number.isFinite(r[0]) && Number.isFinite(r[1])); if (rows.length) { T.curve = rows.map(r => [r[0], r[1] * u, Number.isFinite(r[2]) ? r[2] : NaN]).sort((a, b) => a[0] - b[0]); if (!(T.ratedKW > 0)) T.ratedKW = W.curveInfo(T.curve).rated; toast(`${rows.length}줄을 넣었습니다.`); } }
    box.remove(); render(); save();
  });
}

/* ================= 4단계: 배치·후류 ================= */
const WAKE_MODELS = { lin: { name: 'Jensen 선형 합산 (WindPRO Park2 방식)', k: 0.05 }, rss: { name: 'Jensen 제곱합 (일반 Park 모델)', k: 0.04 }, turbopark: { name: 'TurbOPark (해상 대형 단지)', k: 0.04 }, gauss: { name: '가우스 (Bastankhah·Porté-Agel)', k: 0.04 } };
const LOSS_TEMPLATE = [
  ['가용률', [['turbAvail', '터빈 가용률', /turbine availability/i], ['bop', 'BOP(주변설비) 가용률', /balance of plant/i], ['grid', '계통 가용률', /grid availability/i]]],
  ['전기', [['elec', '전기 손실', /^electrical loss/i], ['cons', '단지 자체 소비', /farm consumption|own consumption/i]]],
  ['터빈 성능', [['hyst', '고풍속 히스테리시스', /hysteresis/i], ['pc', '출력곡선', /^power curve/i], ['flow', '기류(경사·난류 등)', /^wind flow/i]]],
  ['환경', [['degr', '성능 저하 (결빙 제외)', /(degr|drgad).*without icing|blade degradation/i], ['ice', '결빙', /(degr|drgad).*icing|^icing/i], ['temp', '극한 기온', /extreme temp/i], ['access', '현장 접근성', /site access/i]]],
  ['운전 제한', [['gridlim', '계통 용량 제한', /grid size|grid curtail|performance limit/i]]],
  ['출력 제한', [['noise', '소음', /^noise/i], ['shadow', '그림자', /shadow/i], ['bats', '박쥐', /^bats?/i], ['birds', '조류', /^birds?/i], ['sector', '방향별 운전 제한', /sector management/i], ['other', '기타', /^other/i]]],
  ['블로키지', [['block', '단지 블로키지 (전방 감속)', /blockage/i]]]
];
// ===== 손실 조건 (비어 있으면 조건 범위 중간값). 범위는 해상풍력 일반값을 평가 보고서 사례에 맞춘 임시 기준, 화면에서 수정 =====
const LOSS_COND_DEFAULT = {
  turbAvail: { type: 'sel', opts: [['off', '해상 (정비선 운영, 운영기간 평균)', 2.5, 3.5], ['land', '육상', 1.5, 2.5]] },
  bop: { type: 'sel', opts: [['off', '해상 (해저케이블·해상변전소)', 0.3, 0.7], ['land', '육상', 0.1, 0.3]] },
  grid: { type: 'sel', opts: [['stable', '계통 안정 (한전 154 kV 이상)', 0, 0], ['weak', '계통 고장 잦음', 0.3, 1.0]] },
  elec: { type: 'sel', opts: [['off', '해상 (내부망 + 해저 송전)', 2.5, 3.5], ['land', '육상', 1.5, 2.5]] },
  cons: { type: 'sel', opts: [['incl', '전기 손실에 포함', 0, 0], ['sep', '따로 계산', 0.1, 0.3]] },
  hyst: { type: 'num', unit: 'm/s', bins: [['허브 평균풍속 6.5 m/s 미만', -1e9, 6.5, 0.1, 0.5], ['6.5~8.5 m/s', 6.5, 8.5, 0.5, 1.5], ['8.5 m/s 이상', 8.5, 1e9, 1.5, 2.5]] },
  pc: { type: 'sel', opts: [['std', '일반 (보증·계산 곡선 성능 부족분)', 0, 1.0], ['meas', '현장 실측 검증 곡선', 0, 0.3]] },
  flow: { type: 'sel', opts: [['off', '해상 (경사 유입 없음)', 0, 0], ['simple', '완만한 육상', 0, 0.5], ['complex', '복잡 지형 (경사·난류)', 0.5, 2.0]] },
  degr: { type: 'sel', opts: [['std', '일반 (블레이드 오염·침식)', 0, 1.0], ['harsh', '침식 심함 (강우·염분 많음)', 1.0, 2.0]] },
  ice: { type: 'sel', opts: [['none', '결빙 거의 없음 (남부 해안)', 0, 0], ['some', '가끔 결빙', 0.3, 1.0], ['cold', '한랭 지역', 1.0, 3.0]] },
  temp: { type: 'sel', opts: [['none', '운전 온도 범위 안', 0, 0], ['ext', '극한 기온 잦음', 0.2, 1.0]] },
  access: { type: 'sel', opts: [['off', '해상 (파고 때문에 정비 지연)', 4.0, 6.0], ['land', '육상 (접근 쉬움)', 0, 0]] },
  gridlim: { type: 'sel', opts: [['none', '계통 용량 충분', 0, 0], ['lim', '계통 용량 제한 있음', 0.5, 2.0]] },
  noise: { type: 'sel', opts: [['none', '주거지 멂 (해상)', 0, 0], ['near', '주거지 가까움', 0.5, 2.0]] },
  shadow: { type: 'sel', opts: [['none', '주거지 멂 (해상)', 0, 0], ['near', '주거지 가까움', 0.1, 0.5]] },
  bats: { type: 'sel', opts: [['none', '운전 제한 조건 없음', 0, 0], ['cond', '협의 조건 있음', 0.2, 1.0]] },
  birds: { type: 'sel', opts: [['none', '운전 제한 조건 없음', 0, 0], ['cond', '협의 조건 있음', 0.2, 1.0]] },
  sector: { type: 'sel', opts: [['none', '제작사 하중 검토 결과 없음 (0 가정)', 0, 0], ['some', '방향별 운전 제한 있음', 0.5, 2.0]] },
  other: { type: 'sel', opts: [['none', '출력제어 없음', 0, 0], ['curt', '한전 출력제어 예상', 1.0, 3.0]] },
  block: { type: 'sel', opts: [['off', '반영 안 함', 0, 0], ['small', '소규모 단지 (20기 미만)', 0.3, 1.0], ['mid', '중규모 단지 (20~60기)', 1.0, 2.0], ['large', '대규모 단지 (60기 이상)', 2.0, 3.0]] }
};
const lossCondCfg = () => { if (!P.lossCond) P.lossCond = {}; for (const k in LOSS_COND_DEFAULT) if (!P.lossCond[k]) P.lossCond[k] = JSON.parse(JSON.stringify(LOSS_COND_DEFAULT[k])); return P.lossCond; };
function farmKind(F) { const lt = ltInfo(F); const S = P.sites.find(s => s.id === F.siteId) || {}; if (lt.offshore || lt.coastal) return { off: true, src: '보고서: 해상·해안' }; if (+S.elev > 60) return { off: false, src: `측정기 표고 ${S.elev} m — 육상` }; return { off: true, src: '해상으로 가정' }; }
function lossAuto(key, F, R) {
  const k = farmKind(F), o = k.off ? 'off' : 'land';
  switch (key) {
    case 'turbAvail': case 'bop': case 'elec': case 'access': return { opt: o, src: k.src };
    case 'flow': return { opt: k.off ? 'off' : 'simple', src: k.src };
    case 'noise': case 'shadow': return { opt: k.off ? 'none' : 'near', src: k.src };
    case 'hyst': return R && R.c ? { x: R.c.meanV, src: `허브 평균풍속 ${f(R.c.meanV, 2)} m/s` } : null;
    case 'pc': return { opt: 'std', src: '기본값' };
    case 'block': { const n = F.rows.length; const rec = n < 20 ? '소규모' : n <= 60 ? '중규모' : '대규모'; return { opt: 'off', src: `기본값 — ${n}기 단지는 '${rec}' 반영 권장` }; }
    case 'sector': return { opt: 'none', src: R && R.spacing ? `최소 간격 ${f(Math.min(...R.spacing), 1)}D — 제작사 검토 확인 필요` : '기본값' };
  }
  const c = lossCondCfg()[key]; return { opt: c.opts[0][0], src: '기본값' };
}
function lossResolve(key, F, R) {
  const c = lossCondCfg()[key]; if (!c) return null; const a = lossAuto(key, F, R) || {}; const sel = (F.lossSel || {})[key];
  if (c.type === 'num') {
    const i = sel != null && sel !== 'auto' ? +sel : (Number.isFinite(a.x) ? c.bins.findIndex(b => a.x >= b[1] && a.x < b[2]) : 1);
    const b = c.bins[i < 0 ? 1 : i];
    return { label: b[0], lo: b[3], hi: b[4], mid: (b[3] + b[4]) / 2, src: sel != null && sel !== 'auto' ? '직접 선택' : (a.src || '기본값'), choices: c.bins.map(x => x[0]), choiceKeys: c.bins.map((x, j) => String(j)), choice: sel != null ? String(sel) : 'auto', autoTxt: `자동: ${b[0]} (${a.src || '기본값'})` };
  }
  const key2 = sel != null && sel !== 'auto' ? sel : a.opt; const op = c.opts.find(x => x[0] === key2) || c.opts[0]; const ao = c.opts.find(x => x[0] === a.opt) || c.opts[0];
  return { label: op[1], lo: op[2], hi: op[3], mid: (op[2] + op[3]) / 2, src: sel != null && sel !== 'auto' ? '직접 선택' : (a.src || '기본값'), choices: c.opts.map(x => x[1]), choiceKeys: c.opts.map(x => x[0]), choice: sel != null ? sel : 'auto', autoTxt: `자동: ${ao[1]} (${a.src || '기본값'})` };
}
// 행: [기호, 이름, 보고서 항목 찾기(정규식, 기호 있는 행은 묶음끼리만), TR6 범위 [최소, 최대]]
const UNC_FRAMES = {
  tr6: { name: 'FGW TR6 방식', note: '독일 FGW 기술지침 TR6 구성. TÜV SÜD 등 독일 기관이 주로 사용. 묶음마다 최소·최대 범위를 둠(범위는 평가 보고서 사례 기준).', rows: [
    ['A', '풍황 측정 자료', /meteorolog|umet/i], ['A.1', '측정', /evaluations? with wind measurement/i, [1.6, 13.4]], ['', '센서 교정', /calibration/i], ['', '측정높이와 허브높이 차이', /measurement height|hub height/i], ['', '측정 기간', /duration/i], ['', '센서 설치', /attachment|mounting/i], ['', '센서 종류', /sensor type/i],
    ['A.2', '장기 보정', /lt evaluation|long[- ]?term evaluation/i, [2.0, 8.0]], ['', '장기 자료 평가', /evaluation of lt|evaluation of long/i], ['', '장기 참조 자료 월수', /monthly/i], ['', '단기-장기 회귀', /regression/i], ['', '장기 자료 사용 연수', /number of years/i],
    ['B', '바람장 모델', /wind field|umod/i, [5.8, 14.0]], ['', 'RIX(지형 복잡도)', /rix/i], ['', '주풍향 풍상·풍하 위치', /windward|leeward/i], ['', '좌표 정확도', /coordinate/i], ['', '주변 토지이용', /land use/i],
    ['C', '단지 효율 모델', /park efficiency, ufar|ufar|modell?ing of park/i, [0.0, 5.4]], ['', '단지 효율', /^park efficiency$/i], ['', '단지 배치', /park configuration/i],
    ['D', '터빈 기술자료', /technical data|uwea/i, [2.2, 9.8]], ['', '출력곡선', /performance curve|power curve/i], ['', '난류 조건', /turbulence/i],
    ['E', '손실', /losses|uloss/i]] },
  iec: { name: 'IEC 61400-15 방식', note: 'IEC 61400-15 작업반의 손실·불확도 분류. 측정 → 장기 → 수평·수직 외삽 → 단지 성능 순서로 나눔. 기관 간 비교용 공통 분류. 다른 틀의 보고서 값은 뜻이 같은 항목만 옮김.', rows: [
    ['A', '측정', /evaluations? with wind measurement/i], ['', '풍속 측정'], ['', '풍향 측정'], ['', '기타 대기 변수(기온·기압 등)'], ['', '자료 품질·기록'],
    ['B', '과거 풍황 (장기 보정)', /lt evaluation|long[- ]?term evaluation/i], ['', '장기 기간 길이', /number of years/i], ['', '참조 자료 일관성', /evaluation of lt|evaluation of long/i], ['', '장기 보정 방법', /regression/i], ['', '측정 기간 대표성', /monthly/i],
    ['C', '미래 풍황 변동'], ['', '연간 변동'], ['', '기후 변화'],
    ['D', '수직 외삽 (허브높이)'], ['', '모델 입력', /measurement height|hub height/i], ['', '모델 적용 범위(외삽 거리)'], ['', '모델 적합성'],
    ['E', '수평 외삽 (바람장)', /wind field|umod/i], ['', '모델 입력'], ['', '모델 적용 범위(측정기-터빈 거리)'], ['', '모델 적합성'],
    ['F', '단지 성능'], ['', '후류(단지 내부)', /^park efficiency$/i], ['', '후류(주변 단지·장래)'], ['', '터빈 성능(출력곡선)', /performance curve|power curve/i], ['', '전기 손실'], ['', '가용률'], ['', '환경 손실'], ['', '출력 제한']] },
  measnet: { name: 'MEASNET 방식', note: 'MEASNET "현장 풍황 평가" 지침의 풍황 쪽 구성에 단지 항목을 더함. 측정 장비·장착 쪽이 자세함. 다른 틀의 보고서 값은 뜻이 같은 항목만 옮김.', rows: [
    ['A', '풍속 측정'], ['', '장비 교정', /calibration/i], ['', '장비 특성(종류·분류)', /sensor type/i], ['', '장착·설치 영향', /attachment|mounting/i], ['', '자료 취득·처리'],
    ['B', '장기 보정'], ['', '상관 관계(회귀)', /regression/i], ['', '참조 자료 장기 일관성', /evaluation of lt|evaluation of long/i], ['', '측정 기간', /duration of (the )?measurement/i], ['', '장기 기간 대표성', /number of years/i],
    ['C', '수직 외삽'], ['', '시어 모델', /measurement height|hub height/i],
    ['D', '공간 외삽 (바람장)', /wind field|umod/i], ['', '유동 모델'], ['', '측정기-터빈 거리·지형'],
    ['E', '출력곡선'], ['', '출력곡선 종류(계산·실측)', /performance curve|power curve/i], ['', '공기밀도·난류 영향', /turbulence/i],
    ['G', '단지 효율·손실'], ['', '후류 모델', /^park efficiency$/i], ['', '기타 손실', /losses|uloss/i]] }
};
const UNC_TEMPLATE = UNC_FRAMES.tr6.rows;
// 틀 행 만들기 + 원본(보고서 항목)에서 뜻이 같은 값 옮기기
function frameRows(k, srcRows, srcName) {
  const fr = (UNC_FRAMES[k] || UNC_FRAMES.tr6).rows; const used = new Set();
  return fr.map(([code, label, re, range]) => {
    const r = { code, label, value: NaN, range: range || null, src: '' };
    if (re && srcRows) {
      // 묶음은 원본의 묶음(기호 있는 행)에서, 항목은 기호 없는 행에서 찾음. 단, IEC·MEASNET에서 묶음 정규식이 원본 묶음과 다르면 원본 묶음 값을 묶음 입력값으로만 씀
      const i = srcRows.findIndex((x, j) => !used.has(j) && Number.isFinite(x.value) && re.test(x.label) && (!!x.code === !!code || (code && !x.code)));
      if (i >= 0) { used.add(i); r.value = srcRows[i].value; r.src = `${srcRows[i].code ? srcRows[i].code + ' ' : ''}"${srcRows[i].label.replace(/\s*\(min.*\)$/i, '')}"${srcName ? ' · ' + srcName : ''}`; }
    }
    return r;
  });
}
const farmSel = () => (P.farms || []).find(f => f.id === ui.farmSel) || (P.farms || [])[0] || null;
function newFarm(name, rows, extra) {
  const F = { id: uid(), name: name || `단지 ${(P.farms || []).length + 1}`, siteId: P.active, crs: 'utm', zone: 52, rows: rows || [], wake: { model: 'lin', k: WAKE_MODELS.lin.k, ti: 0.06 }, ext: [], spRule: { main: 7, cross: 4, dir: 'auto' }, speed: 'uniform', losses: {}, lossSrc: {}, unc: frameRows('tr6'), uncFrame: 'tr6', uncSrc: '', rep: null, source: '', ...(extra || {}) };
  if (!P.farms) P.farms = []; P.farms.push(F); ui.farmSel = F.id; return F;
}
// 보고서 손실·불확도 → 단지 기본값
function applyReportPct(F, pct, file) {
  if (!pct) return;
  const used = new Set();
  for (const [, items] of LOSS_TEMPLATE) for (const [key, , re] of items) {
    const hit = pct.losses.find((x, i) => !used.has(i) && re.test(x.label) && !/^(loss|uncertainty|net energy)/i.test(x.cat));
    if (hit) { used.add(pct.losses.indexOf(hit)); F.losses[key] = hit.value; F.lossSrc[key] = `${SRCNAME(file)} "${hit.label}"`; }
  }
  const firstCode = pct.unc.findIndex(u => u.code);
  const rows = pct.unc.slice(Math.max(0, firstCode)).filter(u => u.code !== 'F' && !/combined/i.test(u.label));
  if (rows.length) { F.unc = rows.map(u => { const m = u.label.match(/min\s*=\s*([\d.]+)\s*%?\s*,\s*max\s*=\s*([\d.]+)/i); return { code: u.code, label: u.label, value: u.value, range: m ? [+m[1], +m[2]] : null }; }); F.uncReport = F.unc.map(u => ({ ...u })); F.uncFrame = 'report'; F.uncSrc = SRCNAME(file); }
  const y = pct.yields, w = pct.losses.find(x => /^wake loss/i.test(x.label)), tl = pct.losses.find(x => /^total loss/i.test(x.label)), uc = pct.unc.find(u => u.code === 'F' || /combined/i.test(u.label));
  F.rep = { file: SRCNAME(file), gross: y['Total farm yield'], p50: y['Total farm yield, P-50'], p75: y['Total farm yield, P-75'], p90: y['Total farm yield, P-90'], wake: w ? w.value : NaN, total: tl ? tl.value : NaN, uc: uc ? uc.value : NaN };
}
function attachWtg(F, wtg) {
  if (!wtg || !wtg.length) return 0; let n = 0;
  for (const r of F.rows) { const h = wtg.find(x => W.normName(x.name) === W.normName(r.name)); if (h) { r.vRep = h.v; r.repGross = h.gross; r.repNet = h.net; r.repEff = h.eff; n++; } }
  if (n) F.speed = 'report'; return n;
}
function siteNearUtm(rows, zone) {
  if (!rows.length) return null; const cx = rows.reduce((a, r) => a + r.x, 0) / rows.length, cy = rows.reduce((a, r) => a + r.y, 0) / rows.length;
  const ll = W.utmToLatLon(cx, cy, zone || 52, true); const { site: ns, dist } = nearestSite(ll); return ns && dist < 50000 ? ns : null;
}
// PDF 1~2쪽에서 사업 이름 찾기: 항목 번호 붙은 줄·문서 항목 제목은 빼고, "Project·단지·해상풍력" 등이 있는 줄 우선, 없으면 파일 이름
function pdfTitle(pages, file) {
  const lines = [...(pages[0] || []), ...(pages[1] || [])].map(l => l.text.replace(/\s*\|\s*/g, ' ').trim()).filter(t => t.length > 4 && t.length < 90);
  const bad = t => /^\(?\d+[.)]\s|^[가-하][.)]\s|^제\s*\d+\s*[장절]|배치도|설비구성도|설비\s*위치|목\s*차|contents|table of|report no|page \d|^date|^revision|^client|^contractor|^\d{4}[-.]/i.test(t);
  const good = lines.filter(t => !bad(t) && /project|wind\s*farm|offshore|단지|해상풍력|풍력발전|발전소/i.test(t));
  const any = lines.filter(t => !bad(t) && /[A-Za-z가-힣]{3}/.test(t));
  const pick = (good[0] || '').replace(/[:：]\s*$/, '').replace(/\s*-\s*(energy yield assessment|발전량 평가).*$/i, '');
  if (pick) return pick;
  const fn = SRCNAME(file).replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  return bad(fn) || !/[A-Za-z가-힣]{3}/.test(fn) ? '' : fn.replace(/^[\d\-.\s]+/, '');
}
async function handleLayoutFiles(fileList) {
  let files; try { files = await expandFiles(fileList); } catch (e) { toast('파일을 열지 못했습니다: ' + e.message); return; }
  const found = [], msgs = [];
  for (const F of files) {
    try {
      if (/\.pdf$/i.test(F.name)) {
        const pages = await pdfPages(F.buf); const lay = W.findLayouts(pages);
        const text = pages.flat().map(l => l.text).join('\n'); const zm = text.match(/zone[:\s]*(\d{1,2})/i);
        const locs = W.findLocations(pages, F.name); let mSite = null;
        if (locs.length === 1) { const { site: ns, dist } = nearestSite(locs[0]); if (ns && dist <= TOL()) mSite = ns; }
        const title = pdfTitle(pages, F.name);
        const ex = { file: F.name, wtg: W.findWtgResults(pages), pct: W.findPctTables(pages), meas: W.findMeasPeriod(pages), lt: W.findLtInfo(pages), zone: zm ? +zm[1] : 52, mSite, mLabel: locs.length === 1 ? locs[0].label : '', title };
        const pcs = W.findPowerCurves(pages); if (pcs.length) { const sp = W.findTurbineSpec(pages); pcs.forEach(pc => addTurbine(pc, sp, F.name)); }
        if (!lay.length) msgs.push(`${F.name}: 터빈 좌표 표를 찾지 못했습니다.`);
        lay.forEach(l => found.push({ ...l, ...ex, kind: 'pdf' }));
      } else if (/\.dxf$/i.test(F.name)) {
        const ents = W.parseDxf(decodeText(F.buf)); const texts = ents.filter(e => e.type === 'TEXT' || e.type === 'MTEXT');
        ents.filter(e => e.type === 'POLY').forEach((e, i) => found.push({ kind: 'dxf', poly: true, file: F.name, rows: e.pts.map((q, j) => ({ name: `P${j + 1}`, x: q[0], y: q[1] })), caption: `폴리선 · 레이어 ${e.layer || '0'} · ${e.pts.length}점${e.closed ? '' : ' (열린 선)'}`, layer: e.layer, page: '' }));
        const groups = new Map(); ents.filter(e => e.type !== 'TEXT' && e.type !== 'MTEXT' && e.type !== 'POLY').forEach(e => { const k = `${e.type}|${e.layer}|${e.block}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
        if (!groups.size) msgs.push(`${F.name}: 점·블록·원 개체가 없습니다.`);
        for (const [k, es] of groups) {
          const [type, layer, block] = k.split('|');
          const rows = es.map((e, i) => { let best = null, bd = 400; for (const t of texts) { const d = Math.hypot(t.x - e.x, t.y - e.y); if (d < bd) { bd = d; best = t; } } return { name: best ? best.text.replace(/\\P|\{|\}/g, '').trim() : `T${String(i + 1).padStart(2, '0')}`, x: e.x, y: e.y }; });
          found.push({ kind: 'dxf', file: F.name, rows, caption: `${type}${block ? ' 블록 ' + block : ''} · 레이어 ${layer || '0'}`, page: '' });
        }
      } else if (/\.(csv|txt|tsv)$/i.test(F.name)) {
        const rows = parseLayoutText(decodeText(F.buf)); if (rows.length) found.push({ kind: 'txt', file: F.name, rows, caption: '좌표 목록', page: '' }); else msgs.push(`${F.name}: 이름·X·Y 열을 찾지 못했습니다.`);
      } else msgs.push(`${F.name}: 지원하지 않는 형식입니다.`);
    } catch (e) { console.error(e); msgs.push(`${F.name}: ${e.message}`); }
  }
  if (found.length) pickLayouts(found); else if (msgs.length) toast(msgs.join(' / '), 6000);
}
function parseLayoutText(txt) {
  return txt.split(/\r?\n/).map(l => l.trim().split(/[\t,;]|\s{2,}|\s(?=-?\d)/).map(x => x.trim()).filter(Boolean)).filter(c => c.length >= 3 && Number.isFinite(W.num(c[c.length - 2])) && Number.isFinite(W.num(c[c.length - 1])) || c.length >= 3 && Number.isFinite(W.num(c[1])) && Number.isFinite(W.num(c[2])))
    .map((c, i) => { const xi = Number.isFinite(W.num(c[1])) && Number.isFinite(W.num(c[2])) ? 1 : c.length - 2; return { name: Number.isFinite(W.num(c[0])) && xi === 1 ? `T${String(i + 1).padStart(2, '0')}` : c[0], x: W.num(c[xi]), y: W.num(c[xi + 1]), vRep: Number.isFinite(W.num(c[xi + 2])) && W.num(c[xi + 2]) < 20 ? W.num(c[xi + 2]) : undefined }; });
}
function pickLayouts(found) {
  const isBound = g => g.rows.length >= 3 && (g.poly ? /bound|경계|구역|area|site|부지|허가/i.test(g.layer || '') : /vertic|vertex|boundar|경계|꼭짓점|구역|site area/i.test(g.caption || ''));
  const isExcl = g => g.poly && /excl|제외|항로|케이블|cable|군|military|어업|보호|금지/i.test(g.layer || '');
  const isWtg = g => !g.poly && g.rows.length >= 3 && g.rows.filter(r => /\d/.test(r.name)).length >= g.rows.length * 0.8 && !/reference|vertic|vertex|boundar|lidar|node/i.test(g.caption);
  const hasV = g => g.rows.filter(r => r.v > 0).length >= 2;
  const zones = P.zones || [], farms = P.farms || [];
  const cen = rows => [rows.reduce((a, r) => a + r.x, 0) / rows.length, rows.reduce((a, r) => a + r.y, 0) / rows.length];
  // 구역 기본 대상: 경계 안에 들어오거나 10 km 안의 기존 구역, 없으면 새 구역
  const bestZ = g => { const c = cen(g.rows); let best = 'new', bd = 10000; zones.forEach(z => z.bounds.forEach(b => { const d = W.inPoly(c[0], c[1], b.pts) ? 0 : W.distToEdge(c[0], c[1], b.pts); if (d < bd) { bd = d; best = z.id; } })); return best; };
  const defUse = g => isWtg(g) ? (ui.tab === 'zone' ? 'skip' : 'wtg') : isExcl(g) ? 'excl' : isBound(g) ? (hasV(g) && ui.tab !== 'zone' ? 'bound' : 'bound') : 'skip';
  const zOpts = def => `<option value="new" ${def === 'new' ? 'selected' : ''}>새 구역</option>${zones.map(z => `<option value="${z.id}" ${def === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}`;
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box" style="max-width:820px"><h3>찾은 좌표 ${found.length}묶음</h3><div class="hint" style="margin-bottom:8px">묶음마다 용도를 고르세요. 터빈 배치는 단지로, 사업 구역·제외 구역·풍속 기준점은 구역으로 들어갑니다. 재분석 격자점·측정기처럼 쓰지 않는 좌표는 "쓰지 않음"으로 두었습니다. 구역 꼭짓점 표에 풍속 열이 있으면 "구역 경계 + 풍속 기준점"을 고르세요.</div>
   ${found.map((g, i) => { const u = defUse(g); return `<div class="card" style="padding:9px 12px"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><select data-li="${i}" style="font-size:12px">${[['wtg', '터빈 배치 (새 단지)'], ['bound', '사업 구역 경계'], ['boundpts', '구역 경계 + 풍속 기준점'], ['pts', '풍속 기준점'], ['excl', '제외 구역'], ['ext', '주변 단지 (후류만)'], ['skip', '쓰지 않음']].filter(([k]) => (k !== 'boundpts' && k !== 'pts') || hasV(g)).map(([k, l]) => `<option value="${k}" ${(u === k || (u === 'bound' && k === 'boundpts' && hasV(g))) ? 'selected' : ''}>${l}</option>`).join('')}</select> ${esc(g.caption || '좌표 표')} <span class="hint">${esc(SRCNAME(g.file))}${g.page ? ' · ' + g.page + '쪽' : ''} · ${g.rows.length}개${hasV(g) ? ' · 풍속 열 있음' : ''}</span></label>
   <div class="row" style="margin-top:6px"><div class="fld"><label>이름${isWtg(g) && g.kind === 'pdf' && !g.title ? ' <span class="tag blank">사업 이름을 못 찾음 — 확인해 주세요</span>' : ''}</label><input data-ln="${i}" ${isWtg(g) && g.kind === 'pdf' && !g.title ? 'style="width:240px;border-color:#e0a030;background:#fff8e6"' : ''} value="${esc(isWtg(g) ? (g.kind === 'pdf' ? (g.title || `단지 ${(P.farms || []).length + 1}`).slice(0, 60) : SRCNAME(g.file).replace(/\.\w+$/, '')) : g.kind === 'pdf' ? (/\s[-–]\s*([^-–]{2,30})$/.test(g.caption || '') ? `${g.caption.match(/\s[-–]\s*([^-–]{2,30})$/)[1].trim()} 구역` : '구역 경계') : `${g.layer || '폴리선'}`)}" style="width:240px"></div>
   <div class="fld"><label>넣을 구역</label><select data-lz="${i}">${zOpts(bestZ(g))}</select></div><div class="fld"><label>주변 단지를 넣을 단지</label><select data-lf="${i}">${farms.map(F => `<option value="${F.id}" ${F.id === ui.farmSel ? 'selected' : ''}>${esc(F.name)}</option>`).join('')}</select></div>
   <div class="hint" style="align-self:center">${esc(g.rows.slice(0, 4).map(r => `${r.name} (${fi(r.x)}, ${fi(r.y)}${r.v ? ', ' + r.v + ' m/s' : ''})`).join(' · '))}${g.rows.length > 4 ? ' …' : ''}${g.wtg && g.wtg.length ? `<br>터빈별 결과 표 ${g.wtg.length}줄, 손실·불확도 표도 함께 가져옵니다.` : ''}${g.kind === 'pdf' && isWtg(g) ? `<br>지점: ${g.mSite ? `보고서 측정기 "${esc(g.mLabel)}" → <b>${esc(siteName(g.mSite))}</b>` : '보고서 측정기 좌표 없음 → 배치 중심에서 가장 가까운 지점'}` : ''}</div></div></div>`; }).join('')}
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">넣기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => {
    const x = e.target.dataset.x; if (!x) return;
    if (x === 'ok') {
      let n = 0, nz = 0; const made = [], newZ = {};
      const zoneFor = (i, name, g) => { const v = box.querySelector(`[data-lz="${i}"]`).value; if (v !== 'new') return zoneById(v); const c = cen(g.rows); const near = Object.values(newZ).find(z => z.bounds.concat(z.excl).some(b => W.inPoly(c[0], c[1], b.pts) || W.distToEdge(c[0], c[1], b.pts) < 10000) || (z.pts || []).some(q => Math.hypot(q.x - c[0], q.y - c[1]) < 10000)); if (near) return near; const z = newZone(name, { zone: g.zone || 52 }); newZ[z.id] = z; return z; };
      found.forEach((g, i) => {
        const use = box.querySelector(`[data-li="${i}"]`).value, name = box.querySelector(`[data-ln="${i}"]`).value, src = `${SRCNAME(g.file)}${g.page ? ' ' + g.page + '쪽' : ''} ${g.caption || ''}`.trim();
        if (use === 'skip') return;
        if (use === 'wtg') {
          const ns = g.kind === 'pdf' ? (g.mSite || siteNearUtm(g.rows, g.zone)) : null;
          const F = newFarm(name, g.rows.map(r => ({ name: r.name, x: r.x, y: r.y, vRep: r.vRep })), { source: src, zone: g.zone || 52, crs: g.kind === 'pdf' ? 'utm' : 'local', siteId: ns ? ns.id : P.active });
          if (g.kind === 'pdf') { attachWtg(F, g.wtg); applyReportPct(F, g.pct, g.file); if (g.meas) F.meas = { months: g.meas.months, from: g.meas.from, to: g.meas.to, src: `${SRCNAME(g.file)} "${g.meas.text}"` }; if (g.lt) { F.lt = g.lt; F.ltSrc = SRCNAME(g.file); } }
          if (g.kind === 'txt' && F.rows.some(r => r.vRep)) F.speed = 'report';
          made.push(F); n++; return;
        }
        if (use === 'ext') { const F = farms.find(q => q.id === box.querySelector(`[data-lf="${i}"]`).value) || made[0]; if (!F) return; if (!F.ext) F.ext = []; F.ext.push({ id: uid(), name, tid: F.tid || (P.sites.find(s => s.id === F.siteId) ? turbSet(P.sites.find(s => s.id === F.siteId)).tid : P.turbines[0].id), rows: g.rows.map(r => ({ name: r.name, x: r.x, y: r.y })) }); nz++; return; }
        const Z = zoneFor(i, name, g); if (!Z) return;
        if (use === 'bound' || use === 'boundpts') { addZoneItem(Z, 'bound', name, g.rows.map(r => [r.x, r.y]), src); nz++; }
        if (use === 'excl') { addZoneItem(Z, 'excl', name, g.rows.map(r => [r.x, r.y]), src, { shape: g.poly && /열린 선/.test(g.caption) ? 'line' : 'poly' }); nz++; }
        if (use === 'pts' || use === 'boundpts') { g.rows.filter(r => r.v > 0).forEach(r => Z.pts.push({ id: uid(), name: r.name, x: r.x, y: r.y, v: r.v, z: NaN, src })); nz++; }
      });
      // 새로 만든 단지가 새 구역 근처면 연결
      made.forEach(F => { if (F.zoneId) return; const c = cen(F.rows); const z = (P.zones || []).find(z2 => z2.bounds.some(b => W.inPoly(c[0], c[1], b.pts) || W.distToEdge(c[0], c[1], b.pts) < 5000)); if (z) F.zoneId = z.id; });
      if (n || nz) toast(`${n ? `단지 ${n}개를 만들었습니다. ` : ''}${nz ? `구역 항목 ${nz}개를 넣었습니다.` : ''}`);
    }
    box.remove(); render(); save();
  });
}
// ===== 구역 (사업 구역 경계 · 제외 구역 · 풍속 기준점) =====
const EXCL_KINDS = ['항로', '해저케이블', '군 작전구역', '어업 구역', '환경 보호구역', '기타'];
function selfCross(pts) { const n = pts.length, X = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; }; for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (X(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true; } return false; }
const zoneById = id => (P.zones || []).find(z => z.id === id) || null;
const zoneOf = F => F && zoneById(F.zoneId);
const zoneSel = () => (P.zones || []).find(z => z.id === ui.zoneSel) || (P.zones || [])[0] || null;
function newZone(name, extra) { if (!P.zones) P.zones = []; const Z = { id: uid(), name: name || `구역 ${P.zones.length + 1}`, zone: 52, note: '', bounds: [], excl: [], pts: [], ...(extra || {}) }; P.zones.push(Z); ui.zoneSel = Z.id; return Z; }
function addZoneItem(Z, type, name, pts, src, extra = {}) {
  let q = pts.map(p => [+p[0], +p[1]]);
  if (type === 'bound' || (type === 'excl' && extra.shape !== 'line')) { if (q.length < 3) return; if (selfCross(q)) { const cx = q.reduce((a, p) => a + p[0], 0) / q.length, cy = q.reduce((a, p) => a + p[1], 0) / q.length; q = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)); src += ' (꼭짓점 순서 정렬)'; } }
  if (type === 'bound') Z.bounds.push({ id: uid(), name: name || `사업 구역 ${Z.bounds.length + 1}`, pts: q, src: src || '' });
  else if (type === 'excl') Z.excl.push({ id: uid(), name: name || `제외 구역 ${Z.excl.length + 1}`, pts: q, src: src || '', kind: extra.kind || '기타', buffer: extra.buffer ?? 0, shape: extra.shape || (q.length >= 3 ? 'poly' : 'line') });
}
// 한국 TM 좌표(동부·중부·서부·동해원점) → UTM 자동 변환. UTM 북좌표(한국 3.6~4.3백만 m)와 TM 북좌표(1백만 m 미만)는 겹치지 않아 구별된다.
function tmPick(sample) {
  const masts = P.sites.map(siteCoord).filter(Boolean); let best = 'east', bd = Infinity;
  for (const k of Object.keys(W.TM_ORIGINS)) { const g = W.tmToLatLon(sample[0], sample[1], k); if (!(g.lat > 30 && g.lat < 40 && g.lon > 122 && g.lon < 134)) continue;
    const d = masts.length ? Math.min(...masts.map(m => Math.hypot(m.lat - g.lat, (m.lon - g.lon) * Math.cos(g.lat * Math.PI / 180)))) : Math.abs(g.lon - W.TM_ORIGINS[k].lon0);
    if (d < bd) { bd = d; best = k; } }
  return best;
}
const isTmPt = (x, y) => x > 0 && x < 400000 && y > 0 && y < 1000000;
function fixCRS(p) {
  if (!W.looksTm || !W.tmToLatLon) return 0;
  let n = 0; const one = (x, y, key, zone) => { const g = W.tmToLatLon(x, y, key), u = W.latLonToUtm(g.lat, g.lon, zone); return [u.E, u.N]; };
  const arr = (a, key, zone) => (a || []).map(q => isTmPt(q[0], q[1]) ? one(q[0], q[1], key, zone) : q);
  const rws = (a, key, zone) => (a || []).forEach(r => { if (isTmPt(r.x, r.y)) { const u = one(r.x, r.y, key, zone); r.x = u[0]; r.y = u[1]; } });
  (p.zones || []).forEach(Z => {
    const all = [...Z.bounds.flatMap(b => b.pts || []), ...Z.excl.flatMap(e => e.pts || []), ...(Z.pts || []).map(q => [q.x, q.y])];
    const tm = all.filter(q => isTmPt(q[0], q[1])); if (!tm.length) return;
    const key = Z.crsFrom || tmPick(tm[0]), zone = Z.zone || 52; Z.zone = zone; Z.crsFrom = key; n++;
    Z.bounds.forEach(b => b.pts = arr(b.pts, key, zone)); Z.excl.forEach(e => e.pts = arr(e.pts, key, zone)); rws(Z.pts, key, zone);
  });
  (p.farms || []).forEach(F => {
    const rows = [...(F.rows || []), ...(F.parked || []), ...(F.ext || []).flatMap(e => e.rows || [])]; const tm = rows.filter(r => isTmPt(r.x, r.y)); if (!tm.length) return;
    const Z = (p.zones || []).find(z => z.id === F.zoneId); if (F.crs !== 'utm' && !(Z && Z.crsFrom)) return;
    const key = (Z && Z.crsFrom) || F.crsFrom || tmPick([tm[0].x, tm[0].y]), zone = F.zone || (Z && Z.zone) || 52; F.crs = 'utm'; F.zone = zone; F.crsFrom = key; F._cache = null; n++;
    rws(F.rows, key, zone); rws(F.parked, key, zone); (F.ext || []).forEach(e => rws(e.rows, key, zone));
  });
  return n;
}
// 구역 이동 (이전 버전: 단지마다 경계)
function migrateZones(p) {
  if (!p.zones) p.zones = [];
  (p.farms || []).forEach(F => { if (F.bounds && F.bounds.length && !F.zoneId) { const Z = { id: uid(), name: F.bounds[0].name || `${F.name} 구역`, zone: F.zone || 52, note: '', bounds: F.bounds.map(b => ({ ...b })), excl: [], pts: [] }; p.zones.push(Z); F.zoneId = Z.id; } delete F.bounds; if (!F.ext) F.ext = []; if (!F.spRule) F.spRule = { main: 7, cross: 4, dir: 'auto' }; });
  return p;
}
// 제외 구역까지 거리(음수 = 안쪽), 이격 거리 뺀 값
function exclDist(x, y, e) { const d = e.shape === 'line' || e.pts.length < 3 ? W.distToLine(x, y, e.pts) : (W.inPoly(x, y, e.pts) ? -W.distToEdge(x, y, e.pts) : W.distToEdge(x, y, e.pts)); return d - (+e.buffer || 0); }
function boundCheck(F, R) {
  const Z = zoneOf(F); if (!Z) return null; const B = Z.bounds.filter(b => b.pts && b.pts.length >= 3), E = Z.excl.filter(e => e.pts && e.pts.length >= 2);
  if (!B.length && !E.length) return null;
  const radOf = i => { const T = R && R.Ti ? R.Ti[i] : (R && R.T); return T ? (T.rotor || 0) / 2 : 0; }; const rad = R && R.T ? (R.T.rotor || 0) / 2 : 0;
  const tur = F.rows.map((r, i) => { const inB = B.find(b => W.inPoly(r.x, r.y, b.pts)); const d = !B.length ? Infinity : inB ? W.distToEdge(r.x, r.y, inB.pts) : -Math.min(...B.map(b => W.distToEdge(r.x, r.y, b.pts))); let ed = Infinity, en = ''; E.forEach(e => { const v = exclDist(r.x, r.y, e); if (v < ed) { ed = v; en = e.name; } }); return { d, inB: !B.length || !!inB, ed, en, rad: radOf(i) }; });
  return { Z, B, E, rad, tur, out: F.rows.filter((r, i) => !tur[i].inB).map(r => r.name), tip: F.rows.filter((r, i) => tur[i].inB && tur[i].d < tur[i].rad).map(r => r.name),
    exIn: F.rows.filter((r, i) => tur[i].ed < 0).map((r, i2) => r.name), exTip: F.rows.filter((r, i) => tur[i].ed >= 0 && tur[i].ed < tur[i].rad).map(r => r.name), area: B.reduce((a, b) => a + W.polyArea(b.pts), 0) / 1e6 };
}
function parseBoundText(txt, zone) {
  const out = []; let ll = false;
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim(); if (!t) continue; let a = [];
    if (/[°˚]/.test(t)) a = [...t.matchAll(/(\d+(?:\.\d+)?)\s*[°˚]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|'')?)?\s*([NSEW북남동서])?/g)].map(m => { const v = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600; return /[SW남서]/.test(m[4] || '') ? -v : v; });
    else { const ns = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); if (ns.length >= 6 && ns.slice(-6).every(v => Math.abs(v) <= 180)) { const q = ns.slice(-6); a = [q[0] + q[1] / 60 + q[2] / 3600, q[3] + q[4] / 60 + q[5] / 3600]; } else a = ns.slice(-2); }
    if (a.length < 2) continue; let [u, v] = a.slice(-2);
    if (Math.abs(u) <= 180 && Math.abs(v) <= 180) { ll = true; const lat = Math.abs(u) < Math.abs(v) ? u : v, lon = lat === u ? v : u; const g = W.latLonToUtm(lat, lon, zone || 52); out.push([g.E, g.N]); }
    else { if (u >= 1000000 && v < 1000000) [u, v] = [v, u]; out.push([u, v]); }
  }
  return { pts: out, ll };
}
function zonePasteDialog(type) {
  const Z = zoneSel(); if (!Z) return;
  const box = document.createElement('div'); box.className = 'modal';
  const T = { bound: '사업 구역 경계', excl: '제외 구역', pts: '풍속 기준점' }[type];
  box.innerHTML = `<div class="box"><h3>${T} 붙여넣기 — ${esc(Z.name)}</h3><div class="hint">${type === 'pts' ? '한 줄에 한 점: <b>이름 · X(동) · Y(북) · 평균풍속(m/s)</b> 또는 <b>이름 · 위도 · 경도 · 평균풍속</b>. 높이는 아래 칸에 적습니다. 보고서의 구역 꼭짓점 장기 풍속(K2M Table 2-2 등)을 넣으면 터빈마다 풍속을 거리 비례로 나눠 줍니다.' : `한 줄에 꼭짓점 하나, 경계를 따라 순서대로. <b>X(동) Y(북)</b> m 좌표 또는 <b>위도 경도</b>(35.1701 129.2175 / 35°10'12.3" 129°13'03.0"). 위도·경도는 UTM ${Z.zone || 52}N으로 바꿉니다.`}</div>
   <textarea class="paste" id="zpTxt" placeholder="${type === 'pts' ? 'NW\t525164.3\t3904177.1\t7.85' : 'P1\t525164.3\t3904177.1'}"></textarea>
   <div class="row" style="margin:8px 0"><div class="fld"><label>이름</label><input id="zpName" value="${T} ${type === 'bound' ? Z.bounds.length + 1 : type === 'excl' ? Z.excl.length + 1 : ''}" style="width:200px"></div>
   ${type === 'excl' ? `<div class="fld"><label>종류</label><select id="zpKind">${EXCL_KINDS.map(k => `<option>${k}</option>`).join('')}</select></div><div class="fld"><label>모양</label><select id="zpShape"><option value="poly">면 (다각형)</option><option value="line">선 (케이블·항로 중심선)</option></select></div><div class="fld"><label>이격 거리 (m)</label><input id="zpBuf" class="n" value="0"></div>` : ''}
   ${type === 'pts' ? `<div class="fld"><label>풍속 높이 (해발 m)</label><input id="zpZ" class="n" value=""></div>` : ''}</div>
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">넣기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => {
    const x = e.target.dataset.x; if (!x) return;
    if (x === 'ok') {
      const txt = $('#zpTxt').value, name = $('#zpName').value;
      if (type === 'pts') {
        const z = W.num($('#zpZ').value); let n = 0;
        txt.split(/\r?\n/).forEach(line => { const c = line.trim().split(/[\t,;]|\s{2,}|\s(?=-?\d)/).map(s => s.trim()).filter(Boolean); if (c.length < 4) return; const nums = c.slice(1).map(W.num); if (nums.slice(0, 3).some(v => !Number.isFinite(v))) return; let [a, b, v] = nums; let X = a, Y = b; if (Math.abs(a) <= 180 && Math.abs(b) <= 180) { const lat = Math.min(a, b), lon = Math.max(a, b); const g = W.latLonToUtm(lat, lon, Z.zone || 52); X = g.E; Y = g.N; } Z.pts.push({ id: uid(), name: c[0], x: X, y: Y, v, z: Number.isFinite(z) ? z : NaN, src: '붙여넣기' }); n++; });
        if (!n) { toast('점을 읽지 못했습니다.'); return; } toast(`풍속 기준점 ${n}개를 넣었습니다.`);
      } else {
        const r = parseBoundText(txt, Z.zone); const shape = type === 'excl' ? $('#zpShape').value : 'poly';
        if (r.pts.length < (shape === 'line' ? 2 : 3)) { toast('꼭짓점을 충분히 읽지 못했습니다.'); return; }
        addZoneItem(Z, type, name, r.pts, r.ll ? '붙여넣기 (위도·경도 → UTM)' : '붙여넣기', type === 'excl' ? { kind: $('#zpKind').value, buffer: W.num($('#zpBuf').value) || 0, shape } : {});
        toast(`꼭짓점 ${r.pts.length}개로 ${T}을(를) 넣었습니다.`);
      }
    }
    box.remove(); render(); save();
  });
}
// 지도 공통 (배치도·구역도): 좌표 → 화면
function mapFrame(allx, ally, W0 = 640, H0 = 460, m = 30) {
  const x0 = Math.min(...allx), x1 = Math.max(...allx), y0 = Math.min(...ally), y1 = Math.max(...ally);
  const sc = Math.min((W0 - 2 * m) / Math.max(1, x1 - x0), (H0 - 2 * m) / Math.max(1, y1 - y0));
  const ox = m + ((W0 - 2 * m) - (x1 - x0) * sc) / 2, oy = H0 - m - ((H0 - 2 * m) - (y1 - y0) * sc) / 2;
  return { W0, H0, m, sc, x0, y0, X: x => ox + (x - x0) * sc, Y: y => oy - (y - y0) * sc, inv: (px, py) => [x0 + (px - ox) / sc, y0 + (oy - py) / sc] };
}
function mapDeco(M) { const len = [200, 500, 1000, 2000, 5000, 10000, 20000].find(l => l * M.sc > 60) || 20000; return `<g><line x1="${M.m}" x2="${M.m + len * M.sc}" y1="${M.H0 - 8}" y2="${M.H0 - 8}" stroke="#52514e" stroke-width="2"/><text x="${M.m + len * M.sc / 2}" y="${M.H0 - 12}" text-anchor="middle" class="lbl">${len >= 1000 ? len / 1000 + ' km' : len + ' m'}</text></g><g transform="translate(${M.W0 - 22},26)"><path d="M0,-14 L6,6 L0,2 L-6,6Z" fill="#52514e"/><text y="18" text-anchor="middle" class="lbl">N</text></g>`; }
function zoneSvg(Z, M) {
  let s = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#d64545" stroke-width="1.4"/></pattern></defs>`;
  if (!Z) return s;
  Z.bounds.forEach(b => { s += `<polygon points="${b.pts.map(p => `${M.X(p[0]).toFixed(1)},${M.Y(p[1]).toFixed(1)}`).join(' ')}" fill="rgba(42,120,214,0.05)" stroke="#2a78d6" stroke-width="1.5" stroke-dasharray="6 4" data-tip="${esc(b.name)} · ${f(W.polyArea(b.pts) / 1e6, 2)} km²"/>`; });
  Z.excl.forEach(e => {
    const pts = e.pts.map(p => `${M.X(p[0]).toFixed(1)},${M.Y(p[1]).toFixed(1)}`).join(' '); const bw = (+e.buffer || 0) * M.sc;
    const tip = `${esc(e.name)} (${esc(e.kind)})${e.buffer ? ` · 이격 ${e.buffer} m` : ''}`;
    if (e.shape === 'line' || e.pts.length < 3) { if (bw > 0) s += `<polyline points="${pts}" fill="none" stroke="rgba(214,69,69,0.15)" stroke-width="${2 * bw}" stroke-linejoin="round" stroke-linecap="round"/>`; s += `<polyline points="${pts}" fill="none" stroke="#d64545" stroke-width="2" data-tip="${tip}"/>`; }
    else { if (bw > 0) s += `<polygon points="${pts}" fill="none" stroke="rgba(214,69,69,0.15)" stroke-width="${2 * bw}" stroke-linejoin="round"/>`; s += `<polygon points="${pts}" fill="url(#hatch)" fill-opacity=".55" stroke="#d64545" stroke-width="1.4" data-tip="${tip}"/>`; }
  });
  (Z.pts || []).forEach(p => { s += `<rect x="${M.X(p.x) - 4}" y="${M.Y(p.y) - 4}" width="8" height="8" fill="#2f9e6e" stroke="#fff" data-tip="${esc(p.name)} · ${f(p.v, 2)} m/s${Number.isFinite(p.z) ? ` @ ${p.z} m` : ''}"/><text x="${M.X(p.x) + 7}" y="${M.Y(p.y) - 5}" style="font-size:9px;fill:#2f9e6e">${esc(p.name)} ${f(p.v, 2)}</text>`; });
  return s;
}
function zoneExtent(Z) { if (!Z) return [[], []]; const P2 = [...Z.bounds.flatMap(b => b.pts), ...Z.excl.flatMap(e => e.pts), ...(Z.pts || []).map(p => [p.x, p.y])]; return [P2.map(p => p[0]), P2.map(p => p[1])]; }
// 위치도 — 구역 지도는 구역만 확대하므로 좌표계가 틀려도 알아보기 어렵다. 한반도 해안선 위에 대략 위치를 찍어 확인한다.
const LOC_BOX = [123, 32, 132.5, 39.8];
function locCheck(Z) {
  const [zx, zy] = zoneExtent(Z); if (!zx.length) return null; const zone = Z.zone || 52;
  const cx = (Math.min(...zx) + Math.max(...zx)) / 2, cy = (Math.min(...zy) + Math.max(...zy)) / 2, c = W.utmToLatLon(cx, cy, zone, true);
  const inBox = c.lon > LOC_BOX[0] && c.lon < LOC_BOX[2] && c.lat > LOC_BOX[1] && c.lat < LOC_BOX[3];
  const onLand = inBox && COAST_KR.some(r => W.inPoly(c.lon, c.lat, r));
  const masts = P.sites.filter(s => siteCoord(s)).map(s => ({ n: siteName(s), lat: +s.lat, lon: +s.lon, d: W.haversine ? W.haversine(c.lat, c.lon, +s.lat, +s.lon) : 6371000 * Math.hypot((+s.lat - c.lat) * Math.PI / 180, (+s.lon - c.lon) * Math.PI / 180 * Math.cos(c.lat * Math.PI / 180)) })).sort((a, b) => a.d - b.d);
  const warn = []; if (!inBox) warn.push('구역이 한반도 주변 바다 밖에 있습니다. 좌표계(UTM 구역, TM 원점)가 맞는지 확인하세요.'); else if (onLand) warn.push('구역 중심이 육지에 있습니다. 좌표가 맞는지 확인하세요.');
  if (masts.length && masts[0].d > 60000) warn.push(`가장 가까운 측정기(${masts[0].n})까지 ${f(masts[0].d / 1000, 0)} km 떨어져 있습니다. 좌표나 측정기 위치를 확인하세요.`);
  return { lat: c.lat, lon: c.lon, inBox, onLand, masts, warn };
}
function chartLocator(Z) {
  const L = locCheck(Z); if (!L) return '';
  const panel = (lon0, lat0, lon1, lat1, Wd, Ht, title, fine) => {
    const k = Math.cos((lat0 + lat1) / 2 * Math.PI / 180), sc = Math.min(Wd / ((lon1 - lon0) * k), Ht / (lat1 - lat0));
    const X = lon => (lon - lon0) * k * sc, Y = lat => Ht - (lat - lat0) * sc; const w = (lon1 - lon0) * k * sc, h = (lat1 - lat0) * sc;
    const cid = 'lc' + Math.random().toString(36).slice(2, 8); let s = `<defs><clipPath id="${cid}"><rect width="${w.toFixed(0)}" height="${h.toFixed(0)}"/></clipPath></defs><rect width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#e8f1fa"/><g clip-path="url(#${cid})">`;
    COAST_KR.forEach(r => { if (r.every(p => p[0] < lon0 || p[0] > lon1) || r.every(p => p[1] < lat0 || p[1] > lat1)) return; s += `<polygon points="${r.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="#f1efe8" stroke="#a9a69c" stroke-width="0.6"/>`; });
    if (fine) { const zone = Z.zone || 52; Z.bounds.forEach(b => { s += `<polygon points="${b.pts.map(q => { const g = W.utmToLatLon(q[0], q[1], zone, true); return `${X(g.lon).toFixed(1)},${Y(g.lat).toFixed(1)}`; }).join(' ')}" fill="rgba(42,120,214,0.25)" stroke="#2a78d6" stroke-width="1.2"/>`; }); }
    s += '</g>';
    L.masts.forEach(m => { if (m.lon < lon0 || m.lon > lon1 || m.lat < lat0 || m.lat > lat1) return; s += `<path d="M${X(m.lon).toFixed(1)},${(Y(m.lat) - 7).toFixed(1)}l6,10h-12z" fill="#eb6834" stroke="#fff" stroke-width="1.2" data-tip="측정기: ${esc(m.n)}"/>`; });
    const zin = L.lon >= lon0 && L.lon <= lon1 && L.lat >= lat0 && L.lat <= lat1;
    if (zin) s += `<circle cx="${X(L.lon).toFixed(1)}" cy="${Y(L.lat).toFixed(1)}" r="${fine ? 14 : 6}" fill="none" stroke="#d64545" stroke-width="2" data-tip="${esc(Z.name)} ${f(L.lat, 4)}°N ${f(L.lon, 4)}°E"/>`;
    else s += `<text x="${(w / 2).toFixed(0)}" y="${(h / 2).toFixed(0)}" text-anchor="middle" style="font-size:12px;fill:#d64545;font-weight:700">구역이 이 지도 밖에 있습니다</text>`;
    if (fine) { const km = [5, 10, 20].find(v => v * 1000 / 111320 / Math.cos(L.lat * Math.PI / 180) * k * sc > 50) || 20; const px = km * 1000 / 111320 / Math.cos(L.lat * Math.PI / 180) * k * sc; s += `<line x1="8" x2="${(8 + px).toFixed(1)}" y1="${h - 8}" y2="${h - 8}" stroke="#52514e" stroke-width="2"/><text x="${(8 + px / 2).toFixed(1)}" y="${h - 12}" text-anchor="middle" class="lbl">${km} km</text>`; }
    return `<div style="flex:1;min-width:220px"><div class="hint" style="margin-bottom:3px">${title}</div><svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" style="width:100%;max-height:300px;border:1px solid #dcdad3;border-radius:6px;overflow:hidden">${s}</svg></div>`;
  };
  const d = 0.45, a = L.inBox ? panel(L.lon - d / Math.cos(L.lat * Math.PI / 180), L.lat - d * 0.75, L.lon + d / Math.cos(L.lat * Math.PI / 180), L.lat + d * 0.75, 360, 280, '주변 (약 80 km)', true) : '';
  const msg = L.warn.length ? `<div class="warn" style="margin-top:6px;padding:6px 8px;border-radius:6px;background:#fbe9e7;color:#a12d2d;font-size:12px">⚠ ${L.warn.join('<br>⚠ ')}</div>`
    : `<div class="hint" style="margin-top:6px;color:#2f7a4f">✓ 위치 확인: 구역 중심 ${f(L.lat, 4)}°N, ${f(L.lon, 4)}°E${L.masts.length ? ` · 측정기(${esc(L.masts[0].n)})까지 ${f(L.masts[0].d / 1000, 1)} km` : ''}</div>`;
  return `<div class="chart" style="margin-top:10px"><div class="ct">위치도 <span class="sub">빨간 원 = 구역, 주황 삼각형 = 측정기 · 해안선: Natural Earth</span></div><div class="row" style="gap:10px;align-items:flex-start;flex-wrap:wrap">${panel(LOC_BOX[0], LOC_BOX[1], LOC_BOX[2], LOC_BOX[3], 300, 280, '한반도 주변', false)}${a}</div>${msg}</div>`;
}
function chartZone(Z) {
  const [zx, zy] = zoneExtent(Z); const farms = (P.farms || []).filter(F => F.zoneId === Z.id); const fx = farms.flatMap(F => F.rows.map(r => r.x)), fy = farms.flatMap(F => F.rows.map(r => r.y));
  const S = P.sites.find(s => siteCoord(s)); let mast = null; if (S && zx.length) { const u = W.latLonToUtm(+S.lat, +S.lon, Z.zone || 52); if (Math.hypot(u.E - zx[0], u.N - zy[0]) < 60000) mast = { x: u.E, y: u.N, n: siteName(S) }; }
  const ax = [...zx, ...fx, ...(mast ? [mast.x] : [])], ay = [...zy, ...fy, ...(mast ? [mast.y] : [])]; if (!ax.length) return '<div class="hint">구역 경계나 제외 구역을 넣으면 지도가 그려집니다.</div>';
  const M = mapFrame(ax, ay); let s = mapDeco(M) + zoneSvg(Z, M);
  farms.forEach((F, k) => F.rows.forEach(r => { s += `<circle cx="${M.X(r.x)}" cy="${M.Y(r.y)}" r="4" fill="${['#2a78d6', '#7a4fd0', '#d08a1f'][k % 3]}" stroke="#fff" data-tip="${esc(F.name)} · ${esc(r.name)}"/>`; }));
  if (mast) s += `<path d="M${M.X(mast.x)},${M.Y(mast.y) - 8}l7,12h-14z" fill="#eb6834" stroke="#fcfcfb" stroke-width="1.5" data-tip="측정기: ${esc(mast.n)}"/>`;
  return `<div class="chart"><div class="ct">구역 지도</div><svg viewBox="0 0 ${M.W0} ${M.H0}" style="max-height:520px">${s}</svg><div class="legend"><span><i style="background:transparent;border:1.5px dashed #2a78d6"></i>사업 구역</span><span><i style="background:#f3c2c2;border:1px solid #d64545"></i>제외 구역 (연한 띠 = 이격 거리)</span><span><i style="background:#2f9e6e"></i>풍속 기준점</span>${farms.length ? `<span>● 배치: ${farms.map(F => esc(F.name)).join(', ')}</span>` : ''}${mast ? '<span><i style="background:#eb6834"></i>측정기</span>' : ''}</div></div>`;
}
function viewZone() {
  if (!P.zones) P.zones = [];
  const Z = zoneSel(); if (Z) ui.zoneSel = Z.id;
  let h = `<div class="card"><h2>구역 <span class="sub">사업 구역 경계, 들어가면 안 되는 곳(제외 구역), 풍속 기준점을 넣습니다. 4단계 배치에서 단지마다 구역을 고릅니다</span></h2>
   <div class="dslist" style="margin-top:0">${P.zones.map(z => `<div class="ds ${Z && z.id === Z.id ? 'on' : ''}" data-act="zsel" data-id="${z.id}"><span class="x" data-act="zdel" data-id="${z.id}" title="삭제">×</span><div class="t"><span class="tag ts">구역</span><span>${esc(z.name)}</span></div><div class="m">경계 ${z.bounds.length} · 제외 ${z.excl.length} · 기준점 ${(z.pts || []).length}</div></div>`).join('')}</div>
   <div class="drop" id="dropZone" style="margin-top:10px"><b>구역 파일을 끌어다 놓거나 눌러서 고르세요</b><br><span class="hint">AutoCAD DXF(폴리선), 보고서 PDF(구역 꼭짓점 표), CSV/TXT. 넣을 때 묶음마다 사업 구역 / 제외 구역 / 풍속 기준점을 고릅니다</span></div>
   <input type="file" id="zoneIn" multiple hidden accept=".pdf,.dxf,.csv,.txt,.tsv,.zip">
   <div class="row" style="margin-top:8px"><button class="btn sm" data-act="znew">새 구역</button></div></div>`;
  if (!Z) return h + `<div class="card empty">아직 구역이 없습니다. "새 구역"을 누르거나 파일을 넣어 주세요.</div>`;
  h += `<div class="card"><h2><label class="nameedit" title="눌러서 구역 이름 바꾸기"><input data-zone="name" value="${esc(Z.name)}"><span class="pen">✎ 이름 바꾸기</span></label></h2>
   <div class="row"><button class="btn sm" data-act="zdxf">구역도 DXF</button><button class="btn sm" data-act="zpdf">구역도 PDF</button></div>
   <div class="row"><div class="fld"><label>UTM 구역 (위도·경도 변환)</label><input class="n" data-zone="zone" value="${Z.zone || 52}" style="width:60px"></div><div class="fld" style="flex:1"><label>메모</label><input data-zone="note" value="${esc(Z.note || '')}" style="width:100%"></div></div>
   <div class="grid2" style="margin-top:10px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)"><div>${chartZone(Z)}${chartLocator(Z)}</div><div>
   <h3 style="font-size:13px;margin:0 0 6px">사업 구역 경계 <button class="btn sm" data-act="zpaste" data-v="bound">붙여넣기</button></h3>
   ${Z.bounds.length ? `<table class="t"><tr><th>이름</th><th>꼭짓점</th><th>면적 km²</th><th>출처</th><th></th></tr>${Z.bounds.map(b => `<tr><td class="txt"><input data-zb="${b.id}" data-k="name" value="${esc(b.name)}" style="width:150px;text-align:left"></td><td>${b.pts.length}</td><td>${f(W.polyArea(b.pts) / 1e6, 2)}</td><td class="txt"><span class="srcl" style="max-width:150px" title="${esc(b.src)}">${esc(b.src)}</span></td><td style="white-space:nowrap"><span class="btn sm" data-act="zcoord" data-t="bounds" data-id="${b.id}">좌표 보기</span> <span class="btn ghost sm" data-act="zidel" data-t="bounds" data-id="${b.id}">×</span></td></tr>`).join('')}</table>` : '<div class="hint">없음 — 해역이용 허가 구역 좌표 등을 넣어 주세요.</div>'}
   <h3 style="font-size:13px;margin:14px 0 6px">제외 구역 <button class="btn sm" data-act="zpaste" data-v="excl">붙여넣기</button></h3>
   ${Z.excl.length ? `<table class="t"><tr><th>이름</th><th>종류</th><th>모양</th><th>이격 m</th><th></th></tr>${Z.excl.map(e => `<tr><td class="txt"><input data-ze="${e.id}" data-k="name" value="${esc(e.name)}" style="width:120px;text-align:left"></td><td><select data-ze="${e.id}" data-k="kind">${EXCL_KINDS.map(k => `<option ${e.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td><td><select data-ze="${e.id}" data-k="shape"><option value="poly" ${e.shape !== 'line' ? 'selected' : ''}>면</option><option value="line" ${e.shape === 'line' ? 'selected' : ''}>선</option></select></td><td><input data-ze="${e.id}" data-k="buffer" value="${e.buffer || 0}"></td><td style="white-space:nowrap"><span class="btn sm" data-act="zcoord" data-t="excl" data-id="${e.id}">좌표 보기</span> <span class="btn ghost sm" data-act="zidel" data-t="excl" data-id="${e.id}">×</span></td></tr>`).join('')}</table>` : '<div class="hint">없음 — 항로, 해저케이블, 군 작전구역, 어업 구역 등을 넣어 주세요. 선(케이블 중심선)은 이격 거리로 폭을 줍니다.</div>'}
   <h3 style="font-size:13px;margin:14px 0 6px">풍속 기준점 <button class="btn sm" data-act="zpaste" data-v="pts">붙여넣기</button></h3>
   ${(Z.pts || []).length ? `<table class="t"><tr><th>이름</th><th>E</th><th>N</th><th>풍속 m/s</th><th>높이 m</th><th></th></tr>${Z.pts.map(p => `<tr><td class="txt">${esc(p.name)}</td><td>${fi(p.x)}</td><td>${fi(p.y)}</td><td><input data-zp="${p.id}" data-k="v" value="${p.v}"></td><td><input data-zp="${p.id}" data-k="z" value="${Number.isFinite(p.z) ? p.z : ''}" placeholder="비어 있음"></td><td><span class="btn ghost sm" data-act="zidel" data-t="pts" data-id="${p.id}">×</span></td></tr>`).join('')}</table><div class="hint">4단계 "터빈별 풍속 → 구역 풍속 기준점"을 고르면 터빈마다 거리 비례(역거리 제곱)로 풍속을 나눠 줍니다. 높이가 비어 있으면 허브높이 값으로 봅니다.</div>` : '<div class="hint">없음 — 구역 꼭짓점 장기 풍속(K2M 보고서 Table 2-2 등)이 있으면 넣어 주세요.</div>'}
   </div></div></div>`;
  return h;
}
// ===== 단지 계산 =====
// 구역 경계·제외 구역 꼭짓점 좌표 보기: UTM(E·N)과 위도·경도(십진·도분초), 복사(엑셀에 붙여넣기)·CSV 내려받기
const dmsTxt = (v, pos, neg) => { const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), sec = (mf - m) * 60; return `${d}° ${String(m).padStart(2, '0')}′ ${sec.toFixed(2).padStart(5, '0')}″ ${v >= 0 ? pos : neg}`; };
function zoneCoordDialog(Z, item) {
  const zone = Z.zone || 52, tk = Z.crsFrom || 'east', rows = item.pts.map((q, i) => { const ll = W.utmToLatLon(q[0], q[1], zone, true), t = W.latLonToTm(ll.lat, ll.lon, tk); return [i + 1, q[0], q[1], ll.lat, ll.lon, t.E, t.N]; });
  const tmNm = W.TM_ORIGINS[tk].name.replace(/ \(.*/, '');
  const head = ['번호', 'UTM E (m)', 'UTM N (m)', `${tmNm} X(E)`, `${tmNm} Y(N)`, '위도', '경도', '위도 (도분초)', '경도 (도분초)'];
  const line = r => [r[0], r[1].toFixed(2), r[2].toFixed(2), r[5].toFixed(2), r[6].toFixed(2), r[3].toFixed(7), r[4].toFixed(7), dmsTxt(r[3], 'N', 'S'), dmsTxt(r[4], 'E', 'W')];
  const tsv = [head, ...rows.map(line)].map(a => a.join('\t')).join('\r\n');
  const llTxt = rows.map(r => `${r[3].toFixed(6)}, ${r[4].toFixed(6)}`).join('\n');
  const kml = () => { const c = rows.map(r => `${r[4].toFixed(7)},${r[3].toFixed(7)},0`); if (item.shape !== 'line' && c.length) c.push(c[0]); const nm = esc(item.name || '구역');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(Z.name)}</name><Placemark><name>${nm}</name>${item.shape === 'line' ? `<LineString><coordinates>${c.join(' ')}</coordinates></LineString>` : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${c.join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`}</Placemark></Document></kml>`; };
  const box = document.createElement('div'); box.className = 'modal'; document.body.appendChild(box);
  box.innerHTML = `<div class="box" style="width:min(1000px,96vw)"><h3>${esc(item.name || '구역')} 꼭짓점 좌표 <span class="sub">${esc(Z.name)} · UTM ${zone}N (WGS84) · ${rows.length}점${item.shape === 'line' ? ' · 선' : ` · 면적 ${f(W.polyArea(item.pts) / 1e6, 3)} km²`}</span></h3>
   <div class="tw" style="max-height:60vh"><table class="t"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${line(r).map((v, k) => `<td${k >= 7 ? ' class="txt"' : ''}>${v}</td>`).join('')}</tr>`).join('')}</table></div>
   <div class="hint" style="margin-top:6px">${Z.crsFrom ? `처음 넣은 좌표는 ${esc(W.TM_ORIGINS[Z.crsFrom].name)}였고, 도구 안에서는 UTM ${zone}N으로 바꿔 씁니다. ` : ''}위도·경도는 WGS84입니다. 해양 대시보드에는 "위도, 경도 복사"를 눌러 붙여넣으세요. 구글 어스에서 보려면 KML을 내려받으세요.</div>
   <div class="row" style="justify-content:flex-end;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn" data-x="ll">위도, 경도 복사 (대시보드용)</button><button class="btn" data-x="copy">복사 (엑셀용)</button><button class="btn" data-x="csv">CSV 내려받기</button><button class="btn" data-x="kml">KML 내려받기</button><button class="btn pri" data-x="c">닫기</button></div></div>`;
  box.addEventListener('click', async e => {
    const x = e.target.dataset.x; if (!x) { if (e.target === box) box.remove(); return; }
    if (x === 'c') box.remove();
    const cp = async (t, m) => { try { await navigator.clipboard.writeText(t); toast(m); } catch (er) { toast('복사하지 못했습니다. CSV 내려받기를 쓰세요.'); } };
    if (x === 'll') cp(llTxt, '위도, 경도를 줄마다 복사했습니다.');
    if (x === 'copy') cp(tsv, '좌표를 복사했습니다. 엑셀에 붙여넣으세요.');
    if (x === 'csv') download(`${safeNm(Z.name)}_${safeNm(item.name || '구역')}_좌표.csv`, new Blob(['﻿' + tsv.replace(/\t/g, ',')], { type: 'text/csv' }));
    if (x === 'kml') download(`${safeNm(Z.name)}_${safeNm(item.name || '구역')}.kml`, new Blob([kml()], { type: 'application/vnd.google-earth.kml+xml' }));
  });
}
function idwSpeed(pts, x, y) { let a = 0, b = 0; for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < 1) return p.v; const w = 1 / (d * d); a += w * p.v; b += w; } return a / b; }
function spacingCheck(F, R) {
  const rule = F.spRule || { main: 7, cross: 4, dir: 'auto' }; const c = R.c;
  let dir = W.num(rule.dir); if (!Number.isFinite(dir)) { const s = c.r.sectors.slice().sort((a, b) => b.freq * b.mwh - a.freq * a.mwh)[0]; dir = s ? s.dir : 0; }
  const th = dir * Math.PI / 180, ux = Math.sin(th), uy = Math.cos(th); const bad = [];
  for (let i = 0; i < F.rows.length; i++) for (let j = i + 1; j < F.rows.length; j++) {
    const D = Math.max(R.Ti[i].rotor || 100, R.Ti[j].rotor || 100); const dx = F.rows[j].x - F.rows[i].x, dy = F.rows[j].y - F.rows[i].y, d = Math.hypot(dx, dy);
    const a = (dx * ux + dy * uy) / D, b = (-dx * uy + dy * ux) / D; const e = (a / rule.main) ** 2 + (b / rule.cross) ** 2;
    if (e < 1) bad.push([i, j, d / D]);
  }
  return { dir, bad, rule };
}
// 풍속 기준점의 측정기 위치 값(없으면 기준점 평균) — 터빈 풍속 = 대표 풍황 × (기준점 보간값 / 측정기 위치 보간값)
function zoneRefSpeed(F, Z) { const S = P.sites.find(s => s.id === F.siteId); if (S && siteCoord(S)) { const u = W.latLonToUtm(+S.lat, +S.lon, Z.zone || F.zone || 52); const pts = Z.pts; const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length; if (Math.hypot(u.E - cx, u.N - cy) < 40000) return idwSpeed(pts, u.E, u.N); } return Z.pts.reduce((a, p) => a + p.v, 0) / Z.pts.length; }
function farmScale(F, c, Z) {
  return F.rows.map(r => {
    if (F.speed === 'report' && r.vRep > 0) return r.vRep / c.meanV * c.s;
    if (F.speed === 'manual' && r.scale > 0) return r.scale * c.s;
    if (F.speed === 'field' && F.speedField && F.speedField.length) return idwSpeed(F.speedField, r.x, r.y) / c.meanV * c.s;
    if (F.speed === 'zone' && Z && Z.pts && Z.pts.length) { const ref = zoneRefSpeed(F, Z); return idwSpeed(Z.pts, r.x, r.y) / ref * c.s; }
    return c.s;
  });
}
function farmTurb(F, c, r) { return r && r.tid && P.turbines.find(t => t.id === r.tid) || c.T; }
const PERMIT_TOL_LO = 0.9, PERMIT_TOL_HI = 1.1; // 전기사업법 시행규칙: 허가 설비용량의 100분의 10 이하 변경은 변경허가 대상 아님
function farmCalc(F, opt = {}) {
  const S = P.sites.find(s => s.id === F.siteId); if (!S || !S.design || !F.rows.length) return null;
  const c = turbCalc(S, { tid: F.tid, hub: F.hub }); if (!c) return null;
  const Z = zoneOf(F); const scale = opt.scale || farmScale(F, c, Z);
  const Ti = F.rows.map(r => farmTurb(F, c, r)); const ext = (F.ext || []).flatMap(g => g.rows.map(r => ({ ...r, T: P.turbines.find(t => t.id === g.tid) || c.T })));
  const allT = [...Ti, ...ext.map(e => e.T)]; const pf = new Map(); const Pof = T => { if (!pf.has(T.id)) pf.set(T.id, W.powerFn(T, c.rho, c.t.dens)); return pf.get(T.id); };
  const rows = opt.rows || F.rows;
  // 허가 설비용량: 정격 합계가 허가의 ±10% 안이면 정격 그대로(변경허가 불필요 범위). +10%를 넘으면 허가량에 맞춰 모든 터빈 출력을 같은 비율로 제한
  const ratedKW = rows.reduce((a, q, i) => a + (opt.rows ? farmTurb(F, c, q) : Ti[i]).ratedKW, 0), permitKW = 1000 * (+F.permitMW || 0);
  // 방식: cap = 터빈 정격 그대로 + 단지 출력이 계통연계 용량을 넘는 순간만 잘림(기본) / tol = 정격 그대로(±10% 안) / derate = 모든 터빈 출력을 허가량에 맞춰 낮춤
  // 어느 방식이든 정격 합계가 허가 +10%를 넘으면 허가량에 맞춰 출력 제한(변경허가 필요 범위)
  const pMode = F.permitMode || 'cap', over = permitKW > 0 && ratedKW > PERMIT_TOL_HI * permitKW + 1e-6;
  const fac = permitKW > 0 && ratedKW > permitKW + 1e-6 && (pMode === 'derate' || over) ? permitKW / ratedKW : 1;
  const gridKW = permitKW > 0 && pMode === 'cap' && !over ? 1000 * (+F.gridMW > 0 ? +F.gridMW : permitKW / 1000) : 0;
  const permit = permitKW > 0 ? { mw: permitKW / 1000, ratio: ratedKW / permitKW, mode: pMode, gridMW: gridKW / 1000, st: over ? 'over' : ratedKW < PERMIT_TOL_LO * permitKW - 1e-6 ? 'under' : 'in' } : null;
  const Pin = T => { const b = Pof(T); if (fac >= 1) return b; const cap = T.ratedKW * fac; return v => Math.min(b(v), cap); };
  const key = JSON.stringify([rows.map(r => [r.x, r.y, r.tid]), scale, F.wake, c.t, c.T.id, allT.map(T => [T.id, T.rhoRef, T.curve.length]), S.design.at, c.useHist, ext.map(e => [e.x, e.y]), opt.dd, opt.dv, fac, gridKW]);
  if (!opt.rows && F._cache && F._cache.key === key) return F._cache;
  const r = W.wakeFarm({ xy: [...rows.map(q => [q.x, q.y]), ...ext.map(e => [e.x, e.y])], scale: [...scale, ...ext.map(() => c.s)], P: [...rows.map((q, i) => Pin(opt.rows ? farmTurb(F, c, q) : Ti[i])), ...ext.map(e => Pof(e.T))], Ct: allT.map(T => v => W.ctAt(T.curve, v)), R: allT.map(T => (T.rotor || 100) / 2), count: [...rows.map(() => true), ...ext.map(() => false)],
    sectors: c.sectors, hist: c.hist, model: F.wake.model, k: F.wake.k, ti: F.wake.ti || 0.06, hours: c.t.hours, dd: opt.dd, dv: opt.dv, capKW: gridKW > 0 && gridKW < ratedKW * fac ? gridKW : 0 });
  const n = rows.length; ['gross', 'net'].forEach(k => r[k] = r[k].slice(0, n));
  const G = r.gross.reduce((a, b) => a + b, 0), N = r.net.reduce((a, b) => a + b, 0), curt = r.curt || 0;
  const res = { key, S, c, T: c.T, Ti, ext, r, G, N, curt, curtPct: curt / (N + curt) * 100, wake: 1 - (N + curt) / G, eff: r.net.map((x, i) => x / r.gross[i]), capMW: ratedKW * fac / 1000, ratedMW: ratedKW / 1000, permit, derate: fac < 1 ? { fac, permitMW: permitKW / 1000, perMW: [...new Set(rows.map((q, i) => (opt.rows ? farmTurb(F, c, q) : Ti[i]).ratedKW * fac / 1000))] } : null, scale };
  if (opt.rows) return res;
  res.spacing = F.rows.map((a, i) => Math.min(...F.rows.map((b, j) => i === j ? Infinity : Math.hypot(a.x - b.x, a.y - b.y))) / (Ti[i].rotor || 100));
  res.mst = W.mstLength(F.rows.map(q => [q.x, q.y])); res.sp = spacingCheck(F, res);
  F._cache = res; return res;
}
function chartLayout(F, R, opts = {}) {
  const Z = zoneOf(F); const S = P.sites.find(s => s.id === F.siteId); let mast = null;
  const xs = F.rows.map(r => r.x), ys = F.rows.map(r => r.y);
  if (F.crs === 'utm' && S && siteCoord(S) && xs.length) { const u = W.latLonToUtm(+S.lat, +S.lon, F.zone || 52); if (Math.hypot(u.E - xs[0], u.N - ys[0]) < 60000) mast = { x: u.E, y: u.N }; }
  const [zx, zy] = zoneExtent(Z); const ex = (F.ext || []).flatMap(g => g.rows);
  const M = mapFrame([...xs, ...(mast ? [mast.x] : []), ...zx, ...ex.map(e => e.x)], [...ys, ...(mast ? [mast.y] : []), ...zy, ...ex.map(e => e.y)]);
  let s = mapDeco(M) + zoneSvg(Z, M);
  if (R && R.mst && (ui.layCable || opts.cable)) R.mst.edges.forEach(([a, b]) => { s += `<line x1="${M.X(xs[a])}" y1="${M.Y(ys[a])}" x2="${M.X(xs[b])}" y2="${M.Y(ys[b])}" stroke="#9a9993" stroke-width="1.2"/>`; });
  if (R && R.sp) R.sp.bad.forEach(([a, b, d]) => { s += `<line x1="${M.X(xs[a])}" y1="${M.Y(ys[a])}" x2="${M.X(xs[b])}" y2="${M.Y(ys[b])}" stroke="#d64545" stroke-width="2" data-tip="간격 기준 미달: ${esc(F.rows[a].name)}–${esc(F.rows[b].name)} ${f(d, 2)}D"/>`; });
  ex.forEach(e => { s += `<path d="M${M.X(e.x)},${M.Y(e.y) - 6}l5,9h-10z" fill="#8a8984" data-tip="주변 단지: ${esc(e.name || '')}"/>`; });
  const effs = R ? R.eff : null, emin = effs ? Math.min(...effs) : 0, emax = effs ? Math.max(...effs) : 1;
  F.rows.forEach((r, i) => {
    const e = effs ? effs[i] : null; const col = e == null ? '#2a78d6' : RAMP[Math.round((1 - (e - emin) / Math.max(1e-6, emax - emin)) * (RAMP.length - 1))];
    const tipTxt = `${esc(r.name)} · (${fi(r.x)}, ${fi(r.y)})${R ? ` · 총 ${fi(R.r.gross[i])} → ${fi(R.r.net[i])} MWh · 효율 ${f(100 * e, 1)}%${Number.isFinite(r.repEff) ? ` (보고서 ${f(r.repEff, 1)}%)` : ''} · 최근접 ${f(R.spacing[i], 1)}D` : ''}`;
    s += `<circle cx="${M.X(r.x)}" cy="${M.Y(r.y)}" r="7" fill="${col}" stroke="#fcfcfb" stroke-width="2" data-tip="${tipTxt}" ${opts.edit ? `data-ti="${i}" style="cursor:${ui.layEdit === 'del' ? 'not-allowed' : 'grab'}"` : ''}/><text x="${M.X(r.x) + 9}" y="${M.Y(r.y) + 3}" class="ax" style="font-size:9.5px;fill:#52514e;font-family:var(--mono);pointer-events:none">${esc(r.name)}</text>`;
  });
  if (mast) s += `<path d="M${M.X(mast.x)},${M.Y(mast.y) - 8}l7,12h-14z" fill="#eb6834" stroke="#fcfcfb" stroke-width="1.5" data-tip="측정기: ${esc(siteName(S))}"/>`;
  if (R) s += windSvg(R, M, F);
  if (opts.edit) ui.layM = M;
  const lg = `<div class="legend">${R ? `<span><i style="background:${RAMP[0]}"></i>효율 높음 ${f(100 * emax, 1)}%</span><span><i style="background:${RAMP[9]}"></i>효율 낮음 ${f(100 * emin, 1)}%</span>` : ''}${mast ? '<span><i style="background:#eb6834"></i>측정기</span>' : ''}${Z && Z.bounds.length ? '<span><i style="background:transparent;border:1.5px dashed #2a78d6"></i>사업 구역</span>' : ''}${Z && Z.excl.length ? '<span><i style="background:#f3c2c2;border:1px solid #d64545"></i>제외 구역</span>' : ''}${R && R.sp && R.sp.bad.length ? '<span><i style="background:#d64545"></i>간격 기준 미달</span>' : ''}${ex.length ? '<span><i style="background:#8a8984"></i>주변 단지</span>' : ''}${R && R.mst && (ui.layCable || opts.cable) ? '<span><i style="background:#9a9993"></i>최소 연결 케이블</span>' : ''}<span>좌표: ${F.crs === 'utm' ? `UTM ${F.zone}N (WGS84)` : '도면 좌표'}</span></div>`;
  return `<div class="chart"><div class="ct">배치도${opts.edit ? `<span class="seg">${[['', '보기'], ['move', '옮기기'], ['add', '추가'], ['del', '삭제']].map(([k, l]) => `<button data-act="layedit" data-v="${k}" class="${(ui.layEdit || '') === k ? 'on' : ''}">${l}</button>`).join('')}<button data-act="laycable" class="${ui.layCable ? 'on' : ''}">케이블</button><button data-act="drwdxf">도면 DXF</button><button data-act="drwpdf">도면 PDF</button></span>` : ''}</div><svg ${opts.edit ? 'id="laySvg"' : ''} viewBox="0 0 ${M.W0} ${M.H0}" style="max-height:520px;${opts.edit && ui.layEdit === 'add' ? 'cursor:crosshair' : ''}">${s}</svg>${lg}</div>`;
}
// ===== 배치도 바람 표시 (주풍향 화살표·작은 풍배도·간격 기준 축) =====
function windInfo(R) { if (!R || !R.c || !R.c.r) return null; const secs = R.c.r.sectors.map(x => ({ dir: x.dir, e: x.freq / 100 * x.mwh })); const tot = secs.reduce((a, x) => a + x.e, 0) || 1; secs.forEach(x => x.share = x.e / tot); const ord = secs.slice().sort((a, b) => b.share - a.share); return { secs, main: ord[0], second: ord[1] && ord[1].share > 0.6 * ord[0].share && Math.abs(((ord[1].dir - ord[0].dir + 540) % 360) - 180) > 45 ? ord[1] : null }; }
function windSvg(R, M, F) {
  const wi = windInfo(R); if (!wi) return ''; let s = '';
  // 간격 기준 축 (배치 중심을 지나는 점선)
  if (R.sp && F.rows.length) { const cx = F.rows.reduce((a, r) => a + r.x, 0) / F.rows.length, cy = F.rows.reduce((a, r) => a + r.y, 0) / F.rows.length; const L = Math.max(...F.rows.map(r => Math.hypot(r.x - cx, r.y - cy))) * 1.15 + 500; const th = R.sp.dir * Math.PI / 180, ux = Math.sin(th), uy = Math.cos(th); s += `<line x1="${M.X(cx - ux * L)}" y1="${M.Y(cy - uy * L)}" x2="${M.X(cx + ux * L)}" y2="${M.Y(cy + uy * L)}" stroke="#7a4fd0" stroke-width="1" stroke-dasharray="7 5" opacity=".7" data-tip="간격 기준 주풍향 축 ${f(R.sp.dir, 0)}° (이 방향 ${R.sp.rule.main}D, 직각 ${R.sp.rule.cross}D)"/>`; }
  // 작은 풍배도 (방향별 발전량 비율) + 주풍향 화살표
  const ox = M.W0 - 56, oy = M.H0 - 74, rr = 32, mx = Math.max(...wi.secs.map(x => x.share)); const n = wi.secs.length, sw = 2 * Math.PI / n;
  s += `<g data-tip="방향별 발전량 비율 (주풍향 ${wi.main.dir}° ${f(100 * wi.main.share, 1)}%${wi.second ? `, ${wi.second.dir}° ${f(100 * wi.second.share, 1)}%` : ''})"><circle cx="${ox}" cy="${oy}" r="${rr + 2}" fill="#fff" fill-opacity=".85" stroke="#d9d8d2"/>`;
  wi.secs.forEach((x, i) => { const r = rr * x.share / mx; if (r <= 0) return; const a0 = x.dir * Math.PI / 180 - sw / 2 * 0.85 - Math.PI / 2, a1 = x.dir * Math.PI / 180 + sw / 2 * 0.85 - Math.PI / 2; s += `<path d="M${ox},${oy}L${ox + r * Math.cos(a0)},${oy + r * Math.sin(a0)}A${r},${r} 0 0 1 ${ox + r * Math.cos(a1)},${oy + r * Math.sin(a1)}Z" fill="${x === wi.main || x === wi.second ? '#2a78d6' : '#a9c8ef'}"/>`; });
  const arrow = (dir, big) => { const a = dir * Math.PI / 180 - Math.PI / 2, r0 = rr + 20, r1 = rr + 4; const x0 = ox + r0 * Math.cos(a), y0 = oy + r0 * Math.sin(a), x1 = ox + r1 * Math.cos(a), y1 = oy + r1 * Math.sin(a); const hw = big ? 5 : 3.5, ang = Math.atan2(y1 - y0, x1 - x0); return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#d64545" stroke-width="${big ? 2.6 : 1.6}"/><path d="M${x1},${y1}l${-9 * Math.cos(ang) + hw * Math.sin(ang)},${-9 * Math.sin(ang) - hw * Math.cos(ang)}l${-2 * hw * Math.sin(ang)},${2 * hw * Math.cos(ang)}Z" fill="#d64545"/>`; };
  s += arrow(wi.main.dir, true) + (wi.second ? arrow(wi.second.dir, false) : '');
  s += `<text x="${ox}" y="${oy + rr + 16}" text-anchor="middle" style="font-size:9.5px;fill:#d64545;font-weight:600">주풍향 ${wi.main.dir}°${wi.second ? ` · ${wi.second.dir}°` : ''}</text></g>`;
  return s;
}
// ===== 도면 내보내기 (DXF · PDF) =====
function drawingGeom(F, Z) {
  const R = F ? farmCalc(F) : null; Z = Z || (F ? zoneOf(F) : null);
  const S = F ? P.sites.find(s => s.id === F.siteId) : P.sites.find(s => siteCoord(s)); const zone = (F && F.zone) || (Z && Z.zone) || 52;
  let mast = null; if (S && siteCoord(S)) { const u = W.latLonToUtm(+S.lat, +S.lon, zone); mast = { x: u.E, y: u.N, name: siteName(S) }; }
  const rows = F ? F.rows.map((r, i) => ({ ...r, rad: R ? (R.Ti[i].rotor || 100) / 2 : 50 })) : [];
  const ext = F ? (F.ext || []).flatMap(g => g.rows.map(r => ({ ...r, grp: g.name }))) : [];
  const g = { title: F ? F.name : Z.name, kind: F ? '터빈 배치도' : '구역도', rows, Z, ext, mst: R && R.mst ? R.mst.edges : [], sp: R && R.sp ? R.sp : null, mast, wi: windInfo(R), crs: F ? F.crs : 'utm', zone, R, T: R ? R.T : null };
  const P2 = [...rows.map(r => [r.x, r.y]), ...(Z ? [...Z.bounds.flatMap(b => b.pts), ...Z.excl.flatMap(e => e.pts)] : []), ...ext.map(e => [e.x, e.y])];
  if (mast && P2.length && Math.hypot(mast.x - P2[0][0], mast.y - P2[0][1]) < 60000) P2.push([mast.x, mast.y]); else g.mast = null;
  if (!P2.length) return null;
  g.x0 = Math.min(...P2.map(p => p[0])); g.x1 = Math.max(...P2.map(p => p[0])); g.y0 = Math.min(...P2.map(p => p[1])); g.y1 = Math.max(...P2.map(p => p[1]));
  return g;
}
// 이격 범위 근사 외곽 (선: 양쪽 평행선 + 꼭짓점 원, 면: 바깥 평행선 + 꼭짓점 원)
function bufferShapes(e) {
  const b = +e.buffer || 0; if (b <= 0) return { lines: [], circles: [] }; const pts = e.pts, closed = e.shape !== 'line' && pts.length >= 3; const lines = [], circles = pts.map(p => [p[0], p[1], b]);
  const n = closed ? pts.length : pts.length - 1; const area = closed ? pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) : 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; const nx = dy / L, ny = -dx / L; const sides = closed ? [area > 0 ? 1 : -1] : [1, -1]; sides.forEach(sg => lines.push([[p[0] + sg * nx * b, p[1] + sg * ny * b], [q[0] + sg * nx * b, q[1] + sg * ny * b]])); }
  return { lines, circles };
}
function exportDxf(F, Z) {
  const g = drawingGeom(F, Z); if (!g) { toast('그릴 내용이 없습니다.'); return; }
  const out = []; const w = (c, v) => out.push(String(c), String(v));
  const uni = t => String(t).replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const LAYERS = [['WTG', 5], ['WTG-ROTOR', 4], ['WTG-TEXT', 7], ['BOUNDARY', 5], ['EXCLUSION', 1], ['EXCL-BUFFER', 9], ['CABLE', 8], ['SPACING-NG', 1], ['MAST', 30], ['WIND', 1], ['EXTERNAL', 8], ['TABLE', 7], ['TITLE', 7], ['GRID', 9]];
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$DWGCODEPAGE'); w(3, 'ANSI_949'); w(9, '$INSUNITS'); w(70, 6); w(9, '$EXTMIN'); w(10, g.x0); w(20, g.y0); w(30, 0); w(9, '$EXTMAX'); w(10, g.x1); w(20, g.y1); w(30, 0); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES');
  w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 2); w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, 0); w(0, 'LTYPE'); w(2, 'DASHED'); w(70, 0); w(3, '__ __ __'); w(72, 65); w(73, 2); w(40, 75); w(49, 50); w(49, -25); w(0, 'ENDTAB');
  w(0, 'TABLE'); w(2, 'LAYER'); w(70, LAYERS.length); LAYERS.forEach(([n, c]) => { w(0, 'LAYER'); w(2, n); w(70, 0); w(62, c); w(6, n === 'BOUNDARY' || n === 'EXCL-BUFFER' || n === 'GRID' ? 'DASHED' : 'CONTINUOUS'); }); w(0, 'ENDTAB');
  w(0, 'TABLE'); w(2, 'STYLE'); w(70, 1); w(0, 'STYLE'); w(2, 'KOR'); w(70, 0); w(40, 0); w(41, 1); w(50, 0); w(71, 0); w(42, 2.5); w(3, 'malgun.ttf'); w(4, ''); w(0, 'ENDTAB');
  w(0, 'ENDSEC'); w(0, 'SECTION'); w(2, 'ENTITIES');
  const E = Math.max(g.x1 - g.x0, g.y1 - g.y0, 1000), th = E / 160;
  const line = (L, a, b) => { w(0, 'LINE'); w(8, L); w(10, a[0]); w(20, a[1]); w(30, 0); w(11, b[0]); w(21, b[1]); w(31, 0); };
  const circle = (L, x, y, r) => { w(0, 'CIRCLE'); w(8, L); w(10, x); w(20, y); w(30, 0); w(40, r); };
  const poly = (L, pts, closed) => { w(0, 'POLYLINE'); w(8, L); w(66, 1); w(70, closed ? 1 : 0); w(10, 0); w(20, 0); w(30, 0); pts.forEach(p => { w(0, 'VERTEX'); w(8, L); w(10, p[0]); w(20, p[1]); w(30, 0); }); w(0, 'SEQEND'); w(8, L); };
  const text = (L, x, y, h, t, al) => { w(0, 'TEXT'); w(8, L); w(10, x); w(20, y); w(30, 0); w(40, h); w(1, uni(t)); w(7, 'KOR'); if (al) { w(72, al === 'C' ? 1 : 2); w(11, x); w(21, y); w(31, 0); } };
  if (g.Z) {
    g.Z.bounds.forEach(b => { poly('BOUNDARY', b.pts, true); const c = b.pts.reduce((a, p) => [a[0] + p[0] / b.pts.length, a[1] + p[1] / b.pts.length], [0, 0]); text('BOUNDARY', c[0], c[1] + E * 0.02, th, `${b.name} (${f(W.polyArea(b.pts) / 1e6, 2)} km²)`, 'C'); });
    g.Z.excl.forEach(e => { poly('EXCLUSION', e.pts, e.shape !== 'line' && e.pts.length >= 3); const bs = bufferShapes(e); bs.lines.forEach(l => line('EXCL-BUFFER', l[0], l[1])); bs.circles.forEach(c => circle('EXCL-BUFFER', c[0], c[1], c[2])); text('EXCLUSION', e.pts[0][0], e.pts[0][1] + th, th * 0.8, `${e.name} (${e.kind}${e.buffer ? `, 이격 ${e.buffer} m` : ''})`); });
    (g.Z.pts || []).forEach(p => { circle('GRID', p.x, p.y, th * 0.4); text('GRID', p.x + th * 0.6, p.y, th * 0.7, `${p.name} ${f(p.v, 2)} m/s`); });
  }
  g.mst.forEach(([a, b]) => line('CABLE', [g.rows[a].x, g.rows[a].y], [g.rows[b].x, g.rows[b].y]));
  if (g.sp) g.sp.bad.forEach(([a, b]) => line('SPACING-NG', [g.rows[a].x, g.rows[a].y], [g.rows[b].x, g.rows[b].y]));
  g.rows.forEach(r => { w(0, 'POINT'); w(8, 'WTG'); w(10, r.x); w(20, r.y); w(30, 0); circle('WTG', r.x, r.y, Math.max(10, r.rad * 0.12)); circle('WTG-ROTOR', r.x, r.y, r.rad); text('WTG-TEXT', r.x + r.rad * 0.6, r.y + r.rad * 0.6, th * 0.8, r.name); });
  g.ext.forEach(r => { circle('EXTERNAL', r.x, r.y, th * 0.5); text('EXTERNAL', r.x + th * 0.6, r.y, th * 0.6, `${r.grp} ${r.name || ''}`); });
  if (g.mast) { poly('MAST', [[g.mast.x, g.mast.y + th], [g.mast.x - th * 0.9, g.mast.y - th * 0.6], [g.mast.x + th * 0.9, g.mast.y - th * 0.6]], true); text('MAST', g.mast.x + th, g.mast.y, th * 0.8, `측정기 ${g.mast.name}`); }
  // 방위표·축척·주풍향
  const nx = g.x1 + E * 0.03, ny = g.y1; poly('TITLE', [[nx, ny], [nx - th * 0.8, ny - th * 2.5], [nx, ny - th * 1.8], [nx + th * 0.8, ny - th * 2.5]], true); text('TITLE', nx, ny + th * 0.5, th, 'N', 'C');
  const sl = [500, 1000, 2000, 5000].find(l => l > E / 6) || 5000; const sx = g.x0, sy = g.y0 - E * 0.06; line('TITLE', [sx, sy], [sx + sl, sy]); [0, 0.5, 1].forEach(k => line('TITLE', [sx + sl * k, sy - th * 0.4], [sx + sl * k, sy + th * 0.4])); text('TITLE', sx, sy - th * 1.6, th * 0.8, '0', 'C'); text('TITLE', sx + sl, sy - th * 1.6, th * 0.8, sl >= 1000 ? `${sl / 1000} km` : `${sl} m`, 'C');
  if (g.wi) { const ax = g.x0, ay = g.y1 + E * 0.05; const a = g.wi.main.dir * Math.PI / 180; const L = E * 0.06; const fx = ax + Math.sin(a) * L, fy = ay + Math.cos(a) * L; line('WIND', [fx, fy], [ax, ay]); const ang = Math.atan2(ay - fy, ax - fx); poly('WIND', [[ax, ay], [ax - th * 1.2 * Math.cos(ang) + th * 0.5 * Math.sin(ang), ay - th * 1.2 * Math.sin(ang) - th * 0.5 * Math.cos(ang)], [ax - th * 1.2 * Math.cos(ang) - th * 0.5 * Math.sin(ang), ay - th * 1.2 * Math.sin(ang) + th * 0.5 * Math.cos(ang)]], true); text('WIND', ax + th, ay, th * 0.8, `주풍향 ${g.wi.main.dir}° (발전량 ${f(100 * g.wi.main.share, 1)}%)${g.wi.second ? ` · ${g.wi.second.dir}° (${f(100 * g.wi.second.share, 1)}%)` : ''}`);
    if (g.sp) { const cx = g.rows.reduce((q, r) => q + r.x, 0) / (g.rows.length || 1), cy = g.rows.reduce((q, r) => q + r.y, 0) / (g.rows.length || 1); const t2 = g.sp.dir * Math.PI / 180; const LL = Math.max(...g.rows.map(r => Math.hypot(r.x - cx, r.y - cy))) * 1.15 + 300; line('GRID', [cx - Math.sin(t2) * LL, cy - Math.cos(t2) * LL], [cx + Math.sin(t2) * LL, cy + Math.cos(t2) * LL]); } }
  // 제목·좌표 표
  const tx = g.x1 + E * 0.1; let ty = g.y1;
  text('TITLE', tx, ty, th * 1.6, `${g.title} — ${g.kind}`); ty -= th * 2.4;
  text('TITLE', tx, ty, th * 0.8, `좌표계: ${g.crs === 'utm' ? `UTM ${g.zone}N (WGS84), m` : '도면 좌표 (m)'} · 작성: 발전량 계산 도구 · ${reportCfg().date}`); ty -= th * 2;
  if (g.rows.length) {
    const ll = g.crs === 'utm'; const cols = ll ? [0, 6, 13, 20, 27] : [0, 6, 13]; const hd = ll ? ['터빈', 'E (m)', 'N (m)', '위도', '경도'] : ['터빈', 'X (m)', 'Y (m)'];
    hd.forEach((t, k) => text('TABLE', tx + cols[k] * th, ty, th * 0.8, t)); ty -= th * 0.5; line('TABLE', [tx, ty], [tx + (ll ? 34 : 20) * th, ty]); ty -= th * 1.3;
    g.rows.forEach(r => { const v = [r.name, fi(r.x), fi(r.y)]; if (ll) { const q = W.utmToLatLon(r.x, r.y, g.zone, true); v.push(f(q.lat, 6), f(q.lon, 6)); } v.forEach((t, k) => text('TABLE', tx + cols[k] * th, ty, th * 0.75, t)); ty -= th * 1.25; });
    if (g.R) { ty -= th; text('TABLE', tx, ty, th * 0.8, `${g.rows.length}기 · ${[...new Set(g.R.Ti.map(T => T.name))].join(' + ')} · 허브 ${f(g.R.c.t.hub, 1)} m · 설비 ${f(g.R.capMW, 1)} MW · 최소 간격 ${f(Math.min(...g.R.spacing), 1)}D · 케이블(최소 연결) ${f(g.R.mst.len / 1000, 1)} km`); }
  }
  ty -= th * 2; text('TABLE', tx, ty, th * 0.7, '레이어: WTG 터빈 · WTG-ROTOR 로터 회전 범위 · BOUNDARY 사업 구역 · EXCLUSION 제외 구역 · EXCL-BUFFER 이격 범위(근사) · CABLE 최소 연결 케이블 · SPACING-NG 간격 기준 미달 · WIND 주풍향 · MAST 측정기');
  w(0, 'ENDSEC'); w(0, 'EOF');
  download(fname(`_${g.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}_${g.kind}.dxf`), new Blob([out.join('\r\n') + '\r\n'], { type: 'application/dxf' }));
}
async function exportDrawingPdf(F, Z) {
  const g = drawingGeom(F, Z); if (!g) { toast('그릴 내용이 없습니다.'); return; }
  toast('도면 PDF를 만드는 중…', 5000);
  const mm = 96 / 25.4, Wmm = 420, Hmm = 297; const W0 = Wmm * mm, H0 = Hmm * mm; const m = 10 * mm;
  const tblW = g.rows.length ? (g.crs === 'utm' ? 118 : 70) * mm : 0; const areaX = m + 4 * mm, areaY = m + 4 * mm, areaW = W0 - 2 * m - tblW - 12 * mm, areaH = H0 - 2 * m - 8 * mm - 34 * mm;
  const ex = (g.x1 - g.x0) * 1.12 + 400, ey = (g.y1 - g.y0) * 1.12 + 400;
  const den = [2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 300000].find(d => ex * 1000 / d * mm <= areaW && ey * 1000 / d * mm <= areaH) || 500000;
  const sc = 1000 / den * mm; const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
  const X = x => areaX + areaW / 2 + (x - cx) * sc, Y = y => areaY + areaH / 2 - (y - cy) * sc;
  const t = (x, y, s, txt, o = '') => `<text x="${x}" y="${y}" style="font-size:${s}px;font-family:'Malgun Gothic','Noto Sans KR','Noto Sans CJK KR',sans-serif" ${o}>${esc(txt)}</text>`;
  let s = `<rect x="0" y="0" width="${W0}" height="${H0}" fill="#fff"/><rect x="${m}" y="${m}" width="${W0 - 2 * m}" height="${H0 - 2 * m}" fill="none" stroke="#000" stroke-width="2"/>`;
  s += `<defs><clipPath id="ca"><rect x="${areaX}" y="${areaY}" width="${areaW}" height="${areaH}"/></clipPath><pattern id="hp" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#d64545" stroke-width="1.3"/></pattern></defs><g clip-path="url(#ca)">`;
  // 좌표 격자
  const gs = [500, 1000, 2000, 5000, 10000, 20000].find(v => v * sc > 25 * mm) || 20000;
  for (let x = Math.ceil((cx - areaW / 2 / sc) / gs) * gs; x < cx + areaW / 2 / sc; x += gs) s += `<line x1="${X(x)}" y1="${areaY}" x2="${X(x)}" y2="${areaY + areaH}" stroke="#e3e3e3" stroke-width="0.8"/>` + t(X(x) + 2, areaY + 9, 7.5, fi(x), 'fill="#999"');
  for (let y = Math.ceil((cy - areaH / 2 / sc) / gs) * gs; y < cy + areaH / 2 / sc; y += gs) s += `<line x1="${areaX}" y1="${Y(y)}" x2="${areaX + areaW}" y2="${Y(y)}" stroke="#e3e3e3" stroke-width="0.8"/>` + t(areaX + 2, Y(y) - 2, 7.5, fi(y), 'fill="#999"');
  const pp = pts => pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  if (g.Z) {
    g.Z.bounds.forEach(b => { s += `<polygon points="${pp(b.pts)}" fill="rgba(42,120,214,0.05)" stroke="#2a78d6" stroke-width="1.6" stroke-dasharray="8 5"/>`; });
    g.Z.excl.forEach(e => { const bw = (+e.buffer || 0) * sc; const closed = e.shape !== 'line' && e.pts.length >= 3; if (bw > 0) s += `<${closed ? 'polygon' : 'polyline'} points="${pp(e.pts)}" fill="none" stroke="rgba(214,69,69,0.15)" stroke-width="${2 * bw}" stroke-linejoin="round" stroke-linecap="round"/>`; s += closed ? `<polygon points="${pp(e.pts)}" fill="url(#hp)" fill-opacity=".55" stroke="#d64545" stroke-width="1.4"/>` : `<polyline points="${pp(e.pts)}" fill="none" stroke="#d64545" stroke-width="2"/>`; s += t(X(e.pts[0][0]) + 4, Y(e.pts[0][1]) - 4, 8, `${e.name} (${e.kind}${e.buffer ? `, 이격 ${e.buffer} m` : ''})`, 'fill="#b03030"'); });
  }
  if (g.sp && g.rows.length) { const cxr = g.rows.reduce((q, r) => q + r.x, 0) / g.rows.length, cyr = g.rows.reduce((q, r) => q + r.y, 0) / g.rows.length, t2 = g.sp.dir * Math.PI / 180, LL = Math.max(ex, ey); s += `<line x1="${X(cxr - Math.sin(t2) * LL)}" y1="${Y(cyr - Math.cos(t2) * LL)}" x2="${X(cxr + Math.sin(t2) * LL)}" y2="${Y(cyr + Math.cos(t2) * LL)}" stroke="#7a4fd0" stroke-width="0.9" stroke-dasharray="7 5" opacity=".7"/>`; }
  g.mst.forEach(([a, b]) => { s += `<line x1="${X(g.rows[a].x)}" y1="${Y(g.rows[a].y)}" x2="${X(g.rows[b].x)}" y2="${Y(g.rows[b].y)}" stroke="#8a8984" stroke-width="1"/>`; });
  if (g.sp) g.sp.bad.forEach(([a, b]) => { s += `<line x1="${X(g.rows[a].x)}" y1="${Y(g.rows[a].y)}" x2="${X(g.rows[b].x)}" y2="${Y(g.rows[b].y)}" stroke="#d64545" stroke-width="1.6"/>`; });
  g.rows.forEach(r => { s += `<circle cx="${X(r.x)}" cy="${Y(r.y)}" r="${Math.max(1.5, r.rad * sc)}" fill="none" stroke="#2a78d6" stroke-width="0.6" opacity=".6"/><circle cx="${X(r.x)}" cy="${Y(r.y)}" r="3.2" fill="#1c5cab"/>` + t(X(r.x) + 5, Y(r.y) - 4, 8.5, r.name, 'fill="#222"'); });
  g.ext.forEach(r => { s += `<path d="M${X(r.x)},${Y(r.y) - 5}l4.5,8h-9z" fill="#8a8984"/>`; });
  if (g.mast) s += `<path d="M${X(g.mast.x)},${Y(g.mast.y) - 7}l6,11h-12z" fill="#eb6834"/>` + t(X(g.mast.x) + 8, Y(g.mast.y) + 3, 8.5, `측정기 ${g.mast.name}`, 'fill="#b0501f"');
  s += '</g>';
  // 방위표·축척·풍배도
  s += `<g transform="translate(${areaX + areaW - 22},${areaY + 28})"><path d="M0,-18 L8,8 L0,3 L-8,8Z" fill="#333"/>${t(0, 22, 11, 'N', 'text-anchor="middle" font-weight="700"')}</g>`;
  const sl = [500, 1000, 2000, 5000, 10000].find(l => l * sc > 30 * mm) || 10000; const bx = areaX + 10, by = areaY + areaH - 14;
  s += `<rect x="${bx}" y="${by - 4}" width="${sl * sc / 2}" height="4" fill="#333"/><rect x="${bx + sl * sc / 2}" y="${by - 4}" width="${sl * sc / 2}" height="4" fill="#fff" stroke="#333"/>` + t(bx, by + 11, 8, '0') + t(bx + sl * sc, by + 11, 8, sl >= 1000 ? `${sl / 1000} km` : `${sl} m`, 'text-anchor="middle"') + t(bx + sl * sc + 12, by, 9, `축척 1:${den.toLocaleString()} (A3)`);
  if (g.wi) { const ox = areaX + areaW - 60, oy = areaY + areaH - 70, rr = 34, mx = Math.max(...g.wi.secs.map(x => x.share)), sw = 2 * Math.PI / g.wi.secs.length; s += `<circle cx="${ox}" cy="${oy}" r="${rr + 2}" fill="#fff" stroke="#ccc"/>`; g.wi.secs.forEach(x => { const r = rr * x.share / mx, a0 = x.dir * Math.PI / 180 - sw * 0.42 - Math.PI / 2, a1 = x.dir * Math.PI / 180 + sw * 0.42 - Math.PI / 2; if (r > 0) s += `<path d="M${ox},${oy}L${ox + r * Math.cos(a0)},${oy + r * Math.sin(a0)}A${r},${r} 0 0 1 ${ox + r * Math.cos(a1)},${oy + r * Math.sin(a1)}Z" fill="${x === g.wi.main || x === g.wi.second ? '#2a78d6' : '#a9c8ef'}"/>`; }); const a = g.wi.main.dir * Math.PI / 180 - Math.PI / 2; s += `<line x1="${ox + (rr + 22) * Math.cos(a)}" y1="${oy + (rr + 22) * Math.sin(a)}" x2="${ox + (rr + 4) * Math.cos(a)}" y2="${oy + (rr + 4) * Math.sin(a)}" stroke="#d64545" stroke-width="2.6" marker-end="url(#ah)"/>` + t(ox, oy + rr + 15, 8.5, `주풍향 ${g.wi.main.dir}°${g.wi.second ? ` · ${g.wi.second.dir}°` : ''} (발전량 기준)`, 'text-anchor="middle" fill="#d64545"'); s = s.replace('<defs>', '<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#d64545"/></marker>'); }
  // 범례
  let ly = areaY + areaH + 6 * mm; const lg = [['#1c5cab', '터빈 (원 = 로터 회전 범위)'], ['#2a78d6', '사업 구역 (점선)'], ['#d64545', '제외 구역 · 간격 기준 미달'], ['#8a8984', '최소 연결 케이블 · 주변 단지'], ['#7a4fd0', '간격 기준 주풍향 축'], ['#eb6834', '측정기']]; lg.forEach(([c, l], i) => { const lx = areaX + (i % 3) * 70 * mm, yy = ly + Math.floor(i / 3) * 5 * mm; s += `<rect x="${lx}" y="${yy - 7}" width="10" height="7" fill="${c}"/>` + t(lx + 14, yy, 8.5, l); });
  // 좌표 표
  if (g.rows.length) { const tx = W0 - m - tblW - 2 * mm, ty0 = m + 6 * mm; const ll = g.crs === 'utm'; const cols = ll ? [0, 16, 40, 64, 90] : [0, 18, 44]; const hd = ll ? ['터빈', 'E (m)', 'N (m)', '위도', '경도'] : ['터빈', 'X (m)', 'Y (m)']; const rh = Math.min(5 * mm, (H0 - 2 * m - 50 * mm - 8 * mm) / (g.rows.length + 2)); const fs = Math.min(8.5, rh * 0.62);
    s += t(tx, ty0, 11, '터빈 좌표', 'font-weight="700"'); hd.forEach((h, k) => { s += t(tx + cols[k] * mm, ty0 + rh * 1.3, fs, h, 'font-weight="700"'); }); s += `<line x1="${tx}" y1="${ty0 + rh * 1.6}" x2="${tx + tblW - 4 * mm}" y2="${ty0 + rh * 1.6}" stroke="#333"/>`;
    g.rows.forEach((r, i) => { const v = [r.name, fi(r.x), fi(r.y)]; if (ll) { const q = W.utmToLatLon(r.x, r.y, g.zone, true); v.push(f(q.lat, 6), f(q.lon, 6)); } v.forEach((x, k) => { s += t(tx + cols[k] * mm, ty0 + rh * (2.6 + i), fs, x); }); }); }
  // 표제란
  const bw = 150 * mm, bh = 30 * mm, bxx = W0 - m - bw, byy = H0 - m - bh; const R2 = g.R;
  s += `<rect x="${bxx}" y="${byy}" width="${bw}" height="${bh}" fill="#fff" stroke="#000" stroke-width="1.5"/><line x1="${bxx}" y1="${byy + 10 * mm}" x2="${bxx + bw}" y2="${byy + 10 * mm}" stroke="#000"/><line x1="${bxx}" y1="${byy + 20 * mm}" x2="${bxx + bw}" y2="${byy + 20 * mm}" stroke="#000"/><line x1="${bxx + 30 * mm}" y1="${byy}" x2="${bxx + 30 * mm}" y2="${byy + bh}" stroke="#000"/>`;
  s += t(bxx + 3 * mm, byy + 6.5 * mm, 9, '사업명') + t(bxx + 33 * mm, byy + 6.5 * mm, 10.5, g.title, 'font-weight="700"') + t(bxx + 3 * mm, byy + 16.5 * mm, 9, '도면명') + t(bxx + 33 * mm, byy + 16.5 * mm, 10.5, g.kind, 'font-weight="700"') + t(bxx + 3 * mm, byy + 26.5 * mm, 9, '축척 · 좌표계') + t(bxx + 33 * mm, byy + 26.5 * mm, 9, `1:${den.toLocaleString()} (A3) · ${g.crs === 'utm' ? `UTM ${g.zone}N (WGS84)` : '도면 좌표'} · ${reportCfg().date}`);
  if (R2) s += t(bxx, byy - 3 * mm, 8.5, `${g.rows.length}기 · ${[...new Set(R2.Ti.map(T => T.name))].join(' + ')} · 허브 ${f(R2.c.t.hub, 1)} m · ${f(R2.capMW, 1)} MW · 최소 간격 ${f(Math.min(...R2.spacing), 1)}D · 케이블 ${f(R2.mst.len / 1000, 1)} km`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W0}" height="${H0}" viewBox="0 0 ${W0} ${H0}">${s}</svg>`;
  const scale = 2.6; const img = new Image();
  const jpg = await new Promise(res => { img.onload = () => { const c = document.createElement('canvas'); c.width = Math.round(W0 * scale); c.height = Math.round(H0 * scale); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); const u = c.toDataURL('image/jpeg', 0.9); const bin = atob(u.split(',')[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); res({ data: a, w: c.width, h: c.height }); }; img.onerror = () => res(null); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  if (!jpg) { toast('도면을 그리지 못했습니다.'); return; }
  const bytes = buildPdf([jpg], `${g.title} ${g.kind}`, [1190.55, 841.89]);
  download(fname(`_${g.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}_${g.kind}.pdf`), new Blob([bytes], { type: 'application/pdf' }));
}

// ===== 배치 최적화 =====
function optFeasible(F, Z, rows, i, x, y, cfg, Ti) {
  const rad = (Ti[i].rotor || 100) / 2, edge = cfg.blade ? rad : 0;
  const B = Z ? Z.bounds.filter(b => b.pts.length >= 3) : [];
  if (B.length) { const b = B.find(b2 => W.inPoly(x, y, b2.pts)); if (!b || W.distToEdge(x, y, b.pts) < edge) return false; }
  if (Z) for (const e of Z.excl) if (exclDist(x, y, e) < edge) return false;
  const rule = F.spRule, th = cfg.dir * Math.PI / 180, ux = Math.sin(th), uy = Math.cos(th);
  for (let j = 0; j < rows.length; j++) { if (j === i) continue; const D = Math.max(Ti[i].rotor || 100, Ti[j].rotor || 100); const dx = rows[j].x - x, dy = rows[j].y - y; const a = (dx * ux + dy * uy) / D, b = (-dx * uy + dy * ux) / D; if ((a / rule.main) ** 2 + (b / rule.cross) ** 2 < 1) return false; }
  return true;
}
function optimizeDialog() {
  const F = farmSel(); const R = farmCalc(F); if (!R) return; const Z = zoneOf(F);
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box" style="max-width:760px"><h3>배치 최적화 — ${esc(F.name)}</h3>
   ${+F.permitMW > 0 ? (() => { const pr = R.ratedMW / F.permitMW, ok = permitIn(R.ratedMW, +F.permitMW); if (ok) return `<div class="info" style="margin-bottom:6px">허가 설비용량 ${f(+F.permitMW, 1)} MW 기준으로 맞춘 ${F.rows.length}기(정격 ${f(R.ratedMW, 1)} MW, 허가의 ${f(100 * pr, 1)}%)를 배치합니다. 최적화는 터빈 수를 바꾸지 않고 위치만 옮깁니다.</div>`;
      const mw = R.T.ratedKW / 1000, need = permitNeed(+F.permitMW, mw); const fit = P.turbines.filter(t => t.id !== R.T.id && permitIn(F.rows.length * t.ratedKW / 1000, +F.permitMW));
      return `<div class="warnbox" style="margin-bottom:6px"><div>${F.rows.length}기 × ${f(mw, 1)} MW = ${f(R.ratedMW, 1)} MW로 허가 ${f(+F.permitMW, 1)} MW의 ${f(100 * pr, 1)}%입니다(±10% 밖). 허가에 맞추려면 ${need}기(${f(need * mw, 1)} MW)가 필요하지만 ${need > F.rows.length ? '구역 안에 간격 기준이나 최소 거리(3D)를 지키며 더 놓을 자리가 없어' : '자리를 줄이지 못해'} ${F.rows.length}기 그대로 배치합니다. 최적화는 터빈 수를 바꾸지 않고 위치만 옮깁니다.<br>방법: ${fit.length ? `<b>${fit.map(t => `${esc(t.model || t.name)} ${F.rows.length}기 = ${f(F.rows.length * t.ratedKW / 1000, 1)} MW (${f(100 * F.rows.length * t.ratedKW / 1000 / F.permitMW, 0)}%)`).join(', ')}</b>로 터빈을 바꾸면 지금 자리 수로 허가에 맞습니다 · ` : ''}구역을 넓히거나 · 배치도에서 자리를 직접 추가하거나 · 간격 기준을 줄여 보세요.</div></div>`; })() : '<div class="hint" style="margin-bottom:6px">최적화는 터빈 수를 바꾸지 않고 위치만 옮깁니다. 허가 용량에 맞춰 기수를 늘리거나 줄이려면 단지 설정에 "허가 설비용량"을 넣으세요.</div>'}
   <div class="hint">터빈 ${F.rows.length}기를 ${Z && Z.bounds.length ? `구역 "${esc(Z.name)}" 경계 안에서` : '구역 경계 없이(현재 위치 주변에서)'}${Z && Z.excl.length ? ' 제외 구역을 피해' : ''} 옮겨 가며 후류 손실이 작은(순발전량이 큰) 배치를 찾습니다. 간격 기준은 주풍향 ${F.spRule.main}D × 직각 ${F.spRule.cross}D입니다. 탐색은 가벼운 계산(방향 5°, 풍속 1 m/s)으로 하고 마지막에 정밀 계산으로 확인합니다. <b>케이블·수심·지반·항로 등은 보지 않으므로 결과는 "후류 기준 상한선"입니다.</b></div>
   ${(() => { const Bz = Z ? Z.bounds.filter(b => b.pts.length >= 3) : []; if (!Bz.length) return ''; const A = Bz.reduce((a, b) => a + W.polyArea(b.pts), 0) / 1e6; const D = R.T.rotor || 100; const per = Math.PI * F.spRule.main * F.spRule.cross * D * D / 4 / 1e6; const nMax = Math.floor(A / per); return `<div class="${nMax < F.rows.length ? 'warnbox' : 'hint'}" style="margin-top:6px"><div>구역 ${f(A, 2)} km²에 간격 기준(${F.spRule.main}D × ${F.spRule.cross}D, 터빈당 약 ${f(per, 2)} km²)으로 들어가는 기수는 대략 ${nMax}기입니다.${nMax < F.rows.length ? ` 지금 ${F.rows.length}기는 기준을 모두 지키기 어렵습니다. 간격 기준을 줄이거나 기수를 줄여야 합니다. 그대로 돌리면 기준 미달을 줄이는 쪽을 우선해 탐색합니다(최소 거리는 직각 방향 기준 또는 3D).` : ''}</div></div>`; })()}
   <div class="row" style="margin:10px 0"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="opBlade" checked> 블레이드 끝도 구역 안 (제외 구역은 이격 + 로터 반지름)</label><div class="fld"><label>탐색 시간 (초)</label><input id="opSec" class="n" value="60"></div></div>
   <div id="opProg" class="hint" style="min-height:40px"></div>
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">닫기</button><button class="btn" data-x="stop" style="display:none">멈추기</button><button class="btn pri" data-x="go">시작</button><button class="btn pri" data-x="save" style="display:none">새 단지로 저장</button></div></div>`;
  document.body.appendChild(box);
  let stop = false, best = null;
  box.addEventListener('click', async e => {
    const x = e.target.dataset.x; if (!x) return;
    if (x === 'c') { stop = true; box.remove(); return; }
    if (x === 'stop') { stop = true; return; }
    if (x === 'save' && best) { const nf = JSON.parse(JSON.stringify({ ...F, _cache: undefined })); nf.id = uid(); nf.name = `${F.name} (최적화)`; nf.rows = best.rows.map(r => ({ ...r, vRep: undefined, repEff: undefined })); if (nf.speed === 'report') { nf.speed = 'field'; nf.speedField = F.rows.filter(r => r.vRep > 0).map(r => ({ x: r.x, y: r.y, v: r.vRep })); } nf.rep = null; nf.source = `배치 최적화 (${F.name})`; delete nf._cache; P.farms.push(nf); ui.farmSel = nf.id; box.remove(); render(); save(); toast('최적화 배치를 새 단지로 저장했습니다.'); return; }
    if (x !== 'go') return;
    stop = false; box.querySelector('[data-x=go]').style.display = 'none'; box.querySelector('[data-x=stop]').style.display = ''; box.querySelector('[data-x=save]').style.display = 'none';
    const cfg = { blade: box.querySelector('#opBlade').checked, dir: R.sp.dir }; const secs = W.num(box.querySelector('#opSec').value) || 60; const prog = box.querySelector('#opProg');
    const c = R.c, Ti = R.Ti; let rows = F.rows.map(r => ({ ...r }));
    const B = Z ? Z.bounds.filter(b => b.pts.length >= 3) : []; const allP = B.flatMap(b => b.pts);
    const bx = allP.length ? [Math.min(...allP.map(p => p[0])), Math.max(...allP.map(p => p[0])), Math.min(...allP.map(p => p[1])), Math.max(...allP.map(p => p[1]))] : [Math.min(...rows.map(r => r.x)) - 3000, Math.max(...rows.map(r => r.x)) + 3000, Math.min(...rows.map(r => r.y)) - 3000, Math.max(...rows.map(r => r.y)) + 3000];
    const field = F.speed === 'report' ? F.rows.filter(r => r.vRep > 0).map(r => ({ x: r.x, y: r.y, v: r.vRep })) : F.speed === 'field' ? F.speedField : null;
    const scaleOf = rs => F.speed === 'zone' ? farmScale({ ...F, rows: rs }, c, Z) : field && field.length ? rs.map(r => idwSpeed(field, r.x, r.y) / c.meanV * c.s) : rs.map(() => c.s);
    const evalN = rs => { const r = farmCalc(F, { rows: rs, scale: scaleOf(rs), dd: 5, dv: 1 }); return { N: r.N, G: r.G, eff: r.eff }; };
    const hardMin = Math.min(F.spRule.cross, 3);
    // 간격 기준 미달 정도(타원 안으로 들어간 깊이 합), 최소 거리(hardMin·D)보다 가까우면 무한대
    const sev = (i, x0, y0) => { const th = cfg.dir * Math.PI / 180, ux = Math.sin(th), uy = Math.cos(th); let n = 0; for (let j = 0; j < rows.length; j++) { if (j === i) continue; const r = rows[j]; const D = Math.max(Ti[i].rotor || 100, Ti[j].rotor || 100); const dx = r.x - x0, dy = r.y - y0; if (Math.hypot(dx, dy) < hardMin * D) return Infinity; const a = (dx * ux + dy * uy) / D, b = (-dx * uy + dy * ux) / D; const e = Math.sqrt((a / F.spRule.main) ** 2 + (b / F.spRule.cross) ** 2); if (e < 1) n += 1 - e; } return n; };
    const randIn = (i, strict = true) => { for (let k = 0; k < 400; k++) { const px = bx[0] + Math.random() * (bx[1] - bx[0]), py = bx[2] + Math.random() * (bx[3] - bx[2]); if (strict ? optFeasible(F, Z, rows, i, px, py, cfg, Ti) : (optFeasible(F, Z, [], i, px, py, cfg, Ti) && sev(i, px, py) < Infinity)) return [px, py]; } return null; };
    // 기준 미달 터빈 먼저 옮기기
    let fixed = 0; for (let i = 0; i < rows.length; i++) if (!optFeasible(F, Z, [], i, rows[i].x, rows[i].y, cfg, Ti)) { const p = randIn(i) || randIn(i, false); if (p) { rows[i].x = p[0]; rows[i].y = p[1]; fixed++; } }
    const base = evalN(F.rows); let cur = evalN(rows); const lam = 0.03 * base.N; const t0 = Date.now(); let it = 0, acc = 0; const D0 = Ti[0].rotor || 100;
    while (!stop && Date.now() - t0 < secs * 1000) {
      for (let q = 0; q < 6 && !stop; q++) {
        it++; const w = cur.eff.map(e => Math.pow(1.02 - e, 2)); const ws = w.reduce((a, b) => a + b, 0); let rr = Math.random() * ws, i = 0; while (i < w.length - 1 && (rr -= w[i]) > 0) i++;
        let px, py; if (Math.random() < 0.25) { const p = randIn(i) || randIn(i, false); if (!p) continue; [px, py] = p; } else { const st = D0 * (0.3 + 2.5 * Math.random()), an = Math.random() * 2 * Math.PI; px = rows[i].x + st * Math.cos(an); py = rows[i].y + st * Math.sin(an); if (!optFeasible(F, Z, [], i, px, py, cfg, Ti)) continue; }
        const old = [rows[i].x, rows[i].y]; const vOld = sev(i, old[0], old[1]), vNew = sev(i, px, py); if (vNew === Infinity) continue; rows[i].x = px; rows[i].y = py; const ne = evalN(rows);
        if (ne.N - lam * vNew > cur.N - lam * (vOld === Infinity ? 1e3 : vOld)) { cur = ne; acc++; } else { rows[i].x = old[0]; rows[i].y = old[1]; }
      }
      prog.innerHTML = `탐색 ${it}회 · 개선 ${acc}회${fixed ? ` · 기준 미달 ${fixed}기 먼저 옮김` : ''} · ${Math.round((Date.now() - t0) / 1000)}초<br>후류 손실 ${f(100 * (1 - base.N / base.G), 2)}% → <b>${f(100 * (1 - cur.N / cur.G), 2)}%</b> (가벼운 계산)`;
      await new Promise(r => setTimeout(r, 0));
    }
    prog.innerHTML += '<br>정밀 계산으로 확인하는 중…'; await new Promise(r => setTimeout(r, 20));
    const full = rs => { const r = farmCalc(F, { rows: rs, scale: scaleOf(rs) }); const o = { ...r, T: R.T, Ti: R.Ti, c: R.c, spacing: rs.map((a, i) => Math.min(...rs.map((b, j) => i === j ? Infinity : Math.hypot(a.x - b.x, a.y - b.y))) / (Ti[i].rotor || 100)) }; o.mst = W.mstLength(rs.map(q => [q.x, q.y])); o.sp = spacingCheck({ ...F, rows: rs }, o); return o; };
    const R0 = full(F.rows), fin = full(rows), Rt = fin; best = { rows };
    const tmpF = { ...F, rows, _cache: null };
    prog.innerHTML = `<table class="t" style="margin-top:6px"><tr><th></th><th>현재 배치</th><th>최적화 배치</th><th>차이</th></tr>
      <tr><td class="txt">후류 손실 %</td><td>${f(100 * R0.wake, 2)}</td><td>${f(100 * fin.wake, 2)}</td><td>${f(100 * (fin.wake - R0.wake), 2)}%p</td></tr>
      <tr><td class="txt">후류 후 발전량 MWh/년</td><td>${fi(R0.N)}</td><td>${fi(fin.N)}</td><td>${f(100 * (fin.N / R0.N - 1), 2)}%</td></tr>
      <tr><td class="txt">최소 간격 D</td><td>${f(Math.min(...R0.spacing), 2)}</td><td>${f(Math.min(...Rt.spacing), 2)}</td><td></td></tr>
      <tr><td class="txt">간격 기준 미달 쌍</td><td>${R0.sp.bad.length}</td><td>${Rt.sp.bad.length}</td><td></td></tr>
      <tr><td class="txt">최소 연결 케이블 km</td><td>${f(R0.mst.len / 1000, 1)}</td><td>${f(Rt.mst.len / 1000, 1)}</td><td>${f((Rt.mst.len - R0.mst.len) / 1000, 1)} km</td></tr></table>
      <div style="margin-top:8px">${chartLayout(tmpF, Rt, { cable: true })}</div><div class="hint">탐색 ${it}회. 두 배치 모두 같은 풍속 조건(${F.speed === 'zone' ? '구역 풍속 기준점' : field ? '원래 배치의 터빈별 풍속을 위치에 따라 보간' : '단지 전체 같은 풍속'})으로 정밀 계산해 비교했습니다. 마음에 들면 "새 단지로 저장"을 누르세요. 원래 단지는 그대로 남습니다.</div>`;
    box.querySelector('[data-x=stop]').style.display = 'none'; box.querySelector('[data-x=go]').style.display = ''; box.querySelector('[data-x=go]').textContent = '다시 탐색'; box.querySelector('[data-x=save]').style.display = '';
  });
}
// 주변 단지 붙여넣기
function extPasteDialog() {
  const F = farmSel(); if (!F) return;
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box"><h3>주변 단지 넣기 — ${esc(F.name)}</h3><div class="hint">근처 다른 단지의 터빈 좌표입니다. 후류는 우리 단지에 주지만 발전량 합계에는 넣지 않습니다. 한 줄에 한 터빈: <b>이름 · X · Y</b> (또는 위도·경도).</div>
   <textarea class="paste" id="exTxt"></textarea>
   <div class="row" style="margin:8px 0"><div class="fld"><label>단지 이름</label><input id="exName" value="주변 단지 ${(F.ext || []).length + 1}" style="width:200px"></div><div class="fld"><label>터빈</label><select id="exT">${P.turbines.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div></div>
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">넣기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => { const x = e.target.dataset.x; if (!x) return; if (x === 'ok') { const rows = parseBoundText($('#exTxt').value, F.zone).pts.map((p, i) => ({ name: `E${i + 1}`, x: p[0], y: p[1] })); const named = parseLayoutText($('#exTxt').value); const use = named.length === rows.length && named.every(r => r.x > 1000) ? named : rows; if (!use.length) { toast('좌표를 읽지 못했습니다.'); return; } if (!F.ext) F.ext = []; F.ext.push({ id: uid(), name: $('#exName').value, tid: $('#exT').value, rows: use.map(r => ({ name: r.name, x: r.x, y: r.y })) }); toast(`주변 단지 터빈 ${use.length}기를 넣었습니다.`); } box.remove(); render(); save(); });
}
function farmCompareHtml() {
  const farms = P.farms || []; if (farms.length < 1) return '';
  const rows = farms.map(F => { let R = null, A = null; try { R = farmCalc(F); A = R ? aepCalc(F) : null; } catch (e) { } const Ts = R ? [...new Set(R.Ti.map(T => T.name))].join(' + ') : '-'; return `<tr class="click ${F.id === ui.farmSel ? 'sel' : ''}" data-act="fsel" data-id="${F.id}"><td class="txt">${esc(F.name)}</td><td class="txt">${esc(Ts)}</td><td>${F.rows.length}</td><td>${R ? f(R.capMW, 1) : '-'}${R && R.permit ? ` <span class="hint"${R.permit.st === 'in' ? '' : ' style="color:#b3261e"'}>(허가 ${f(100 * R.permit.ratio, 0)}%)</span>` : ''}</td><td>${R ? f(R.c.t.hub, 1) : '-'}</td><td>${R ? f(100 * R.wake, 2) : '-'}</td><td>${A ? fi(A.net) : '-'}</td><td>${A ? fi((A.pv.find(x => x.p === 90) || {}).mwh) : '-'}</td><td>${A ? f(100 * A.cf, 1) : '-'}</td><td>${R ? f(Math.min(...R.spacing), 1) : '-'}</td><td>${R ? f(R.mst.len / 1000, 1) : '-'}</td><td class="txt">${esc((zoneOf(F) || {}).name || '-')}</td></tr>`; }).join('');
  return `<div class="card"><h2>배치안 비교 <span class="sub">줄을 누르면 그 단지를 엽니다</span></h2><div class="tw"><table class="t"><tr><th>단지</th><th>터빈</th><th>기수</th><th>MW</th><th>허브 m</th><th>후류 %</th><th>순발전량 P50 MWh</th><th>P90 MWh</th><th>이용률 %</th><th>최소 간격 D</th><th>케이블 km</th><th>구역</th></tr>${rows}</table></div></div>`;
}
function viewFarm() {
  if (!P.farms) P.farms = [];
  const F = farmSel(); if (F) ui.farmSel = F.id;
  // 허가 설비용량이 있는 단지는 열 때 기수가 허가 ±10% 밖이면 자동으로 맞춤(이전 버전에서 만든 단지, 최적화로 만든 단지 포함). 같은 조건이면 다시 하지 않음
  if (F && +F.permitMW > 0 && !F.noFit && !F.rows.some(r => r.tid)) { try { const S = P.sites.find(x => x.id === F.siteId); const T = S && S.design ? turbOf(F.tid || turbSet(S).tid) : null; if (T) { const key = JSON.stringify([F.permitMW, T.id, T.ratedKW, F.zoneId, F.rows.length]); if (F._fitKey !== key && !permitIn(F.rows.length * T.ratedKW / 1000, +F.permitMW)) { farmFitPermit(F); F._fitKey = JSON.stringify([F.permitMW, T.id, T.ratedKW, F.zoneId, F.rows.length]); save(); } } } catch (e) { console.warn(e); } }
  let h = `<div class="card"><h2>단지 <span class="sub">터빈 배치를 넣으면 단지(배치안)가 만들어집니다</span></h2>
   <div class="dslist" style="margin-top:0">${P.farms.map(x => `<div class="ds ${F && x.id === F.id ? 'on' : ''}" data-act="fsel" data-id="${x.id}"><span class="x" data-act="fdel" data-id="${x.id}" title="삭제">×</span><div class="t"><span class="tag wg">단지</span><span>${esc(x.name)}</span></div><div class="m">${x.rows.length}기 · ${esc(siteName(P.sites.find(s => s.id === x.siteId) || {}))}</div></div>`).join('')}</div>
   <div class="drop" id="dropLayout" style="margin-top:10px"><b>배치 파일을 끌어다 놓거나 눌러서 고르세요</b><br><span class="hint">발전량 평가 보고서 PDF(터빈 좌표 표 · 터빈별 결과 · 손실·불확도 표 함께), AutoCAD DXF(점·블록·원), CSV/TXT(이름, X, Y[, 풍속]). 구역 경계는 3단계(구역) 탭에서 넣습니다</span></div>
   <input type="file" id="layoutIn" multiple hidden accept=".pdf,.dxf,.csv,.txt,.tsv,.zip">
   <div class="row" style="margin-top:8px"><button class="btn sm" data-act="fpaste">좌표 붙여넣기로 새 단지</button>${F ? `<button class="btn sm" data-act="fcopy">이 단지 복제</button>` : ''}</div></div>`;
  if (!F) return h + `<div class="card empty">아직 단지가 없습니다. 배치 파일을 넣어 주세요.</div>`;
  h += farmCompareHtml();
  h += farmTurbCmpHtml(farmSel());
  const S = P.sites.find(s => s.id === F.siteId); const ts = S ? turbSet(S) : null; const fT = turbOf(F.tid || (ts && ts.tid));
  const ext = F.ext || [];
  h += `<div class="card"><h2><input data-farm="name" value="${esc(F.name)}" style="border:none;font-weight:700;font-size:14px;background:transparent;width:380px"><span class="sub">배치 출처 <input data-farm="source" value="${esc(F.source || '')}" placeholder="비어 있음" style="width:360px;font-size:11.5px;border:1px solid var(--line2);border-radius:3px;padding:1px 4px"></span></h2><div class="row">
   <div class="fld"><label>지점 (대표 풍황)</label><select data-farm="siteId">${P.sites.map(s => `<option value="${s.id}" ${s.id === F.siteId ? 'selected' : ''}>${esc(siteName(s))}${s.design ? '' : ' (대표 풍황 없음)'}</option>`).join('')}</select></div>
   <div class="fld"><label>터빈</label><select data-farm="tid"><option value="" ${!F.tid ? 'selected' : ''}>지점 설정 따름 (${esc(ts ? turbOf(ts.tid).name : '-')})</option>${P.turbines.map(t => `<option value="${t.id}" ${F.tid === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
   <div class="fld"><label>허브높이 (해발 m)</label><input class="n" data-farm="hub" value="${Number.isFinite(F.hub) ? F.hub : ''}" placeholder="${F.tid ? fT.hub : (ts ? ts.hub : '')}"></div>
   <div class="fld"><label>허가 설비용량 (MW)</label><input class="n" data-farm="permitMW" value="${+F.permitMW > 0 ? F.permitMW : ''}" placeholder="없음">${+F.permitMW > 0 ? (() => { const rMW = F.rows.reduce((a, q) => a + farmTurb(F, { T: fT }, q).ratedKW / 1000, 0), pr = rMW / F.permitMW; const ok = pr >= PERMIT_TOL_LO - 1e-9 && pr <= PERMIT_TOL_HI + 1e-9; return `<span class="srcl" style="color:${ok ? '#226b22' : '#b3261e'};font-weight:600">정격 ${f(rMW, 1)} MW = 허가의 ${f(100 * pr, 1)}% ${ok ? '(±10% 안)' : pr > 1 ? '(+10% 초과)' : '(−10% 미만)'}</span>`; })() : ''}</div>
   ${+F.permitMW > 0 ? `<div class="fld"><label>허가 용량 적용</label><select data-farm="permitMode"><option value="cap" ${(F.permitMode || 'cap') === 'cap' ? 'selected' : ''}>단지 출력 상한 (터빈 정격, 넘는 순간만 잘림)</option><option value="tol" ${F.permitMode === 'tol' ? 'selected' : ''}>정격 그대로 (±10% 안, 제한 없음)</option><option value="derate" ${F.permitMode === 'derate' ? 'selected' : ''}>기당 출력 제한 (허가량에 맞춰 낮춤)</option></select></div>${(F.permitMode || 'cap') === 'cap' ? `<div class="fld"><label>계통연계 용량 (MW)</label><input class="n" data-farm="gridMW" value="${+F.gridMW > 0 ? F.gridMW : ''}" placeholder="${F.permitMW}"></div>` : ''}` : ''}
   <div class="fld"><label>구역</label><select data-farm="zoneId"><option value="">없음</option>${(P.zones || []).map(z => `<option value="${z.id}" ${F.zoneId === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></div>
   <div class="fld"><label>후류 모델</label><select data-farm="model">${Object.entries(WAKE_MODELS).map(([k, v]) => `<option value="${k}" ${F.wake.model === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
   ${F.wake.model === 'lin' || F.wake.model === 'rss' ? `<div class="fld"><label>후류 확산계수 k</label><input class="n" data-farm="k" value="${F.wake.k}"></div>` : `<div class="fld"><label>주변 난류강도</label><input class="n" data-farm="ti" value="${F.wake.ti || 0.06}"></div>`}
   <div class="fld"><label>터빈별 풍속</label><select data-farm="speed"><option value="uniform" ${F.speed === 'uniform' ? 'selected' : ''}>단지 전체 같은 풍속</option><option value="report" ${F.speed === 'report' ? 'selected' : ''} ${F.rows.some(r => r.vRep > 0) ? '' : 'disabled'}>터빈별 평균풍속 (보고서·입력)</option><option value="zone" ${F.speed === 'zone' ? 'selected' : ''} ${zoneOf(F) && (zoneOf(F).pts || []).length ? '' : 'disabled'}>구역 풍속 기준점 (거리 비례)</option><option value="field" ${F.speed === 'field' ? 'selected' : ''} ${F.speedField && F.speedField.length ? '' : 'disabled'}>원래 배치 터빈별 풍속 보간</option><option value="manual" ${F.speed === 'manual' ? 'selected' : ''}>터빈별 배율 직접 입력</option></select></div>
   <div class="fld"><label>좌표계</label><select data-farm="crs"><option value="utm" ${F.crs === 'utm' ? 'selected' : ''}>UTM (WGS84)</option><option value="local" ${F.crs !== 'utm' ? 'selected' : ''}>도면 좌표 (m)</option></select></div>
   ${F.crs === 'utm' ? `<div class="fld"><label>UTM 구역</label><input class="n" data-farm="zone" value="${F.zone}" style="width:60px"></div>` : ''}</div>
   <div class="row" style="margin-top:6px"><div class="fld"><label>간격 기준: 주풍향 방향 (D)</label><input class="n" data-sp="main" value="${F.spRule.main}"></div><div class="fld"><label>직각 방향 (D)</label><input class="n" data-sp="cross" value="${F.spRule.cross}"></div><div class="fld"><label>주풍향 (°)</label><input class="n" data-sp="dir" value="${F.spRule.dir}" placeholder="auto"></div>
   <div class="fld"><label>주변 단지</label><div>${ext.length ? ext.map(g => `<span class="tag" style="margin-right:4px">${esc(g.name)} ${g.rows.length}기 <span data-act="extdel" data-id="${g.id}" style="cursor:pointer">×</span></span>`).join('') : '<span class="hint">없음</span>'} <button class="btn sm" data-act="extadd">넣기</button></div></div>
   <button class="btn pri sm" data-act="optim" style="align-self:flex-end">배치 최적화</button></div>
   <div class="hint" style="margin-top:6px">${F.wake.model === 'lin' || F.wake.model === 'rss' ? 'Jensen 선형 합산 k 0.05는 WindPRO Park2(2018) 방식에 가까운 설정입니다. 일반 Park(제곱합, 해상 k 0.04)는 같은 단지에서 후류 손실이 더 작게 나옵니다.' : F.wake.model === 'turbopark' ? 'TurbOPark(Nygaard 2020): 주변 난류강도와 추력계수로 후류 폭이 넓어지는 속도를 정하고, 후류끼리는 제곱합으로 합칩니다. 해상 대형 단지에서 Jensen보다 먼 거리 후류를 크게 잡습니다. 주변 난류강도는 해상 보통 0.05~0.08.' : '가우스 모델(Bastankhah·Porté-Agel 2014, 확산계수 = 0.38×난류강도 + 0.004): 후류 단면을 종 모양으로 보고 로터 9점 평균, 후류끼리는 제곱합. 주변 난류강도는 해상 보통 0.05~0.08.'} 방향 1° 간격, 풍속 0.5 m/s 구간, 상류 터빈은 후류 받은 풍속으로 추력계수를 계산합니다.</div></div>`;
  if (!S || !S.design) return h + `<div class="card"><div class="warnbox"><div>선택한 지점에 대표 풍황이 없습니다. 1단계에서 지정하거나 다른 지점을 고르세요.</div></div></div>` + farmTable(F, null);
  const R = farmCalc(F); const c = R.c; const rep = F.rep || {};
  const cmp = (v, r, d = 0, pct) => Number.isFinite(r) ? `<span class="hint"> · 보고서 ${pct ? f(r, 2) + '%' : fi(r)} (${pct ? (v - r >= 0 ? '+' : '') + f(v - r, 2) + '%p' : (v / r - 1 >= 0 ? '+' : '') + f(100 * (v / r - 1), 1) + '%'})</span>` : '';
  h += `<div class="card design"><h2>후류 계산 결과 <span class="sub">${esc(siteName(S))} 대표 풍황 · ${esc([...new Set(R.Ti.map(T => T.name))].join(' + '))} · 허브 ${f(c.t.hub, 1)} m · ${c.useHist ? '실측 분포' : 'Weibull'} · 공기밀도 ${f(c.rho, 3)}</span></h2>
   <div class="big"><div><b>${F.rows.length}</b><span>터빈 수</span></div><div><b>${f(R.capMW, 1)}</b><span>설비용량 MW${R.derate ? ` (정격 ${f(R.ratedMW, 1)})` : ''}</span></div>${R.permit ? `<div><b style="color:${R.permit.st === 'in' ? 'inherit' : '#b3261e'}">${f(100 * R.permit.ratio, 1)}%</b><span>허가 ${f(R.permit.mw, 1)} MW 대비 · ${R.permit.st === 'in' ? '±10% 안' : R.permit.st === 'over' ? '+10% 초과' : '−10% 미만'}</span></div>` : ''}<div><b>${fi(R.G)}</b><span>총발전량 MWh/년${cmp(R.G, rep.gross)}</span></div><div><b>${fi(R.N)}</b><span>후류 후 발전량 MWh/년</span></div><div><b>${f(100 * R.wake, 2)}</b><span>후류 손실 %${cmp(100 * R.wake, rep.wake, 2, 1)}</span></div><div><b>${f(Math.min(...R.spacing), 1)}D</b><span>최소 터빈 간격</span></div><div><b>${f(R.mst.len / 1000, 1)}</b><span>최소 연결 케이블 km</span></div></div>
   ${F.fitMsg && F.fitMsg.removed ? `<div class="info">정격 합계가 허가 ±10%를 벗어나 허가 설비용량에 가장 가깝게 터빈 수를 ${F.fitMsg.n0}기 → ${F.fitMsg.need}기로 줄였습니다(정격 합계 = 허가의 ${f(100 * R.ratedMW / F.permitMW, 1)}%). 지금 배치에서 발전량이 가장 적은 자리부터 뺐습니다: <b>${F.fitMsg.removed.map(esc).join(', ')}</b>. <span class="btn ghost sm" data-act="fitUndo">뺀 자리 되돌리기</span></div>` : ''}
   ${F.fitMsg && F.fitMsg.addedN && F.fitMsg.addedN.length ? `<div class="info">정격 합계가 허가 ±10%보다 적어 허가 설비용량에 가장 가깝게 터빈 수를 ${F.fitMsg.n0}기 → ${F.rows.length}기로 늘렸습니다(정격 합계 = 허가의 ${f(100 * R.ratedMW / F.permitMW, 1)}%). 새 자리 <b>${F.fitMsg.addedN.map(esc).join(', ')}</b>는 ${zoneOf(F) && zoneOf(F).bounds.length ? '구역 경계 안·제외 구역 밖에서' : '기존 배치 주변에서'} 기존 터빈과 간격 기준(${F.spRule.main}D × ${F.spRule.cross}D)의 1.5배 이상 떨어지면서 단지 중심에 가까운 곳(후류·케이블 균형)에 자동으로 놓았습니다${F.fitMsg.relaxed ? ` — ${F.fitMsg.relaxed}기는 기준을 지킬 자리가 없어 최소 거리만 지킴` : ''}. 위치는 배치도에서 옮기거나 배치 최적화로 다듬으세요. <span class="btn ghost sm" data-act="fitUndo">추가한 자리 지우기</span></div>` : ''}
   ${F.fitMsg && F.fitMsg.short > 0 ? `<div class="warnbox"><div>허가 설비용량을 채우려면 ${F.fitMsg.need}기가 필요한데 ${F.fitMsg.short}기 놓을 자리를 찾지 못했습니다(구역이 좁거나 간격 기준이 큼). 구역을 넓히거나 좌표를 직접 추가해 주세요.</div></div>` : ''}
   ${F.noFit && +F.permitMW > 0 ? `<div class="hint">터빈 수 자동 맞춤을 끈 상태입니다. <span class="btn ghost sm" data-act="fitRedo">허가량에 맞게 다시 맞추기</span></div>` : ''}
   ${R.permit ? (() => { const pm = R.permit; const base = `정격 합계 ${f(R.ratedMW, 1)} MW = 허가 설비용량 ${f(pm.mw, 1)} MW의 ${f(100 * pm.ratio, 1)}%`;
     if (pm.st === 'over') return `<div class="warnbox"><div>${base}로 +10%를 넘습니다(변경허가 필요 범위). 허가량에 맞춰 터빈 출력을 정격의 ${f(100 * R.derate.fac, 2)}%(기당 ${R.derate.perMW.map(v => f(v, 3)).join(' / ')} MW)로 제한해 계산했습니다.</div></div>`;
     const law = '전기사업법 시행규칙: 허가 설비용량의 10% 이하 변경은 변경허가 대상 아님';
     const lo = pm.st === 'under' ? `<div class="warnbox"><div>${base}로 −10%보다 적습니다(변경허가가 필요할 수 있음).</div></div>` : '';
     if (pm.mode === 'derate' && R.derate) return lo + `<div class="info">${base}. 기당 출력 제한 방식: 모든 터빈 출력을 정격의 ${f(100 * R.derate.fac, 2)}%(기당 ${R.derate.perMW.map(v => f(v, 3)).join(' / ')} MW)로 낮춰 계산했습니다. 추력계수(Ct)는 원래 곡선을 써서 후류는 약간 보수적입니다.</div>`;
     if (pm.mode === 'cap' && R.curt > 0) return lo + `<div class="info">${base}${pm.st === 'in' ? ` — ±10% 안이라 터빈은 정격 그대로(${law})` : ''}. 단지 출력 상한 방식: 단지 합계 출력이 계통연계 용량 ${f(pm.gridMW, 1)} MW를 넘는 순간만 잘라 계산했습니다 — 출력 상한 손실 <b>${fi(R.curt)} MWh/년 (${f(R.curtPct, 2)}%)</b>. 5 발전량 탭 손실 표의 "운전 제한"에 "단지 출력 상한" 항목으로 들어갑니다(후류 후 발전량 숫자에는 이미 빠져 있음).</div>`;
     return lo + `<div class="info">${base}${pm.st === 'in' ? ` — ±10% 안이라 터빈 정격 그대로 계산했습니다(${law})` : ''}.${pm.mode === 'cap' ? ` 단지 합계가 계통연계 용량 ${f(pm.gridMW, 1)} MW를 넘지 않아 잘리는 출력이 없습니다.` : ''} 계통연계 용량·입찰 계약 용량·환경영향평가 협의 내용은 따로 확인하세요.</div>`; })() : ''}
   ${boundHtml(F, R)}
   ${R.sp.bad.length ? `<div class="warnbox"><div>간격 기준(주풍향 ${f(R.sp.dir, 0)}° 방향 ${R.sp.rule.main}D × 직각 ${R.sp.rule.cross}D) 미달 ${R.sp.bad.length}쌍: ${esc(R.sp.bad.slice(0, 12).map(([a, b, d]) => `${F.rows[a].name}–${F.rows[b].name} ${f(d, 1)}D`).join(', '))}${R.sp.bad.length > 12 ? ' …' : ''}. 제작사 하중 검토로 허용되는지 확인하세요.</div></div>` : `<div class="hint">간격 기준(주풍향 ${f(R.sp.dir, 0)}° 방향 ${R.sp.rule.main}D × 직각 ${R.sp.rule.cross}D)을 모두 만족합니다.</div>`}
   ${ext.length ? `<div class="hint">주변 단지 ${ext.reduce((a, g) => a + g.rows.length, 0)}기의 후류를 포함했습니다(발전량 합계에는 넣지 않음).</div>` : ''}
   ${F.speed === 'uniform' ? '<div class="hint">단지 전체에 대표 풍황을 같게 적용했습니다. 보고서 터빈별 풍속이나 구역 풍속 기준점이 있으면 "터빈별 풍속"을 바꿔 보세요.</div>' : ''}
   <div class="grid2" style="margin-top:10px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">${chartLayout(F, R, { edit: true })}
   <div>${chartBars(c.sectors.map(x => x.dir + '°'), R.r.secGross.map((g, i) => g > 0 ? 100 * (1 - R.r.secNet[i] / g) : NaN), '방향별 후류 손실', '후류 손실 (%)', (i, v) => `${c.sectors[i].dir}°: 후류 손실 ${f(v, 1)}% · 총 ${fi(R.r.secGross[i])} → ${fi(R.r.secNet[i])} MWh`)}
   ${chartBars(F.rows.map(r => r.name), R.eff.map(e => 100 * e), '터빈별 효율', '효율 (%)', (i, v) => `${F.rows[i].name}: ${f(v, 1)}%${Number.isFinite(F.rows[i].repEff) ? ` (보고서 ${f(F.rows[i].repEff, 1)}%)` : ''}`)}</div></div></div>`;
  h += farmTable(F, R);
  return h;
}
function boundHtml(F, R) {
  const bc = boundCheck(F, R); if (!bc) return zoneOf(F) ? '' : '<div class="hint">구역을 고르지 않았습니다. 3단계(구역) 탭에서 사업 구역과 제외 구역을 넣고 위 "구역"에서 고르면 경계 검사를 합니다.</div>';
  let h = `<div style="margin:10px 0"><div class="hint">구역 "${esc(bc.Z.name)}": 사업 구역 ${bc.B.length}개 (${f(bc.area, 2)} km²${bc.area > 0 ? `, 설비 밀도 ${f(R.capMW / bc.area, 2)} MW/km²` : ''}) · 제외 구역 ${bc.E.length}개</div>`;
  if (bc.out.length) h += `<div class="warnbox"><div>사업 구역 밖 터빈 ${bc.out.length}기: ${esc(bc.out.join(', '))}</div></div>`;
  if (bc.tip.length) h += `<div class="warnbox"><div>블레이드 끝이 사업 구역 경계를 넘는 터빈 ${bc.tip.length}기 (경계까지 거리 < 로터 반지름): ${esc(bc.tip.join(', '))}. 허가 조건이 "블레이드 포함 구역 안"이면 위치 조정이 필요합니다.</div></div>`;
  if (bc.exIn.length) h += `<div class="warnbox"><div>제외 구역(이격 거리 포함) 안에 있는 터빈 ${bc.exIn.length}기: ${esc(bc.exIn.join(', '))}</div></div>`;
  if (bc.exTip.length) h += `<div class="warnbox"><div>블레이드 끝이 제외 구역 이격 범위에 들어가는 터빈 ${bc.exTip.length}기: ${esc(bc.exTip.join(', '))}</div></div>`;
  if (!bc.out.length && !bc.tip.length && !bc.exIn.length && !bc.exTip.length) h += `<div class="hint">모든 터빈과 블레이드 끝이 사업 구역 안에 있고 제외 구역을 피합니다.${bc.B.length ? ` 경계까지 최소 ${f(Math.min(...bc.tur.map(t => t.d)), 0)} m.` : ''}</div>`;
  return h + `</div>`;
}
function farmTable(F, R) {
  const bc = boundCheck(F, R); const hasB = bc && bc.B.length, hasE = bc && bc.E.length;
  const hasRep = F.rows.some(r => Number.isFinite(r.repEff));
  let h = `<div class="card"><h2>터빈별 <span class="sub">이름·좌표·풍속·터빈은 칸을 눌러 고칠 수 있습니다</span></h2><div class="tw" style="max-height:520px"><table class="t"><tr><th>이름</th><th>X (E)</th><th>Y (N)</th><th>터빈</th><th>최근접 간격</th>${hasB ? '<th>경계까지 m</th>' : ''}${hasE ? '<th>제외 구역까지 m</th>' : ''}${F.speed === 'manual' ? '<th>풍속 배율</th>' : F.speed === 'zone' || F.speed === 'field' ? '<th>풍속 (보간) m/s</th>' : '<th>평균풍속 (보고서·입력)</th>'}<th>총발전량 MWh</th><th>후류 후 MWh</th><th>효율 %</th>${hasRep ? '<th>보고서 효율 %</th><th>차이 %p</th>' : ''}<th></th></tr>`;
  F.rows.forEach((r, i) => {
    h += `<tr><td><input data-fr="${i}" data-k="name" value="${esc(r.name)}" style="width:70px;text-align:left"></td><td><input data-fr="${i}" data-k="x" value="${r.x}" style="width:90px"></td><td><input data-fr="${i}" data-k="y" value="${r.y}" style="width:95px"></td>
      <td><select data-fr="${i}" data-k="tid" style="max-width:150px"><option value="">단지 터빈</option>${P.turbines.map(t => `<option value="${t.id}" ${r.tid === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td>
      <td>${R ? f(R.spacing[i], 1) + 'D' : '-'}</td>${hasB ? `<td class="${bc.tur[i].d < bc.tur[i].rad ? 'ng' : ''}">${bc.tur[i].inB ? fi(bc.tur[i].d) : '밖 ' + fi(-bc.tur[i].d)}</td>` : ''}${hasE ? `<td class="${bc.tur[i].ed < bc.tur[i].rad ? 'ng' : ''}" title="${esc(bc.tur[i].en)}">${bc.tur[i].ed < 0 ? '안 ' + fi(-bc.tur[i].ed) : fi(bc.tur[i].ed)}</td>` : ''}
      <td>${F.speed === 'manual' ? `<input data-fr="${i}" data-k="scale" value="${r.scale ?? ''}" placeholder="1">` : F.speed === 'zone' || F.speed === 'field' ? (R ? f(R.scale[i] / R.c.s * R.c.meanV, 2) : '-') : `<input data-fr="${i}" data-k="vRep" value="${r.vRep ?? ''}">`}</td>
      <td>${R ? fi(R.r.gross[i]) : '-'}</td><td>${R ? fi(R.r.net[i]) : '-'}</td><td>${R ? f(100 * R.eff[i], 1) : '-'}</td>${hasRep ? `<td>${f(r.repEff, 1)}</td><td>${R && Number.isFinite(r.repEff) ? f(100 * R.eff[i] - r.repEff, 1) : '-'}</td>` : ''}<td><span class="btn ghost sm" data-act="frdel" data-i="${i}">×</span></td></tr>`;
  });
  if (R) h += `<tr class="sum"><td>합계</td><td></td><td></td><td></td><td></td>${hasB ? '<td></td>' : ''}${hasE ? '<td></td>' : ''}<td></td><td>${fi(R.G)}</td><td>${fi(R.N)}</td><td>${f(100 * (1 - R.wake), 2)}</td>${hasRep ? `<td>${f(100 - (F.rep && F.rep.wake), 2)}</td><td></td>` : ''}<td></td></tr>`;
  h += `</table></div><div class="row" style="margin-top:6px"><button class="btn sm" data-act="fradd">터빈 추가</button></div>`;
  if (hasRep && R) { const d = F.rows.map((r, i) => Math.abs(100 * R.eff[i] - r.repEff)).filter(Number.isFinite); h += `<div class="hint" style="margin-top:6px">보고서 대비 터빈별 효율 차이: 평균 ${f(d.reduce((a, b) => a + b, 0) / d.length, 2)}%p, 최대 ${f(Math.max(...d), 2)}%p</div>`; }
  return h + `</div>`;
}
function layoutPasteDialog() {
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box"><h3>좌표 붙여넣기</h3><div class="hint">엑셀에서 복사해 붙여 넣으세요. 한 줄에 한 터빈: <b>이름 · X(동) · Y(북)</b> [· 평균풍속]. 좌표는 m 단위(UTM 또는 도면 좌표).</div>
   <textarea class="paste" id="lyTxt" placeholder="WTG1\t527207\t3903760&#10;WTG2\t527807\t3903420"></textarea>
   <div class="row" style="margin:8px 0"><div class="fld"><label>단지 이름</label><input id="lyName" value="새 단지" style="width:240px"></div><div class="fld"><label>좌표계</label><select id="lyCrs"><option value="utm">UTM 52N (WGS84)</option><option value="local">도면 좌표</option></select></div></div>
   <div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">단지 만들기</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', e => { const x = e.target.dataset.x; if (!x) return; if (x === 'ok') { const rows = parseLayoutText($('#lyTxt').value); if (rows.length) { const crs = $('#lyCrs').value; const ns = crs === 'utm' ? siteNearUtm(rows, 52) : null; const F = newFarm($('#lyName').value, rows, { crs, source: '붙여넣기', siteId: ns ? ns.id : P.active }); if (rows.some(r => r.vRep)) F.speed = 'report'; toast(`${rows.length}기로 단지를 만들었습니다.`); } else toast('좌표를 읽지 못했습니다.'); } box.remove(); render(); save(); });
}

/* ================= 5단계: 발전량 (손실·불확도·P값) ================= */
// ===== 불확도 조건 (항목마다 조건 → 범위 → 중간값). 범위는 평가 보고서 사례에 맞춘 임시 기준, 화면에서 수정 =====
// num: 자료 값 x로 구간(bins: [x하한, x상한) ) 결정 / sel: 선택지 / ratio: 다른 값 × 비율 범위
const UNC_COND_DEFAULT = {
  meas: { label: '측정 기간', type: 'num', unit: '개월', bins: [['6개월 미만', -1e9, 6, 4.0, 6.0], ['6~12개월', 6, 12, 2.5, 4.0], ['12~24개월', 12, 24, 1.5, 2.5], ['24개월 이상', 24, 1e9, 0.5, 1.5]] },
  overlap: { label: '측정·장기 자료 겹친 기간', type: 'num', unit: '개월', bins: [['6개월 미만', -1e9, 6, 5.0, 7.0], ['6~12개월', 6, 12, 3.5, 5.0], ['12~24개월', 12, 24, 2.5, 3.5], ['24개월 이상', 24, 1e9, 1.0, 2.5]] },
  ltRef: { label: '장기 참조 자료', type: 'sel', opts: [['reanalysis', '재분석 자료 (ERA5·MERRA2 등)', 0.5, 1.5], ['station', '인근 관측소', 1.5, 3.0], ['none', '장기 자료 없음', 3.0, 5.0]] },
  ltReg: { label: '단기-장기 상관계수 r', type: 'num', unit: '', bins: [['r 0.9 이상', 0.9, 1.01, 1.0, 2.0], ['r 0.8~0.9', 0.8, 0.9, 2.3, 3.3], ['r 0.7~0.8', 0.7, 0.8, 3.5, 5.0], ['r 0.7 미만', -1e9, 0.7, 5.0, 8.0]] },
  ltYears: { label: '장기 자료 연수', type: 'num', unit: '년', bins: [['20년 이상', 20, 1e9, 1.0, 2.2], ['10~20년', 10, 20, 2.0, 3.0], ['5~10년', 5, 10, 3.0, 4.0], ['5년 미만', -1e9, 5, 4.0, 6.0]] },
  calib: { label: '센서 교정·검증', type: 'sel', opts: [['yes', '검증·교정 보고서 있음', 0.5, 1.5], ['no', '검증·교정 보고서 없음', 2.0, 3.0]] },
  hubdiff: { label: '허브높이 − 최고 측정높이', type: 'num', unit: 'm', bins: [['허브가 측정 범위 안', -1e9, 0.5, 0, 0], ['30 m 이내 외삽', 0.5, 30, 0.5, 1.5], ['30 m 넘는 외삽', 30, 1e9, 1.5, 3.0]] },
  mount: { label: '센서 설치 상태', type: 'sel', opts: [['std', '표준 설치', 0.5, 1.5], ['struct', '구조물 영향 가능', 1.5, 2.5]] },
  sensor: { label: '센서 종류', type: 'sel', opts: [['class', '라이다(검증됨)·IEC 등급 풍속계', 0.5, 1.5], ['other', '기타', 1.5, 3.0]] },
  rix: { label: '지형', type: 'sel', opts: [['sea', '해상 (지형 영향 없음)', 0.3, 0.9], ['coast', '해안·완만한 지형', 0.8, 1.6], ['complex', '복잡 지형', 2.0, 5.0]] },
  dist: { label: '측정기-터빈 평균 거리', type: 'num', unit: 'km', bins: [['2 km 미만', -1e9, 2, 0.5, 1.5], ['2~5 km', 2, 5, 1.5, 2.5], ['5~10 km', 5, 10, 2.6, 3.8], ['10 km 이상', 10, 1e9, 3.8, 6.0]] },
  coord: { label: '좌표 근거', type: 'sel', opts: [['survey', '측량 좌표', 0.5, 1.0], ['design', '보고서·설계 좌표', 1.5, 2.5], ['rough', '개략 위치', 3.0, 4.0]] },
  landuse: { label: '측정기 주변', type: 'sel', opts: [['open', '먼 바다 (해안 영향 없음)', 0.5, 1.5], ['coast', '해안 가까운 측정', 2.5, 3.5], ['land', '육상', 1.5, 3.0]] },
  parkEff: { label: '후류 손실 비례', type: 'ratio', of: 'wake', lo: 15, hi: 20 },
  layout: { label: '배치 확정 여부', type: 'sel', opts: [['fixed', '확정 배치', 0.5, 1.5], ['prelim', '예비 배치 (변경 가능)', 1.5, 3.0]] },
  pcurve: { label: '출력곡선 종류', type: 'sel', opts: [['measured', '실측 인증 곡선', 2.0, 4.0], ['warranted', '보증 곡선', 3.5, 5.5], ['calc', '계산 곡선', 5.5, 7.5]] },
  turb: { label: '현장 난류강도', type: 'sel', opts: [['low', '낮음 (해상, TI 0.08 미만)', 0.5, 1.5], ['mid', '보통 (TI 0.08~0.12)', 1.0, 2.0], ['high', '높음 (TI 0.12 이상)', 2.0, 3.0]] },
  losses: { label: '후류 제외 손실 비례', type: 'ratio', of: 'other', lo: 20, hi: 32 },
  // IEC·MEASNET에만 있는 항목
  wdir: { label: '풍향 측정', type: 'sel', opts: [['ok', '풍향 센서·라이다 방위 확인됨', 0.2, 0.6], ['unk', '방위 보정 불확실', 0.6, 1.5]] },
  atmo: { label: '기온·기압 자료', type: 'sel', opts: [['meas', '현장 기온·기압 측정', 0.1, 0.3], ['est', '추정값 (표준기압 등)', 0.3, 0.8]] },
  dataq: { label: '자료 회수율', type: 'num', unit: '%', bins: [['95% 이상', 95, 1e9, 0.1, 0.3], ['85~95%', 85, 95, 0.3, 0.8], ['85% 미만', -1e9, 85, 0.8, 1.5]] },
  iav: { label: '미래 연간 변동 (평가 기간)', type: 'sel', opts: [['life', '운영기간 장기 평균 (P50 장기값)', 1.0, 1.6], ['y10', '10년 평균', 1.6, 2.2], ['y1', '1년', 5.0, 7.0]] },
  climate: { label: '기후 변화', type: 'sel', opts: [['std', '일반 (뚜렷한 추세 없음)', 0.5, 1.5], ['trend', '장기 추세 의심', 1.5, 3.0]] },
  vfit: { label: '수직 외삽 모델', type: 'sel', opts: [['in', '허브가 측정 범위 안 (외삽 없음)', 0, 0], ['shear', '시어 모델 외삽', 0.5, 1.5], ['complex', '복잡 지형·안정도 영향', 1.5, 3.0]] },
  wakeExt: { label: '주변 단지·장래 후류', type: 'sel', opts: [['none', '주변 단지 없음', 0, 0.5], ['near', '주변 단지 있음·계획', 1.0, 2.0]] },
  lossElec: { label: '전기 손실 비례', type: 'ratio', of: 'cat:전기', lo: 20, hi: 32 },
  lossAvail: { label: '가용률 손실 비례', type: 'ratio', of: 'cat:가용률', lo: 20, hi: 32 },
  lossEnv: { label: '환경 손실 비례', type: 'ratio', of: 'cat:환경', lo: 20, hi: 32 },
  lossCurt: { label: '출력·운전 제한 손실 비례', type: 'ratio', of: 'cat:출력 제한,운전 제한', lo: 20, hi: 32 }
};
// 자료가 없을 때 쓰는 기본 구간 번호 (보수적인 쪽)
const UNC_COND_NODATA = { meas: 1, overlap: 1, ltReg: 1, ltYears: 1, hubdiff: 1, dist: 2, dataq: 1 };
const uncCondCfg = () => { if (!P.uncCond) P.uncCond = {}; for (const k in UNC_COND_DEFAULT) if (!P.uncCond[k]) P.uncCond[k] = JSON.parse(JSON.stringify(UNC_COND_DEFAULT[k])); return P.uncCond; };
// 행 → 조건 (그룹 기호까지 보고 판단)
function condIdForRow(u, grp) {
  const L = u.label || '';
  if (u.code) return /^손실$|^losses?,? uloss|^losses$/i.test(L) ? 'losses' : null;
  const T = [
    ['meas', /^측정 기간$|duration of (the )?measurement/i], ['overlap', /^장기 참조 자료 월수|monthly data|^측정 기간 대표성/i], ['ltRef', /^장기 자료 평가|evaluation of lt|evaluation of long|^참조 자료 (장기 )?일관성/i],
    ['ltReg', /회귀|regression|^장기 보정 방법|상관 관계/i], ['ltYears', /^장기 자료 사용 연수|number of years|^장기 기간 (길이|대표성)/i], ['calib', /^센서 교정|calibration|^장비 교정|^풍속 측정$/i],
    ['hubdiff', /^측정높이와 허브높이|measurement height|^시어 모델/i], ['mount', /^센서 설치|attachment|mounting|^장착/i], ['sensor', /^센서 종류|sensor type|^장비 특성/i],
    ['rix', /^rix|^유동 모델/i], ['dist', /풍상|windward|leeward|측정기-터빈/i], ['coord', /^좌표 정확도|coordinate/i], ['landuse', /토지이용|land use/i],
    ['parkEff', /^단지 효율$|^park efficiency$|^후류\(단지 내부\)|^후류 모델/i], ['layout', /^단지 배치|park configuration/i], ['pcurve', /^출력곡선|performance curve|power curve|터빈 성능\(출력곡선\)/i],
    ['turb', /^난류 조건|turbulence|공기밀도·난류/i], ['losses', /^기타 손실/i],
    ['wdir', /^풍향 측정/], ['atmo', /^기타 대기 변수/], ['dataq', /^자료 품질|^자료 취득/], ['iav', /^연간 변동/], ['climate', /^기후 변화/], ['wakeExt', /^후류\(주변/],
    ['lossElec', /^전기 손실$/], ['lossAvail', /^가용률$/], ['lossEnv', /^환경 손실$/], ['lossCurt', /^출력 제한$/]];
  if (grp === 'D' && /^모델 입력$/.test(L)) return 'hubdiff';
  if (grp === 'D' && /^모델 (적용 범위|적합성)/.test(L)) return 'vfit';
  if (grp === 'E' && /^모델 입력$/.test(L)) return 'coord';
  if (grp === 'E' && /^모델 적용 범위/.test(L)) return 'dist';
  if (grp === 'E' && /^모델 적합성/.test(L)) return 'rix';
  const hit = T.find(([, re]) => re.test(L)); return hit ? hit[0] : null;
}
// 측정 기간 (시작일·종료일·개월): 지점에 직접 입력 → 보고서 문장 → 시계열 → Windographer
const kDate = ms => { if (!Number.isFinite(ms)) return ''; const d = new Date(ms); return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`; };
const parseYmd = t => { const m = String(t || '').match(/(\d{4}|\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/) || String(t || '').match(/^\s*(\d{4})(\d{2})(\d{2})\s*$/); if (!m) return NaN; const y = m[1].length === 2 ? 2000 + +m[1] : +m[1]; return Date.UTC(y, m[2] - 1, +m[3]); };
const MONTH_MS = 86400000 * 30.4375;
function siteMeasAuto(S) {
  const ds = S.design ? S.datasets.find(d => d.id === S.design.dsId) : null;
  for (const d of [ds, ...S.datasets].filter(Boolean)) {
    if (d.type === 'ts' && d.ser && d.ser.ts.length) { const ws = d.ser.columns.map((c, j) => c.role === 'ws' ? j : -1).filter(j => j >= 0); let best = 0; for (const j of ws) { let n = 0; const a = d.ser.data[j]; for (let i = 0; i < a.length; i++) if (a[i] >= 0) n++; best = Math.max(best, n); } if (best) return { months: best * d.ser.step / MONTH_MS, from: d.ser.ts[0], to: d.ser.ts[d.ser.ts.length - 1], src: `${d.name} 유효 자료 ${fi(best)}개`, kind: '시계열' }; }
    if (d.type === 'wg' && d.reports && d.reports.length) { const r = d.reports[d.reports.length - 1]; const first = d.reports.reduce((m, q) => Math.min(m, q.startTs || Infinity), Infinity); const n = Math.max(...r.sensors.map(x => x.valid || 0)); if (n) return { months: n * 600000 / MONTH_MS, from: Number.isFinite(first) ? first : r.startTs, to: r.endTs, src: `${SRCNAME(r.file)} 유효 자료 ${fi(n)}개(10분)`, kind: 'Windographer' }; }
  }
  return null;
}
// 끝 시각이 자정(00:00)이면 그 전날까지 측정한 것(예: 10월 1일 00:00 = 9월 30일까지)
const endDay = ms => Number.isFinite(ms) && ms % 86400000 === 0 ? ms - 86400000 : ms;
function measInfoAuto(F, S) {
  if (F.meas && F.meas.months > 0) { let fr = F.meas.from, to = F.meas.to; if (!Number.isFinite(fr)) { const ds = [...String(F.meas.src || '').matchAll(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/g)].map(m => Date.UTC(+m[1], m[2] - 1, +m[3])); if (ds.length >= 2) { fr = ds[0]; to = ds[1]; } } return { months: F.meas.months, from: fr, to, src: F.meas.src, kind: '보고서' }; }
  const a = S ? siteMeasAuto(S) : null; return a ? { ...a, to: endDay(a.to) } : null;
}
function measInfo(F) {
  const S = P.sites.find(s => s.id === F.siteId);
  const a = measInfoAuto(F, S);
  const f0 = S ? parseYmd(S.measFrom) : NaN, t0 = S ? parseYmd(S.measTo) : NaN;
  if (!Number.isFinite(f0) && !Number.isFinite(t0)) return a;
  // 직접 입력한 날짜가 우선(한쪽만 넣어도 그쪽은 직접 입력값)
  const from = Number.isFinite(f0) ? f0 : a && a.from, to = Number.isFinite(t0) ? t0 : a && a.to;
  if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) return a;
  const both = Number.isFinite(f0) && Number.isFinite(t0);
  return { months: (to + 86400000 - from) / MONTH_MS, from, to, src: both ? '지점 정보 직접 입력' : `지점 정보 직접 입력 + ${a ? a.kind : ''}`, kind: '직접 입력' };
}
const measDates = mi => mi ? (Number.isFinite(mi.from) && Number.isFinite(mi.to) ? `${kDate(mi.from)}부터 ${kDate(mi.to)}까지` : `약 ${f(mi.months, 1)}개월`) : '';
const measText = mi => mi ? (Number.isFinite(mi.from) && Number.isFinite(mi.to) ? `${kDate(mi.from)}부터 ${kDate(mi.to)}까지 (약 ${f(mi.months, 1)}개월)` : `약 ${f(mi.months, 1)}개월`) : '';
function ltInfo(F) { if (F.lt) return { ...F.lt, src: F.ltSrc || '보고서' }; const S = P.sites.find(s => s.id === F.siteId); const d = S && S.datasets.find(x => x.lt); return d ? { ...d.lt, src: SRCNAME(d.source || d.name) } : {}; }
// 측정기가 해안(등대·섬·육상)에 있는지: 보고서 문장 → 지점 이름·메모 → 설치 표고(해발 3 m 넘으면 육상 설치로 봄)
function coastalMast(F, lt) {
  if (lt && lt.coastal) return { coast: true, why: '보고서: 등대·섬·해안 측정' };
  const S = P.sites.find(s => s.id === F.siteId) || {}; const txt = [S.name, S.note, ...(S.datasets || []).map(d => d.name)].join(' ');
  if (/등대|lighthouse|섬|island|해안|coast|항구|harbou?r|port|방파제|breakwater/i.test(txt)) return { coast: true, why: `지점 정보에 해안 단서 ("${(txt.match(/등대|lighthouse|섬|island|해안|coast|항구|harbou?r|port|방파제|breakwater/i) || [''])[0]}")` };
  if (Number(S.elev) > 3) return { coast: true, why: `측정기 설치 표고 ${S.elev} m — 육상(해안) 설치로 판단` };
  return { coast: false, why: '' };
}
// 조건별 자료 값(자동)
function condAuto(id, F, ctx) {
  const S = P.sites.find(s => s.id === F.siteId) || {}; const lt = ltInfo(F); const R = ctx.R;
  switch (id) {
    case 'meas': case 'overlap': { const m = measInfo(F); return m ? { x: m.months, src: `${measText(m)} · ${m.kind}` } : null; }
    case 'ltReg': return Number.isFinite(lt.r) ? { x: lt.r, src: `r ${lt.r} · ${lt.src}` } : null;
    case 'ltYears': return Number.isFinite(lt.years) ? { x: lt.years, src: `${f(lt.years, 1)}년 (${lt.yearsText || ''}) · ${lt.src}` } : null;
    case 'ltRef': return lt.refType ? { opt: lt.refType, src: `보고서에 재분석·관측 자료 언급 · ${lt.src}` } : null;
    case 'calib': return lt.verification ? { opt: 'yes', src: '보고서에 검증 보고서 언급' } : { opt: 'yes', src: '가정 — 라이다 검증 보고서 확인 필요' };
    case 'hubdiff': { if (!R) return null; const elev = +S.elev || 0; let top = S.design ? S.design.z : -1e9; for (const d of S.datasets || []) { if (d.type === 'ts' && d.ser) top = Math.max(top, Math.max(...W.seriesHeights(d.ser)) + elev); if (d.type === 'wg' && d.reports) top = Math.max(top, Math.max(...d.reports[d.reports.length - 1].sensors.map(x => x.height)) + elev); } return Number.isFinite(top) && top > -1e8 ? { x: R.c.t.hub - top, src: `허브 ${f(R.c.t.hub, 1)} m − 최고 측정·대표 높이 ${f(top, 1)} m (해발)` } : null; }
    case 'mount': return { opt: 'std', src: '기본값' };
    case 'sensor': return { opt: 'class', src: '기본값' };
    case 'rix': { const cm = coastalMast(F, lt); return cm.coast ? { opt: 'coast', src: cm.why } : lt.offshore ? { opt: 'sea', src: '보고서: 해상' } : { opt: 'sea', src: '기본값' }; }
    case 'dist': { if (!R || F.crs !== 'utm' || !siteCoord(S)) return null; const u = W.latLonToUtm(+S.lat, +S.lon, F.zone || 52); const d = F.rows.reduce((a, r) => a + Math.hypot(r.x - u.E, r.y - u.N), 0) / F.rows.length / 1000; return { x: d, src: `측정기(${esc(siteName(S))})에서 터빈까지 평균 ${f(d, 1)} km` }; }
    case 'coord': return { opt: /pdf|dxf|붙여넣기|보고서/i.test(F.source || '') || F.rows.length ? 'design' : 'rough', src: F.source ? '보고서·도면 좌표' : '기본값' };
    case 'landuse': { const cm = coastalMast(F, lt); return cm.coast ? { opt: 'coast', src: cm.why } : { opt: 'open', src: '기본값' }; }
    case 'layout': return { opt: F.rep ? 'fixed' : 'prelim', src: F.rep ? '평가 보고서 배치' : '기본값' };
    case 'pcurve': { const T = R && R.T; return { opt: (T && T.curveType) || 'calc', src: T && T.curveType ? `터빈 "${T.name}" 곡선 종류` : '곡선 종류 미입력 — 계산 곡선으로 가정' }; }
    case 'turb': return { opt: lt.offshore || lt.coastal ? 'low' : 'mid', src: lt.offshore || lt.coastal ? '해상 일반값(가정)' : '기본값' };
    case 'parkEff': return R ? { x: 100 * R.wake, src: `후류 손실 ${f(100 * R.wake, 2)}%` } : null;
    case 'wdir': return { opt: 'ok', src: '기본값' };
    case 'atmo': { const has = (S.datasets || []).some(d => d.type === 'ts' && d.ser && d.ser.columns.some(c => c.role === 'temp')) && (S.datasets || []).some(d => d.type === 'ts' && d.ser && d.ser.columns.some(c => c.role === 'press')); return has ? { opt: 'meas', src: '시계열에 기온·기압 있음' } : { opt: 'est', src: '현장 기압 자료 없음' }; }
    case 'dataq': { for (const d of S.datasets || []) if (d.type === 'ts' && d.ser && d.ser.ts.length) { let best = 0; d.ser.columns.forEach((c, j) => { if (c.role !== 'ws') return; let n = 0; const a = d.ser.data[j]; for (let i = 0; i < a.length; i++) if (a[i] >= 0) n++; best = Math.max(best, n); }); if (best) { const x = 100 * best / d.ser.ts.length; return { x, src: `${d.name} 풍속 회수율 ${f(x, 1)}%` }; } } return { x: 95, src: '시계열 없음 — 95% 이상으로 가정' }; }
    case 'iav': return { opt: 'life', src: 'P50 장기값 기준' };
    case 'climate': return { opt: 'std', src: '기본값' };
    case 'vfit': { const h = condAuto('hubdiff', F, ctx); return h && Number.isFinite(h.x) ? (h.x <= 0.5 ? { opt: 'in', src: h.src } : { opt: 'shear', src: h.src }) : { opt: 'shear', src: '기본값' }; }
    case 'wakeExt': return (F.ext || []).length ? { opt: 'near', src: `주변 단지 ${F.ext.length}개 입력됨` } : { opt: 'none', src: '기본값 — 주변 단지 있으면 바꿔 주세요' };
    case 'lossElec': case 'lossAvail': case 'lossEnv': case 'lossCurt': { const c = uncCondCfg()[id]; const cats = c.of.slice(4).split(','); const v = W.totalLoss(cats.map(k => (ctx.cat || {})[k] || 0)); return ctx.cat ? { x: 100 * v, src: `${cats.join('·')} 손실 ${f(100 * v, 2)}%` } : null; }
    case 'losses': return Number.isFinite(ctx.other) ? { x: 100 * ctx.other, src: `후류 제외 손실 ${f(100 * ctx.other, 2)}%` } : null;
  }
  return null;
}
// 조건 결정 → {label, lo, hi, mid, src, choice, choices}
function condResolve(id, F, ctx) {
  const c = uncCondCfg()[id]; if (!c) return null; const a = condAuto(id, F, ctx) || {}; const sel = (F.uncSel || {})[id];
  if (c.type === 'ratio') { if (!Number.isFinite(a.x)) return null; return { id, label: `${a.src.replace(/ 손실 /, ' ')} × ${c.lo}~${c.hi}%`, lo: a.x * c.lo / 100, hi: a.x * c.hi / 100, mid: a.x * (c.lo + c.hi) / 200, src: a.src, ratio: true }; }
  if (c.type === 'num') {
    let i = sel != null && sel !== 'auto' ? +sel : (Number.isFinite(a.x) ? c.bins.findIndex(b => a.x >= b[1] && a.x < b[2]) : -1);
    if (i < 0) { const di = Math.min(UNC_COND_NODATA[id] ?? 1, c.bins.length - 1); const b = c.bins[di]; return { id, label: b[0], lo: b[3], hi: b[4], mid: (b[3] + b[4]) / 2, src: '자료 없음 — 기본 조건(가정)', choices: c.bins.map(x => x[0]), choice: 'auto', autoTxt: `자동: 자료 없음 → ${b[0]} (가정)` }; }
    const b = c.bins[i]; return { id, label: b[0], lo: b[3], hi: b[4], mid: (b[3] + b[4]) / 2, src: sel != null && sel !== 'auto' ? '직접 선택' : a.src, choices: c.bins.map(b => b[0]), choice: sel != null ? String(sel) : 'auto', autoTxt: Number.isFinite(a.x) ? `자동: ${a.src}` : '' };
  }
  const key = sel != null && sel !== 'auto' ? sel : a.opt; const o = c.opts.find(x => x[0] === key) || c.opts[0];
  return { id, label: o[1], lo: o[2], hi: o[3], mid: (o[2] + o[3]) / 2, src: sel != null && sel !== 'auto' ? '직접 선택' : (a.src || '기본값'), choices: c.opts.map(x => x[1]), choiceKeys: c.opts.map(x => x[0]), choice: sel != null ? sel : 'auto', autoTxt: `자동: ${(c.opts.find(x => x[0] === a.opt) || c.opts[0])[1]} (${a.src || '기본값'})` };
}
// 계산용 행: 비어 있는 항목은 조건 중간값
function uncRowsEff(F, ctx) {
  let grp = ''; const conds = [];
  const rows = F.unc.map((u, i) => {
    if (/^[A-H]$/.test(u.code || '')) grp = u.code;
    const hasItems = u.code && F.unc[i + 1] && !F.unc[i + 1].code;
    const id = (!u.code || !hasItems) ? condIdForRow(u, grp) : null;
    const cr = id ? condResolve(id, F, ctx || {}) : null; conds[i] = cr;
    return !Number.isFinite(u.value) && cr && Number.isFinite(cr.mid) ? { ...u, value: cr.mid, auto: true } : u;
  });
  return { rows, conds };
}
function uncCalc(F, ctx) {
  const rows = uncRowsEff(F, ctx).rows, n = rows.length, val = new Array(n).fill(NaN);
  const isTop = c => /^[A-H]$/.test(c || ''), isSub = c => /^[A-H]\.\d+$/.test(c || '');
  const rss = a => a.length ? Math.sqrt(a.reduce((s, v) => s + v * v, 0)) : NaN;
  // 하위 묶음: 바로 아래 항목들
  for (let i = 0; i < n; i++) if (isSub(rows[i].code)) { const it = []; for (let j = i + 1; j < n && !rows[j].code; j++) if (Number.isFinite(rows[j].value)) it.push(rows[j].value); val[i] = it.length ? rss(it) : rows[i].value; }
  // 상위 묶음: 바로 아래 항목 + 하위 묶음
  for (let i = 0; i < n; i++) if (isTop(rows[i].code)) {
    const it = []; let inSub = false;
    for (let j = i + 1; j < n && !isTop(rows[j].code); j++) { if (isSub(rows[j].code)) { inSub = true; if (Number.isFinite(val[j])) it.push(val[j]); } else if (!rows[j].code && !inSub && Number.isFinite(rows[j].value)) it.push(rows[j].value); }
    val[i] = it.length ? rss(it) : rows[i].value;
  }
  const tops = rows.map((r, i) => isTop(r.code) ? val[i] : NaN).filter(Number.isFinite);
  const empty = rows.filter((r, i) => isTop(r.code) && !Number.isFinite(val[i])).map(r => `${r.code} ${r.label}`);
  return { val, total: tops.length ? rss(tops) : 0, empty };
}
function aepCalc(F) {
  const R = farmCalc(F); if (!R) return null;
  const items = []; for (const [cat, list] of LOSS_TEMPLATE) for (const [key, label] of list) { const given = Number.isFinite(F.losses[key]); const cr = lossResolve(key, F, R); items.push({ cat, key, label, input: given ? F.losses[key] : NaN, cond: cr, auto: !given && cr && Number.isFinite(cr.mid), value: given ? F.losses[key] : (cr && Number.isFinite(cr.mid) ? cr.mid : NaN) }); }
  if (R.curt > 0) { const at = items.findIndex(x => x.key === 'gridlim') + 1; items.splice(at, 0, { cat: '운전 제한', key: 'gridcap', label: '단지 출력 상한 (계통연계 용량)', input: NaN, cond: null, auto: false, calc: `계산값: 단지 합계 출력이 ${f(R.permit.gridMW, 1)} MW를 넘는 순간만 잘림`, value: R.curtPct }); }
  const other = items.map(x => Number.isFinite(x.value) ? x.value : 0);
  const total = W.totalLoss([100 * R.wake, ...other]);
  const net = R.G * (1 - total);
  const cat = {}; for (const [c] of LOSS_TEMPLATE) cat[c] = W.totalLoss(items.filter(x => x.cat === c).map(x => Number.isFinite(x.value) ? x.value : 0)) * 100;
  const ctx = { R, other: W.totalLoss(other), cat }; const U = uncCalc(F, ctx); const uc = U.total / 100;
  const hours = R.c.t.hours;
  const pv = Object.entries(W.PZ).filter(([p]) => +p >= 50 && +p <= 95).map(([p, z]) => ({ p: +p, mwh: net * (1 - z * uc), cf: net * (1 - z * uc) / (R.capMW * hours) }));
  return { R, items, total, net, U, uc, pv, ctx, cf: net / (R.capMW * hours), otherOnly: W.totalLoss(other) };
}
function viewAep() {
  if (!P.farms || !P.farms.length) return `<div class="card empty">먼저 4단계(배치·후류)에서 단지를 만들어 주세요.</div>`;
  const F = farmSel(); ui.farmSel = F.id;
  let h = `<div class="card"><h2>단지 선택</h2><div class="dslist" style="margin-top:0">${P.farms.map(x => `<div class="ds ${x.id === F.id ? 'on' : ''}" data-act="fsel" data-id="${x.id}"><div class="t"><span class="tag wg">단지</span><span>${esc(x.name)}</span></div><div class="m">${x.rows.length}기</div></div>`).join('')}</div></div>`;
  const A = aepCalc(F);
  if (!A) return h + `<div class="card"><div class="warnbox"><div>후류 계산을 할 수 없습니다. 4단계에서 지점(대표 풍황)과 배치를 확인해 주세요.</div></div></div>`;
  const rep = F.rep || {}, R = A.R;
  const cmp = (v, r, pct) => Number.isFinite(r) ? `<span class="hint"> · 보고서 ${pct ? f(r, 2) + '%' : fi(r)} (${pct ? (v - r >= 0 ? '+' : '') + f(v - r, 2) + '%p' : (v / r - 1 >= 0 ? '+' : '') + f(100 * (v / r - 1), 1) + '%'})</span>` : '';
  h += `<div class="card design"><h2>${esc(F.name)} — 연간 순발전량 <span class="sub">${F.rows.length}기 · ${f(R.capMW, 1)} MW · ${esc(R.c.T.name)}</span></h2>
   <div class="big"><div><b>${fi(R.G)}</b><span>총발전량 MWh/년${cmp(R.G, rep.gross)}</span></div><div><b>${f(100 * A.total, 2)}</b><span>총손실 %${cmp(100 * A.total, rep.total, 1)}</span></div><div><b>${fi(A.net)}</b><span>순발전량 P50 MWh/년${cmp(A.net, rep.p50)}</span></div><div><b>${f(100 * A.cf, 2)}</b><span>이용률 P50 %</span></div><div><b>${f(A.U.total, 2)}</b><span>결합 불확도 %${cmp(A.U.total, rep.uc, 1)}</span></div><div><b>${fi(A.pv.find(x => x.p === 90).mwh)}</b><span>P90 MWh/년${cmp(A.pv.find(x => x.p === 90).mwh, rep.p90)}</span></div></div>
   ${A.U.empty.length ? `<div class="warnbox"><div>불확도 묶음 ${A.U.empty.length}개가 비어 있어(${esc(A.U.empty.join(', '))}) 결합 불확도와 P75·P90이 실제보다 유리하게 나옵니다.</div></div>` : ''}
   ${rep.file ? `<div class="hint">보고서 값: ${esc(rep.file)}. 총발전량 차이는 풍속 분포(Weibull 근사)와 출력곡선 기준 밀도 가정 때문이고, 손실·불확도·P값 계산 방식은 보고서와 같습니다.</div>` : ''}</div>`;
  // 손실
  h += `<div class="card"><h2>손실 <span class="sub">항목별로 곱해서 합칩니다: 1 − Π(1 − 손실)</span></h2><div class="grid2" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)"><div><div class="tw" style="max-height:none"><table class="t"><tr><th>분류</th><th>항목</th><th>손실 %</th><th>출처</th></tr>
   <tr class="hub"><td class="txt">단지 효율</td><td class="txt">후류 손실 (4단계 계산)</td><td>${f(100 * R.wake, 2)}</td><td class="txt">${Number.isFinite(rep.wake) ? `<span class="hint">보고서 ${f(rep.wake, 2)}%</span>` : ''}</td></tr>`;
  let lastCat = '';
  A.items.forEach(x => { h += `<tr><td class="txt">${x.cat !== lastCat ? esc(x.cat) : ''}</td><td class="txt">${esc(x.label)}${x.cond ? `<div class="hint">조건 <select data-lcs="${x.key}" style="font-size:11px;max-width:230px"><option value="auto" ${x.cond.choice === 'auto' ? 'selected' : ''}>${esc(x.cond.autoTxt)}</option>${x.cond.choices.map((c, ci) => `<option value="${esc(x.cond.choiceKeys[ci])}" ${x.cond.choice === x.cond.choiceKeys[ci] ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select> ${f(x.cond.lo, 2)}~${f(x.cond.hi, 2)}% → 중간값 <b>${f(x.cond.mid, 2)}%</b>${Number.isFinite(x.input) && Math.abs(x.input - x.cond.mid) > 0.005 ? ` · <span style="color:#a4500f">입력값 ${x.input}% 사용 중</span>` : ''}</div>` : ''}</td><td><input data-loss="${x.key}" value="${Number.isFinite(x.input) ? x.input : ''}" placeholder="${x.cond ? f(x.cond.mid, 2) : x.calc ? f(x.value, 2) : '0'}" ${x.calc ? 'disabled' : ''}>${x.calc ? `<div class="hint">${esc(x.calc)}</div>` : ''}</td><td class="txt">${x.calc ? '<span class="hint">4 배치·후류 계산값</span>' : F.lossSrc[x.key] ? `<span class="srcl" style="max-width:200px" title="${esc(F.lossSrc[x.key])}">${esc(F.lossSrc[x.key])}</span>` : (Number.isFinite(x.input) ? '<span class="hint">직접 입력</span>' : (x.auto ? `<span class="srcl" style="max-width:200px" title="${esc(x.cond.src)}">조건 중간값 · ${esc(x.cond.src)}</span>` : '<span class="tag blank">비어 있음 — 0%</span>'))}</td></tr>`; lastCat = x.cat; });
  h += `<tr class="sum"><td class="txt">합계</td><td class="txt">후류 제외 ${f(100 * A.otherOnly, 2)}%</td><td>${f(100 * A.total, 2)}</td><td class="txt">${Number.isFinite(rep.total) ? `<span class="hint">보고서 ${f(rep.total, 2)}%</span>` : ''}</td></tr></table></div>
   <details style="margin-top:8px"><summary>손실 조건표 (임시 기준 — 고칠 수 있음)</summary>
   <div class="hint" style="margin:4px 0">해상풍력 일반 범위를 평가 보고서 사례에 맞춰 잡은 임시 기준입니다. 칸이 비어 있으면 조건 범위의 중간값을 쓰고, 값을 넣으면 그 값을 씁니다(보고서 값이 있으면 보고서 값 우선). 계약·설계 자료가 생기면 그 값을 넣어 주세요.</div>
   <div class="tw" style="max-height:360px"><table class="t"><tr><th>항목</th><th>조건</th><th>최소 %</th><th>최대 %</th><th>중간값 %</th></tr>${LOSS_TEMPLATE.flatMap(([, list]) => list).map(([key, label]) => { const c = lossCondCfg()[key]; if (!c) return ''; const list = c.type === 'num' ? c.bins.map(b => [b[0], b[3], b[4]]) : c.opts.map(o => [o[1], o[2], o[3]]); return list.map((x, k) => `<tr><td class="txt">${k === 0 ? esc(label) : ''}</td><td class="txt">${esc(x[0])}</td><td><input data-lc="${key}" data-i="${k}" data-k="lo" value="${x[1]}"></td><td><input data-lc="${key}" data-i="${k}" data-k="hi" value="${x[2]}"></td><td>${f((x[1] + x[2]) / 2, 2)}</td></tr>`).join(''); }).join('')}</table></div>
   <div class="row" style="margin-top:6px"><button class="btn sm" data-act="lcreset">손실 조건표 기본값으로</button></div></details></div>
   <div>${chartBars(['후류', ...LOSS_TEMPLATE.map(c => c[0])], [100 * R.wake, ...LOSS_TEMPLATE.map(([cat]) => 100 * W.totalLoss(A.items.filter(x => x.cat === cat).map(x => Number.isFinite(x.value) ? x.value : 0)))], '분류별 손실', '손실 (%)', (i, v) => `${['후류', ...LOSS_TEMPLATE.map(c => c[0])][i]}: ${f(v, 2)}%`)}</div></div></div>`;
  // 불확도
  h += `<div class="card"><h2>불확도 <span class="sub">항목 → 묶음 → 전체를 제곱합의 제곱근으로 합칩니다</span></h2>
   <div class="row" style="margin-bottom:8px;align-items:flex-end"><div class="fld"><label>항목 틀</label><select id="uncFrame" style="width:260px">${F.uncReport ? `<option value="report" ${F.uncFrame === 'report' ? 'selected' : ''}>보고서 항목 (${esc(F.uncSrc)})</option>` : ''}${Object.entries(UNC_FRAMES).map(([k, v]) => `<option value="${k}" ${F.uncFrame === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
   <div class="hint" style="flex:1;min-width:260px">${F.uncFrame === 'report' ? '평가 보고서의 항목과 값을 그대로 씁니다.' : esc((UNC_FRAMES[F.uncFrame || 'tr6'] || UNC_FRAMES.tr6).note) + ' 값은 평가 기관 판단이 들어가는 부분이라 근거 자료로 채워 주세요.'} 틀은 항목을 빠짐없이 따지기 위한 구성이고, 틀을 바꾼다고 불확도가 정당하게 줄지는 않습니다.</div></div><div class="grid2" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)"><div><div class="tw" style="max-height:none"><table class="t"><tr><th>기호</th><th>항목</th><th>입력 %</th><th>계산 %</th>${F.unc.some(u => u.range) ? '<th>TR6 범위</th>' : ''}<th>출처</th><th></th></tr>`;
  const showR = F.unc.some(u => u.range); const outR = []; const UE = uncRowsEff(F, A.ctx);
  F.unc.forEach((u, i) => { const grp = !!u.code; const cv = grp ? A.U.val[i] : NaN; const bad = u.range && Number.isFinite(cv) && (cv < u.range[0] - 1e-9 || cv > u.range[1] + 1e-9); if (bad) outR.push(`${u.code} ${f(cv, 2)}% (범위 ${u.range[0]}~${u.range[1]}%)`);
    const cr = UE.conds[i]; const crTxt = cr ? `<div class="hint">${cr.ratio ? '' : `조건 <select data-ucs="${cr.id}" style="font-size:11px;max-width:230px"><option value="auto" ${cr.choice === 'auto' ? 'selected' : ''}>${esc(cr.autoTxt || '자동')}</option>${(cr.choices || []).map((c, ci) => { const v = cr.choiceKeys ? cr.choiceKeys[ci] : String(ci); return `<option value="${esc(v)}" ${cr.choice === v ? 'selected' : ''}>${esc(c)}</option>`; }).join('')}</select> `}${cr.ratio ? esc(cr.label) + ' ' : `"${esc(cr.label)}" `}${Number.isFinite(cr.lo) ? `${f(cr.lo, 2)}~${f(cr.hi, 2)}% → 중간값 <b>${f(cr.mid, 2)}%</b>` : ''}${Number.isFinite(u.value) && Number.isFinite(cr.mid) && Math.abs(u.value - cr.mid) > 0.005 ? ` · <span style="color:#a4500f">입력값 ${u.value}% 사용 중</span>` : ''}</div>` : '';
    h += `<tr class="${/^[A-H]$/.test(u.code) ? 'hub' : ''}"><td>${esc(u.code)}</td><td class="txt" style="${grp ? 'font-weight:500' : 'padding-left:18px'}">${esc(u.label)}${crTxt}</td><td><input data-unc="${i}" value="${Number.isFinite(u.value) ? u.value : ''}" placeholder="${cr && Number.isFinite(cr.mid) ? f(cr.mid, 2) : ''}"></td><td class="${bad ? 'ng' : ''}">${grp ? f(cv, 2) : ''}</td>${showR ? `<td>${u.range ? u.range[0] + '~' + u.range[1] : ''}</td>` : ''}<td class="txt">${u.src ? `<span class="srcl" style="max-width:170px" title="${esc(u.src)}">${esc(u.src)}</span>` : (Number.isFinite(u.value) ? '' : (cr && Number.isFinite(cr.mid) ? `<span class="srcl" style="max-width:170px" title="${esc(cr.src || '')}">조건 중간값</span>` : (F.uncFrame === 'report' ? '' : '<span class="tag blank">비어 있음</span>')))}</td><td><span class="btn ghost sm" data-act="uncdel" data-i="${i}">×</span></td></tr>`; });
  h += `<tr class="sum"><td></td><td class="txt">결합 불확도</td><td></td><td>${f(A.U.total, 2)}</td>${showR ? '<td></td>' : ''}<td></td><td></td></tr></table></div>
   ${outR.length ? `<div class="warnbox"><div>TR6 범위를 벗어난 묶음: ${esc(outR.join(', '))}</div></div>` : ''}
   ${A.U.empty.length ? `<div class="warnbox"><div>비어 있는 묶음: ${esc(A.U.empty.join(', '))} — 0으로 계산되지 않도록 값을 채워 주세요.</div></div>` : ''}
   <div class="row" style="margin-top:6px"><button class="btn sm" data-act="uncadd">항목 추가</button></div>
   <details style="margin-top:8px"><summary>조건표 (임시 기준 — 고칠 수 있음)</summary>
   <div class="hint" style="margin:4px 0">공식 기준표가 아니라 평가 보고서 사례(TR6)에 맞춰 잡은 임시 범위입니다. 평가 기관·사내 기준표가 있으면 그 값으로 고쳐 주세요. 항목 칸이 비어 있으면 조건 범위의 중간값을 쓰고, 값을 넣으면 그 값을 씁니다(보고서 값이 있으면 보고서 값 우선).</div>
   <div class="tw" style="max-height:360px"><table class="t"><tr><th>조건</th><th>구간·선택지</th><th>최소 %</th><th>최대 %</th><th>중간값 %</th></tr>${Object.entries(uncCondCfg()).map(([id, c]) => { const list = c.type === 'num' ? c.bins.map(b => [b[0], b[3], b[4]]) : c.type === 'sel' ? c.opts.map(o => [o[1], o[2], o[3]]) : [[`${c.of === 'wake' ? '후류 손실' : '후류 제외 손실'} × 비율`, c.lo, c.hi]]; return list.map((x, k) => `<tr><td class="txt">${k === 0 ? esc(c.label) : ''}</td><td class="txt">${esc(x[0])}</td><td><input data-uc="${id}" data-i="${k}" data-k="lo" value="${x[1]}"></td><td><input data-uc="${id}" data-i="${k}" data-k="hi" value="${x[2]}"></td><td>${f((x[1] + x[2]) / 2, 2)}${c.type === 'ratio' ? ' (비율 %)' : ''}</td></tr>`).join(''); }).join('')}</table></div>
   <div class="row" style="margin-top:6px"><button class="btn sm" data-act="ucreset">조건표 기본값으로</button></div></details>
   <div class="hint" style="margin-top:6px">묶음(A, A.1 …) 아래에 항목이 있으면 항목 제곱합으로 계산하고, 없으면 묶음에 입력한 값을 씁니다.</div></div>
   <div><h4 style="margin-top:0">초과확률별 발전량</h4><table class="t"><tr><th>P값</th><th>발전량 MWh/년</th><th>이용률 %</th><th>보고서</th></tr>${A.pv.map(x => { const r = { 50: rep.p50, 75: rep.p75, 90: rep.p90 }[x.p]; return `<tr class="${[50, 75, 90].includes(x.p) ? 'hub' : ''}"><td>P${x.p}</td><td>${fi(x.mwh)}</td><td>${f(100 * x.cf, 2)}</td><td>${Number.isFinite(r) ? fi(r) : ''}</td></tr>`; }).join('')}</table>
   <div class="hint" style="margin-top:6px">P값 = P50 × (1 − z × 결합 불확도), 정규분포 z (P75 0.674, P90 1.282, P95 1.645).</div></div></div></div>`;
  return h;
}

/* ================= 이벤트 ================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) { if (e.target.closest('#drop')) $('#fileIn').click(); if (e.target.closest('#dropLayout')) $('#layoutIn').click(); if (e.target.closest('#dropZone')) $('#zoneIn').click(); if (e.target.closest('#dropMcp')) $('#mcpIn').click(); return; }
  const a = el.dataset.act, S = site();
  if (a === 'tab') { ui.tab = el.dataset.v; busy(() => { render(); window.scrollTo(0, 0); }); return; }
  if (a === 'fsel') { if (e.target.closest('.x')) return; ui.farmSel = el.dataset.id; busy(render); return; }
  if (a === 'fdel') { const F = P.farms.find(x => x.id === el.dataset.id); confirmBox(`"${F.name}" 단지를 삭제할까요?`, () => { P.farms = P.farms.filter(x => x.id !== F.id); ui.farmSel = null; render(); save(); }); return; }
  if (a === 'fpaste') { layoutPasteDialog(); return; }
  if (a === 'zsel') { if (e.target.closest('.x')) return; ui.zoneSel = el.dataset.id; render(); return; }
  if (a === 'zdel') { const Z = zoneById(el.dataset.id); confirmBox(`"${Z.name}" 구역을 삭제할까요? 이 구역을 쓰는 단지는 구역 없음으로 바뀝니다.`, () => { P.zones = P.zones.filter(z => z.id !== Z.id); (P.farms || []).forEach(F => { if (F.zoneId === Z.id) { F.zoneId = undefined; F._cache = null; } }); ui.zoneSel = null; render(); save(); }); return; }
  if (a === 'znew') { newZone(); render(); save(); return; }
  if (a === 'zpaste') { zonePasteDialog(el.dataset.v); return; }
  if (a === 'zidel') { const Z = zoneSel(); Z[el.dataset.t] = Z[el.dataset.t].filter(q => q.id !== el.dataset.id); (P.farms || []).forEach(F => F._cache = null); render(); save(); return; }
  if (a === 'fitUndo') { const F = farmSel(); F.noFit = true; busy(() => { farmFitPermit(F); render(); save(); }); return; }
  if (a === 'fitRedo') { const F = farmSel(); F.noFit = false; busy(() => { farmFitPermit(F); render(); save(); }); return; }
  if (a === 'fcmpRun') { const F = farmSel(); busy(() => { const hubMode = ui.fcmpHub || 'own'; const key = JSON.stringify([F.id, hubMode, F.permitMW, P.turbines.map(t => [t.id, t.hub, t.curve.length, t.rhoRef]), (farmCalc(F) || {}).key]); const list = P.turbines.map(T => { try { return farmWithTurb(F, T, hubMode); } catch (e) { console.warn(e); return null; } }).filter(Boolean); ui.fcmp = { fid: F.id, key, list }; render(); }); return; }
  if (a === 'fcmpMake') { const F = farmSel(), T = turbOf(el.dataset.id); const x = ui.fcmp && ui.fcmp.list.find(q => q.T.id === T.id); const nf = JSON.parse(JSON.stringify({ ...F, _cache: undefined })); nf.id = uid(); nf.name = `${F.name} — ${T.name.replace(/\s*\(추정\)/, '')}`; nf.tid = T.id; nf.hub = x ? x.hub : T.hub; if (x) { const all = [...nf.rows.filter(r => !r.added), ...(nf.parked || [])]; const keep = new Set(x.G.rows.map(r => r.name)); nf.rows = [...all.filter(r => keep.has(r.name)), ...x.G.rows.filter(r => r.added).map(r => { const q = { ...r }; if (nf.speed !== 'manual') delete q.scale; return q; })].sort((a, b) => (a._ord ?? 0) - (b._ord ?? 0)); nf.parked = all.filter(r => !keep.has(r.name)); nf.fitMsg = nf.parked.length ? { removed: nf.parked.map(r => r.name), n0: all.length, need: nf.rows.length } : (x.addedN || []).length ? { addedN: x.addedN, relaxed: x.relaxed, n0: all.length, need: nf.rows.length } : null; nf.noFit = false; } nf.rows.forEach(r => delete r.tid); P.farms.push(nf); ui.farmSel = nf.id; render(); save(); toast(`"${nf.name}" 단지를 만들었습니다.`); return; }
  if (a === 'fcopy') { const F = farmSel(); const nf = JSON.parse(JSON.stringify({ ...F, _cache: undefined })); nf.id = uid(); nf.name = F.name + ' (복제)'; P.farms.push(nf); ui.farmSel = nf.id; render(); save(); return; }
  if (a === 'extadd') { extPasteDialog(); return; }
  if (a === 'extdel') { const F = farmSel(); F.ext = F.ext.filter(g => g.id !== el.dataset.id); F._cache = null; busy(() => { render(); save(); }); return; }
  if (a === 'optim') { optimizeDialog(); return; }
  if (a === 'treqdl') { const T = turbOf(ui.turbSel); download(`${T.name.replace(/[\\/:*?"<>|]/g, '_')}_자료요청.txt`, new Blob(['\ufeff' + turbReqText(T).replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' })); return; }
  if (a === 'treqcopy') { const T = turbOf(ui.turbSel); const txt = turbReqText(T); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('요청 목록을 복사했습니다.'), () => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('요청 목록을 복사했습니다.'); } catch (e) { toast('복사하지 못했습니다.'); } ta.remove(); }); return; }
  if (a === 'drwdxf') { exportDxf(farmSel()); return; }
  if (a === 'drwpdf') { exportDrawingPdf(farmSel()); return; }
  if (a === 'zdxf') { exportDxf(null, zoneSel()); return; }
  if (a === 'zpdf') { exportDrawingPdf(null, zoneSel()); return; }
  if (a === 'stpick') { const S = site(); turbSet(S).station = el.dataset.v || undefined; (P.farms || []).forEach(F => F._cache = null); render(); save(); return; }
  if (a === 'layedit') { ui.layEdit = el.dataset.v; render(); return; }
  if (a === 'laycable') { ui.layCable = !ui.layCable; render(); return; }
  if (a === 'rphwpx') { exportHwpx(); return; }
  if (a === 'rppdf') { exportPdf(); return; }
  if (a === 'rpmake') { ui.rp = null; render(); return; }
  if (a === 'fradd') { const F = farmSel(); const l = F.rows[F.rows.length - 1] || { x: 0, y: 0 }; F.rows.push({ name: `T${String(F.rows.length + 1).padStart(2, '0')}`, x: l.x + 1000, y: l.y }); busy(() => { render(); save(); }); return; }
  if (a === 'frdel') { const F = farmSel(); F.rows.splice(+el.dataset.i, 1); busy(() => { render(); save(); }); return; }
  if (a === 'lcreset') { confirmBox('손실 조건표를 기본값으로 되돌릴까요?', () => { P.lossCond = null; render(); save(); }); return; }
  if (a === 'ucreset') { confirmBox('조건표를 기본값(임시 범위)으로 되돌릴까요?', () => { P.uncCond = null; render(); save(); }); return; }
  if (a === 'uncadd') { farmSel().unc.push({ code: '', label: '새 항목', value: NaN }); render(); save(); return; }
  if (a === 'uncdel') { farmSel().unc.splice(+el.dataset.i, 1); render(); save(); return; }

  if (a === 'tsel') { if (e.target.closest('.x')) return; ui.turbSel = el.dataset.id; render(); return; }
  if (a === 'tdel') { const T = turbOf(el.dataset.id); confirmBox(`"${T.name}" 터빈을 삭제할까요?`, () => { P.turbines = P.turbines.filter(t => t.id !== T.id); P.sites.forEach(s => { if (s.turb && s.turb.tid === T.id) s.turb.tid = null; }); ui.turbSel = null; render(); save(); }); return; }
  if (a === 'tpdf') { $('#turbPdf').click(); return; }
  if (a === 'tnew') { const T = { id: uid(), name: `새 터빈 ${P.turbines.length + 1}`, maker: '', model: '', ratedKW: NaN, rotor: NaN, hub: NaN, rhoRef: 1.225, regulation: 'pitch', source: '직접 입력', curve: [] }; P.turbines.push(T); ui.turbSel = T.id; render(); save(); curvePasteDialog(T); return; }
  if (a === 'zcoord') { const Z = zoneSel(); const it = Z && (el.dataset.t === 'bounds' ? Z.bounds : Z.excl).find(q => q.id === el.dataset.id); if (it) zoneCoordDialog(Z, it); return; }
  if (a === 'tfImp') { $('#turbJson').click(); return; }
  if (a === 'tfExp') { const T = turbOf(ui.turbSel); download(`터빈_${safeNm(T.name)}.json`, new Blob([turbFileText([T])], { type: 'application/json' })); return; }
  if (a === 'tfExpAll') { download(`터빈목록_${new Date().toISOString().slice(0, 10)}.json`, new Blob([turbFileText(P.turbines)], { type: 'application/json' })); return; }
  if (a === 'tdup') { const T = JSON.parse(JSON.stringify(turbOf(ui.turbSel))); T.id = uid(); T.name += ' (복제)'; P.turbines.push(T); ui.turbSel = T.id; render(); save(); return; }
  if (a === 'cvadd') { turbOf(ui.turbSel).curve.push([NaN, NaN, NaN]); render(); return; }
  if (a === 'cvdel') { turbOf(ui.turbSel).curve.splice(+el.dataset.i, 1); render(); save(); return; }
  if (a === 'cvpaste') { curvePasteDialog(turbOf(ui.turbSel)); return; }
  if (a === 'site') { P.active = el.dataset.id; autofillSite(site()); render(); save(); }
  else if (a === 'delSite') { if (P.sites.length > 1 && confirmBox(`"${siteName(S)}" 지점을 삭제할까요?`, () => { P.sites = P.sites.filter(s => s.id !== S.id); P.active = P.sites[0].id; render(); save(); })) { } }
  else if (a === 'selds') { if (e.target.closest('.x')) return; S.sel = el.dataset.id; render(); save(); }
  else if (a === 'delds') { const d = S.datasets.find(x => x.id === el.dataset.id); confirmBox(`"${d.name}" 자료를 삭제할까요?`, () => { S.datasets = S.datasets.filter(x => x.id !== d.id); if (S.sel === d.id) S.sel = S.datasets[0]?.id || null; if (S.design && S.design.dsId === d.id) S.design.note = (S.design.note || '') + ' (원본 자료 삭제됨)'; render(); save(); }); }
  else if (a === 'wgsel') { dsSel().sel = +el.dataset.i; render(); save(); }
  else if (a === 'wgh') { ui.wgHeight = +el.dataset.h; render(); }
  else if (a === 'rose') { ui.rose = el.dataset.v; render(); }
  else if (a === 'manual') { const D = { id: uid(), type: 'sec', name: '직접 입력', source: '', height: NaN, rows: Array.from({ length: 12 }, (_, i) => ({ dir: i * 30, freq: NaN, mean: NaN, k: NaN, A: NaN })) }; S.datasets.push(D); S.sel = D.id; render(); save(); }
  else if (a === 'secAdd') { const D = dsSel(); D.rows.push({ dir: NaN, freq: NaN, mean: NaN, k: NaN, A: NaN }); render(); }
  else if (a === 'secDel') { const D = dsSel(); D.rows.splice(+el.dataset.i, 1); render(); save(); }
  else if (a === 'secPaste') pasteDialog(dsSel());
  else if (a === 'secDesign') { const D = dsSel(), T = secTotals(D); const notes = []; if (T.overall) notes.push(`방향별 k·A가 없어 전체 Weibull(k ${D.wk}, A ${D.wA})을 모든 방향에 적용.`); if (!Number.isFinite(W.num(D.rho))) notes.push('공기밀도 입력이 없어 1.225 kg/m³(표준)로 넣었습니다.');
    setDesign({ dsId: D.id, src: `방향별 표: ${D.name}`, z: D.height, mean: T.mean, k: T.k, A: T.A, rho: W.num(D.rho) || rhoDefault, sectorMode: T.overall ? '전체 Weibull 공통' : '방향별 Weibull', sectors: D.rows.filter(r => r.freq > 0).map(r => ({ dir: r.dir, freq: r.freq * 100 / T.fs, k: T.overall ? D.wk : r.k, A: T.overall ? D.wA : r.A })), note: notes.join(' ') }); }
  else if (a === 'mcpAdd') { $('#mcpIn').click(); return; }
  else if (a === 'mcpClear') { const D = dsSel(); if (D) { delete D.mcp; D._mcp = null; render(); save(); } return; }
  else if (a === 'mcpDesign') { const D = dsSel(), C = tsCompute(D), r = mcpCompute(D, C); if (!r || r.err) return; const st = r.st, R = D.mcp.ref;
    setDesign({ dsId: D.id, src: `장기 보정(MCP): ${D.name} + ${R.name || '기준 자료'} (${W.fmtDate(r.ltFrom).slice(0, 4)}~${W.fmtDate(r.ltTo).slice(0, 4)})`, z: C.hubZ, mean: st.mean, k: st.k, A: st.A, rho: C.rho ? C.rho.rhoHub : rhoDefault, alpha: C.sh ? C.sh.alpha : NaN,
      sectors: st.sectors ? st.sectors.map(s => ({ dir: s.dir, freq: s.freq, k: Number.isFinite(s.k) ? s.k : st.k, A: Number.isFinite(s.A) ? s.A : st.A })) : null, hist: st.secHist || null,
      mcp: { ref: R.name, id: R.id, r: r.all.r, n: r.conc.n, method: D.mcp.opt.method, ltFrom: r.ltFrom, ltTo: r.ltTo, measMean: C.hub.mean, ltMean: st.mean },
      note: `측정 ${W.fmtDate(r.conc.from)} ~ ${W.fmtDate(r.conc.to)}을 ${R.name || '기준 자료'}로 장기 보정(${D.mcp.opt.method === 'lin' ? '선형 회귀' : '분산비'}, r ${f(r.all.r, 3)}). 측정 기간 평균 ${f(C.hub.mean, 2)} → 장기 ${f(st.mean, 2)} m/s.` }); }
  else if (a === 'tsDesign') { const D = dsSel(), C = tsCompute(D), hb = C.hub; setDesign({ dsId: D.id, src: `시계열: ${D.name} (${W.fmtDate(D.ser.ts[0])} ~ ${W.fmtDate(D.ser.ts[D.ser.ts.length - 1])})`, z: C.hubZ, mean: hb.mean, k: hb.k, A: hb.A, rho: C.rho ? C.rho.rhoHub : rhoDefault, alpha: C.sh ? C.sh.alpha : NaN, sectors: hb.sectors ? hb.sectors.map(s => ({ dir: s.dir, freq: s.freq, k: Number.isFinite(s.k) ? s.k : hb.k, A: Number.isFinite(s.A) ? s.A : hb.A })) : null, hist: hb.secHist || null, note: [hb.n < 52000 ? '1년 미만 측정 자료 — 장기 보정 전 값입니다.' : '', hb.sectors && hb.sectors.some(s => !Number.isFinite(s.k)) ? '자료가 적은 방향은 전체 Weibull로 채웠습니다.' : ''].filter(Boolean).join(' ') }); }
  else if (a === 'wgDesign') {
    const D = dsSel(), r = D.reports[D.sel ?? D.reports.length - 1], elev = +S.elev || 0;
    const z = W.num($('#wgHub').value), al = W.num($('#wgAlpha').value); ui.wgHub = z;
    const near = r.sensors.reduce((b, s) => Math.abs(s.height + elev - z) < Math.abs(b.height + elev - z) ? s : b, r.sensors[0]);
    const A = near.c * Math.pow(z / (near.height + elev), al);
    setDesign({ dsId: D.id, src: `PDF 요약: ${r.file.replace(/^[0-9a-f]{8}-/, '')} (${W.fmtDate(r.startTs)} ~ ${W.fmtDate(r.endTs)})`, z, mean: W.weibullMean(near.k, A), k: near.k, A, rho: wgRho(r, ui.wgRho, z, ui.wgRhoVal) || rhoDefault, alpha: al, sectors: null, note: `측정높이 ${near.height} m(해발 ${near.height + elev} m)의 k를 쓰고 A를 α=${al}로 보정. 공기밀도: ${{ temp: '평균 기온+표준기압', pdf: 'PDF 평균', manual: '직접 입력' }[ui.wgRho]}. 방향 분포 없음. 단기 측정값(장기 보정 전).` });
  }
  else if (a === 'clearDesign') { S.design = null; render(); save(); }
});
document.addEventListener('input', e => { const el = e.target; if (el.dataset && el.dataset.site === 'name') { const S = site(); S.name = el.value; const n = document.querySelector('.site.on span'); if (n) n.textContent = siteName(S); } });
document.addEventListener('change', e => {
  const el = e.target, S = site(), D = dsSel();
  if (el.id === 'fileIn') { handleFiles([...el.files]); el.value = ''; return; }
  if (el.id === 'turbJson') { const fs = [...el.files]; el.value = ''; (async () => { const objs = []; let bad = 0; for (const fl of fs) { try { objs.push(JSON.parse(await fl.text())); } catch (e) { bad++; } } const r = importTurbFiles(objs); if (!r.got) { toast('터빈 자료를 찾지 못했습니다. 터빈 파일(.json)인지 확인하세요.'); return; } render(); save(); toast(`터빈 ${r.got}개를 가져왔습니다${r.rep ? ` (같은 터빈 ${r.rep}개는 새 자료로 바꿈)` : ''}${r.est ? ` · 출력곡선이 없는 ${r.est}개는 추정 곡선으로 넣음` : ''}${r.bad + bad ? ` · 읽지 못한 항목 ${r.bad + bad}개` : ''}: ${r.names.join(', ')}`, 8000); })(); return; }
  if (el.id === 'tcmpHub') { ui.tcmpHub = el.value; render(); return; }
  if (el.id === 'tcmpBase') { ui.tcmpBase = el.value; render(); return; }
  if (el.id === 'fcmpHub') { ui.fcmpHub = el.value; render(); return; }
  if (el.id === 'tpreset') { const src = W.TURB_PRESETS.find(t => t.id === el.value); if (!src) return; const ex = P.turbines.find(t => t.preset === src.id); if (ex) { ui.turbSel = ex.id; render(); toast(`"${ex.name}"은(는) 이미 목록에 있습니다.`); return; } const T = JSON.parse(JSON.stringify(src)); T.preset = src.id; T.id = uid(); P.turbines.push(T); ui.turbSel = T.id; render(); save(); toast(`"${T.name}"을(를) 터빈 목록에 넣었습니다.`); return; }
  if (el.id === 'fileOpen') { openProject(el.files[0]); el.value = ''; return; }
  if (el.id === 'mcpIn') { const D = dsSel(); if (D) mcpLoad(D, [...el.files]); el.value = ''; return; }
  if (el.dataset.mcp) { const D = dsSel(); if (D && D.mcp) { const k = el.dataset.mcp; D.mcp.opt[k] = k === 'lag' ? +el.value : el.value; busy(() => { render(); save(); }); } return; }
  if (el.id === 'layoutIn' || el.id === 'zoneIn') { handleLayoutFiles([...el.files]); el.value = ''; return; }
  if (el.dataset.farm) { const F = farmSel(), k = el.dataset.farm; if (k === 'model') { F.wake.model = el.value; F.wake.k = WAKE_MODELS[el.value].k; if (!F.wake.ti) F.wake.ti = 0.06; } else if (k === 'k') F.wake.k = W.num(el.value) || WAKE_MODELS[F.wake.model].k; else if (k === 'ti') F.wake.ti = W.num(el.value) || 0.06; else if (k === 'zone') F.zone = W.num(el.value) || 52; else if (k === 'hub') F.hub = el.value.trim() === '' ? undefined : W.num(el.value); else if (k === 'tid' || k === 'zoneId') { F[k] = el.value || undefined; if (k === 'tid') { F.noFit = false; F._fit = true; ui.fcmp = null; } } else if (k === 'permitMW' || k === 'gridMW') { F[k] = W.num(el.value) > 0 ? W.num(el.value) : undefined; ui.fcmp = null; if (k === 'permitMW') { F.noFit = false; F._fit = true; } } else if (k === 'permitMode') { F.permitMode = el.value; ui.fcmp = null; } else F[k] = el.value; F._cache = null; ui.rp = null; busy(() => { if (F._fit) { delete F._fit; farmFitPermit(F); } render(); save(); }); return; }
  if (el.dataset.sp) { const F = farmSel(), k = el.dataset.sp; F.spRule[k] = k === 'dir' ? (el.value.trim() === '' || /auto/i.test(el.value) ? 'auto' : W.num(el.value)) : (W.num(el.value) || F.spRule[k]); F._cache = null; busy(() => { render(); save(); }); return; }
  if (el.dataset.zone) { const Z = zoneSel(), k = el.dataset.zone; Z[k] = k === 'zone' ? (W.num(el.value) || 52) : el.value; render(); save(); return; }
  if (el.dataset.zb || el.dataset.ze || el.dataset.zp) { const Z = zoneSel(); const [list, id] = el.dataset.zb ? [Z.bounds, el.dataset.zb] : el.dataset.ze ? [Z.excl, el.dataset.ze] : [Z.pts, el.dataset.zp]; const it = list.find(q => q.id === id); const k = el.dataset.k; if (it) it[k] = ['buffer', 'v', 'z'].includes(k) ? W.num(el.value) : el.value; (P.farms || []).forEach(F => F._cache = null); render(); save(); return; }
  if (el.dataset.fr != null) { const F = farmSel(), r = F.rows[+el.dataset.fr], k = el.dataset.k; F._cache = null; r[k] = k === 'tid' ? (el.value || undefined) : k === 'name' ? el.value : (el.value.trim() === '' ? undefined : W.num(el.value)); busy(() => { render(); save(); }); return; }
  if (el.dataset.loss) { const F = farmSel(), k = el.dataset.loss; F.losses[k] = el.value.trim() === '' ? NaN : W.num(el.value); F.lossSrc[k] = el.value.trim() === '' ? '' : '직접 입력'; render(); save(); return; }
  if (el.id === 'uncFrame') { const F = farmSel(), k = el.value, prev = F.uncFrame || 'tr6'; const apply = () => { F.uncFrame = k; F.unc = k === 'report' ? F.uncReport.map(u => ({ ...u })) : frameRows(k, F.uncReport, F.uncSrc); render(); save(); }; if (F.unc.some(u => Number.isFinite(u.value)) && k !== prev) confirmBox('항목 틀을 바꾸면 지금 입력된 불확도 값이 지워집니다. 바꿀까요?', apply); else apply(); setTimeout(() => { const s2 = $('#uncFrame'); if (s2 && F.uncFrame !== k) s2.value = F.uncFrame || prev; }, 0); return; }
  if (el.dataset.act2 === 'rpfarm') { ui.farmSel = el.value; render(); return; }
  if (el.dataset.rp) { reportCfg()[el.dataset.rp] = el.value.trim(); render(); save(); return; }
  if (el.dataset.treq) { const T = turbOf(ui.turbSel); if (!T.req) T.req = {}; T.req[el.dataset.treq] = el.checked; render(); save(); return; }
  if (el.dataset.lcs) { const F = farmSel(); if (!F.lossSel) F.lossSel = {}; if (el.value === 'auto') delete F.lossSel[el.dataset.lcs]; else F.lossSel[el.dataset.lcs] = el.value; render(); save(); return; }
  if (el.dataset.lc) { const c = lossCondCfg()[el.dataset.lc], k = +el.dataset.i, v = W.num(el.value); if (Number.isFinite(v)) { if (c.type === 'num') c.bins[k][el.dataset.k === 'lo' ? 3 : 4] = v; else c.opts[k][el.dataset.k === 'lo' ? 2 : 3] = v; } render(); save(); return; }
  if (el.dataset.ucs) { const F = farmSel(); if (!F.uncSel) F.uncSel = {}; if (el.value === 'auto') delete F.uncSel[el.dataset.ucs]; else F.uncSel[el.dataset.ucs] = el.value; render(); save(); return; }
  if (el.dataset.uc) { const c = uncCondCfg()[el.dataset.uc], k = +el.dataset.i, v = W.num(el.value); if (Number.isFinite(v)) { if (c.type === 'num') c.bins[k][el.dataset.k === 'lo' ? 3 : 4] = v; else if (c.type === 'sel') c.opts[k][el.dataset.k === 'lo' ? 2 : 3] = v; else c[el.dataset.k] = v; } render(); save(); return; }
  if (el.dataset.unc != null) { const F = farmSel(), u = F.unc[+el.dataset.unc]; u.value = el.value.trim() === '' ? NaN : W.num(el.value); u.src = el.value.trim() === '' ? '' : '직접 입력'; render(); save(); return; }
  if (el.id === 'turbPdf') { importTurbinePdf([...el.files]); el.value = ''; return; }
  if (el.dataset.turb) { const T = turbOf(ui.turbSel), k = el.dataset.turb; T[k] = ['name', 'maker', 'regulation', 'curveType'].includes(k) ? el.value : W.num(el.value); if (k === 'rhoRef') T.rhoRefNote = ''; if (k === 'curveType') T.curveTypeNote = ''; render(); save(); return; }
  if (el.dataset.cv != null) { const T = turbOf(ui.turbSel); T.curve[+el.dataset.cv][+el.dataset.k] = W.num(el.value); if (el.dataset.k === '0') T.curve.sort((a, b) => a[0] - b[0]); render(); save(); return; }
  if (el.dataset.ts) { const S = site(), t = turbSet(S), k = el.dataset.ts; t[k] = ['tid', 'rhoMode', 'dens', 'dist'].includes(k) ? el.value : (el.value.trim() === '' ? NaN : W.num(el.value)); if (k === 'tid') { t.hub = turbOf(t.tid).hub; } render(); save(); return; }
  if (el.id === 'tolM') { P.tolM = W.num(el.value) || 1000; save(); return; }
  if (el.id === 'wgRhoMode') { ui.wgRho = el.value; ui.wgHub = W.num($('#wgHub').value); render(); return; }
  if (el.id === 'wgRhoVal') { ui.wgRhoVal = el.value; return; }
  if (el.id === 'wgHub') { ui.wgHub = W.num(el.value); render(); return; }
  if (el.id === 'projName') { P.name = el.value; save(); return; }
  if (el.dataset.site) { const k = el.dataset.site; const v = el.value.trim(); S[k] = (k === 'elev' || k === 'lat' || k === 'lon') ? (v === '' ? '' : (Number.isFinite(W.num(v)) ? W.num(v) : v)) : v; if (!S.src) S.src = {}; if (v === '') delete S.src[k]; else S.src[k] = '직접 입력'; if (k === 'elev' && D && D.type === 'ts') D.cache = null; render(); save(); return; }
  if (el.dataset.dsname != null && D) { D.name = el.value; render(); save(); return; }
  if (el.dataset.opt && D) { const k = el.dataset.opt; D.opt[k] = ['from', 'to', 'weibull'].includes(k) ? el.value : W.num(el.value); if (k === 'dirOffset') D.opt._dirSet = 1; busy(() => { render(); save(); }); return; }
  if (el.dataset.qc && D) { const k = el.dataset.qc; if (k === 'minAvail') D.opt.minAvail = W.num(el.value) || 0; else D.opt.qc[k] = el.type === 'checkbox' ? el.checked : W.num(el.value); busy(() => { render(); save(); }); return; }
  if (el.dataset.col != null && D) { const c = D.ser.columns[+el.dataset.col]; if (el.dataset.k === 'role') c.role = el.value; else c.height = el.value === '' ? null : W.num(el.value); D.cache = null; D.qcRes = null; busy(() => { render(); save(); }); return; }
  if (el.dataset.sec && D) { const k = el.dataset.sec; D[k] = k === 'source' ? el.value : W.num(el.value); if (k === 'rho') D.rhoSrc = el.value.trim() ? '직접 입력' : ''; render(); save(); return; }
  if (el.dataset.r != null && D) { D.rows[+el.dataset.r][el.dataset.k] = W.num(el.value); render(); save(); return; }
});
function busy(fn) { document.body.style.cursor = 'progress'; toast('계산 중…', 800); setTimeout(() => { try { fn(); } finally { document.body.style.cursor = ''; } }, 30); }
function confirmBox(msg, ok) {
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="box" style="width:380px"><div style="margin-bottom:14px">${esc(msg)}</div><div class="row" style="justify-content:flex-end"><button class="btn" data-x="c">취소</button><button class="btn pri" data-x="ok">확인</button></div></div>`;
  document.body.appendChild(box); box.addEventListener('click', e => { const x = e.target.dataset.x; if (!x) return; box.remove(); if (x === 'ok') ok(); });
  return true;
}
$('#btnAddSite').onclick = () => { const s = newSite(); P.sites.push(s); P.active = s.id; render(); save(); };
// 배치도 편집 (옮기기·추가·삭제)
let layDrag = null;
const svgPt = (svg, e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y]; };
document.addEventListener('mousedown', e => {
  const svg = e.target.closest && e.target.closest('#laySvg'); if (!svg || !ui.layEdit || !ui.layM) return; const F = farmSel(); if (!F) return;
  const ti = e.target.dataset && e.target.dataset.ti;
  if (ui.layEdit === 'del' && ti != null) { const r = F.rows[+ti]; confirmBox(`${r.name}을(를) 지울까요?`, () => { F.rows.splice(+ti, 1); F._cache = null; render(); save(); }); return; }
  if (ui.layEdit === 'add' && ti == null) { const [px, py] = svgPt(svg, e); const [x, y] = ui.layM.inv(px, py); let k = F.rows.length + 1; while (F.rows.some(r => r.name === `T${String(k).padStart(2, '0')}`)) k++; F.rows.push({ name: `T${String(k).padStart(2, '0')}`, x: Math.round(x), y: Math.round(y) }); F._cache = null; busy(() => { render(); save(); }); return; }
  if (ui.layEdit === 'move' && ti != null) { layDrag = { svg, i: +ti, el: e.target, txt: e.target.nextElementSibling }; e.preventDefault(); }
});
document.addEventListener('mousemove', e => { if (!layDrag) return; const [px, py] = svgPt(layDrag.svg, e); layDrag.el.setAttribute('cx', px); layDrag.el.setAttribute('cy', py); if (layDrag.txt) { layDrag.txt.setAttribute('x', px + 9); layDrag.txt.setAttribute('y', py + 3); } layDrag.p = [px, py]; });
document.addEventListener('mouseup', () => { if (!layDrag) return; const d = layDrag; layDrag = null; if (!d.p) return; const F = farmSel(); const [x, y] = ui.layM.inv(d.p[0], d.p[1]); F.rows[d.i].x = Math.round(x); F.rows[d.i].y = Math.round(y); F._cache = null; busy(() => { render(); save(); }); });
document.addEventListener('dragover', e => { e.preventDefault(); const d = (e.target.closest && e.target.closest('#dropMcp')) || $('#drop') || $('#dropLayout') || $('#dropZone'); if (d) d.classList.add('over'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) { const d = $('#drop'); if (d) d.classList.remove('over'); } });
document.addEventListener('drop', e => { e.preventDefault(); document.querySelectorAll('.drop').forEach(d => d.classList.remove('over')); const fl = [...e.dataTransfer.files]; if (!fl.length) return; if (ui.tab === 'farm' || ui.tab === 'zone') handleLayoutFiles(fl); else if (ui.tab === 'turb') importTurbinePdf(fl.filter(x => /\.pdf$/i.test(x.name))); else if (ui.tab === 'wind') { if (e.target.closest && e.target.closest('#dropMcp')) { const D = dsSel(); if (D) mcpLoad(D, fl); } else handleFiles(fl); } });
$('#btnOpen').onclick = () => $('#fileOpen').click();
$('#btnSave').onclick = () => saveProjectFile();
$('#btnSnap').onclick = () => snapDialog();
$('#btnNew').onclick = () => newProjectDialog();
$('#btnXlsx').onclick = () => exportXlsx();

/* ================= 저장 ================= */
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s, T) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
function serialize() {
  return JSON.stringify({ app: 'wind-energy-tool', v: 1, P: { ...P, farms: (P.farms || []).map(F => ({ ...F, _cache: undefined })), sites: P.sites.map(s => ({ ...s, datasets: s.datasets.map(d => d.type !== 'ts' ? d : ({ ...d, cache: undefined, raw: undefined, qcRes: undefined, _mcp: undefined, mcp: d.mcp && d.mcp.ref ? { ...d.mcp, ref: { ...d.mcp.ref, t: b64(Float64Array.from(d.mcp.ref.t).buffer), v: b64(Float32Array.from(d.mcp.ref.v).buffer), d: b64(Float32Array.from(d.mcp.ref.d).buffer) } } : d.mcp, ser: { ...d.ser, ts: b64(d.ser.ts.buffer), data: d.ser.data.map(a => b64(a.buffer)) } })) })) } });
}
function deserialize(txt) {
  const o = JSON.parse(txt); if (o.app !== 'wind-energy-tool') throw new Error('이 도구의 프로젝트 파일이 아닙니다.');
  const p = o.P; p.sites.forEach(s => s.datasets.forEach(d => { if (d.type === 'ts') { d.ser.ts = unb64(d.ser.ts, Float64Array); d.ser.data = d.ser.data.map(x => unb64(x, Float32Array)); d.cache = null; if (d.mcp && d.mcp.ref && typeof d.mcp.ref.t === 'string') { d.mcp.ref.t = unb64(d.mcp.ref.t, Float64Array); d.mcp.ref.v = unb64(d.mcp.ref.v, Float32Array); d.mcp.ref.d = unb64(d.mcp.ref.d, Float32Array); } } }));
  const fix = x => { if (x === null) return NaN; return x; }; // JSON NaN→null
  p.sites.forEach(s => s.datasets.forEach(d => { if (d.type === 'sec') d.rows.forEach(r => { for (const k in r) r[k] = fix(r[k]); }); }));
  (p.turbines || []).forEach(t => { t.curve = t.curve.map(c => c.map(fix)); for (const k of ['ratedKW', 'rotor', 'hub', 'rhoRef']) t[k] = fix(t[k]); });
  p.sites.forEach(s => { if (s.turb) for (const k of ['hub', 'alpha', 'rho']) s.turb[k] = fix(s.turb[k]); });
  (p.farms || []).forEach(F => { if (!F.uncFrame) { F.uncFrame = F.uncSrc ? 'report' : 'tr6'; if (F.uncSrc && !F.uncReport) F.uncReport = F.unc.map(u => ({ ...u })); } F.unc.forEach(u => u.value = fix(u.value)); (F.uncReport || []).forEach(u => u.value = fix(u.value)); for (const k in F.losses) F.losses[k] = fix(F.losses[k]); if (F.rep) for (const k in F.rep) F.rep[k] = fix(F.rep[k]); });
  (p.farms || []).forEach(F => { F.hub = fix(F.hub); if (F.wake) F.wake.ti = fix(F.wake.ti); });
  (p.zones || []).forEach(Z => (Z.pts || []).forEach(q => { q.z = fix(q.z); q.v = fix(q.v); }));
  migrateZones(p);
  return p;
}
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { idbPut(serialize()); } catch (e) { console.warn(e); } }, 600); }
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('wind-energy-tool', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbPut(v) { try { const db = await idb(); db.transaction('kv', 'readwrite').objectStore('kv').put(v, 'project'); } catch (e) { } }
async function idbGet() { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get('project'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (e) { return null; } }
async function download(name, data) {
  try { const dl = window.claude && await window.claude.use('downloads'); if (dl) { await dl.save({ filename: name, data }); toast('저장했습니다.'); return; } } catch (e) { if (e && e.code === 'declined') return; if (e && e.code && e.code !== 'unavailable') { toast('저장하지 못했습니다: ' + (e.message || e.code)); return; } }
  try { const blob = data instanceof Blob ? data : new Blob([data]); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  catch (e) { toast('이 화면에서는 파일 내려받기를 할 수 없습니다.'); }
}
/* ----- 내부 저장: 도구(이 브라우저) 안에 이름 붙여 여러 개 저장 ----- */
async function idbKv(key, val, del) { try { const db = await idb(); return await new Promise(res => { const st = db.transaction('kv', val === undefined && !del ? 'readonly' : 'readwrite').objectStore('kv'); const q = del ? st.delete(key) : val === undefined ? st.get(key) : st.put(val, key); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (e) { return null; } }
const snapList = async () => (await idbKv('snaps')) || [];
const nowStamp = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const kb = n => n > 1048576 ? f(n / 1048576, 1) + ' MB' : fi(n / 1024) + ' KB';
// 저장소 두 가지: local = 이 PC 브라우저(IndexedDB), cloud = 아티팩트 db의 본인 전용 영역(data/users/<id>, 본인만 읽고 씀 — 사무실·집 어디서나)
const LocalStore = {
  name: '이 PC', list: async () => snapList(),
  put: async (id, data, meta) => { await idbKv('snap:' + id, data); const L = (await snapList()).filter(q => q.id !== id); L.push(meta); await idbKv('snaps', L); },
  get: async id => idbKv('snap:' + id),
  del: async id => { await idbKv('snap:' + id, undefined, true); await idbKv('snaps', (await snapList()).filter(q => q.id !== id)); }
};
// 구글 드라이브 저장: 사용자의 Google Drive 커넥터로 "내 드라이브 > - GitHub 작업 - > 풍력 발전량 계산" 폴더에 .wind.json 파일로 저장
const GD_SERVER = 'Google Drive', GD_PARENT = '- GitHub 작업 -', GD_FOLDER = '풍력 발전량 계산';
let gdCtx = null;
async function gdCall(tool, input) {
  const mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null; if (!mcp) throw { code: 'not_granted', message: '이 화면에서는 구글 드라이브를 쓸 수 없습니다' };
  const r = await mcp.callTool(GD_SERVER, tool, input, { cache: false }); return { payload: r.payload, result: r };
}
const gdErrText = e => { try { console.error('[구글 드라이브]', e); } catch (_) { } const c = e && e.code; const det = c ? ` (코드 ${c}${e.message ? ': ' + String(e.message).slice(0, 200) : ''})` : ''; return gdErrMsg(e, c) + det; };
const gdErrMsg = (e, c) => c === 'needs_reauth' ? '구글 드라이브 연결이 만료되었습니다. claude.ai 설정 → 커넥터에서 Google Drive를 다시 연결해 주세요.' : c === 'server_not_connected' ? 'claude.ai 설정 → 커넥터에서 Google Drive를 추가해 주세요.' : c === 'approval_required' || c === 'not_in_manifest' || c === 'consent_required' ? '이 도구가 구글 드라이브를 쓰도록 허용해야 합니다(허용 창에서 "허용").' : c === 'selection_required' ? '연결된 Google Drive가 여러 개라 하나를 골라야 합니다.' : c === 'not_granted' || c === 'capability_disabled' ? '이 화면에서는 구글 드라이브를 쓸 수 없습니다(claude.ai에서 도구를 열어 주세요).' : (e && (e.message || e.code)) || String(e);
async function gdFolder() {
  if (gdCtx && gdCtx.folder) return gdCtx.folder;
  const q = t => `title = '${t}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const parent = ((await gdCall('search_files', { query: q(GD_PARENT), excludeContentSnippets: true, pageSize: 5 })).payload || {}).files || [];
  const pid = parent[0] && parent[0].id;
  const found = ((await gdCall('search_files', { query: q(GD_FOLDER) + (pid ? ` and parentId = '${pid}'` : ''), excludeContentSnippets: true, pageSize: 5 })).payload || {}).files || [];
  let folder = found[0] && found[0].id;
  if (!folder) { const c = (await gdCall('create_file', { title: GD_FOLDER, contentMimeType: 'application/vnd.google-apps.folder', ...(pid ? { parentId: pid } : {}) })).payload || {}; folder = c.id; }
  if (!folder) throw new Error('구글 드라이브 폴더를 만들지 못했습니다');
  let fileArgs = false; try { const mcp = await window.claude.use('mcp'); fileArgs = !!(await mcp.listTools()).fileArgs; } catch (e) { }
  gdCtx = { folder, fileArgs, where: pid ? `내 드라이브 › ${GD_PARENT} › ${GD_FOLDER}` : `내 드라이브 › ${GD_FOLDER}` };
  return folder;
}
const b64utf8 = b => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); };
const isoLocal = t => { const d = new Date(t); if (isNaN(d)) return t || ''; const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
// 큰 저장본(시계열 포함 수십 MB): gzip으로 줄인 뒤 base64 글자 70만 자씩 나눠 "이름.wind.json.part01…"로 올리고, "이름.wind.json"에는 조각 목록만 적음
const GD_PART = 700000, GD_PARTS = '저장 조각 (지우지 마세요)';
async function gdPartsFolder() {
  const folder = await gdFolder(); if (gdCtx.parts) return gdCtx.parts;
  const f = ((await gdCall('search_files', { query: `title = '${GD_PARTS}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and parentId = '${folder}'`, excludeContentSnippets: true, pageSize: 5 })).payload || {}).files || [];
  let id = f[0] && f[0].id; if (!id) id = ((await gdCall('create_file', { title: GD_PARTS, contentMimeType: 'application/vnd.google-apps.folder', parentId: folder })).payload || {}).id;
  if (!id) throw new Error('조각 폴더를 만들지 못했습니다'); gdCtx.parts = id; return id;
}
async function gzipB64(text) { const cs = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')); const u = new Uint8Array(await new Response(cs).arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); }
async function gunzipB64(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(ds).text(); }
async function gdReadText(id) {
  const { payload, result } = await gdCall('download_file_content', { fileId: id });
  if (payload && typeof payload.content === 'string') return b64utf8(payload.content);
  const blk = ((result && result.content) || []).find(c => c.resource && (c.resource.blob || c.resource.text)); if (blk) return blk.resource.text || b64utf8(blk.resource.blob);
  if (typeof payload === 'string') return payload;
  throw new Error('파일 내용을 받지 못했습니다');
}
const gdManifest = txt => { if (txt.length > 5000) return null; try { const o = JSON.parse(txt); return o && o.app === 'wind-energy-tool' && Array.isArray(o.parts) ? o : null; } catch (e) { return null; } };
const CloudStore = {
  name: '구글 드라이브',
  list: async () => {
    let folder; try { folder = await gdFolder(); } catch (e) { CloudStore.err = gdErrText(e); return null; }
    CloudStore.err = null;
    const fs = ((await gdCall('search_files', { query: `parentId = '${folder}' and trashed = false and title contains '.wind.json'`, excludeContentSnippets: true, pageSize: 200 })).payload || {}).files || [];
    return fs.filter(x => /\.wind\.json$/i.test(x.title || '')).map(x => { const m = String(x.title || '').replace(/\.wind\.json$/i, '').match(/^(.*?)(?: \[(.*)\])?$/); const small = +x.fileSize < 5000; return { id: x.id, name: m ? m[1] : x.title, note: m && m[2] || '', at: isoLocal(x.modifiedTime), ts: Date.parse(x.modifiedTime) || 0, size: small ? 0 : +x.fileSize || 0, multi: small, sites: '-', farms: '-', url: x.viewUrl }; });
  },
  put: async (id, data, meta, old, prog = () => { }) => {
    const folder = await gdFolder();
    const title = `${(meta.name || '저장').replace(/[\\/]/g, '_')}${meta.note ? ` [${meta.note}]` : ''}.wind.json`;
    const bytes = new TextEncoder().encode(data).length;
    if (bytes < GD_PART) await gdCall('create_file', { title, parentId: folder, contentMimeType: 'application/json', disableConversionToGoogleType: true, textContent: data });
    else {
      prog('압축 중…'); const z = await gzipB64(data); const n = Math.ceil(z.length / GD_PART), ids = []; const pf = await gdPartsFolder();
      for (let i = 0; i < n; i++) { prog(`올리는 중… ${i + 1}/${n} 조각 (압축 후 ${kb(z.length * 0.75)})`); const r = (await gdCall('create_file', { title: `${title}.part${String(i + 1).padStart(2, '0')}`, parentId: pf, contentMimeType: 'text/plain', disableConversionToGoogleType: true, textContent: z.slice(i * GD_PART, (i + 1) * GD_PART) })).payload || {}; if (!r.id) throw new Error(`${i + 1}번째 조각을 올리지 못했습니다`); ids.push(r.id); }
      await gdCall('create_file', { title, parentId: folder, contentMimeType: 'application/json', disableConversionToGoogleType: true, textContent: JSON.stringify({ app: 'wind-energy-tool', gz: true, parts: ids, size: bytes, savedAt: new Date().toISOString() }) });
    }
    if (old) { prog('이전 파일 정리 중…'); await CloudStore.del(old); } // 덮어쓰기 = 새로 저장 후 이전 파일은 휴지통으로
  },
  get: async (id, prog = () => { }) => {
    const head = await gdReadText(id); const mf = gdManifest(head); if (!mf) return head;
    let z = ''; for (let i = 0; i < mf.parts.length; i++) { prog(`내려받는 중… ${i + 1}/${mf.parts.length} 조각`); z += await gdReadText(mf.parts[i]); }
    prog('압축 푸는 중…'); return await gunzipB64(z);
  },
  del: async id => {
    try { const mf = gdManifest(await gdReadText(id)); if (mf) for (const pid of mf.parts) await gdCall('trash_file', { fileId: pid }); } catch (e) { }
    await gdCall('trash_file', { fileId: id });
  }
};
// 새 프로젝트: 지금 작업은 저장하라고 안내한 뒤 빈 프로젝트로 시작(터빈 목록은 선택해서 가져감)
function newProjectDialog() {
  const box = document.createElement('div'); box.className = 'modal'; document.body.appendChild(box);
  const nT = (P.turbines || []).length, nS = P.sites.filter(x => x.datasets && x.datasets.length).length, nF = (P.farms || []).length;
  box.innerHTML = `<div class="box" style="width:min(560px,94vw)"><h3>새 프로젝트</h3>
   <div class="hint">지금 작업(${esc(P.name || '')} · 지점 ${nS}곳 · 단지 ${nF}개)은 화면에서 사라집니다. 이어서 쓸 작업이면 먼저 저장하세요 — 저장하면 나중에 "내부 저장"에서 불러올 수 있습니다.</div>
   <div class="row" style="margin:12px 0 6px"><div class="fld"><label>새 프로젝트 이름</label><input id="npName" value="" placeholder="예: 청사포 해상풍력" style="width:320px"></div></div>
   <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin:4px 0 12px"><input type="checkbox" id="npTurb" checked> 터빈 목록 ${nT}개는 그대로 가져가기 (출력곡선·제조사 자료 다시 넣지 않게)</label>
   <div class="row" style="justify-content:flex-end;gap:6px"><button class="btn" data-x="c">취소</button><button class="btn" data-x="save">먼저 저장하기</button><button class="btn pri" data-x="new">새 프로젝트 시작</button></div></div>`;
  setTimeout(() => { const i = $('#npName'); if (i) i.focus(); }, 30);
  box.addEventListener('click', e => {
    const x = e.target.dataset.x; if (!x) { if (e.target === box) box.remove(); return; }
    if (x === 'c') { box.remove(); return; }
    if (x === 'save') { box.remove(); snapDialog(); return; }
    if (x === 'new') {
      const keep = $('#npTurb').checked, name = ($('#npName').value || '').trim() || '새 프로젝트';
      const T = keep ? JSON.parse(JSON.stringify(P.turbines || [])) : [];
      P = { name, sites: [newSite()], active: null, tolM: 1000, zones: [], farms: [], turbines: T }; P.active = P.sites[0].id;
      ensureTurbines(); ui.tab = 'wind'; ui.farmSel = null; ui.zoneSel = null; ui.fcmp = null; ui.rp = null; ui.turbSel = null;
      document.querySelectorAll('[data-act=tab]').forEach(t => t.classList.toggle('on', t.dataset.v === 'wind'));
      $('#projName').value = name; render(); save(); box.remove(); toast(`새 프로젝트 "${name}"을(를) 시작했습니다.`);
    }
  });
}
async function snapDialog() {
  const box = document.createElement('div'); box.className = 'modal'; document.body.appendChild(box);
  let arm = null, busyMsg = ''; // 불러오기·덮어쓰기·삭제는 두 번 눌러 확인
  const draw = async () => {
    const web = !(window.claude && window.claude.use); // claude.ai 밖(일반 웹 주소)에서 열었을 때
    const loc = (await LocalStore.list()).slice(); let cl = null; if (!web) { try { cl = await CloudStore.list(); } catch (e) { CloudStore.err = gdErrText(e); cl = null; } }
    const rows = [...(cl || []).map(m => ({ ...m, where: 'cloud' })), ...loc.map(m => ({ ...m, where: 'local' }))].sort((a, b) => (b.ts || 0) - (a.ts || 0) || b.at.localeCompare(a.at));
    const btn = (x, m, label, armLabel, cls = 'ghost') => { const k = `${x}:${m.where}:${m.id}`; return `<button class="btn sm ${arm === k ? 'pri' : cls}" data-x="${x}" data-w="${m.where}" data-id="${m.id}">${arm === k ? armLabel : label}</button>`; };
    box.innerHTML = `<div class="box"><h3>내부 저장</h3>
     ${web ? '<div class="hint"><b>이 PC</b>: 지금 쓰는 브라우저 안에 이름을 붙여 여러 개 저장합니다 — 다른 PC에서는 안 보입니다. 다른 PC로 옮기거나 보관할 것은 "파일로 저장"(.wind.json)으로 내려받아 두세요(구글 드라이브 등에 넣어 두면 어디서나 "열기"로 불러올 수 있음).</div>' : `<div class="hint"><b>구글 드라이브</b>: 연결된 구글 드라이브의 <b>${esc((gdCtx && gdCtx.where) || `내 드라이브 › ${GD_PARENT} › ${GD_FOLDER}`)}</b> 폴더에 .wind.json 파일로 저장 — 사무실·집 어디서나 같은 목록이 보이고, 드라이브에서 파일을 직접 내려받거나 옮길 수도 있습니다. 덮어쓰면 이전 파일은 드라이브 휴지통으로 갑니다. 처음 쓸 때 구글 드라이브 사용 허용 창이 뜨면 "허용"을 눌러 주세요.<br><b>이 PC</b>: 지금 쓰는 브라우저 안에만 저장 — 다른 PC에서는 안 보입니다.<br>오래 보관하거나 남에게 줄 것은 "파일로 저장"(.wind.json)도 함께 해 두세요.</div>`}
     ${cl === null && !web ? `<div class="warnbox"><div>지금은 구글 드라이브를 쓸 수 없습니다: ${esc(CloudStore.err || '연결 안 됨')} "이 PC" 저장만 됩니다. <button class="btn sm" data-x="retry">다시 시도</button></div></div>` : ''}
     <div class="row" style="margin:10px 0"><div class="fld"><label>저장 이름</label><input id="snapName" value="${esc((P.name || '프로젝트') + ' ' + nowStamp())}" style="width:300px"></div><div class="fld"><label>메모</label><input id="snapNote" value="" placeholder="예: 배치안 B, 손실 수정 전" style="width:220px"></div>
      ${web ? '' : `<button class="btn pri" data-x="save" data-w="cloud" ${cl === null ? 'disabled' : ''}>구글 드라이브에 저장</button>`}<button class="btn" data-x="save" data-w="local">이 PC에 저장</button></div>
     ${busyMsg ? `<div class="info"><span>${esc(busyMsg)}</span> <span id="snapBusy" style="font-weight:600"></span></div>` : ''}
     ${rows.length ? `<table class="t"><tr><th>위치</th><th>이름</th><th>메모</th><th>저장 시각</th><th>지점·단지</th><th>크기</th><th></th></tr>${rows.map(m => `<tr><td>${m.where === 'cloud' ? `<span class="tag ts">구글 드라이브</span>` : '<span class="tag">이 PC</span>'}</td><td class="txt">${esc(m.name)}</td><td class="txt">${esc(m.note || '')}</td><td>${esc(m.at)}</td><td>${m.where === 'cloud' ? (m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">드라이브에서 보기</a>` : '-') : `${m.sites}·${m.farms}`}</td><td>${m.size ? kb(m.size) : m.multi ? '압축 조각' : '-'}</td><td style="white-space:nowrap">
       ${btn('load', m, '불러오기', '한 번 더: 지금 작업을 바꿈', '')} ${btn('over', m, '덮어쓰기', '한 번 더: 덮어쓰기')} ${web ? '' : btn('copy', m, m.where === 'cloud' ? '이 PC로 복사' : '드라이브로 복사', m.where === 'cloud' ? '한 번 더: 이 PC로' : '한 번 더: 드라이브로')} ${btn('del', m, '삭제', '한 번 더: 삭제')}</td></tr>`).join('')}</table>` : '<div class="hint">아직 저장한 것이 없습니다.</div>'}
     <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-x="c">닫기</button></div></div>`;
    const nm = $('#snapName'); if (nm) nm.addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('[data-x=save][data-w=' + (cl === null ? 'local' : 'cloud') + ']').click(); });
  };
  const meta = (id, name, note, data) => ({ id, name, note, at: nowStamp(), ts: Date.now(), size: data.length, sites: P.sites.length, farms: (P.farms || []).length });
  const prog = t => { const el = box.querySelector('#snapBusy'); if (el) el.textContent = t; };
  const run = async (msg, fn) => { busyMsg = msg; await draw(); try { await fn(); } catch (er) { toast('실패했습니다: ' + gdErrText(er), 8000); } busyMsg = ''; await draw(); };
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]'); if (!b || b.disabled) { if (e.target === box && !busyMsg) box.remove(); return; }
    if (busyMsg && b.dataset.x !== 'c') return;
    const x = b.dataset.x, id = b.dataset.id, w = b.dataset.w, ST = w === 'cloud' ? CloudStore : LocalStore;
    if (x === 'c') { box.remove(); return; }
    if (x === 'retry') { gdCtx = null; await draw(); return; }
    if (x === 'save') {
      const name = ($('#snapName').value || '').trim() || nowStamp(), note = ($('#snapNote').value || '').trim();
      const data = serialize(), sid = uid(); arm = null;
      await run(`${ST.name}에 저장 중… (${kb(data.length)})`, async () => { await ST.put(sid, data, meta(sid, name, note, data), null, prog); toast(`"${name}"을(를) ${ST.name}에 저장했습니다.`); });
      return;
    }
    const key = `${x}:${w}:${id}`; if (arm !== key) { arm = key; await draw(); return; } arm = null;
    const m = ((await ST.list()) || []).find(q => q.id === id); if (!m) { await draw(); return; }
    if (x === 'load') {
      await run(`${ST.name}에서 불러오는 중…`, async () => {
        const v = await ST.get(id, prog); if (!v) throw new Error('저장 내용을 찾지 못했습니다');
        P = deserialize(v); if (!P.sites.find(s => s.id === P.active)) P.active = P.sites[0].id; $("#projName").value = P.name || ""; render(); save(); box.remove(); toast(`"${m.name}"을(를) 불러왔습니다.`);
      });
      return;
    }
    if (x === 'over') { const data = serialize(); await run(`${ST.name}에 덮어쓰는 중…`, async () => { await ST.put(id, data, { ...meta(id, m.name, m.note, data) }, id, prog); toast(`"${m.name}"에 지금 상태를 덮어썼습니다.`); }); return; }
    if (x === 'copy') { const TO = w === 'cloud' ? LocalStore : CloudStore; await run(`${TO.name}로 복사 중…`, async () => { const v = await ST.get(id, prog); if (!v) throw new Error('저장 내용을 찾지 못했습니다'); const nid = uid(); await TO.put(nid, v, { ...m, id: nid, chunks: undefined }, null, prog); toast(`"${m.name}"을(를) ${TO.name}에 복사했습니다.`); }); return; }
    if (x === 'del') { await run(`${ST.name}에서 지우는 중…`, async () => { await ST.del(id); toast(`"${m.name}"을(를) 지웠습니다.`); }); return; }
  });
  await draw();
}
const fname = ext => (P.name || '발전량').replace(/[\\/:*?"<>|]/g, '_') + ext;
function saveProjectFile() { download(fname('.wind.json'), serialize()); }
async function openProject(file) { try { P = deserialize(await file.text()); if (!P.sites.find(s => s.id === P.active)) P.active = P.sites[0].id; P.sites.forEach(s => autofillSite(s)); render(); save(); toast('프로젝트를 열었습니다.'); } catch (e) { toast('열지 못했습니다: ' + e.message); } }



/* ================= 6단계: 보고서 (HWPX · PDF) ================= */
// 화면 그래프(SVG) → PNG
const CHART_CSS = `text{font-family:'Malgun Gothic','Noto Sans KR','Noto Sans CJK KR',sans-serif}.ax text{fill:#595959;font-size:10px}.ax line,.ax path{stroke:#bfbfbf}.grid line{stroke:#e6e6e6}.lbl{fill:#404040;font-size:10.5px}`;
function svgToPng(chartHtml, scale = 3) {
  return new Promise((res) => {
    const m = String(chartHtml || '').match(/<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"[^>]*>([\s\S]*)<\/svg>/); if (!m) { res(null); return; }
    const w = +m[1], h = +m[2];
    const body = m[3].replace(/var\(--mono\)/g, "'Malgun Gothic',sans-serif").replace(/var\(--line\)/g, '#dcdbd5').replace(/ data-tip="[^"]*"/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="-6 -6 ${w + 12} ${h + 12}"><style>${CHART_CSS}</style><rect x="-6" y="-6" width="${w + 12}" height="${h + 12}" fill="#ffffff"/>${body}</svg>`;
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0); const url = c.toDataURL('image/png'); const bin = atob(url.split(',')[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); res({ data: a, w: c.width, h: c.height, url }); } catch (e) { console.warn(e); res(null); } };
    img.onerror = () => res(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
const legendText = html => { const m = String(html || '').match(/<div class="legend">([\s\S]*?)<\/div>/); return m ? m[1].replace(/<i [^>]*><\/i>/g, '■ ').replace(/<\/span><span>/g, '   ').replace(/<[^>]+>/g, '').trim() : ''; };
const reportCfg = () => { if (!P.report) P.report = {}; const r = P.report; const d = new Date(); if (!r.date) r.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (!r.reportNo) r.reportNo = `EYA-${d.getFullYear()}-001`; if (r.rev == null || r.rev === '') r.rev = '0'; if (!r.status) r.status = '초안'; if (!r.conf) r.conf = 'C'; if (!r.country) r.country = '대한민국'; return r; };
const REPORT_FIELDS = [['reportNo', '보고서 번호'], ['rev', '개정'], ['date', '발행일'], ['status', '상태'], ['client', '발주처'], ['clientAddr', '발주처 주소'], ['contractor', '수행사'], ['contractorAddr', '수행사 주소'], ['contractNo', '계약 번호'], ['country', '국가'], ['issuedBy', '작성'], ['issuedDept', '작성 부서'], ['reviewedBy', '검토'], ['reviewedDept', '검토 부서']];

// 보고서 내용(블록) — HWPX와 PDF가 같은 내용을 씀
async function reportModel(F) {
  const S = P.sites.find(s => s.id === F.siteId); if (!S || !S.design) throw new Error('단지 지점에 대표 풍황이 없습니다. 1단계에서 지정해 주세요.');
  const A = aepCalc(F); if (!A) throw new Error('발전량을 계산할 수 없습니다.');
  const R = A.R, c = R.c, T = c.T, d = S.design, rc = reportCfg();
  const pct = (v, n = 2) => Number.isFinite(v) ? f(v, n) : '-';
  const bc = boundCheck(F, R), mi = measInfo(F), lt = ltInfo(F), rep = F.rep || {};
  const refs = [], refUse = {}; const sref = (t, what) => String(t || '').replace(/(?:보고서 \()?([^\s()"]+\.(?:pdf|sta|csv|txt|dxf|xlsx|zip))\)?/gi, (m0, fn) => { fn = SRCNAME(fn); let i = refs.indexOf(fn); if (i < 0) { refs.push(fn); i = refs.length - 1; refUse[fn] = new Set(); } if (what) refUse[fn].add(what); return `[자료${i + 1}]`; });
  const assume = [];
  // 항목·근거 칸 너비를 글 길이에 맞춤 (한글 1자 ≈ 영문 1.7자)
  const tw = t => [...String(t || '')].reduce((a, ch) => a + (/[\u1100-\uFFFF]/.test(ch) ? 1.7 : 1), 0);
  const fitW = rows => { const cs = rows.filter(r => !(r && r.band != null)).map(r => r.cells || r); const a = Math.max(8, ...cs.map(c => tw(c[0]))), b = Math.max(6, ...cs.map(c => tw(c[2]))); const tot = a + b; const room = 6.6; return [Math.max(1.6, room * a / tot), 0.8, Math.max(1.2, room * b / tot)]; };
  const B = []; const toc = [], lof = [], lot = []; let n1 = 0, n2 = 0, n3 = 0, nt = 0, nf = 0;
  const h1 = (text, br = true) => { n1++; n2 = 0; n3 = 0; B.push({ t: 'h1', num: `${n1}.`, text, br }); toc.push({ lvl: 1, num: n1, text }); };
  const h2 = text => { n2++; n3 = 0; const num = `${n1}.${n2}`; B.push({ t: 'h2', num, text }); toc.push({ lvl: 2, num, text }); };
  const h3 = text => { n3++; B.push({ t: 'h3', num: `${n1}.${n2}.${n3}`, text }); };
  const p = text => B.push({ t: 'p', text }); const bullet = text => B.push({ t: 'bullet', text });
  const table = (o) => { nt++; o.caption = `표 ${nt}  ${o.caption}`; lot.push(o.caption); B.push({ t: 'table', ...o }); };
  const fig = async (html, caption, frac = 0.75) => { const png = await svgToPng(html); if (!png) return; nf++; const lg = legendText(html); const cap = `그림 ${nf}  ${caption}`; lof.push(cap); B.push({ t: 'fig', png, frac, caption: cap + (lg ? `   (${lg})` : '') }); };
  const lossOf = cat => A.items.filter(x => x.cat === cat);
  const pv = x => (A.pv.find(q => q.p === x) || {});
  const proj = F.name, typeName = '발전량 평가'; const Tnames = [...new Set(R.Ti.map(x => x.name))]; const Z = zoneOf(F); const RI = c.rhoInfo || {};
  const wakeDesc = F.wake.model === 'turbopark' ? `TurbOPark 모델(Nygaard 2020, 주변 난류강도 ${F.wake.ti || 0.06}, 후류 제곱합)` : F.wake.model === 'gauss' ? `가우스 모델(Bastankhah·Porté-Agel 2014, 주변 난류강도 ${F.wake.ti || 0.06}, 후류 제곱합)` : `${WAKE_MODELS[F.wake.model] ? WAKE_MODELS[F.wake.model].name.replace(/\s*\(.*\)/, '') : 'Jensen'} 모델(확산계수 k = ${F.wake.k})`;
  const speedDesc = F.speed === 'report' ? '터빈별 평균풍속(보고서·입력)' : F.speed === 'manual' ? '터빈별 배율' : F.speed === 'zone' ? '구역 풍속 기준점을 거리 비례로 보간한 풍속' : F.speed === 'field' ? '원래 배치의 터빈별 풍속을 위치에 따라 보간한 풍속' : '단지 전체 같은 풍속';
  const meta = { project: proj, typeName, title: `${proj}: ${typeName}`, header: `${proj} - ${typeName}`, footer: `${rc.reportNo}        개정 ${rc.rev}`, reportNo: rc.reportNo, rev: rc.rev, date: rc.date, coverBand: '발전량 평가 보고서', preview: `${proj} 발전량 평가 보고서\n순발전량 P50 ${fi(A.net)} MWh/년` };

  // 표지 · 정보 · 면책 · 차례
  B.push({ t: 'cover' });
  B.push({ t: 'break' });
  B.push({ t: 'kv', rows: [['발주처:', [rc.client, rc.clientAddr].filter(Boolean).join('\n')], ['수행사:', [rc.contractor, rc.contractorAddr].filter(Boolean).join('\n')], ['', ''], ['계약 번호:', rc.contractNo || ''], ['보고서 종류:', typeName], ['단지 이름:', proj], ['국가:', rc.country || ''], ['보고서 번호:', rc.reportNo], ['개정:', rc.rev], ['발행일:', rc.date], ['상태:', rc.status], ['보안 등급:', rc.conf], ['', ''], ['작성:', [rc.issuedBy, rc.issuedDept ? `(${rc.issuedDept})` : ''].filter(Boolean).join('\n')], ['검토:', [rc.reviewedBy, rc.reviewedDept ? `(${rc.reviewedDept})` : ''].filter(Boolean).join('\n')]], widths: [1, 2.4] });
  // 보안 등급 정의 (2쪽 기본)
  B.push({ t: 'h2x', text: '보안 등급' });
  table({ caption: '보안 등급', widths: [0.7, 1.2, 4.1], head: [['등급', '분류', '정의']], rows: [['A', '극비', '본 사업 정보는 회사 주소와 함께 명시적으로 지정된 수신자에게만 공개됩니다.'], ['B', '상업 기밀', '사업 정보는 발주자 회사 및 소속 임직원 이외에는 공개할 수 없습니다.'], ['C', '제한 공개', '발주자가 지정한 회사에 정보를 공개할 수 있습니다.']].map(r => r[0] === rc.conf ? { cells: r, strong: true } : r), align: ['C', 'C', 'L'], nocap: true });
  B.push({ t: 'pagetitle', text: '면책 조항' });
  p('이 보고서는 작성 시점의 지식과 기술 수준에 따라 성실히 작성하였다. 다만 발주처나 제3자가 제공한 자료(측정 자료, 문서, 도면 등)는 작성자가 모두 검증할 수 없었으므로, 계산 결과의 무결함을 보증하지 않는다.');
  p('이 보고서의 결과는 보고서 전체의 맥락과 작성자의 의견, 산정된 불확도를 함께 고려하여 해석해야 한다.');
  B.push({ t: 'h2x', text: '발행 보고서' }); table({ caption: '발행 보고서', widths: [0.8, 1.2, 4], head: [['개정', '날짜', '제목']], rows: [[rc.rev, rc.date, meta.title]], align: ['C', 'C', 'L'], nocap: true });
  B.push({ t: 'h2x', text: '개정 이력' }); table({ caption: '개정 이력', widths: [0.8, 1.2, 4], head: [['개정', '날짜', '변경 내용']], rows: [[rc.rev, rc.date, rc.status === '최종' ? '최종본' : '초안']], align: ['C', 'C', 'L'], nocap: true });
  nt = 0; lot.length = 0;
  B.push({ t: 'pagetitle', text: '차례' }); const tocBlock = { t: 'toc', items: toc }; B.push(tocBlock);
  B.push({ t: 'pagetitle', text: '그림 목록' }); const lofBlock = { t: 'list', items: lof }; B.push(lofBlock);
  B.push({ t: 'pagetitle', text: '표 목록' }); const lotBlock = { t: 'list', items: lot }; B.push(lotBlock);

  // 보고서 요약
  B.push({ t: 'pagetitle', text: '보고서 요약' }); toc.push({ lvl: 0, text: '보고서 요약' });
  p(`이 보고서는 ${proj}의 연간 발전량을 평가한 것이다. ${siteName(S)} 측정 자료를 바탕으로 ${mi ? `${measDates(mi)} 측정한 ` : ''}풍황을 분석하였고${lt.years ? `, ${f(lt.years, 0)}년 이상의 장기 참조 자료(${lt.refType === 'reanalysis' ? '재분석 자료' : '관측 자료'})로 장기 보정된 값` : ''}을 사용하였다. 허브높이 ${f(c.t.hub, 1)} m의 장기 평균풍속은 ${f(c.meanV, 2)} m/s이고, 발전량 비중이 가장 큰 풍향은 ${(() => { const s = c.r.sectors.slice().sort((a, b) => b.freq * b.mwh - a.freq * a.mwh)[0]; return s ? s.dir + '°' : '-'; })()}이다.`);
  p('검토한 터빈 배치는 다음과 같다.'); bullet(`배치 1: ${Tnames.join(' + ')} ${F.rows.length}기, 허브높이 ${f(c.t.hub, 1)} m, 설비용량 ${f(R.capMW, 1)} MW${R.derate ? ` (허가 설비용량에 맞춰 기당 ${R.derate.perMW.map(v => f(v, 2)).join('/')} MW로 출력 제한, 정격 합계 ${f(R.ratedMW, 1)} MW)` : R.permit ? ` (허가 설비용량 ${f(R.permit.mw, 1)} MW 대비 ${f(100 * R.permit.ratio, 1)}%${R.curt > 0 ? `, 단지 출력을 계통연계 용량 ${f(R.permit.gridMW, 1)} MW로 제한 — 출력 상한 손실 ${f(R.curtPct, 2)}%` : ''})` : ''}${Z ? `, 구역 "${Z.name}"` : ''}`);
  p(`총발전량은 터빈 출력곡선과 방향별 풍속 분포로 계산하였고, 후류 손실은 ${wakeDesc}로 산정하였다${(F.ext || []).length ? ` (주변 단지 ${F.ext.reduce((a, g) => a + g.rows.length, 0)}기의 후류 포함)` : ''}. 후류를 포함한 각종 손실을 반영하여 순발전량(P50)을 구하였고, 측정 자료·바람장 모델·단지 효율 등의 불확도를 산정하여 초과확률 75%·90%의 발전량(P75, P90)을 제시하였다. 평가 결과는 다음과 같다.`);
  const lossCatRows = [['가용률', '가용률'], ['전기', '전기'], ['터빈 성능', '터빈'], ['환경', '환경'], ['운전 제한', '운전 제한'], ['출력 제한', '출력 제한'], ['블로키지', '블로키지']].map(([cat, lab]) => [`${lab} [%]`, pct(100 * W.totalLoss(lossOf(cat).map(x => Number.isFinite(x.value) ? x.value : 0)))]);
  const UE = uncRowsEff(F, A.ctx); const topU = UE.rows.map((u, i) => /^[A-H]$/.test(u.code || '') && u.code !== 'F' ? [`${u.label.replace(/\s*\(min.*\)$/i, '')} [%]`, pct(A.U.val[i])] : null).filter(Boolean);
  table({ caption: '발전량 평가 결과 요약', title: '발전량 평가 결과 요약', widths: [3, 2], frac: 0.8, label: true, align: ['L', 'R'], rows: [
    { band: '배치' }, ['배치 1', T.maker || T.name],
    { band: '터빈 사양' }, ['터빈 모델', Tnames.length > 1 ? Tnames.join(' + ') : (T.model || T.name)], ['정격출력 [MW]', f(T.ratedKW / 1000, 1)], ['허브높이 [m]', f(c.t.hub, 1)], ['로터 직경 [m]', f(T.rotor, 0)], ['터빈 수', F.rows.length], ...(R.permit ? [['허가 설비용량 [MW]', f(R.permit.mw, 1)]] : []), ...(R.derate ? [['운전 출력 (출력 제한) [MW/기]', R.derate.perMW.map(v => f(v, 2)).join(' / ')]] : []), ...(R.curt > 0 ? [['계통연계 용량 [MW]', f(R.permit.gridMW, 1)], ['출력 상한 손실 [%]', f(R.curtPct, 2)]] : []), ['설비용량 [MW]', f(R.capMW, 1)],
    { band: '평균풍속' }, ['평균 (허브높이) [m/s]', f(c.meanV, 2)],
    { band: '총발전량' }, ['단지 총발전량 [MWh/년]', fi(R.G)],
    { band: '손실' }, ['후류 손실 [%]', pct(100 * R.wake)], ...lossCatRows, { cells: ['총손실 [%]', pct(100 * A.total)], strong: true },
    { band: '불확도' }, ...topU, { cells: ['결합 표준 불확도 [%]', pct(A.U.total)], strong: true },
    { band: '순발전량' }, ['단지 발전량, P50 [MWh/년]', fi(A.net)], ['이용률, P50 [%]', pct(100 * A.cf)], ['단지 발전량, P75 [MWh/년]', fi(pv(75).mwh)], ['이용률, P75 [%]', pct(100 * pv(75).cf)], ['단지 발전량, P90 [MWh/년]', fi(pv(90).mwh)], ['이용률, P90 [%]', pct(100 * pv(90).cf)]] });

  // 1. 사이트 정보
  h1('사이트 정보');
  h2(`${proj}`);
  const mastU = siteCoord(S) ? W.latLonToUtm(+S.lat, +S.lon, F.zone || 52) : null;
  const cen = [F.rows.reduce((a, r) => a + r.x, 0) / F.rows.length, F.rows.reduce((a, r) => a + r.y, 0) / F.rows.length];
  p(`${proj}는 터빈 ${F.rows.length}기로 구성되며, 배치 중심 좌표는 UTM ${F.zone || 52}N 기준 E ${fi(cen[0])}, N ${fi(cen[1])}이다.${mastU && F.crs === 'utm' ? ` 측정기(${siteName(S)})는 배치 중심에서 약 ${f(Math.hypot(mastU.E - cen[0], mastU.N - cen[1]) / 1000, 1)} km 떨어져 있다.` : ''}${bc ? ` 사업 구역 면적은 ${f(bc.area, 2)} km²이다.` : ''}`);
  await fig(chartLayout(F, R), `${proj} 터빈 배치와 측정기 위치`, 0.8);
  h2('지형 평가');
  p(lt.offshore || lt.coastal ? `단지는 해상에 있어 터빈 위치의 지형 영향은 작다. 측정기는 ${lt.coastal ? '해안(등대·섬 등)' : '해상'}에 있어 해안 지형과 육지 거칠기의 영향을 일부 받을 수 있으며, 이는 불확도의 바람장 모델 항목에 반영하였다.` : '지형 자료가 없어 지형 평가는 하지 않았다. 복잡 지형이면 바람장 모델 결과로 터빈별 풍속을 넣어야 한다.');

  // 2. 측정 풍황 자료 분석
  h1('측정 풍황 자료 분석');
  h2('측정 정보');
  const wgD = S.datasets.find(x => x.type === 'wg'), tsD = S.datasets.find(x => x.type === 'ts' && x.ser);
  const heights = wgD ? wgD.reports[wgD.reports.length - 1].sensors.map(s => s.height) : tsD ? W.seriesHeights(tsD.ser) : [];
  table({ caption: '측정 정보', title: '측정 정보', widths: [1.2, 0.8, 2.6], head: [['항목', { t: '내용', span: 2 }]], rows: [
    ['측정기', '', siteName(S)], ['위치', 'E', mastU ? fi(mastU.E) : '-'], [`(UTM ${F.zone || 52}N)`, 'N', mastU ? fi(mastU.N) : '-'],
    ['설치 표고', '', S.elev !== '' && S.elev != null ? `${S.elev} m` : '-'], ['측정 기간', '', mi ? `${measText(mi)} · ${sref(mi.src, '측정 기간')}` : '-'],
    ['측정 높이', '', heights.length ? heights.join(', ') + ' m' : '-']], align: ['C', 'C', 'L'] });
  if (mi) p(Number.isFinite(mi.from) && Number.isFinite(mi.to) ? `풍황자료는 ${siteName(S)}에서 ${kDate(mi.from)}부터 ${kDate(mi.to)}까지 측정하였다(약 ${f(mi.months, 1)}개월, 근거: ${mi.kind === '보고서' ? sref(mi.src, '측정 기간') : mi.src}).` : `풍황자료 측정 기간은 약 ${f(mi.months, 1)}개월이다(근거: ${sref(mi.src, '측정 기간')}). 시작일과 종료일은 1단계 지점 정보에 넣으면 보고서에 표시된다.`);
  h2('자료 분석');
  if (wgD) {
    const r = wgD.reports[wgD.reports.length - 1];
    p(`측정 자료 요약은 ${sref(r.file, '높이별 풍속 요약')}의 높이별 통계를 사용하였다. 회수율은 오류값을 제외한 유효 자료 비율이다.`);
    table({ caption: '높이별 풍속 요약', title: '높이별 풍속 요약', widths: [0.9, 0.9, 0.8, 0.8, 0.8, 0.9, 0.9], head: [['측정 높이 (m)', '평균 (m/s)', '최대 (m/s)', 'Weibull k', 'Weibull A (m/s)', '유효 자료 수', '회수율 (%)']], rows: r.sensors.map(s => [s.height, f(s.mean, 2), f(s.max, 2), f(s.k, 2), f(s.c, 2), fi(s.valid), f(s.recovery, 2)]), align: ['C', 'R', 'R', 'R', 'R', 'R', 'R'] });
  } else p(`측정 원자료가 없어 자료 분석은 평가 보고서의 결과를 사용하였다 (${sref(d.src, '대표 풍황')}).`);
  h2('시어');
  p(Math.abs(c.t.hub - d.z) > 0.5 ? `대표 풍황 높이(해발 ${f(d.z, 1)} m)에서 허브높이로 멱법칙 시어 지수 α = ${f(c.al.a, 3)}를 적용하였다 (${c.al.src}).` : `대표 풍황이 허브높이(해발 ${f(c.t.hub, 1)} m) 값이므로 높이 환산은 하지 않았다. 참고 시어 지수 α = ${f(c.al.a, 3)} (${c.al.src}).`);
  if (c.al.assumed && Math.abs(c.t.hub - d.z) > 0.5) assume.push(['풍황', `시어 지수 α ${f(c.al.a, 2)}`, c.al.src]);
  if (wgD) { const r = wgD.reports[wgD.reports.length - 1], elev = +S.elev || 0; await fig(chartProfile(r.sensors.map(q => ({ z: q.height + elev, v: q.mean })), c.al.a, null, c.t.hub, ''), '높이별 평균풍속', 0.55); }

  // 3. 풍황 평가
  h1('풍황 평가');
  h2('장기 참조 자료');
  p(lt.years ? `장기 보정에는 ${lt.refType === 'reanalysis' ? '재분석 자료' : lt.refType === 'station' ? '인근 관측소 자료' : '장기 참조 자료'} ${f(lt.years, 1)}년 (${lt.yearsText || ''})을 사용하였다${Number.isFinite(lt.r) ? `. 측정 자료와 장기 참조 자료의 상관계수는 r = ${f(lt.r, 3)}로, ${lt.r >= 0.9 ? '매우 좋음' : lt.r >= 0.8 ? '좋음' : lt.r >= 0.7 ? '보통' : '나쁨'} 수준이다` : ''} (${sref(lt.src, '장기 보정')}).` : '장기 참조 자료 정보가 없다. 1년 미만 측정 자료이면 장기 보정이 필요하다.');
  table({ caption: '상관계수에 따른 장기 참조 자료 품질', title: '상관계수에 따른 품질 판정', widths: [1.4, 1, 1, 1, 1, 1], head: [['상관계수', '0.5 - 0.6', '0.6 - 0.7', '0.7 - 0.8', '0.8 - 0.9', '0.9 - 1.0']], rows: [['품질', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음']], align: ['C', 'C', 'C', 'C', 'C', 'C'] });
  h2('허브높이 장기 풍황');
  h3('장기 풍황 요약');
  await fig(chartHist(Array.from({ length: 30 }, (_, i) => 100 * (Math.exp(-Math.pow(i / (d.A * c.s), d.k)) - Math.exp(-Math.pow((i + 1) / (d.A * c.s), d.k)))), d.k, d.A * c.s, ''), `허브높이(${f(c.t.hub, 1)} m) Weibull 분포`, 0.6);
  table({ caption: `허브높이(${f(c.t.hub, 1)} m) 장기 풍황 요약`, title: '장기 풍황 요약', widths: [2, 1.6], frac: 0.75, label: true, head: [['항목', '값']], rows: [['허브높이 (m)', f(c.t.hub, 1)], ['평균풍속 (m/s)', f(c.meanV, 3)], ['Weibull k', f(d.k, 3)], ['Weibull A (m/s)', f(d.A * c.s, 3)], ['공기밀도 (kg/m³)', f(c.rho, 3)], ['공기밀도 근거', RI.src || '-'], ['방향 분포', d.sectorMode || '방향별 Weibull'], ['대표 풍황 출처', sref(d.src, '대표 풍황')]], align: ['L', 'C'] });
  if (RI.st) { const list = stationsNear(S).filter(x => x.kind !== 'inland').slice(0, 3); table({ caption: '공기밀도 근거 비교 (허브높이)', title: '공기밀도 근거 비교', widths: [2.2, 0.8, 0.9, 0.9, 1, 1], head: [['근거', '종류', '지점까지 [km]', '평년 기온 [℃]', '공기밀도 [kg/m³]', '사용 중 대비']], rows: [[`대표 풍황 값 (${RI.dk === 'report' ? '보고서 장기값' : RI.dk === 'measured' ? '1년 측정값' : '표준값'})`, '-', '-', '-', f(RI.rhoD, 3), `${f(100 * (RI.rhoD / c.rho - 1), 2)}%`], ...list.map(st => [`기상청 ${st.name} 평년값 (1991~2020)`, KIND_KO[st.kind], f(st.dist, 0), f(st.T, 1), f(rhoFromStation(st, c.t.hub), 3), `${f(100 * (rhoFromStation(st, c.t.hub) / c.rho - 1), 2)}%`])], align: ['L', 'C', 'C', 'C', 'C', 'C'] }); p(`사용한 공기밀도는 ${f(c.rho, 3)} kg/m³이다 (${RI.src}). 관측소 값은 평년 기온을 고도감률 0.65℃/100 m로 허브높이에 옮기고 표준대기 기압으로 계산하였다.`); }
  if (RI.use === 'design' && RI.dk === 'measured') assume.push(['풍황', '공기밀도', '1년 측정값을 사용 — 장기값(보고서·관측소 평년값)으로 바꾸는 것이 원칙']);
  h3('방향별 통계');
  await fig(chartRose(c.r.sectors.map(x => ({ ...x })), 'freq', '', ''), '풍향별 빈도', 0.42);
  table({ caption: `허브높이(${f(c.t.hub, 1)} m) 방향별 장기 풍황`, title: '방향별 장기 풍황', widths: [1, 1, 1, 1, 1, 1], head: [['방향 (°)', '빈도 (%)', '평균 (m/s)', 'Weibull k', 'Weibull A (m/s)', '발전량 비율 (%)']], rows: [...c.sectors.map((x, i) => { const r = c.r.sectors[i] || {}; return [x.dir, f(r.freq, 2), f(r.meanV, 2), f(x.k, 2), f(x.A * c.s, 2), f(100 * (r.freq / 100 * r.mwh) / c.r.mwh, 1)]; }), { cells: ['전체', '100.00', f(c.meanV, 2), f(d.k, 2), f(d.A * c.s, 2), '100.0'], strong: true }], align: ['C', 'C', 'C', 'C', 'C', 'C'] });

  // 4. 터빈 최적화
  h1('터빈과 배치');
  h2('터빈'); h3('터빈 사양');
  table({ caption: '터빈 사양', title: '터빈 사양', widths: [1.6, 1.6], frac: 0.8, label: true, rows: [['제작사', T.maker || '-'], ['모델', T.model || T.name], ['정격출력 [MW]', f(T.ratedKW / 1000, 1)], ['로터 직경 [m]', f(T.rotor, 0)], ['허브높이 [m]', f(c.t.hub, 1)], ['출력 제어', T.regulation === 'stall' ? '실속 제어' : '피치 제어, 가변속'], ['시동 / 정격 / 정지 풍속 [m/s]', (() => { const cv = T.curve, ci = cv.find(x => x[1] > 0), rr = cv.find(x => x[1] >= T.ratedKW * 0.999), co = cv[cv.length - 1]; return `${ci ? ci[0] : '-'} / ${rr ? rr[0] : '-'} / ${co ? co[0] : '-'}`; })()], ['출력곡선 종류', { measured: '실측 인증 곡선', warranted: '보증 곡선', calc: '계산 곡선' }[T.curveType] || '모름'], ['출력곡선 기준 공기밀도 [kg/m³]', f(T.rhoRef, 3)], ['자료 출처', sref(T.source, '출력곡선·터빈 사양') || '-']], align: ['C', 'C'] });
  if (T.rhoRefNote) assume.push(['터빈', '출력곡선 기준 공기밀도', T.rhoRefNote]);
  if (!T.curveType || T.curveTypeNote) assume.push(['터빈', '출력곡선 종류', T.curveTypeNote || '미입력 — 계산 곡선으로 가정']);
  h3('출력·추력 곡선');
  await fig(chartLines(T.curve.map(x => x[0]), [{ name: '출력 (kW)', y: T.curve.map(x => x[1]), c: '#2a78d6' }, { name: '추력계수 × 10,000', y: T.curve.map(x => x[2] * 10000), c: '#eb6834' }], '', '풍속 (m/s)', 'kW / Ct×10⁴', { zero: true }), '출력·추력 곡선', 0.65);
  const cv = T.curve, half = Math.ceil(cv.length / 2);
  table({ caption: '출력·추력 곡선', title: T.name, widths: [1, 1, 1, 1, 1, 1], head: [['풍속 [m/s]', '출력 [kW]', '추력 [-]', '풍속 [m/s]', '출력 [kW]', '추력 [-]']], rows: Array.from({ length: half }, (_, i) => { const a = cv[i], b = cv[i + half]; return [a[0], f(a[1], 1), f(a[2], 3), b ? b[0] : '', b ? f(b[1], 1) : '', b ? f(b[2], 3) : '']; }), align: ['C', 'C', 'C', 'C', 'C', 'C'] });
  p(`공기밀도 보정은 ${c.t.dens === 'iec' ? 'IEC 61400-12-1 풍속 보정(피치 제어)' : c.t.dens === 'power' ? '출력 비례 보정(실속 제어)' : '하지 않음'}으로 하였고, 허브높이 공기밀도는 ${f(c.rho, 3)} kg/m³이다.`);
  h2('터빈 배치');
  await fig(chartLayout(F, R), '터빈 배치', 0.8);
  table({ caption: '터빈 좌표', title: '터빈 좌표', widths: [1, 1.6, 0.8, 0.8, 0.8, 1.1, 1.1], head: [['터빈', '터빈 형식', '허브높이 [m]', '로터 [m]', '정격 [MW]', `E [m]`, `N [m]`]], rows: F.rows.map(r => [r.name, T.model || T.name, f(c.t.hub, 1), f(T.rotor, 0), f(T.ratedKW / 1000, 1), fi(r.x), fi(r.y)]), align: ['C', 'C', 'C', 'C', 'C', 'C', 'C'] });
  p(`좌표계는 ${F.crs === 'utm' ? `UTM ${F.zone || 52}N (WGS84)` : '도면 좌표'}이다. 최소 터빈 간격은 ${f(Math.min(...R.spacing), 1)}D (${fi(Math.min(...R.spacing) * T.rotor)} m)이고, 터빈을 가장 짧게 잇는 내부 케이블 길이(최소 연결)는 약 ${f(R.mst.len / 1000, 1)} km이다. 배치 출처: ${sref(F.source, '터빈 배치') || '-'}.`);
  if (Tnames.length > 1) p(`이 배치는 터빈 모델을 섞어 썼다: ${Tnames.map(nm => `${nm} ${R.Ti.filter(x => x.name === nm).length}기`).join(', ')}.`);
  p(`간격 기준(주풍향 ${f(R.sp.dir, 0)}° 방향 ${R.sp.rule.main}D × 직각 방향 ${R.sp.rule.cross}D)으로 검토하면 ${R.sp.bad.length ? `기준에 못 미치는 터빈 쌍이 ${R.sp.bad.length}개 있다. 제작사 하중 검토로 허용 여부를 확인해야 한다.` : '모든 터빈 쌍이 기준을 만족한다.'}`);
  if (R.sp.bad.length) assume.push(['배치', '터빈 간격', `간격 기준 미달 ${R.sp.bad.length}쌍 — 제작사 하중 검토 필요`]);
  if ((F.ext || []).length) p(`주변 단지 ${F.ext.map(g => `${g.name}(${g.rows.length}기)`).join(', ')}의 후류를 계산에 넣었다(발전량 합계에는 넣지 않음).`);
  if (bc) {
    h2('사업 구역');
    if (bc.B.length) table({ caption: `사업 구역 (${bc.Z.name})`, title: '사업 구역', widths: [1.6, 0.7, 0.9, 1.1, 2.2], head: [['구역', '꼭짓점', '면적 [km²]', '설비 밀도 [MW/km²]', '출처']], rows: bc.B.map(b => { const a = W.polyArea(b.pts) / 1e6; const n = F.rows.filter(r => W.inPoly(r.x, r.y, b.pts)).length; return [b.name, b.pts.length, f(a, 2), n ? f(R.Ti.filter((x, i) => W.inPoly(F.rows[i].x, F.rows[i].y, b.pts)).reduce((q, x) => q + x.ratedKW / 1000, 0) / a, 2) : '-', sref(b.src, '사업 구역')]; }), align: ['C', 'C', 'C', 'C', 'L'] });
    const exShow = bc.E.filter(e => e.kind !== '기타'); // 보고서에는 종류 "기타" 제외 구역은 싣지 않음(사용자 요청)
    if (exShow.length) table({ caption: '제외 구역', title: '제외 구역', widths: [1.6, 1, 0.7, 0.8, 1.2, 1.8], head: [['이름', '종류', '모양', '이격 [m]', '가장 가까운 터빈까지 [m]', '출처']], rows: exShow.map(e => { let best = Infinity, nm = ''; F.rows.forEach(r => { const v = exclDist(r.x, r.y, e) + (+e.buffer || 0); if (v < best) { best = v; nm = r.name; } }); return [e.name, e.kind, e.shape === 'line' ? '선' : '면', e.buffer || 0, `${fi(best)} (${nm})`, sref(e.src, '제외 구역')]; }), align: ['C', 'C', 'C', 'C', 'C', 'L'] });
    if (bc.exIn.length) bullet(`제외 구역(이격 포함) 안에 있는 터빈 ${bc.exIn.length}기: ${bc.exIn.join(', ')}. 위치 조정이 필요하다.`);
    if (bc.exTip.length) bullet(`블레이드 끝이 제외 구역 이격 범위에 들어가는 터빈 ${bc.exTip.length}기: ${bc.exTip.join(', ')}.`);
    if (bc.exIn.length || bc.exTip.length) assume.push(['배치', '제외 구역', [bc.exIn.length ? `침범 ${bc.exIn.join(', ')}` : '', bc.exTip.length ? `블레이드 이격 위반 ${bc.exTip.join(', ')}` : ''].filter(Boolean).join(' / ')]);
    if (bc.out.length) bullet(`구역 밖 터빈 ${bc.out.length}기: ${bc.out.join(', ')}`);
    if (bc.tip.length) bullet(`블레이드 끝(로터 반지름 ${f(bc.rad, 1)} m)이 경계를 넘는 터빈 ${bc.tip.length}기: ${bc.tip.join(', ')}. 허가 조건이 블레이드 회전 범위를 포함하면 위치 조정이 필요하다.`);
    if (bc.B.length && !bc.out.length && !bc.tip.length) bullet(`모든 터빈과 블레이드 끝이 사업 구역 안에 있다 (경계까지 최소 ${fi(Math.min(...bc.tur.map(t => t.d)))} m).`);
    if (bc.out.length || bc.tip.length) assume.push(['배치', '구역 경계', [bc.out.length ? `구역 밖 ${bc.out.join(', ')}` : '', bc.tip.length ? `블레이드 경계 초과 ${bc.tip.join(', ')}` : ''].filter(Boolean).join(' / ')]);
  }

  // 5. 발전량 평가
  h1('발전량 평가');
  h2('연간 발전량');
  p(`터빈별 총발전량은 허브높이 방향별 풍속 분포와 출력곡선으로 계산하였고, 후류 손실은 ${wakeDesc}로 방향 1° 간격, 풍속 0.5 m/s 구간으로 산정하였다. 터빈별 풍속은 ${speedDesc}을 적용하였다.`);
  table({ caption: '터빈별 연간 발전량', title: '터빈별 연간 발전량', widths: [1, 0.8, 1.1, 0.9, 0.9, 1.1, 0.9], head: [[{ t: '총발전량', span: 5 }, { t: '단지 내 결과', span: 2 }], ['터빈', '풍속 [m/s]', '발전량 [MWh/년]', '공기밀도 [kg/m³]', '이용률 [-]', '발전량 [MWh/년]', '효율 [-]']],
    rows: [...F.rows.map((r, i) => [r.name, Number.isFinite(r.vRep) && F.speed === 'report' ? f(r.vRep, 2) : f(c.meanV, 2), fi(R.r.gross[i]), f(c.rho, 3), `${f(100 * R.r.gross[i] / (T.ratedKW / 1000 * c.t.hours), 1)}%`, fi(R.r.net[i]), `${f(100 * R.eff[i], 1)}%`]),
      { cells: ['평균', '', fi(R.G / F.rows.length), f(c.rho, 3), `${f(100 * R.G / (R.capMW * c.t.hours), 1)}%`, fi(R.N / F.rows.length), `${f(100 * (1 - R.wake), 2)}%`], strong: true }, { cells: ['단지 합계', '', fi(R.G), '', '', fi(R.N), ''], strong: true }], align: ['C', 'C', 'C', 'C', 'C', 'C', 'C'] });
  const lrows = [{ band: '총발전량' }, ['단지 총발전량 [MWh/년]', fi(R.G), ''], { band: '단지 효율' }, ['후류 손실', pct(100 * R.wake), '4단계 후류 계산']];
  const catName = { '가용률': '가용률 손실', '전기': '전기 손실', '터빈 성능': '터빈 손실', '환경': '환경 손실', '운전 제한': '운전 제한', '출력 제한': '출력 제한', '블로키지': '블로키지' };
  LOSS_TEMPLATE.forEach(([cat]) => { lrows.push({ band: catName[cat] || cat }); lossOf(cat).forEach(x => { const basis = x.calc ? x.calc : F.lossSrc[x.key] ? sref(F.lossSrc[x.key], '손실') : Number.isFinite(x.input) ? '직접 입력' : x.auto ? `중간값: ${x.cond.label}` : '0 (비어 있음)'; lrows.push([x.label, pct(x.value), basis]); if (x.auto && /기본값|가정|확인/.test(x.cond.src)) assume.push(['손실', x.label, `${pct(x.value)}% — ${x.cond.label} (${x.cond.src})`]); }); });
  lrows.push({ band: '총손실' }, { cells: ['총손실', pct(100 * A.total), Number.isFinite(rep.total) ? `보고서 ${pct(rep.total)}%` : ''], strong: true }, { band: '손실 반영 순발전량' }, { cells: ['단지 발전량, P50 [MWh/년]', fi(A.net), ''], strong: true }, { cells: ['이용률, P50', pct(100 * A.cf), ''], strong: true });
  table({ caption: '손실을 반영한 연간 발전량', title: '손실', widths: fitW(lrows), label: true, head: [['항목', '값 [%]', '근거']], rows: lrows, align: ['L', 'R', 'L'] });
  h2('불확도');
  const frame = F.uncFrame === 'report' ? `평가 보고서의 항목 ${sref(F.uncSrc || rep.file || '', '불확도')}` : (UNC_FRAMES[F.uncFrame || 'tr6'] || UNC_FRAMES.tr6).name;
  p(`불확도 항목 틀은 ${frame}을 사용하였다. 묶음 안 항목과 묶음끼리는 제곱합의 제곱근으로 합쳤고, 값이 비어 있는 항목은 조건 범위의 중간값을 적용하였다.`);
  const urows = [];
  UE.rows.forEach((u, i) => { const cr = UE.conds[i]; const grp = !!u.code; const basis = F.unc[i].src ? sref(F.unc[i].src, '불확도') : Number.isFinite(F.unc[i].value) ? (F.uncFrame === 'report' ? '보고서 값' : '직접 입력') : u.auto && cr ? `중간값: ${cr.label}` : ''; const lab = `${u.code ? u.code + '. ' : ''}${u.label}`; if (grp) urows.push({ cells: [lab, pct(A.U.val[i]), basis], strong: true }); else urows.push([lab, pct(u.value), basis]); if (u.auto && cr && /기본값|가정|확인/.test(cr.src || '')) assume.push(['불확도', u.label, `${pct(u.value)}% — ${cr.label} (${cr.src})`]); });
  urows.push({ cells: ['결합 표준 불확도, Uc', pct(A.U.total), Number.isFinite(rep.uc) ? `보고서 ${pct(rep.uc)}%` : ''], strong: true });
  table({ caption: '불확도', title: '불확도', widths: fitW(urows), head: [['항목', '값 [%]', '근거']], rows: urows, align: ['L', 'R', 'L'] });
  if (A.U.empty.length) bullet(`비어 있는 묶음: ${A.U.empty.join(', ')} — 결합 불확도와 P75·P90이 실제보다 유리하게 나올 수 있다.`);
  h2('초과확률별 발전량');
  p(`초과확률별 발전량은 정규분포를 가정하여 P50 × (1 − z × Uc)로 산정하였다 (P50 ${fi(A.net)} MWh/년, Uc ${pct(A.U.total)}%).`);
  await fig(chartLines(A.pv.map(x => x.p), [{ name: '발전량', y: A.pv.map(x => x.mwh), c: '#2a78d6' }], '', '초과확률 (%)', '발전량 (MWh/년)', { yfmt: v => fi(v) }), '초과확률별 연간 발전량', 0.6);
  table({ caption: '초과확률별 연간 발전량', title: '초과확률별 연간 발전량', widths: [1, 1.4, 1], frac: 0.7, head: [['P [%]', '발전량 [MWh/년]', '이용률 [%]']], rows: A.pv.map(x => ({ cells: [x.p, fi(x.mwh), f(100 * x.cf, 2)], strong: [50, 75, 90].includes(x.p) })), align: ['C', 'C', 'C'] });

  // 부록
  h1('확인이 필요한 가정');
  p('아래 항목은 자료가 없어 기본값이나 가정으로 계산하였다. 제작사 자료, 설계 계산서, 협의 조건 등으로 확인하여 바꾸면 결과가 달라질 수 있다.');
  assume.push(['손실·불확도', '조건별 범위', '조건표의 범위는 공식 기준이 아니라 평가 보고서 사례에 맞춘 임시 기준이다.']);
  table({ caption: '확인이 필요한 가정', title: '가정 목록', widths: [0.9, 1.6, 4], head: [['구분', '항목', '내용']], rows: assume, align: ['C', 'L', 'L'] });
  if (refs.length) { h2('참고 자료'); table({ caption: '참고 자료', title: '참고 자료', widths: [0.8, 3.6, 2.6], head: [['기호', '파일', '가져온 내용']], rows: refs.map((r, i) => [`[자료${i + 1}]`, r, [...(refUse[r] || [])].join(', ') || '-']), align: ['C', 'L', 'L'] }); }
  return { meta, blocks: B, toc, lof, lot, key: reportKey(F) };
}
const siteKeyOf = F => { const S = P.sites.find(x => x.id === F.siteId) || {}; return [S.name, S.elev, S.note, S.measFrom, S.measTo, S.lat, S.lon]; };
const reportKey = F => { try { const R = farmCalc(F); const A = R ? aepCalc(F) : null; return JSON.stringify([F.id, F.name, R && R.key, A && [A.net, A.U.total, A.total], P.report, JSON.stringify(zoneOf(F) || null), R && R.c.rho, siteKeyOf(F), F.ext, F.spRule, F.speed, F.lossSel, F.uncSel, F.uncFrame]); } catch (e) { return String(Math.random()); } };

// ===== 보고서 쪽 나누기 (HTML) =====
const RP_CSS = `.rp-page{width:210mm;height:297mm;position:relative;background:#fff;box-sizing:border-box;font-family:'Malgun Gothic','Noto Sans KR','Noto Sans CJK KR',sans-serif;color:#000;overflow:hidden}
.rp-hdr{position:absolute;left:20mm;right:20mm;top:11mm;font-size:7.5pt;color:#333;border-bottom:1.3pt solid #1F5FA8;padding-bottom:1.4mm}
.rp-ftr{position:absolute;left:20mm;right:20mm;bottom:9mm;font-size:7.5pt;color:#333;border-top:.6pt solid #7f7f7f;padding-top:1.4mm;display:flex;justify-content:space-between}
.rp-body{position:absolute;left:20mm;right:20mm;top:24mm;bottom:20mm}
.rp-b{padding-bottom:2.2mm}
.rp-h1{font-size:12pt;font-weight:700;color:#1F5FA8;padding:3mm 0 1.5mm}.rp-h2{font-size:10.5pt;font-weight:700;color:#1F5FA8;padding:2mm 0 1mm}.rp-h3{font-size:9.5pt;font-weight:700;color:#1F5FA8;padding:1.5mm 0 .5mm}
.rp-h2x{font-size:10pt;font-weight:700;color:#1F5FA8;padding:3mm 0 1mm}
.rp-pt{font-size:13pt;font-weight:700;color:#1F5FA8;text-align:center;padding:2mm 0 6mm}
.rp-p{font-size:9pt;line-height:1.95;text-align:justify}.rp-small{font-size:8pt;color:#555}
.rp-bul{font-size:9pt;line-height:1.95;padding-left:5mm;text-indent:-3mm}
.rp-cap{font-size:8pt;text-align:center;padding:1.5mm 0 1.5mm}
.rp-fig{text-align:center}.rp-fig img{display:inline-block}
table.rt{border-collapse:collapse;margin:0 auto;font-size:7.8pt;table-layout:fixed}
table.rt td,table.rt th{border:.5pt solid #7f7f7f;padding:.9mm 1.6mm;line-height:1.35;word-break:break-all}
table.rt th{background:#D9D9D9;font-weight:700;text-align:center}
table.rt th.ttl{background:#0B5CAD;color:#fff}
table.rt tr.band td{background:#E7E6E6;font-weight:700}
table.rt tr.str td{background:#E7E6E6;font-weight:700}
table.rt td.lbl{background:#F2F2F2}
table.kv{border-collapse:collapse;width:100%;font-size:8.5pt}table.kv td{padding:1.2mm 1mm;vertical-align:top;white-space:pre-line}table.kv td:first-child{font-weight:700;width:30%}
.rp-toc1{font-size:9pt;font-weight:700;display:flex;padding-top:2.4mm}.rp-toc2{font-size:9pt;display:flex;padding:.8mm 0 0 7mm}
.rp-toc1 .d,.rp-toc2 .d{flex:1;border-bottom:.8pt dotted #777;margin:0 2mm .9mm}
.rp-cover{position:absolute;inset:0}.rp-cover .band{position:absolute;left:12mm;right:12mm;top:12mm;height:95mm;background:linear-gradient(180deg,#5d95c8 0%,#9cc4e4 55%,#2c5f8f 56%,#18456f 100%)}
.rp-cover .band b{position:absolute;left:0;right:0;bottom:6mm;text-align:center;color:#fff;font-size:24pt;font-weight:800;text-shadow:0 1px 3px rgba(0,0,0,.3)}
.rp-cover .t1{position:absolute;top:122mm;left:0;right:0;text-align:center;font-size:16pt;font-weight:700;line-height:1.9}
.rp-cover .t2{position:absolute;top:210mm;left:0;right:0;text-align:center;font-size:11pt;font-weight:700;line-height:2.1}
.rp-cover .foot{position:absolute;left:12mm;right:12mm;bottom:12mm;height:14mm;background:linear-gradient(90deg,#fff,#d9d9d9)}`;
const rpEsc = s => esc(s == null ? '' : String(s));
function rpTableHtml(b, rowsSlice, withTitle) {
  const nC = b.widths.length, ws = b.widths.reduce((a, x) => a + x, 0);
  let h = `<table class="rt" style="width:${(b.frac || 1) * 100}%"><colgroup>${b.widths.map(w => `<col style="width:${(100 * w / ws).toFixed(2)}%">`).join('')}</colgroup>`;
  if (b.title) h += `<tr><th class="ttl" colspan="${nC}">${rpEsc(b.title)}</th></tr>`;
  (b.head || []).forEach(hr => { h += '<tr>' + hr.map(x => x && typeof x === 'object' ? `<th colspan="${x.span || 1}">${rpEsc(x.t)}</th>` : `<th>${rpEsc(x)}</th>`).join('') + '</tr>'; });
  rowsSlice.forEach(r => {
    if (r && r.band != null) { h += `<tr class="band"><td colspan="${nC}">${rpEsc(r.band)}</td></tr>`; return; }
    const cells = r.cells || r; h += `<tr class="${r.strong ? 'str' : ''}">` + cells.map((v, ci) => `<td class="${b.label && ci === 0 && !r.strong ? 'lbl' : ''}" style="text-align:${({ L: 'left', C: 'center', R: 'right' })[(b.align || [])[ci] || (ci === 0 ? 'L' : 'C')]}">${rpEsc(v).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>';
  });
  return h + '</table>';
}
function rpBlockHtml(b, M) {
  switch (b.t) {
    case 'h1': return `<div class="rp-h1">${rpEsc(b.num)}&nbsp;&nbsp;${rpEsc(b.text)}</div>`;
    case 'h2': return `<div class="rp-h2">${rpEsc(b.num)}&nbsp;&nbsp;${rpEsc(b.text)}</div>`;
    case 'h3': return `<div class="rp-h3">${rpEsc(b.num)}&nbsp;&nbsp;${rpEsc(b.text)}</div>`;
    case 'h2x': return `<div class="rp-h2x">${rpEsc(b.text)}</div>`;
    case 'pagetitle': return `<div class="rp-pt">${rpEsc(b.text)}</div>`;
    case 'p': return `<div class="rp-p">${rpEsc(b.text)}</div>`;
    case 'small': return `<div class="rp-small">${rpEsc(b.text)}</div>`;
    case 'bullet': return `<div class="rp-bul">•&nbsp;&nbsp;${rpEsc(b.text)}</div>`;
    case 'kv': return `<table class="kv">${b.rows.map(r => `<tr><td>${rpEsc(r[0])}</td><td>${rpEsc(r[1])}</td></tr>`).join('')}</table>`;
    case 'fig': return `<div class="rp-fig">${b.png ? `<img src="${b.png.url}" style="width:${((b.frac || 0.75) * 170).toFixed(1)}mm;height:${((b.frac || 0.75) * 170 * b.png.h / b.png.w).toFixed(1)}mm">` : ''}</div>${b.caption ? `<div class="rp-cap">${rpEsc(b.caption)}</div>` : ''}`;
    case 'toc': return b.items.map(it => `<div class="${it.lvl <= 1 ? 'rp-toc1' : 'rp-toc2'}"><span>${it.lvl === 1 ? `${it.num}.&nbsp;&nbsp;` : it.lvl === 2 ? `${it.num}&nbsp;&nbsp;` : ''}${rpEsc(it.text)}</span><span class="d"></span><span>${M.pages[it.key] || ''}</span></div>`).join('');
    case 'list': return b.items.map(it => `<div class="rp-toc2" style="padding-left:0"><span>${rpEsc(it)}</span><span class="d"></span><span>${M.pages[it] || ''}</span></div>`).join('');
  }
  return '';
}
function rpLayout(model) {
  const mm = 3.7795275591, bodyH = (297 - 24 - 20) * mm;
  const meas = document.createElement('div'); meas.style.cssText = 'position:absolute;left:-10000px;top:0;width:170mm;visibility:hidden';
  meas.innerHTML = `<style>${RP_CSS}</style><div class="rp-page" style="height:auto;width:210mm"><div style="position:relative;width:170mm" id="rpm"></div></div>`; document.body.appendChild(meas);
  const box = meas.querySelector('#rpm');
  const H = html => { box.innerHTML = `<div class="rp-b">${html}</div>`; return box.firstChild.offsetHeight; };
  const M = { pages: {} };
  // 차례 키
  model.toc.forEach(it => it.key = 'toc:' + (it.num || '') + it.text);
  const run = () => {
    const pages = [{ cover: true, items: [] }]; let cur = null, used = 0;
    const newPage = () => { cur = { items: [] }; pages.push(cur); used = 0; };
    const put = (html, h) => { if (!cur) newPage(); if (used + h > bodyH && used > 0) newPage(); cur.items.push(html); used += h; };
    const B = model.blocks;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.t === 'cover') continue;
      if (b.t === 'break' || (b.t === 'pagetitle' && b.br !== false) || (b.t === 'h1' && b.br)) { newPage(); if (b.t === 'break') continue; }
      const pageNo = () => pages.length;
      if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3' || b.t === 'pagetitle') {
        const html = rpBlockHtml(b, M), h = H(html);
        const nx = B[i + 1]; let need = h; if (nx && !['break', 'pagetitle'].includes(nx.t) && !(nx.t === 'h1' && nx.br)) need += Math.min(nx.t === 'table' ? H(rpTableHtml(nx, (nx.rows || []).slice(0, 2))) + 20 : H(rpBlockHtml(nx, M)), bodyH * 0.25);
        if (used + need > bodyH && used > 0) newPage();
        put(html, h);
        const key = b.t === 'pagetitle' ? 'toc:' + b.text : 'toc:' + (b.num ? b.num.replace(/\.$/, '') : '') + b.text; M.pages[key] = pageNo();
        if (b.t === 'pagetitle' && b.text === '보고서 요약') M.pages['toc:보고서 요약'] = pageNo();
        continue;
      }
      if (b.t === 'table') {
        const capH = b.nocap ? 0 : H(`<div class="rp-cap">${rpEsc(b.caption)}</div>`);
        const full = H(rpTableHtml(b, b.rows)) + capH;
        if (used + full <= bodyH || full > bodyH && used + capH + H(rpTableHtml(b, b.rows.slice(0, 3))) <= bodyH) {
          if (used + full > bodyH && full <= bodyH) newPage();
          // 쪽에 맞게 행 나누기 (제목·머리 행 반복)
          let rest = b.rows.slice(), first = true;
          while (rest.length) {
            let n = rest.length; const room = bodyH - used - (first ? capH : 0);
            while (n > 1 && H(rpTableHtml(b, rest.slice(0, n))) > room) n = Math.max(1, Math.floor(n * 0.85) < n - 1 ? Math.floor(n * 0.85) : n - 1);
            if (H(rpTableHtml(b, rest.slice(0, n))) > room && used > 0) { newPage(); continue; }
            const html = (first && !b.nocap ? `<div class="rp-cap">${rpEsc(b.caption)}</div>` : '') + rpTableHtml(b, rest.slice(0, n));
            const h = H(html); if (!cur) newPage(); cur.items.push(html); used += h; if (first) M.pages[b.caption] = pages.length;
            rest = rest.slice(n); first = false; if (rest.length) newPage();
          }
        } else { newPage(); i--; }
        continue;
      }
      const html = rpBlockHtml(b, M), h = H(html);
      put(html, h);
      if (b.t === 'fig' && b.caption) M.pages[b.caption.replace(/\s{3}\(.*\)$/, '')] = pages.length;
    }
    return pages;
  };
  let pages = run(); pages = run(); // 두 번: 차례 쪽 번호가 채워진 높이로 다시
  meas.remove();
  return { pages, M };
}
function rpPagesHtml(model, L) {
  const { meta } = model, total = L.pages.length;
  return L.pages.map((pg, i) => pg.cover
    ? `<div class="rp-page"><div class="rp-cover"><div class="band"><b>${rpEsc(meta.coverBand)}</b></div><div class="t1">${rpEsc(meta.project)}:<br>${rpEsc(meta.typeName)}</div><div class="t2">보고서 번호 : ${rpEsc(meta.reportNo)}<br>개정 ${rpEsc(meta.rev)}<br>날짜 : ${rpEsc(meta.date)}</div><div class="foot"></div></div></div>`
    : `<div class="rp-page"><div class="rp-hdr">${rpEsc(meta.header)}</div><div class="rp-body">${pg.items.map(x => `<div class="rp-b">${x}</div>`).join('')}</div><div class="rp-ftr"><span>${rpEsc(meta.reportNo)}</span><span>개정 ${rpEsc(meta.rev)}</span><span>쪽 ${i + 1} / ${total}</span></div></div>`);
}
// ===== PDF (쪽 그림 → JPEG → PDF) =====
function rpPageToJpeg(pageHtml, scale = 2) {
  return new Promise(res => {
    const w = 794, h = 1123;
    const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml"><style>${RP_CSS}</style>${pageHtml.replace(/<br>/g, '<br/>').replace(/<col ([^>]*?)>/g, '<col $1/>').replace(/<img ([^>]*?)>/g, '<img $1/>').replace(/&nbsp;/g, '&#160;')}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); const url = c.toDataURL('image/jpeg', 0.88); const bin = atob(url.split(',')[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); res({ data: a, w: c.width, h: c.height }); } catch (e) { console.warn(e); res(null); } };
    img.onerror = e => { console.warn('page render failed', e); res(null); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
function buildPdf(jpegs, title, size) {
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpegs.length; const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
  const kids = jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  jpegs.forEach((j, i) => {
    const pId = 3 + i * 3, cId = pId + 1, iId = pId + 2; const W0 = size ? size[0] : 595.28, H0 = size ? size[1] : 841.89;
    obj(pId, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W0} ${H0}] /Resources << /XObject << /Im0 ${iId} 0 R >> >> /Contents ${cId} 0 R >>`));
    const cs = `q ${W0} 0 0 ${H0} 0 0 cm /Im0 Do Q`;
    obj(cId, () => { push(`<< /Length ${cs.length} >>\nstream\n`); push(cs); push('\nendstream'); });
    obj(iId, () => { push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.data.length} >>\nstream\n`); push(j.data); push('\nendstream'); });
  });
  const infoId = 3 + n * 3; const tHex = Array.from(title || '').map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  obj(infoId, () => push(`<< /Title <FEFF${tHex}> /Producer (wind-energy-tool) >>`));
  const xref = len; push(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= infoId; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0; parts.forEach(b => { out.set(b, o); o += b.length; }); return out;
}
// ===== 6단계 화면 =====
async function rpEnsure(F) {
  const key = reportKey(F);
  if (ui.rp && ui.rp.key === key && ui.rp.fid === F.id) return ui.rp;
  const model = await reportModel(F); const L = rpLayout(model);
  ui.rp = { key, fid: F.id, model, L, pages: rpPagesHtml(model, L) }; return ui.rp;
}
function viewReport() {
  if (!P.farms || !P.farms.length) return `<div class="card empty">먼저 4단계(배치·후류)에서 단지를 만들어 주세요.</div>`;
  const F = farmSel(); ui.farmSel = F.id; const rc = reportCfg();
  const S = P.sites.find(s => s.id === F.siteId);
  let h = `<div class="card"><h2>보고서 <span class="sub">발전량 평가 보고서 구성으로 만듭니다 · 한글(HWPX)과 PDF</span></h2>
   <div class="row"><div class="fld"><label>단지 제목 (표지·머리말·본문)</label><input data-farm="name" value="${esc(F.name)}" style="width:320px"></div><div class="fld"><label>보고서 대상 단지(배치안)</label><select data-act2="rpfarm">${P.farms.map(x => `<option value="${x.id}" ${x.id === F.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
   <button class="btn pri" data-act="rphwpx">한글(HWPX) 내려받기</button><button class="btn pri" data-act="rppdf">PDF 내려받기</button><button class="btn" data-act="rpmake">미리보기 다시 만들기</button></div>
   ${!S || !S.design ? '<div class="warnbox"><div>이 단지의 지점에 대표 풍황이 없습니다. 1단계에서 지정해 주세요.</div></div>' : ''}
   <h3 style="margin:12px 0 6px;font-size:13px">보고서 정보 <span class="hint">표지·정보 쪽·머리말·꼬리말에 들어갑니다. 비어 있으면 빈칸으로 둡니다.</span></h3>
   <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px 14px">${REPORT_FIELDS.map(([k, l]) => `<div class="fld"><label>${l}${rc[k] ? '' : ' <span class="tag blank">비어 있음</span>'}</label>${k === 'status' ? `<select data-rp="status">${['초안', '최종'].map(o => `<option ${rc.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select>` : `<input data-rp="${k}" value="${esc(rc[k] || '')}" style="width:100%">`}</div>`).join('')}
   <div class="fld"><label>보안 등급</label><select data-rp="conf">${['A', 'B', 'C'].map(o => `<option ${rc.conf === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div></div></div>`;
  const ok = ui.rp && ui.rp.fid === F.id && ui.rp.key === reportKey(F);
  h += `<div class="card"><h2>미리보기 <span class="sub">${ok ? `${ui.rp.pages.length}쪽 · 한글에서 열면 줄바꿈·쪽 나눔이 조금 다를 수 있습니다` : '만드는 중…'}</span></h2><div id="rpPrev" class="rp-prev">${ok ? ui.rp.pages.map(x => `<div class="rp-wrap">${x}</div>`).join('') : '<div class="hint">보고서를 만드는 중입니다…</div>'}</div></div>`;
  if (!ok && S && S.design) setTimeout(async () => { try { await rpEnsure(F); if (ui.tab === 'report') render(); } catch (e) { console.error(e); toast('보고서를 만들지 못했습니다: ' + e.message, 6000); } }, 30);
  return `<style>${RP_CSS}.rp-prev{display:flex;flex-wrap:wrap;gap:14px;background:#e9e9e6;padding:14px;border-radius:6px;max-height:900px;overflow:auto}.rp-wrap{width:calc(210mm * .62);height:calc(297mm * .62);overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.25);background:#fff}.rp-wrap>.rp-page{transform:scale(.62);transform-origin:0 0}</style>` + h;
}
async function exportHwpx() {
  const F = farmSel(); if (!F) { toast('단지가 없습니다.'); return; }
  try { toast('한글 파일을 만드는 중…', 6000); const rp = await rpEnsure(F); const bytes = await renderHwpx(rp.model); await download(fname(`_${F.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}_발전량평가.hwpx`), new Blob([bytes], { type: 'application/hwp+zip' })); }
  catch (e) { console.error(e); toast('보고서를 만들지 못했습니다: ' + e.message, 6000); }
}
async function exportPdf() {
  const F = farmSel(); if (!F) { toast('단지가 없습니다.'); return; }
  try {
    const rp = await rpEnsure(F); const jp = [];
    for (let i = 0; i < rp.pages.length; i++) { toast(`PDF 만드는 중… ${i + 1} / ${rp.pages.length}쪽`, 4000); const j = await rpPageToJpeg(rp.pages[i]); if (!j) throw new Error(`${i + 1}쪽을 그리지 못했습니다.`); jp.push(j); }
    const bytes = buildPdf(jp, rp.model.meta.title);
    await download(fname(`_${F.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}_발전량평가.pdf`), new Blob([bytes], { type: 'application/pdf' }));
  } catch (e) { console.error(e); toast('PDF를 만들지 못했습니다: ' + e.message, 6000); }
}

/* ================= 엑셀 ================= */
async function exportXlsx() {
  const sheets = [];
  const S0 = [['프로젝트', P.name], [], ['지점', '위도', '경도', '설치 표고(해발 m)', '대표 풍황 출처', '허브높이(해발 m)', '평균풍속(m/s)', 'Weibull k', 'Weibull A(m/s)', '공기밀도(kg/m³)', '시어 α', '비고']];
  P.sites.forEach(s => { const d = s.design || {}; S0.push([siteName(s), W.num(s.lat), W.num(s.lon), isEmpty(s.elev) ? '비어 있음' : +s.elev, d.src || '', d.z, d.mean, d.k, d.A, d.rho, d.alpha, d.note || '']); });
  P.sites.forEach(s => { if (s.design && s.design.sectors) { S0.push([], [`${siteName(s)} 대표 풍황 방향별`], ['방향(°)', '빈도(%)', 'Weibull k', 'Weibull A(m/s)']); s.design.sectors.forEach(x => S0.push([x.dir, x.freq, x.k, x.A])); } });
  sheets.push({ name: '대표풍황', rows: S0 });
  const used = new Set(['대표풍황']);
  const sname = n => { let b = n.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 28), x = b, i = 2; while (used.has(x)) x = b.slice(0, 26) + '_' + i++; used.add(x); return x; };
  for (const s of P.sites) for (const d of s.datasets) {
    const elev = +s.elev || 0; const rows = [[`${siteName(s)} — ${d.name}`]];
    if (d.type === 'wg') {
      rows.push([], ['보고서 목록'], ['파일', '제목', '시작', '종료', '기간']); d.reports.forEach(r => rows.push([r.file, r.title, W.fmtDate(r.startTs, 1), W.fmtDate(r.endTs, 1), r.props.duration || '']));
      const r = d.reports[d.sel ?? d.reports.length - 1];
      rows.push([], [`높이별 요약 — ${r.file}`], ['측정높이(m)', '해발(m)', '평균', '중앙', '최소', '최대', 'k', 'A', '에너지패턴계수', '에너지밀도(W/m²)', 'TI', '유효자료', '회수율(%)']);
      r.sensors.forEach(x => rows.push([x.height, x.height + elev, x.mean, x.median, x.min, x.max, x.k, x.c, x.epf, x.pd, x.ti, x.valid, x.recovery]));
      const inc = W.deriveIncrements(d.reports); const hs = r.sensors.map(x => x.height);
      rows.push([], ['기간별 평균풍속 (m/s)'], ['시작', '종료', ...hs.map(h => h + ' m')]); inc.forEach(x => rows.push([W.fmtDate(x.from, 1), W.fmtDate(x.to, 1), ...hs.map(h => (x.rows.find(q => q.height === h) || {}).mean)]));
      rows.push([], ['기간별 Weibull k'], ['시작', '종료', ...hs.map(h => h + ' m')]); inc.forEach(x => rows.push([W.fmtDate(x.from, 1), W.fmtDate(x.to, 1), ...hs.map(h => (x.rows.find(q => q.height === h) || {}).k)]));
    } else if (d.type === 'ts') {
      const pa = P.active; P.active = s.id; const C = tsCompute(d); P.active = pa;
      rows.push(['기간', W.fmtDate(d.ser.ts[0], 1) + ' ~ ' + W.fmtDate(d.ser.ts[d.ser.ts.length - 1], 1)], ['가용률 기준(%)', d.opt.minAvail, '풍향 보정(°)', d.opt.dirOffset, 'Weibull', d.opt.weibull], ['오류값 제거', `범위 밖 ${d.opt.qc.range ? '적용(풍속 상한 ' + d.opt.qc.wsMax + ')' : '안 함'}`, `같은 값 연속 ${d.opt.qc.stuck ? d.opt.qc.stuckN + '개 이상' : '안 함'}`, `CNR ${d.opt.qc.cnr ? d.opt.qc.cnrMin + ' dB' : '안 함'}`]);
      rows.push([], ['오류값 제외 내역'], ['열', '원자료', '범위 밖', '같은 값 연속', '가용률 미달', 'CNR 미달', '남은 값']); C.qc.filter(r => ['ws', 'dir', 'std', 'temp', 'press', 'rh'].includes(r.role)).forEach(r => rows.push([r.name, r.total, r.range, r.stuck, r.avail, r.cnr, r.kept]));
      rows.push([], ['높이별 요약'], ['측정높이(m)', '해발(m)', '평균', '중앙', '최대', '표준편차', 'k', 'A', '에너지패턴계수', 'TI 평균', '대표TI@15', '유효자료', '회수율(%)']);
      C.heights.forEach(x => rows.push([x.h, x.z, x.st.mean, x.st.median, x.st.max, x.st.std, x.st.k, x.st.A, x.st.epf, x.st.tiAll, x.st.tiRep15, x.st.n, x.st.recovery]));
      if (C.hub) {
        const hb = C.hub; rows.push(['허브', C.hubZ, hb.mean, hb.median, hb.max, hb.std, hb.k, hb.A, hb.epf, hb.tiAll, hb.tiRep15, hb.n, hb.recovery]);
        if (C.sh) rows.push(['시어 지수 α', C.sh.alpha]); if (C.rho) rows.push(['공기밀도(허브, kg/m³)', C.rho.rhoHub, '평균 기온(℃)', C.rho.meanT, '평균 기압(hPa)', C.rho.meanP]);
        if (hb.sectors) { rows.push([], ['방향별 (허브)'], ['방향(°)', '빈도(%)', '평균', 'k', 'A', '에너지(%)', '자료 수']); hb.sectors.forEach(x => rows.push([x.dir, x.freq, x.mean, x.k, x.A, x.energyPct, x.n])); }
        rows.push([], ['월별 평균풍속 (허브)'], ['연월', '평균(m/s)', '자료 수']); hb.yearMonth.forEach(x => rows.push([String(x.ym).replace(/(\d{4})(\d\d)/, '$1-$2'), x.mean, x.n]));
        rows.push([], ['시간대별 평균풍속 (허브)'], ['시', '평균(m/s)']); hb.diurnal.forEach((v, i) => rows.push([i, v]));
        rows.push([], ['풍속별 난류강도 (허브)'], ['풍속(m/s)', '평균 TI', '대표 TI', '자료 수']); hb.ti.forEach(x => { if (x.n) rows.push([x.v, x.mean, x.rep, x.n]); });
      }
    } else if (d.type === 'sec') {
      const T = secTotals(d); rows.push(['높이(해발 m)', d.height], ['출처', d.source || ''], [], ['방향(°)', '빈도(%)', '평균(m/s)', 'k', 'A']); d.rows.forEach(r => rows.push([r.dir, r.freq, r.mean, r.k, r.A])); rows.push(['전체', T.fs, T.mean, T.k, T.A]);
    }
    sheets.push({ name: sname(`${P.sites.length > 1 ? siteName(s) + '_' : ''}${d.name}`), rows });
  }
  ensureTurbines();
  const TS = [['지점별 터빈 1기 총발전량 (손실·후류 빼기 전)'], ['지점', '대표 풍황', '터빈', '허브높이(해발 m)', '시어 α', 'α 출처', '공기밀도(kg/m³)', '밀도 보정', '허브 평균풍속(m/s)', '총발전량(MWh/년)', '이용률(%)', '전부하시간(h)']];
  P.sites.forEach(s2 => { const c = turbCalc(s2); if (!c) { TS.push([siteName(s2), '대표 풍황 없음']); return; } TS.push([siteName(s2), s2.design.src, c.T.name, c.t.hub, c.al.a, c.al.src, c.rho, { iec: 'IEC 풍속 보정', power: '출력 비례', none: '안 함' }[c.t.dens], c.meanV, c.r.mwh, 100 * c.cf, c.flh]); });
  P.sites.forEach(s2 => { const c = turbCalc(s2); if (!c) return; TS.push([], [`${siteName(s2)} 풍속 구간별 발전량`], ['풍속 구간(m/s)', '발전량(MWh/년)']); c.r.bins.forEach((v, i) => { if (v > 0.5) TS.push([`${i}–${i + 1}`, v]); }); });
  sheets.splice(1, 0, { name: sname('터빈1기_발전량'), rows: TS });
  P.turbines.forEach(T => { const rows = [[T.name], ['제작사', T.maker], ['정격출력(kW)', T.ratedKW], ['로터 직경(m)', T.rotor], ['기본 허브높이(m)', T.hub], ['기준 공기밀도(kg/m³)', T.rhoRef], ['출처', T.source || ''], [], ['풍속(m/s)', '출력(kW)', '추력계수 Ct']]; T.curve.forEach(c => rows.push(c)); sheets.push({ name: sname('터빈_' + T.name), rows }); });
  for (const F of P.farms || []) {
    const A = aepCalc(F); if (!A) continue; const R = A.R, rep = F.rep || {};
    const rows = [[`단지: ${F.name}`], ['지점(대표 풍황)', siteName(R.S)], ['터빈', R.T.name, '허브높이(해발 m)', R.c.t.hub], ['후류 모델', WAKE_MODELS[F.wake.model].name, '확산계수 k', F.wake.k], ['풍속 분포', R.c.useHist ? '실측 분포' : 'Weibull', '공기밀도', R.c.rho], [],
      ['항목', '도구 계산', '보고서'], ['총발전량(MWh/년)', R.G, rep.gross], ['후류 손실(%)', 100 * R.wake, rep.wake], ['총손실(%)', 100 * A.total, rep.total], ['순발전량 P50(MWh/년)', A.net, rep.p50], ['이용률 P50(%)', 100 * A.cf], ['결합 불확도(%)', A.U.total, rep.uc], ['P75(MWh/년)', A.pv.find(x => x.p === 75).mwh, rep.p75], ['P90(MWh/년)', A.pv.find(x => x.p === 90).mwh, rep.p90], [],
      ['터빈별'], ['이름', 'X', 'Y', '최근접 간격(D)', '평균풍속(입력)', '총발전량(MWh)', '후류 후(MWh)', '효율(%)', '보고서 효율(%)']];
    F.rows.forEach((r, i) => rows.push([r.name, r.x, r.y, R.spacing[i], r.vRep, R.r.gross[i], R.r.net[i], 100 * R.eff[i], r.repEff]));
    rows.push([], ['손실'], ['분류', '항목', '손실(%)', '출처'], ['단지 효율', '후류 손실', 100 * R.wake, '4단계 계산']); A.items.forEach(x => rows.push([x.cat, x.label, Number.isFinite(x.value) ? x.value : 0, x.calc || F.lossSrc[x.key] || (x.auto ? `조건 중간값 (${x.cond.label} · ${x.cond.src})` : Number.isFinite(x.value) ? '직접 입력' : '비어 있음')])); rows.push(['합계', '', 100 * A.total]);
    rows.push([], ['불확도'], ['기호', '항목', '입력(%)', '계산(%)']); uncRowsEff(F, A.ctx).rows.forEach((u, i) => rows.push([u.code, u.label, u.value, u.code ? A.U.val[i] : undefined, u.auto ? '조건 중간값' : (u.src || '')])); rows.push(['', '결합 불확도', undefined, A.U.total]);
    rows.push([], ['초과확률별 발전량'], ['P값', '발전량(MWh/년)', '이용률(%)']); A.pv.forEach(x => rows.push(['P' + x.p, x.mwh, 100 * x.cf]));
    sheets.splice(1, 0, { name: sname('단지_' + F.name), rows });
  }
  const blob = await buildXlsx(sheets);
  download(fname('_풍황자료.xlsx'), blob);
}
async function buildXlsx(sheets) {
  const z = new JSZip(); const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts><fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, si) => {
    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="30" width="12" customWidth="1"/></cols><sheetData>`;
    s.rows.forEach((r, ri) => {
      const isHead = r.length > 1 && r.every(c => typeof c === 'string') || r.length === 1;
      xml += `<row r="${ri + 1}">` + r.map((c, ci) => {
        const ref = col(ci) + (ri + 1);
        if (typeof c === 'number') return Number.isFinite(c) ? `<c r="${ref}"${Math.abs(c) < 1000 && c % 1 !== 0 ? ' s="2"' : ''}><v>${c}</v></c>` : '';
        if (c == null || c === '') return '';
        return `<c r="${ref}" t="inlineStr"${isHead ? ' s="1"' : ''}><is><t>${x(c)}</t></is></c>`;
      }).join('') + `</row>`;
    });
    xml += `</sheetData></worksheet>`; z.file(`xl/worksheets/sheet${si + 1}.xml`, xml);
  });
  return await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ================= 시작 ================= */
(async () => { const v = await idbGet(); if (v) { try { P = deserialize(v); if (!P.sites.find(s => s.id === P.active)) P.active = P.sites[0].id; } catch (e) { console.warn(e); } }
  const filled = []; P.sites.forEach(s => filled.push(...autofillSite(s))); render(); if (filled.length) { save(); toast('들어 있는 자료로 지점 정보를 채웠습니다: ' + [...new Set(filled)].join(', ')); } })();
window.__app = { get P() { return P; }, handleFiles, render, exportXlsx, serialize };
