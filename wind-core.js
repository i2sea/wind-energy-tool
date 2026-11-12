/* 풍황자료 처리 핵심 모듈 — 브라우저/Node 공용 */
(function (G) {
'use strict';
const W = {};

/* ---------- 공통 ---------- */
const num = s => { if (s == null) return NaN; s = String(s).trim().replace(/,/g, ''); if (s === '' || /^(nan|na|n\/a|-|null)$/i.test(s)) return NaN; const v = Number(s); return Number.isFinite(v) ? v : NaN; };
const isNum = s => /^-?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(String(s).trim());
W.num = num;

function gammaLn(x) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (let j = 0; j < 6; j++) s += c[j] / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
const gamma = x => Math.exp(gammaLn(x));
W.gamma = gamma;

/* ---------- Weibull ---------- */
// MLE (Newton) — v>0 만 사용
function weibullMLE(vs) {
  const v = vs.filter(x => x > 0); const n = v.length; if (n < 10) return null;
  const lnv = v.map(Math.log); const mlnv = lnv.reduce((a, b) => a + b, 0) / n;
  let k = 2;
  for (let it = 0; it < 100; it++) {
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const p = Math.pow(v[i], k); s0 += p; s1 += p * lnv[i]; s2 += p * lnv[i] * lnv[i]; }
    const f = s1 / s0 - 1 / k - mlnv;
    const df = (s2 * s0 - s1 * s1) / (s0 * s0) + 1 / (k * k);
    const dk = f / df; k -= dk; if (k < 0.3) k = 0.3; if (Math.abs(dk) < 1e-7) break;
  }
  let s0 = 0; for (let i = 0; i < n; i++) s0 += Math.pow(v[i], k);
  const A = Math.pow(s0 / n, 1 / k);
  return { k, A, method: 'MLE' };
}
// WAsP: 평균 v³ 보존 + 평균풍속 초과확률 보존
function weibullWAsP(vs) {
  const v = vs.filter(x => x >= 0); const n = v.length; if (n < 10) return null;
  let m = 0, m3 = 0; for (const x of v) { m += x; m3 += x * x * x; } m /= n; m3 /= n;
  let above = 0; for (const x of v) if (x > m) above++; const P = above / n;
  const g = k => { const A = Math.cbrt(m3 / gamma(1 + 3 / k)); return Math.exp(-Math.pow(m / A, k)) - P; };
  let lo = 0.5, hi = 6; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) <= 0) hi = mid; else lo = mid; }
  const k = (lo + hi) / 2; return { k, A: Math.cbrt(m3 / gamma(1 + 3 / k)), method: 'WAsP' };
}
// 모멘트(평균·표준편차)
function weibullMoments(vs) {
  const v = vs.filter(x => x >= 0); const n = v.length; if (n < 10) return null;
  let m = 0; for (const x of v) m += x; m /= n; let s = 0; for (const x of v) s += (x - m) ** 2; s = Math.sqrt(s / (n - 1));
  const k = Math.pow(s / m, -1.086); return { k, A: m / gamma(1 + 1 / k), method: '모멘트' };
}
W.weibullFit = (vs, method) => method === 'WAsP' ? weibullWAsP(vs) : method === 'MOM' ? weibullMoments(vs) : weibullMLE(vs);
W.weibullPdf = (v, k, A) => v < 0 ? 0 : (k / A) * Math.pow(v / A, k - 1) * Math.exp(-Math.pow(v / A, k));
W.weibullMean = (k, A) => A * gamma(1 + 1 / k);
// 에너지 패턴 계수 → k
W.kFromEPF = epf => { const f = k => gamma(1 + 3 / k) / Math.pow(gamma(1 + 1 / k), 3) - epf; let lo = 0.6, hi = 8; if (f(lo) * f(hi) > 0) return NaN; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; } return (lo + hi) / 2; };

/* ---------- PDF 텍스트 → 줄/칸 ---------- */
// items: [{str,x,y,w}] (pdf.js textContent 정규화)
W.itemsToLines = function (items) {
  const its = items.filter(i => i.str && i.str.trim() !== '').map(i => ({ s: i.str.trim(), x: i.x, y: i.y, w: i.w }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    let L = lines.find(l => Math.abs(l.y - it.y) <= 2.2);
    if (!L) { L = { y: it.y, items: [] }; lines.push(L); }
    L.items.push(it);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(L => {
    L.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of L.items) {
      const last = cells[cells.length - 1];
      if (last && it.x - (last.x + last.w) < 3.5) { last.s += (it.x - (last.x + last.w) > 1 ? ' ' : '') + it.s; last.w = it.x + it.w - last.x; }
      else cells.push({ s: it.s, x: it.x, w: it.w });
    }
    return { y: L.y, cells, text: cells.map(c => c.s).join(' | ') };
  });
};

/* ---------- Windographer Extended Summary Report ---------- */
W.isWindographer = allText => /Extended Summary Report/i.test(allText) && /Windographer/i.test(allText);

W.parseWindographer = function (pages /* [[line]] */, fileName) {
  const R = { kind: 'wg', file: fileName, title: '', created: '', props: {}, env: {}, sensors: [], columns: [], warnings: [] };
  const all = pages.flat();
  const hdr = all.find(l => /Extended Summary Report/i.test(l.text));
  if (hdr) R.title = hdr.cells.map(c => c.s).filter(s => !/^Page \d+/i.test(s)).join('').replace(/Extended Summary Report:\s*/i, '').replace(/\s+/g, ' ').trim();
  for (const l of all) {
    const t = l.cells.map(c => c.s);
    if (/^Report Created:?$/i.test(t[0]) && t[1]) R.created = t[1].replace(/\s*using.*/, '');
    else if (/^Report Created:/i.test(t[0])) R.created = t[0].replace(/^Report Created:\s*/i, '').replace(/\s*using.*/, '');
  }
  // Data Set Properties (2칸: 항목 | 값)
  const propKeys = { 'Latitude': 'lat', 'Longitude': 'lon', 'Elevation': 'elev', 'Start date': 'start', 'End date': 'end', 'Duration': 'duration', 'Length of time step': 'step', 'Calm threshold': 'calm', 'Mean temperature': 'meanT', 'Mean pressure': 'meanP', 'Mean air density': 'meanRho', 'Wind power class': 'wpc', 'Power law exponent': 'alpha', 'Surface roughness': 'z0', 'Roughness class': 'rclass' };
  for (const l of all) {
    if (l.cells.length < 2) continue; const a = l.cells[0].s;
    for (const k in propKeys) if (a === k) R.props[propKeys[k]] = l.cells.slice(1).map(c => c.s).join(' ');
    if (/^Power density at/i.test(a)) { R.props.pdAt = a.replace(/Power density at\s*/i, ''); R.props.pd = l.cells[1].s; }
  }
  const latS = R.props.lat || '', lonS = R.props.lon || '';
  R.lat = num(latS.replace(/[NS]\s*/, '')) * (/S/.test(latS) ? -1 : 1);
  R.lon = num(lonS.replace(/[EW]\s*/, '')) * (/W/.test(lonS) ? -1 : 1);
  const lead = x => num(String(x || '').match(/-?[\d,]*\.?\d+/)?.[0]);
  R.alpha = lead(R.props.alpha); R.meanRho = lead(R.props.meanRho); R.meanT = lead(R.props.meanT); R.meanP = lead(R.props.meanP);
  // Environmental Summary
  for (const l of all) {
    const a = l.cells[0] && l.cells[0].s;
    if (!a || l.cells.length < 4) continue;
    const key = /^Temperature/i.test(a) ? 'T' : /^Pressure/i.test(a) ? 'P' : /^Air Density/i.test(a) ? 'rho' : null;
    if (key && !R.env[key]) R.env[key] = { mean: num(l.cells[1].s), min: num(l.cells[2].s), max: num(l.cells[3].s) };
  }
  // Wind Speed Sensor Summary
  const sKeys = { 'Measurement height (m)': 'height', 'Mean wind speed (m/s)': 'mean', 'MoMM wind speed (m/s)': 'momm', 'Median wind speed (m/s)': 'median', 'Min wind speed (m/s)': 'min', 'Max wind speed (m/s)': 'max', 'CRMC wind speed (m/s)': 'crmc', 'Weibull k': 'k', 'Weibull c (m/s)': 'c', 'Energy pattern factor': 'epf', 'Frequency of calms (%)': 'calms', 'Possible data points': 'possible', 'Valid data points': 'valid', 'Missing data points': 'missing', 'Data recovery rate (%)': 'recovery' };
  let cur = null;
  for (const l of all) {
    const t = l.cells.map(c => c.s);
    if (t[0] === 'Variable' && t.slice(1).some(s => /Wind Speed/i.test(s))) { cur = t.slice(1).map(lbl => ({ label: lbl })); R.sensors.push(...cur); continue; }
    if (!cur) continue;
    const lbl = t[0]; let key = sKeys[lbl];
    if (!key && /^Mean power density/i.test(lbl)) key = 'pd';
    if (!key && /^MoMM power density/i.test(lbl)) key = 'mommPd';
    if (!key && /^Mean energy content/i.test(lbl)) key = 'energy';
    if (!key && /^MoMM energy content/i.test(lbl)) key = 'mommEnergy';
    if (!key) { if (!t.slice(1).every(isNum)) cur = null; continue; }
    const vals = t.slice(1);
    if (vals.length === cur.length) cur.forEach((s, i) => s[key] = num(vals[i]));
  }
  R.sensors = R.sensors.filter(s => Number.isFinite(s.height)).sort((a, b) => a.height - b.height);
  // Data Column Properties
  for (const l of all) {
    const t = l.cells.map(c => c.s);
    if (!/^\d+$/.test(t[0]) || t.length < 4) continue;
    let i = 1; const label = t[i++]; if (!label || isNum(label)) continue;
    let units = '', height = '';
    while (i < t.length && !isNum(t[i])) { if (/^\d+(\.\d+)?\s*m$/.test(t[i]) && !height) height = t[i]; else units += (units ? ' ' : '') + t[i]; i++; }
    const ns = t.slice(i).map(num); if (ns.length < 3) continue;
    R.columns.push({ no: +t[0], label: label.replace(/\s*\(\?$/, ''), units: units.replace(/캜|占폚|\?C/, '℃'), height: num(height), possible: ns[0], valid: ns[1], recovery: ns[2], mean: ns[3], min: ns[4], max: ns[5], std: ns[6] });
  }
  // TI 평균 (Data Column Properties의 "xxm Wind Speed TI")
  for (const s of R.sensors) {
    const c = R.columns.find(c => new RegExp('^' + s.height + 'm Wind Speed TI$', 'i').test(c.label));
    if (c) s.ti = c.mean;
  }
  // 경고
  if (R.env.P && R.env.P.min < 500) R.warnings.push(`기압 최솟값 ${R.env.P.min} hPa — 센서 오류값이 섞여 있습니다.`);
  if (R.env.rho && R.env.rho.min < 0.9) R.warnings.push(`공기밀도 최솟값 ${R.env.rho.min} kg/m³ — 오류값이 섞여 있습니다(평균에 영향).`);
  for (const s of R.sensors) if (s.recovery < 80) { R.warnings.push(`회수율 80% 미만 높이: ${R.sensors.filter(x => x.recovery < 80).map(x => x.height + 'm').join(', ')}`); break; }
  R.startTs = W.parseDate(R.props.start); R.endTs = W.parseDate(R.props.end);
  return R;
};

// 누적 보고서 묶음 → 기간별 역산
W.deriveIncrements = function (reports) {
  const rs = reports.slice().sort((a, b) => a.endTs - b.endTs);
  const out = [];
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], p = i > 0 ? rs[i - 1] : null;
    const cumulative = p && p.startTs === r.startTs;
    const rows = r.sensors.map(s => {
      const q = cumulative ? p.sensors.find(x => x.height === s.height) : null;
      const m3 = s.epf * s.mean ** 3;
      if (!q) return { height: s.height, n: s.valid, mean: s.mean, m3, k: s.k, A: s.c, recovery: s.recovery, derived: false };
      const n = s.valid - q.valid; if (n <= 0) return { height: s.height, n: 0, mean: NaN, m3: NaN, k: NaN, A: NaN };
      const mean = (s.valid * s.mean - q.valid * q.mean) / n;
      const qm3 = q.epf * q.mean ** 3;
      const m3d = (s.valid * m3 - q.valid * qm3) / n;
      const k = W.kFromEPF(m3d / mean ** 3);
      const poss = s.possible - q.possible;
      return { height: s.height, n, mean, m3: m3d, k, A: mean / gamma(1 + 1 / k), recovery: poss > 0 ? 100 * n / poss : NaN, derived: true };
    });
    out.push({ report: r, from: cumulative ? p.endTs : r.startTs, to: r.endTs, cumulative: !!cumulative || i === 0, rows });
  }
  return out;
};

/* ---------- 보고서 표에서 방향 구간 표 찾기 (범용) ---------- */
W.findSectorTables = function (pages, fileName) {
  const found = [];
  pages.forEach((lines, pi) => {
    for (const nSec of [12, 16, 8, 36]) {
      const step = 360 / nSec;
      for (let i = 0; i + nSec <= lines.length; i++) {
        const first = lines[i].cells.map(c => c.s);
        if (num(first[0]) !== 0) continue;
        let ok = true; const rows = [];
        // 연속 줄에서 0, step, 2step... 찾기 (사이에 다른 줄 1개까지 허용)
        let j = i, s = 0;
        while (s < nSec && j < lines.length && j < i + nSec * 2) {
          const t = lines[j].cells.map(c => c.s);
          if (Math.abs(num(t[0]) - s * step) < 1e-6 && t.length >= 2 && t.slice(1).every(isNum)) { rows.push({ dir: s * step, vals: t.slice(1).map(num), x: lines[j].cells.slice(1).map(c => c.x + c.w) }); s++; }
          else if (rows.length) { if (j - i > rows.length + 1) { ok = false; break; } }
          j++;
        }
        if (!ok || rows.length !== nSec) continue;
        const nc = rows[0].vals.length; if (!rows.every(r => r.vals.length === nc)) continue;
        // 머리글: 위쪽 줄들에서 칸 오른쪽 끝 위치로 이름 맞추기
        const heads = Array(nc).fill('').map(() => []);
        for (let h = Math.max(0, i - 5); h < i; h++) {
          for (const c of lines[h].cells) {
            if (c.s.length > 28 || c.x + c.w < rows[0].x[0] - 40) continue;
            const cx = c.x + c.w / 2; let best = -1, bd = 60;
            rows[0].x.forEach((xr, ci) => { const d = Math.abs(cx - (xr - 12)); if (d < bd) { bd = d; best = ci; } });
            if (best >= 0 && !/^table/i.test(c.s)) heads[best].push(c.s);
          }
        }
        // 다음 줄이 All/합계면 함께
        const nxt = lines[j] && lines[j].cells.map(c => c.s);
        const total = nxt && /^(all|total|합계|전체|sum)/i.test(nxt[0]) ? nxt.slice(1).map(num) : null;
        const capRe = /^(table|figure|fig\.|표|그림)\s*[\d-]+/i;
        let caption = (lines.slice(Math.max(0, i - 8), i).map(l => l.text).reverse().find(t => capRe.test(t)) || lines.slice(j, j + 10).map(l => l.text).find(t => capRe.test(t)) || '').replace(/\s*\|\s*/g, ' ');
        found.push({ file: fileName, page: pi + 1, nSec, cols: heads.map(h => h.join(' ').trim()), rows: rows.map(r => ({ dir: r.dir, vals: r.vals })), total, caption });
        i = j;
      }
    }
  });
  // 열 역할 추정
  for (const T of found) T.guess = W.guessSectorColumns(T);
  return found;
};
W.guessSectorColumns = function (T) {
  const nc = T.cols.length, g = { freq: -1, k: -1, A: -1, mean: -1 };
  const col = c => T.rows.map(r => r.vals[c]);
  const sum = c => col(c).reduce((a, b) => a + b, 0);
  const name = c => (T.cols[c] || '').toLowerCase();
  for (let c = 0; c < nc; c++) { if (/freq|prob|빈도/.test(name(c))) g.freq = c; else if (/weibull k|^k$|\bk\b/.test(name(c))) g.k = c; else if (/weibull a|weibull c|\ba\b|scale/.test(name(c))) g.A = c; else if (/mean|평균/.test(name(c))) g.mean = c; }
  if (g.freq < 0) for (let c = 0; c < nc; c++) if (Math.abs(sum(c) - 100) < 1.5 && col(c).every(v => v >= 0 && v < 100)) { g.freq = c; break; }
  if (g.k < 0) for (let c = 0; c < nc; c++) if (c !== g.freq && col(c).every(v => v >= 0.8 && v <= 4.5) && !col(c).every(v => v === 100)) { g.k = c; break; }
  const rest = [...Array(nc).keys()].filter(c => c !== g.freq && c !== g.k && !col(c).every(v => v === 100) && col(c).every(v => v > 0.5 && v < 25));
  if (g.A < 0 && g.mean < 0 && rest.length >= 2) { const avg = c => sum(c) / T.rows.length; const last = rest[rest.length - 1]; g.A = last; g.mean = rest.find(c => c !== last && avg(c) < avg(last)); if (g.mean === undefined) g.mean = -1; }
  return g;
};

/* ---------- 보고서에서 설치 표고 찾기 (표 칸 '항목 | 값 m' 형태만) ---------- */
W.findElevation = function (pages) {
  const vals = new Map();
  pages.forEach((lines, pi) => lines.forEach(l => {
    const t = l.cells.map(c => c.s);
    if (!/^(elevation|installation elevation|lidar elevation|설치\s*표고|표고|설치\s*높이)$/i.test(t[0] || '')) return;
    for (const c of t.slice(1)) { const m = c.match(/^(-?\d+(?:\.\d+)?)\s*m\b(.*)$/i); if (m) { const v = +m[1]; if (!vals.has(v)) vals.set(v, { value: v, page: pi + 1, text: t.join(' ') }); break; } }
  }));
  return vals.size === 1 ? [...vals.values()][0] : null; // 값이 여러 개면 어느 측정기인지 알 수 없어 적용 안 함
};

/* ---------- 측정기별 전체 Weibull 표 (이름 | A | k | 평균) ---------- */
W.findWeibullRows = function (pages) {
  const out = [];
  pages.forEach((lines, pi) => lines.forEach((l, i) => {
    const iA = l.cells.findIndex(c => /^(weibull\s*)?(a|c|scale)(\s*\[?\(?m\/s\)?\]?)?$/i.test(c.s));
    const iK = l.cells.findIndex(c => /^(weibull\s*)?k(\s*\[-\])?$/i.test(c.s));
    if (iA < 0 || iK < 0) return;
    const xA = l.cells[iA].x + l.cells[iA].w / 2, xK = l.cells[iK].x + l.cells[iK].w / 2;
    const ctx = lines.slice(Math.max(0, i - 12), i + 1).map(x => x.text).join(' ');
    const hm = ctx.match(/(\d+(?:\.\d+)?)\s*m\s*a?msl/i) || ctx.match(/hub height(?: of)?\s*(\d+(?:\.\d+)?)\s*m/i) || ctx.match(/\((\d+(?:\.\d+)?)\s*m\)/);
    const caption = (lines.slice(Math.max(0, i - 6), i).map(x => x.text).reverse().find(t => /^(table|표)\s*[\d-]+/i.test(t)) || '').replace(/\s*\|\s*/g, ' ');
    let miss = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 20) && miss < 3; j++) {
      const cs = lines[j].cells; if (cs.length < 3 || isNum(cs[0].s)) { miss++; continue; }
      const nums = cs.slice(1).filter(c => isNum(c.s)); if (nums.length < 2) { miss++; continue; }
      const near = x => nums.reduce((b, c) => Math.abs(c.x + c.w / 2 - x) < Math.abs(b.x + b.w / 2 - x) ? c : b, nums[0]);
      const cA = near(xA), cK = near(xK); if (cA === cK) { miss++; continue; }
      const rest = nums.filter(c => c !== cA && c !== cK);
      const A = num(cA.s), k = num(cK.s), mean = rest.length ? num(rest[rest.length - 1].s) : NaN;
      if (!(k > 0.8 && k < 5 && A > 1 && A < 25)) { miss++; continue; }
      out.push({ label: cs[0].s, A, k, mean: mean > 1 && mean < A ? mean : NaN, height: hm ? +hm[1] : NaN, page: pi + 1, caption });
      miss = 0;
    }
  }));
  return out;
};

/* ---------- 보고서 문장/표의 공기밀도 ---------- */
W.findAirDensity = function (pages) {
  const text = pages.flat().map(l => l.text.replace(/\s*\|\s*/g, ' ')).join(' ');
  const out = []; const re = /(1\.[12]\d{1,3})\s*kg\s*\/\s*m\s*(?:3|³)?/gi; let m;
  while ((m = re.exec(text))) {
    let tail = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const cut = tail.search(/\d\.\d+\s*kg|\.\s|;/); if (cut >= 0) tail = tail.slice(0, cut);
    const hm = tail.match(/(\d+(?:\.\d+)?)\s*m\b/); const sea = /sea level|해수면|해면/i.test(tail);
    out.push({ rho: +m[1], height: sea ? 0 : hm ? +hm[1] : NaN, text: (m[0] + tail).trim().slice(0, 90) });
  }
  return out;
};

/* ---------- 좌표 ---------- */
W.utmToLatLon = function (E, N, zone, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = north ? N : N - 10000000;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) ** 2, 1.5), D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return { lat: lat * 180 / Math.PI, lon: (zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI };
};
W.distM = (a, b) => { const R = 6371000, r = Math.PI / 180; const dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
W.parseGps = s => { const m = String(s || '').match(/Lat:\s*(-?[\d.]+)\s*([NS])?.*?Long?:\s*(-?[\d.]+)\s*([EW])?/i); if (!m) return null; return { lat: +m[1] * (m[2] === 'S' ? -1 : 1), lon: +m[3] * (m[4] === 'W' ? -1 : 1) }; };
// 보고서에서 측정기 좌표 찾기 (UTM). 결과: [{label, lat, lon, E, N, zone, elev}]
W.findLocations = function (pages, fileName) {
  const text = pages.flat().map(l => l.text).join('\n');
  const zm = text.match(/zone[:\s]*(\d{1,2})\s*([C-X])?\b/i) || text.match(/UTM[^\n]{0,30}?\b(\d{2})\s*([C-X])\b/i);
  if (!zm) return [];
  const zone = +zm[1], north = !zm[2] || zm[2].toUpperCase() >= 'N' || !/south/i.test(text.slice(zm.index, zm.index + 40)) && zm[2].toUpperCase() >= 'N';
  const out = [];
  const isE = c => c.s.match(/^(\d{6}(?:[.,]\d+)?)\s*E\b,?$/), isN = c => c.s.match(/^(\d{7}(?:[.,]\d+)?)\s*N\b,?$/);
  pages.forEach(lines => {
    for (let i = 0; i < lines.length; i++) {
      // A) "519807.5 E," ... "3891821.4 N" (아래 줄), 그 사이 줄 왼쪽 칸이 이름
      for (const ce of lines[i].cells) {
        const me = isE(ce); if (!me) continue;
        for (let j = i; j < Math.min(lines.length, i + 4); j++) {
          const cn = lines[j].cells.find(c => isN(c) && Math.abs(c.x - ce.x) < 40 && c !== ce); if (!cn) continue;
          let label = '';
          for (let k = i; k <= j; k++) { const c0 = lines[k].cells[0]; if (c0 && c0.x < ce.x - 10 && !/^\d+(\.\d+)?$/.test(c0.s)) { label = c0.s; break; } }
          const E = +me[1].replace(',', '.'), N = +isN(cn)[1].replace(',', '.');
          out.push({ label, E, N, zone, ...W.utmToLatLon(E, N, zone, north) }); break;
        }
      }
      // B) "East | 519,808" / "North | 3,891,821"
      const t = lines[i].cells.map(c => c.s);
      if (/^(east|easting)$/i.test(t[0]) && t[1] && /^\d{3},?\d{3}(\.\d+)?$/.test(t[1])) {
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) { const u = lines[j].cells.map(c => c.s); if (/^(north|northing)$/i.test(u[0]) && u[1]) { const E = num(t[1]), N = num(u[1]); out.push({ label: '', E, N, zone, ...W.utmToLatLon(E, N, zone, north) }); break; } }
      }
    }
  });
  // 이름 없는 좌표: 문서의 장비 번호(Serial number)
  const sn = text.match(/serial number\s*\|\s*([^\n|]+)/i);
  out.forEach(o => { if (!o.label) o.label = sn ? sn[1].trim() : fileName.replace(/^[0-9a-f]{8}-/, '').replace(/\.pdf$/i, ''); });
  // 이름별 설치 표고 (Elevation 열이 있는 표)
  pages.forEach(lines => lines.forEach((l, i) => {
    if (!l.cells.some(c => /^elevation/i.test(c.s))) return;
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const t = lines[j].cells.map(c => c.s); const o = out.find(o => o.label && t[0] === o.label);
      if (o && /^\d+(\.\d+)?$/.test(t[t.length - 1])) o.elev = +t[t.length - 1];
    }
  }));
  // 중복 제거
  return out.filter((o, i) => out.findIndex(p => p.label === o.label && Math.abs(p.E - o.E) < 1) === i);
};
// 이름 비교용 토큰 (숫자 3자리 이상, 영문·한글 단어)
W.nameTokens = s => (String(s || '').toLowerCase().replace(/\d+(\.\d+)?\s*m\b/g, ' ').match(/\d{3,}|[a-z]{4,}|[가-힣]{2,}/g) || []).filter(t => !/^(lidar|wind|report|table|figure|predicted|long|term|rose|speed|distribution|height|amsl|measurement|statistics|resource|directional|turbine|extended|summary)$/.test(t));

/* ---------- 날짜 ---------- */
W.parseDate = function (s) {
  if (!s) return NaN; s = String(s).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/); if (m) return Date.UTC(+m[1], m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/); // dd/mm/yyyy
  if (m) return Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  return NaN;
};
W.fmtDate = (t, withTime) => { if (!Number.isFinite(t)) return '-'; const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` + (withTime ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : ''); };

/* ---------- 시계열 (WindCube .sta / CSV / TXT) ---------- */
// 열 이름 → {role, height}
W.classifyColumn = function (name) {
  const n = name.toLowerCase().replace(/\s+/g, ' ');
  const hm = n.match(/(\d+(?:\.\d+)?)\s*m(?![a-z\/])/) || n.match(/(?:ws|wd|speed|spd|dir|sd|std|ti)[_ ]?(\d+(?:\.\d+)?)/) || n.match(/^(\d+(?:\.\d+)?)[_ ]/);
  const h = hm ? Number(hm[1]) : NaN;
  let role = '';
  if (/timestamp|date|time|일시|시각/.test(n) && !Number.isFinite(h)) role = 'time';
  else if (/z-wind|vertical|w-wind/.test(n)) role = /disp|std|sd\b/.test(n) ? '' : 'wz';
  else if (/\bti\b|turbulence/.test(n)) role = 'ti';
  else if (/dir|wd|풍향/.test(n)) role = 'dir';
  else if (/disp|std|stdev|\bsd\b|sigma/.test(n) && /speed|ws|spd|wind/.test(n)) role = 'std';
  else if (/max|gust/.test(n) && /speed|ws|spd|wind/.test(n)) role = 'max';
  else if (/\bmin\b/.test(n) && /speed|ws|spd|wind/.test(n)) role = 'min';
  else if (/\bcnr\b/.test(n) && !/min/.test(n)) role = 'cnr';
  else if (/wpd|power density|cnr|dopp|broad/.test(n)) role = '';
  else if (/availab|가용/.test(n)) role = 'avail';
  else if (/speed|\bws\b|ws_|spd|풍속|wind/.test(n)) role = 'ws';
  else if (/int temp/.test(n)) role = '';
  else if (/temp|기온/.test(n)) role = 'temp';
  else if (/press|기압|baro/.test(n)) role = 'press';
  else if (/humid|습도|rh\b/.test(n)) role = 'rh';
  if (role && role !== 'time' && role !== 'temp' && role !== 'press' && role !== 'rh' && !Number.isFinite(h)) role = role === 'ws' ? 'ws' : role;
  return { role, height: Number.isFinite(h) ? h : null };
};

W.parseTimeSeriesText = function (text, fileName) {
  const lines = text.split(/\r?\n/);
  const meta = {};
  let hi = -1;
  for (let i = 0; i < Math.min(lines.length, 400); i++) {
    const L = lines[i];
    const mm = L.match(/^([^=\t,;]{2,40})=(.*)$/); if (mm && hi < 0) { meta[mm[1].trim()] = mm[2].trim(); }
    if (/^\s*"?(timestamp|date|time|일시|datetime)/i.test(L) && /[\t,;]/.test(L)) { hi = i; break; }
  }
  if (hi < 0) { // 첫 줄 중 날짜로 시작하는 줄의 바로 앞 줄
    for (let i = 1; i < Math.min(lines.length, 400); i++) if (Number.isFinite(W.parseDate(lines[i].split(/[\t,;]/)[0].replace(/"/g, ''))) && /[\t,;]/.test(lines[i - 1])) { hi = i - 1; break; }
  }
  if (hi < 0) throw new Error('시계열 머리글(Timestamp/Date 열)을 찾지 못했습니다.');
  const hl = lines[hi];
  const delim = (hl.match(/\t/g) || []).length >= 2 ? '\t' : (hl.match(/;/g) || []).length > (hl.match(/,/g) || []).length ? ';' : ',';
  const names = hl.split(delim).map(s => s.replace(/^"|"$/g, '').trim());
  const cols = names.map((n, i) => ({ idx: i, name: n, ...W.classifyColumn(n) }));
  if (cols[0]) cols[0].role = 'time';
  // 날짜+시각 분리된 경우
  let timeCols = [0];
  if (cols[1] && /^time|시각/i.test(names[1]) && /date|일자/i.test(names[0])) { timeCols = [0, 1]; cols[1].role = 'time'; }
  const keep = cols.filter(c => c.role && c.role !== 'time');
  const N = lines.length - hi - 1;
  const ts = new Float64Array(N); const data = keep.map(() => new Float32Array(N));
  let n = 0;
  for (let i = hi + 1; i < lines.length; i++) {
    const L = lines[i]; if (!L || !L.trim()) continue;
    const p = L.split(delim);
    const tstr = timeCols.map(c => (p[c] || '').replace(/"/g, '')).join(' ');
    const t = W.parseDate(tstr); if (!Number.isFinite(t)) continue;
    ts[n] = t;
    for (let j = 0; j < keep.length; j++) { let v = num((p[keep[j].idx] || '').replace(/"/g, '')); if (v === 9999 || v === -9999 || v === 99.99 || v === -999) v = NaN; data[j][n] = v; }
    n++;
  }
  const ser = { file: fileName, meta, columns: keep.map(c => ({ name: c.name, role: c.role, height: c.height })), ts: ts.slice(0, n), data: data.map(a => a.slice(0, n)) };
  if (meta['Altitudes (m)']) ser.altitudes = meta['Altitudes (m)'].split(/\s+/).map(Number).filter(Number.isFinite);
  ser.device = meta['ID System'] || ''; ser.timezone = meta.timezone || '';
  ser.dirOffset = num(meta['DirectionOffset (°)'] || meta['DirectionOffset (占)'] || Object.entries(meta).find(([k]) => /^DirectionOffset/.test(k))?.[1]);
  ser.location = meta['Location'] || '';
  ser.gps = meta['GPS Location'] || '';
  return ser;
};

// 여러 시계열 병합 (열 이름 기준, 시각 정렬, 중복 제거)
W.mergeSeries = function (list) {
  if (!list.length) return null;
  const colKey = c => c.role + '|' + c.height + '|' + c.name;
  const allCols = []; const seen = new Map();
  for (const s of list) s.columns.forEach(c => { const k = colKey(c); if (!seen.has(k)) { seen.set(k, allCols.length); allCols.push({ ...c }); } });
  const total = list.reduce((a, s) => a + s.ts.length, 0);
  const idx = []; list.forEach((s, si) => { for (let i = 0; i < s.ts.length; i++) idx.push([s.ts[i], si, i]); });
  idx.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ts = new Float64Array(total); const data = allCols.map(() => new Float32Array(total).fill(NaN));
  const maps = list.map(s => s.columns.map(c => seen.get(colKey(c))));
  let n = 0, dup = 0;
  for (const [t, si, i] of idx) {
    if (n > 0 && ts[n - 1] === t) { dup++; continue; }
    ts[n] = t; const m = maps[si]; const d = list[si].data;
    for (let j = 0; j < m.length; j++) data[m[j]][n] = d[j][i];
    n++;
  }
  // 시간 간격(최빈값)
  const diffs = new Map(); for (let i = 1; i < Math.min(n, 5000); i++) { const d = ts[i] - ts[i - 1]; diffs.set(d, (diffs.get(d) || 0) + 1); }
  let step = 600000, bc = 0; diffs.forEach((c, d) => { if (c > bc && d > 0) { bc = c; step = d; } });
  let gaps = 0; for (let i = 1; i < n; i++) if (ts[i] - ts[i - 1] > step) gaps += Math.round((ts[i] - ts[i - 1]) / step) - 1;
  const f = list[0];
  return { files: list.flatMap(s => s.files || [s.file]), columns: allCols, ts: ts.slice(0, n), data: data.map(a => a.slice(0, n)), step, duplicates: dup, gaps, device: f.device, timezone: f.timezone, dirOffset: f.dirOffset, location: f.location, gps: f.gps, meta: f.meta };
};

/* ---------- 오류값 제거 (QC) ---------- */
W.QC_DEFAULT = { range: true, wsMax: 55, stuck: true, stuckN: 6, cnr: false, cnrMin: -23 };
W.QC_RANGE = { ws: [0, null], max: [0, null], min: [0, null], std: [0, 20], dir: [0, 360], temp: [-40, 50], press: [850, 1090], rh: [0, 100], avail: [0, 100] };
W.qcClean = function (ser, qc, minAvail) {
  qc = Object.assign({}, W.QC_DEFAULT, qc || {});
  const n = ser.ts.length, step = ser.step || 600000;
  const data = ser.data.map(a => Float32Array.from(a));
  const rep = ser.columns.map(c => ({ name: c.name, role: c.role, height: c.height, total: 0, range: 0, stuck: 0, avail: 0, cnr: 0, kept: 0 }));
  ser.columns.forEach((c, j) => { const a = data[j]; for (let i = 0; i < n; i++) if (Number.isFinite(a[i])) rep[j].total++; });
  // 1) 범위 밖
  if (qc.range) ser.columns.forEach((c, j) => {
    const R = W.QC_RANGE[c.role]; if (!R) return; const lo = R[0], hi = R[1] == null ? +qc.wsMax : R[1]; const a = data[j];
    for (let i = 0; i < n; i++) { const v = a[i]; if (Number.isFinite(v) && (v < lo || v > hi)) { a[i] = NaN; rep[j].range++; } }
  });
  // 2) 같은 값 연속 (센서 멈춤)
  if (qc.stuck && qc.stuckN >= 2) ser.columns.forEach((c, j) => {
    if (!['ws', 'dir', 'temp', 'press'].includes(c.role)) return; const a = data[j];
    let st = 0;
    for (let i = 1; i <= n; i++) {
      const same = i < n && Number.isFinite(a[i]) && a[i] === a[st] && ser.ts[i] - ser.ts[i - 1] <= step;
      if (!same) { const len = i - st; if (len >= qc.stuckN && Number.isFinite(a[st])) { for (let k = st; k < i; k++) a[k] = NaN; rep[j].stuck += len; } st = i; }
    }
  });
  // 3) 높이별 가용률·CNR → 그 높이의 풍속·풍향·표준편차 제외
  const heights = [...new Set(ser.columns.filter(c => c.height != null).map(c => c.height))];
  for (const h of heights) {
    const iav = ser.columns.findIndex(c => c.role === 'avail' && c.height === h);
    const icn = ser.columns.findIndex(c => c.role === 'cnr' && c.height === h);
    const targets = ser.columns.map((c, j) => ['ws', 'dir', 'std', 'max', 'min', 'ti'].includes(c.role) && c.height === h ? j : -1).filter(j => j >= 0);
    for (let i = 0; i < n; i++) {
      let why = '';
      if (iav >= 0 && minAvail > 0) { const v = ser.data[iav][i]; if (!(v >= minAvail)) why = 'avail'; }
      if (!why && qc.cnr && icn >= 0) { const v = ser.data[icn][i]; if (!(v >= qc.cnrMin)) why = 'cnr'; }
      if (!why) continue;
      for (const j of targets) if (Number.isFinite(data[j][i])) { data[j][i] = NaN; rep[j][why]++; }
    }
  }
  ser.columns.forEach((c, j) => { const a = data[j]; for (let i = 0; i < n; i++) if (Number.isFinite(a[i])) rep[j].kept++; });
  return { data, report: rep };
};

/* ---------- 시계열 통계 ---------- */
W.seriesHeights = ser => [...new Set(ser.columns.filter(c => c.role === 'ws' && c.height != null).map(c => c.height))].sort((a, b) => a - b);
const colOf = (ser, role, h) => { const i = ser.columns.findIndex(c => c.role === role && (h == null || c.height === h)); return i >= 0 ? ser.data[i] : null; };
W.colOf = colOf;

// 유효 자료 마스크 (높이별)
W.validMask = function (ser, h, opt) {
  const ws = colOf(ser, 'ws', h), av = colOf(ser, 'avail', h); const n = ser.ts.length;
  const m = new Uint8Array(n);
  const t0 = opt.from || -Infinity, t1 = opt.to || Infinity;
  for (let i = 0; i < n; i++) {
    const v = ws[i]; if (!(v >= 0 && v < 75)) continue;
    if (av && opt.minAvail > 0 && !(av[i] >= opt.minAvail)) continue;
    if (ser.ts[i] < t0 || ser.ts[i] > t1) continue;
    m[i] = 1;
  }
  return m;
};

// 허브높이 시계열 (순간 시어로 보간/외삽)
W.hubSeries = function (ser, hub, opt) {
  const H = W.seriesHeights(ser); const n = ser.ts.length;
  const masks = H.map(h => W.validMask(ser, h, opt)); const ws = H.map(h => colOf(ser, 'ws', h));
  const dirs = H.map(h => colOf(ser, 'dir', h)); const stds = H.map(h => colOf(ser, 'std', h));
  const out = new Float32Array(n).fill(NaN), dir = new Float32Array(n).fill(NaN), std = new Float32Array(n).fill(NaN);
  const alphaFix = opt.alphaAbove; // 위쪽 외삽 고정 지수(없으면 순간값)
  const nearest = H.reduce((b, h, i) => Math.abs(h - hub) < Math.abs(H[b] - hub) ? i : b, 0);
  for (let i = 0; i < n; i++) {
    const av = []; for (let j = 0; j < H.length; j++) if (masks[j][i] && ws[j][i] > 0) av.push(j);
    if (!av.length) continue;
    let lo = -1, hiI = -1;
    for (const j of av) { if (H[j] <= hub) lo = j; if (H[j] >= hub && hiI < 0) hiI = j; }
    let v;
    if (lo >= 0 && H[lo] === hub) v = ws[lo][i];
    else if (lo >= 0 && hiI >= 0) { const a = Math.log(ws[hiI][i] / ws[lo][i]) / Math.log(H[hiI] / H[lo]); v = ws[lo][i] * Math.pow(hub / H[lo], a); }
    else if (av.length >= 2) {
      const [j1, j2] = hiI < 0 ? [av[av.length - 2], av[av.length - 1]] : [av[0], av[1]];
      let a = Number.isFinite(alphaFix) ? alphaFix : Math.log(ws[j2][i] / ws[j1][i]) / Math.log(H[j2] / H[j1]);
      a = Math.max(-0.2, Math.min(0.5, a));
      const jr = hiI < 0 ? j2 : j1; v = ws[jr][i] * Math.pow(hub / H[jr], a);
    } else continue;
    out[i] = v;
    const jd = masks[nearest][i] ? nearest : av.reduce((b, j) => Math.abs(H[j] - hub) < Math.abs(H[b] - hub) ? j : b, av[0]);
    if (dirs[jd]) dir[i] = dirs[jd][i];
    if (stds[jd] && ws[jd][i] > 0) std[i] = stds[jd][i] * v / ws[jd][i];
  }
  return { ws: out, dir, std };
};

// 한 높이(또는 허브) 통계
W.statsFor = function (ser, src, opt) {
  // src: {ws, dir, std, mask?}
  const n = ser.ts.length, ts = ser.ts;
  const vs = [], ds = [], tis = [];
  let possible = 0;
  const t0 = opt.from || ts[0], t1 = opt.to || ts[n - 1];
  possible = Math.round((Math.min(t1, ts[n - 1]) - Math.max(t0, ts[0])) / ser.step) + 1;
  const nSec = opt.nSec || 12, sw = 360 / nSec, off = opt.dirOffset || 0;
  const sec = Array.from({ length: nSec }, () => ({ v: [], e: 0 }));
  const mon = Array.from({ length: 12 }, () => ({ s: 0, n: 0 })); const ym = new Map();
  const hr = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
  const tiBins = Array.from({ length: 31 }, () => []);
  const hist = new Array(41).fill(0);
  let s = 0, s3 = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = src.ws[i]; if (!(v >= 0) || (src.mask && !src.mask[i])) continue;
    if (ts[i] < t0 || ts[i] > t1) continue;
    vs.push(v); s += v; s3 += v * v * v; if (v < mn) mn = v; if (v > mx) mx = v;
    hist[Math.min(40, Math.floor(v))]++;
    const d = new Date(ts[i] - 1); // 구간 끝 시각 → 1ms 빼서 해당 구간
    const M = d.getUTCMonth(); mon[M].s += v; mon[M].n++;
    const key = d.getUTCFullYear() * 100 + M + 1; const y = ym.get(key) || { s: 0, n: 0 }; y.s += v; y.n++; ym.set(key, y);
    const H = d.getUTCHours(); hr[H].s += v; hr[H].n++;
    if (src.dir) { let dd = src.dir[i]; if (dd >= 0 && dd <= 360) { dd = ((dd + off) % 360 + 360) % 360; const k = Math.floor(((dd + sw / 2) % 360) / sw); sec[k].v.push(v); sec[k].e += v * v * v; } }
    if (src.std && v >= 0.5) { const sd = src.std[i]; if (sd >= 0) tiBins[Math.min(30, Math.round(v))].push(sd / v); }
  }
  const N = vs.length; if (!N) return null;
  const mean = s / N;
  const sorted = Float32Array.from(vs).sort();
  const wb = W.weibullFit(vs, opt.weibull);
  const nDir = sec.reduce((a, x) => a + x.v.length, 0) || 1;
  const secHist = sec.map(x => { const h = new Array(80).fill(0); for (const v of x.v) h[Math.min(79, Math.floor(v / 0.5))]++; const nn = x.v.length || 1; return h.map(c => c / nn); });
  const secOut = sec.map((x, i) => { const w = x.v.length >= 30 ? W.weibullFit(x.v, opt.weibull) : null; return { dir: i * sw, n: x.v.length, freq: 100 * x.v.length / nDir, mean: x.v.length ? x.v.reduce((a, b) => a + b, 0) / x.v.length : NaN, k: w ? w.k : NaN, A: w ? w.A : NaN, energy: x.e }; });
  const eTot = secOut.reduce((a, b) => a + b.energy, 0); secOut.forEach(x => x.energyPct = eTot ? 100 * x.energy / eTot : 0);
  const ti = tiBins.map((b, v) => { if (b.length < 5) return { v, n: b.length, mean: NaN, rep: NaN }; const m = b.reduce((a, c) => a + c, 0) / b.length; const sd = Math.sqrt(b.reduce((a, c) => a + (c - m) ** 2, 0) / (b.length - 1)); return { v, n: b.length, mean: m, rep: m + 1.28 * sd }; });
  const ti15 = ti[15];
  const tiAll = (() => { let a = 0, c = 0; tiBins.forEach(b => b.forEach(x => { a += x; c++; })); return c ? a / c : NaN; })();
  return {
    n: N, possible, recovery: 100 * N / possible, mean, median: sorted[Math.floor(N / 2)], min: mn, max: mx,
    std: Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1)),
    m3: s3 / N, epf: (s3 / N) / mean ** 3, k: wb ? wb.k : NaN, A: wb ? wb.A : NaN,
    sectors: src.dir ? secOut : null, secHist: src.dir ? { dv: 0.5, f: secHist } : null,
    monthly: mon.map(x => x.n ? x.s / x.n : NaN), monthlyN: mon.map(x => x.n),
    yearMonth: [...ym.entries()].sort((a, b) => a[0] - b[0]).map(([k, x]) => ({ ym: k, mean: x.s / x.n, n: x.n })),
    diurnal: hr.map(x => x.n ? x.s / x.n : NaN),
    hist: hist.map(c => 100 * c / N), ti, ti15: ti15 ? ti15.mean : NaN, tiRep15: ti15 ? ti15.rep : NaN, tiAll
  };
};

// 시어: 동시 자료 평균풍속으로 멱법칙 맞춤
W.shear = function (ser, heights, opt, offset) {
  const n = ser.ts.length; const ms = heights.map(h => W.validMask(ser, h, opt)); const ws = heights.map(h => colOf(ser, 'ws', h));
  const sums = heights.map(() => 0); let c = 0;
  const dirC = colOf(ser, 'dir', heights[Math.floor(heights.length / 2)]);
  const nSec = opt.nSec || 12, sw = 360 / nSec, off = opt.dirOffset || 0;
  const secS = Array.from({ length: nSec }, () => ({ s: heights.map(() => 0), c: 0 }));
  for (let i = 0; i < n; i++) {
    let ok = true; for (let j = 0; j < heights.length; j++) if (!ms[j][i]) { ok = false; break; }
    if (!ok) continue; c++;
    for (let j = 0; j < heights.length; j++) sums[j] += ws[j][i];
    if (dirC) { const d = dirC[i]; if (d >= 0 && d <= 360) { const k = Math.floor((((d + off) % 360 + 360 + sw / 2) % 360) / sw); secS[k].c++; for (let j = 0; j < heights.length; j++) secS[k].s[j] += ws[j][i]; } }
  }
  if (c < 10) return null;
  const z = heights.map(h => h + (offset || 0));
  const fit = means => { const X = z.map(Math.log), Y = means.map(Math.log); const mx = X.reduce((a, b) => a + b) / X.length, my = Y.reduce((a, b) => a + b) / Y.length; let sxy = 0, sxx = 0; X.forEach((x, i) => { sxy += (x - mx) * (Y[i] - my); sxx += (x - mx) ** 2; }); const a = sxy / sxx; return { alpha: a, b: my - a * mx }; };
  const means = sums.map(s => s / c); const f = fit(means);
  return { n: c, heights, z, means, alpha: f.alpha, vAt: zz => Math.exp(f.b) * Math.pow(zz, f.alpha), sectors: secS.map((x, i) => ({ dir: i * sw, n: x.c, alpha: x.c >= 30 ? fit(x.s.map(s => s / x.c)).alpha : NaN })) };
};

W.airDensity = function (ser, opt, hubAsl, sensorAsl) {
  const T = colOf(ser, 'temp'), P = colOf(ser, 'press'); if (!T || !P) return null;
  let s = 0, c = 0, st = 0, sp = 0;
  for (let i = 0; i < ser.ts.length; i++) { const t = T[i], p = P[i]; if (!(t > -40 && t < 50) || !(p > 850 && p < 1090)) continue; s += p * 100 / (287.05 * (t + 273.15)); st += t; sp += p; c++; }
  if (!c) return null;
  const rho0 = s / c; const dz = (hubAsl - (sensorAsl || 0)) / 1000;
  return { n: c, rho: rho0, meanT: st / c, meanP: sp / c, rhoHub: rho0 - 0.113 * dz };
};

/* ================= 터빈 ================= */
// 두산에너빌리티 DS205-10MW — 공개 사양(10 MW, 로터 205 m, IEC IB, 시동 3.5 · 정지 25 m/s, 전체 높이 약 230 m)으로 만든 추정 곡선.
// 출력곡선은 Cp(전기) 0.45 · 정격 부근 완만한 꺾임으로 계산, Ct는 대형 해상 터빈 Ct 모양을 정격풍속 비율로 옮긴 값. 제조사 곡선을 받으면 바꿔야 함.
W.DOOSAN_DS205_10 = {
  id: 'doosan-ds205-10', name: 'Doosan DS205-10MW (추정)', maker: 'Doosan Enerbility', model: 'DS205-10MW', ratedKW: 10000, rotor: 205, hub: 127.5,
  rhoRef: 1.225, rhoRefNote: '공개 자료에 기준 공기밀도 없음 — 1.225(표준)로 가정', curveType: 'calc', curveTypeNote: '공개 사양으로 만든 추정 곡선(제조사 곡선 아님)',
  regulation: 'pitch', estimated: true,
  source: '공개 사양 추정: 두산에너빌리티 풍력 브로슈어(2024) · 언론 보도(2025.7, UL 형식인증) — 로터 205 m, 시동 3.5 m/s, 정지 25 m/s, IEC IB. 허브높이는 전체 높이 230 m − 로터 반경으로 추정',
  curve: [[3.5, 332, 0.75], [4, 495, 0.75], [5, 1137, 0.75], [6, 1965, 0.75], [7, 3120, 0.74], [8, 4658, 0.73], [9, 6621, 0.68], [10, 8804, 0.57], [11, 9863, 0.44], [12, 9989, 0.33], [13, 10000, 0.25], [14, 10000, 0.2], [15, 10000, 0.16], [16, 10000, 0.13], [17, 10000, 0.11], [18, 10000, 0.1], [19, 10000, 0.09], [20, 10000, 0.07], [21, 10000, 0.07], [22, 10000, 0.06], [23, 10000, 0.05], [24, 10000, 0.05], [25, 10000, 0.04]]
};
// 유니슨 U210-10MW — 공개 사양(10 MW, 로터 210 m, 직접구동 기어리스, 시동 3 · 정지 25 m/s, 허브 131 m)으로 만든 추정 곡선. 두산과 같은 방법.
W.UNISON_U210 = {
  id: 'unison-u210-10', name: 'Unison U210-10MW (추정)', maker: 'Unison', model: 'U210-10MW', ratedKW: 10000, rotor: 210, hub: 131,
  rhoRef: 1.225, rhoRefNote: '공개 자료에 기준 공기밀도 없음 — 1.225(표준)로 가정', curveType: 'calc', curveTypeNote: '공개 사양으로 만든 추정 곡선(제조사 곡선 아님)',
  regulation: 'pitch', estimated: true,
  source: '공개 사양 추정: 언론 보도(2026, UL 설계인증·영광 실증) · The Wind Power DB — 로터 210 m, 직접구동, 시동 3 m/s, 정지 25 m/s, 허브 131 m',
  curve: [[3, 193, 0.75], [4, 611, 0.75], [5, 1193, 0.75], [6, 2062, 0.75], [7, 3274, 0.74], [8, 4887, 0.72], [9, 6941, 0.67], [10, 9092, 0.55], [11, 9913, 0.42], [12, 10000, 0.31], [13, 10000, 0.24], [14, 10000, 0.19], [15, 10000, 0.15], [16, 10000, 0.13], [17, 10000, 0.11], [18, 10000, 0.09], [19, 10000, 0.08], [20, 10000, 0.07], [21, 10000, 0.07], [22, 10000, 0.06], [23, 10000, 0.05], [24, 10000, 0.05], [25, 10000, 0.04]]
};
W.TURB_PRESETS = [W.DOOSAN_DS205_10, W.UNISON_U210];
// 출력 (kW) — 표 사이 선형 보간, 첫 점 미만·마지막 점 초과는 0
W.powerAt = function (curve, v) {
  const n = curve.length; if (!n || v < curve[0][0] || v > curve[n - 1][0]) return 0;
  for (let i = 1; i < n; i++) if (v <= curve[i][0]) { const [v0, p0] = curve[i - 1], [v1, p1] = curve[i]; return p0 + (p1 - p0) * (v - v0) / (v1 - v0); }
  return curve[n - 1][1];
};
W.ctAt = function (curve, v) {
  const n = curve.length; if (!n || v < curve[0][0] || v > curve[n - 1][0]) return 0;
  for (let i = 1; i < n; i++) if (v <= curve[i][0]) { const [v0, , c0] = curve[i - 1], [v1, , c1] = curve[i]; return c0 + (c1 - c0) * (v - v0) / (v1 - v0); }
  return curve[n - 1][2];
};
W.curveInfo = function (curve) {
  const rated = Math.max(...curve.map(c => c[1]));
  const cutIn = (curve.find(c => c[1] > 0) || [])[0], ratedV = (curve.find(c => c[1] >= rated * 0.999) || [])[0], cutOut = curve.length ? curve[curve.length - 1][0] : NaN;
  return { rated, cutIn, ratedV, cutOut };
};
// 공기밀도 보정한 출력곡선 함수 (IEC 61400-12-1: 피치 제어 → 풍속 보정, 실속 제어 → 출력 보정)
W.powerFn = function (T, rho, mode) {
  const r = rho / (T.rhoRef || 1.225);
  if (mode === 'none' || !(r > 0)) return v => W.powerAt(T.curve, v);
  if (mode === 'power') return v => Math.min(W.powerAt(T.curve, v) * r, T.ratedKW || Infinity);
  const f = Math.cbrt(r); return v => W.powerAt(T.curve, v * f);
};
// 연간발전량: sectors [{freq%, k, A}], 허브높이 풍속 배율 s, 시간 hours
W.aep = function (sectors, P, s, hours, dv) {
  dv = dv || 0.05; hours = hours || 8760;
  const bins = new Array(41).fill(0), secE = [];
  let tot = 0, fsum = sectors.reduce((a, x) => a + x.freq, 0) || 100;
  for (const x of sectors) {
    const k = x.k, A = x.A * s, w = x.freq / fsum; let e = 0;
    for (let v = dv / 2; v < 40; v += dv) { const pr = W.weibullPdf(v, k, A) * dv; const kw = P(v) * pr; e += kw; bins[Math.min(40, Math.floor(v))] += w * kw * hours / 1000; }
    secE.push({ dir: x.dir, freq: 100 * w, mwh: e * hours / 1000, meanV: W.weibullMean(k, A) }); tot += w * e;
  }
  return { mwh: tot * hours / 1000, bins, sectors: secE };
};
// PDF에서 출력곡선 표 찾기: 머리글에 Wind speed·Power (Thrust/Ct 선택), 묶음이 옆으로 반복될 수 있음
W.findPowerCurves = function (pages) {
  const out = [];
  pages.forEach((lines, pi) => lines.forEach((l, i) => {
    const cs = l.cells; const iv = cs.map((c, j) => /wind\s*speed|^v\b|풍속/i.test(c.s) ? j : -1).filter(j => j >= 0);
    if (!iv.length || !cs.some(c => /power|출력/i.test(c.s))) return;
    const groups = iv.map((j, g) => { const end = g + 1 < iv.length ? iv[g + 1] : cs.length; const part = cs.slice(j, end); return { xs: part.map(c => c.x + c.w / 2), roles: part.map(c => /wind\s*speed|^v\b|풍속/i.test(c.s) ? 'v' : /power|출력/i.test(c.s) ? 'p' : /thrust|ct\b|추력/i.test(c.s) ? 'ct' : '') }; });
    const kw = /\[?\s*mw\s*\]?/i.test(cs.find(c => /power|출력/i.test(c.s)).s) && !/kw/i.test(cs.find(c => /power|출력/i.test(c.s)).s) ? 1000 : 1;
    const pts = []; let miss = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 60) && miss < 2; j++) {
      const row = lines[j].cells; if (!row.length || !row.every(c => isNum(c.s))) { miss++; continue; }
      miss = 0;
      for (const g of groups) {
        const pick = role => { const gi = g.roles.indexOf(role); if (gi < 0) return NaN; const x = g.xs[gi]; let b = null, bd = 45; for (const c of row) { const d = Math.abs(c.x + c.w / 2 - x); if (d < bd) { bd = d; b = c; } } return b ? num(b.s) : NaN; };
        const v = pick('v'), p = pick('p'), ct = pick('ct');
        if (Number.isFinite(v) && Number.isFinite(p) && v >= 0 && v <= 40) pts.push([v, p * kw, Number.isFinite(ct) ? ct : NaN]);
      }
    }
    if (pts.length < 5) return;
    pts.sort((a, b) => a[0] - b[0]);
    const name = (lines.slice(Math.max(0, i - 3), i).map(x => x.text).reverse().find(t => !/^(table|figure|표|그림)\s*[\d-]+/i.test(t) && /[a-z]/i.test(t) && t.length < 60) || '').replace(/\s*\|\s*/g, ' ');
    out.push({ page: pi + 1, name, curve: pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0]) });
  }));
  return out;
};
// PDF 사양 표 (항목 | 값)
W.findTurbineSpec = function (pages) {
  const sp = {};
  for (const l of pages.flat()) {
    const t = l.cells.map(c => c.s); if (t.length < 2) continue; const a = t[0], b = t[t.length - 1];
    if (/^manufacturer|제조사|제작사/i.test(a)) sp.maker = b;
    else if (/^(wtg|turbine)?\s*model|기종|모델/i.test(a)) sp.model = b;
    else if (/^rated power/i.test(a)) { const v = num(b); if (Number.isFinite(v)) sp.ratedKW = /\[\s*mw\s*\]/i.test(a) ? v * 1000 : v; }
    else if (/^rotor diameter|로터\s*직경/i.test(a)) { const v = num(b); if (Number.isFinite(v)) sp.rotor = v; }
    else if (/^hub height|허브\s*높이/i.test(a) && !sp.hub) { const v = num(b); if (Number.isFinite(v)) sp.hub = v; }
    else if (/^power regulation/i.test(a)) sp.regulation = /stall/i.test(b) && !/pitch/i.test(b) ? 'stall' : 'pitch';
  }
  return sp;
};

/* ================= 3단계: 배치·후류 ================= */
W.latLonToUtm = function (lat, lon, zone) {
  zone = zone || Math.floor((lon + 180) / 6) + 1;
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
  const lam0 = ((zone - 1) * 6 - 180 + 3) * r, ph = lat * r, la = lon * r;
  const N = a / Math.sqrt(1 - e2 * Math.sin(ph) ** 2), T = Math.tan(ph) ** 2, C = ep2 * Math.cos(ph) ** 2, A = Math.cos(ph) * (la - lam0);
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * ph - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * ph) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * ph) - (35 * e2 ** 3 / 3072) * Math.sin(6 * ph));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let Nn = k0 * (M + N * Math.tan(ph) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720)); if (lat < 0) Nn += 10000000;
  return { E, N: Nn, zone };
};
// 국내 TM 좌표(GRS80, 2003년 이후 새 원점: 위도 38°, 가산값 X 200,000 · Y 600,000, 축척 1.0) ↔ 위도·경도.
// 동부원점(EPSG:5187) 129°, 중부원점(5186) 127°, 서부원점(5185) 125°, 동해원점(5188) 131°. GRS80과 WGS84 차이는 mm 수준이라 같다고 봄
W.TM_ORIGINS = { east: { name: 'TM 동부원점 (GRS80, EPSG:5187)', lon0: 129 }, central: { name: 'TM 중부원점 (GRS80, EPSG:5186)', lon0: 127 }, west: { name: 'TM 서부원점 (GRS80, EPSG:5185)', lon0: 125 }, eastsea: { name: 'TM 동해원점 (GRS80, EPSG:5188)', lon0: 131 } };
(function () {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180, k0 = 1, lat0 = 38 * r, FE = 200000, FN = 600000;
  const Mof = ph => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * ph - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * ph) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * ph) - (35 * e2 ** 3 / 3072) * Math.sin(6 * ph));
  const M0 = Mof(lat0);
  W.latLonToTm = function (lat, lon, key = 'east') {
    const lam0 = W.TM_ORIGINS[key].lon0 * r, ph = lat * r, la = lon * r;
    const N = a / Math.sqrt(1 - e2 * Math.sin(ph) ** 2), T = Math.tan(ph) ** 2, C = ep2 * Math.cos(ph) ** 2, A = Math.cos(ph) * (la - lam0);
    const X = FE + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const Y = FN + k0 * (Mof(ph) - M0 + N * Math.tan(ph) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return { E: X, N: Y };
  };
  W.tmToLatLon = function (E, N, key = 'east') {
    const lam0 = W.TM_ORIGINS[key].lon0, x = E - FE, M = M0 + (N - FN) / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(p1) ** 2, 1.5), D = x / (N1 * k0);
    const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
    return { lat: lat / r, lon: lam0 + lon / r };
  };
})();
// 좌표 묶음이 국내 TM(가산값 200,000/600,000 체계)으로 보이는지: N(Y)이 100만 미만이고 E(X)가 0~40만 → UTM(북반구 N 수백만)과 구분
W.looksTm = pts => pts.length > 0 && pts.every(p => p[1] > 0 && p[1] < 1000000 && p[0] > 0 && p[0] < 400000);
W.overlapFrac = function (Rw, r, d) {
  if (d >= Rw + r) return 0; if (d <= Rw - r) return 1; if (d <= r - Rw) return (Rw * Rw) / (r * r);
  const a = Math.acos((d * d + r * r - Rw * Rw) / (2 * d * r)), b = Math.acos((d * d + Rw * Rw - r * r) / (2 * d * Rw));
  return (r * r * a + Rw * Rw * b - 0.5 * Math.sqrt(Math.max(0, (-d + r + Rw) * (d + r - Rw) * (d - r + Rw) * (d + r + Rw)))) / (Math.PI * r * r);
};
// TurbOPark 후류 지름 (Nygaard et al. 2020, Ørsted). x, D [m], I0 주변 난류강도, ct 추력계수
W.turboparkDw = function (x, D, I0, ct, A) {
  A = A || 0.04; const c1 = 1.5, c2 = 0.8; const a = c1 * I0, b = c2 * I0 / Math.sqrt(Math.max(ct, 0.01)); const xs = a + b * x / D;
  const s1 = Math.sqrt(xs * xs + 1), s0 = Math.sqrt(1 + a * a);
  return D * (1 + A * I0 / b * (s1 - s0 - Math.log(((s1 + 1) * a) / ((s0 + 1) * xs))));
};
// 단지 후류 계산. o: {xy:[[x,y]], scale:[], P(v)|P:[f], Ct(v)|Ct:[f], R|R:[], count:[bool] (false = 주변 단지: 후류만 줌),
//   sectors:[{dir,freq,k,A}], hist?:{dv, f:[[]]}, model:'lin'|'rss'|'turbopark'|'gauss', k (Jensen), ti (주변 난류강도), dd, dv, hours}
W.wakeFarm = function (o) {
  const n = o.xy.length, dd = o.dd || 1, dv = o.dv || 0.5, hours = o.hours || 8760, kw = o.k, model = o.model || 'lin', I0 = o.ti || 0.06;
  const Pf = i => Array.isArray(o.P) ? o.P[i] : o.P, Cf = i => Array.isArray(o.Ct) ? o.Ct[i] : o.Ct, Rr = i => Array.isArray(o.R) ? o.R[i] : o.R;
  const cnt = i => !o.count || o.count[i] !== false;
  const nS = o.sectors.length, sw = 360 / nS, fs = o.sectors.reduce((a, x) => a + x.freq, 0) || 100;
  const gross = new Float64Array(n), net = new Float64Array(n), secG = new Float64Array(nS), secN = new Float64Array(nS); let curt = 0;
  const kStar = 0.3837 * I0 + 0.003678; // Gaussian (Bastankhah & Porté-Agel 2014, Niayifar & Porté-Agel 2016)
  const ring = [[0, 0, 0.25], ...Array.from({ length: 8 }, (_, q) => [0.7 * Math.cos(q * Math.PI / 4), 0.7 * Math.sin(q * Math.PI / 4), 0.75 / 8])];
  for (let d = dd / 2; d < 360; d += dd) {
    const si = Math.floor(((d + sw / 2) % 360) / sw), S = o.sectors[si], wdir = S.freq / fs * dd / sw;
    const th = d * Math.PI / 180, wx = -Math.sin(th), wy = -Math.cos(th);
    const along = o.xy.map(p => p[0] * wx + p[1] * wy), cross = o.xy.map(p => -p[0] * wy + p[1] * wx);
    const ord = [...Array(n).keys()].sort((a, b) => along[a] - along[b]);
    // 상류 j → 하류 i 쌍: Jensen은 겹침 계수를 미리, 나머지는 거리만
    const pairs = new Map();
    for (let ii = 0; ii < n; ii++) {
      const i = ord[ii]; const list = []; const Ri = Rr(i);
      for (let jj = 0; jj < ii; jj++) {
        const j = ord[jj]; const x = along[i] - along[j]; if (x <= 1) continue; const dc = Math.abs(cross[i] - cross[j]), Rj = Rr(j);
        if (model === 'lin' || model === 'rss') { const Rw = Rj + kw * x; const ov = W.overlapFrac(Rw, Ri, dc); if (ov > 0) list.push([j, ov * (Rj / Rw) ** 2]); }
        else if (model === 'turbopark') { if (dc < Ri + Rj + 0.5 * x) list.push([j, x, dc]); }
        else { if (dc < Ri + 6 * (kStar * x + 0.5 * Rj)) list.push([j, x, dc]); }
      }
      pairs.set(i, list);
    }
    const bins = [];
    if (o.hist && o.hist.f[si]) { const hb = o.hist.f[si], hdv = o.hist.dv; for (let b = 0; b < hb.length; b++) if (hb[b] > 0) bins.push([(b + 0.5) * hdv, hb[b] * wdir]); }
    else for (let v = dv / 2; v < 32; v += dv) { const pr = W.weibullPdf(v, S.k, S.A) * dv * wdir; if (pr > 1e-10) bins.push([v, pr]); }
    const u = new Float64Array(n), pn = new Float64Array(n);
    for (const [v, pr] of bins) {
      let sumN = 0;
      for (const i of ord) {
        const u0 = v * o.scale[i]; let s2 = 0, sl = 0; const Ri = Rr(i);
        for (const pr2 of pairs.get(i)) {
          const j = pr2[0]; const ct = Math.min(Cf(j)(u[j]), 0.999); if (ct <= 0) continue; const Dj = 2 * Rr(j); let def;
          if (model === 'lin' || model === 'rss') def = (1 - Math.sqrt(1 - ct)) * pr2[1];
          else if (model === 'turbopark') { const Dw = W.turboparkDw(pr2[1], Dj, I0, ct); const ov = W.overlapFrac(Dw / 2, Ri, pr2[2]); if (ov <= 0) continue; def = (1 - Math.sqrt(Math.max(0, 1 - ct * (Dj / Dw) ** 2))) * ov; }
          else { const bc = 0.5 * (1 + Math.sqrt(1 - ct)) / Math.sqrt(1 - ct); const sig = (kStar * pr2[1] / Dj + 0.2 * Math.sqrt(bc)) * Dj; const C = 1 - Math.sqrt(Math.max(0, 1 - ct / (8 * (sig / Dj) ** 2)));
            def = 0; for (const [ry, rz, w] of ring) { const r2 = (pr2[2] + ry * Ri) ** 2 + (rz * Ri) ** 2; def += w * C * Math.exp(-r2 / (2 * sig * sig)); } }
          s2 += def * def; sl += def;
        }
        const tot = model === 'lin' ? sl : Math.sqrt(s2); u[i] = u0 * (1 - Math.min(tot, 0.95));
        if (!cnt(i)) continue;
        const P = Pf(i); const g = P(u0) * pr; pn[i] = P(u[i]); sumN += pn[i]; gross[i] += g; secG[si] += g;
      }
      // 단지 출력 상한(계통연계 용량): 이 풍향·풍속에서 단지 합계가 상한을 넘으면 넘는 만큼 모든 터빈을 같은 비율로 깎음
      const fc = o.capKW > 0 && sumN > o.capKW ? o.capKW / sumN : 1; if (fc < 1) curt += sumN * (1 - fc) * pr;
      for (let i = 0; i < n; i++) if (cnt(i)) { const ne = pn[i] * fc * pr; net[i] += ne; secN[si] += ne; }
    }
  }
  const k = hours / 1000;
  return { gross: Array.from(gross, x => x * k), net: Array.from(net, x => x * k), secGross: Array.from(secG, x => x * k), secNet: Array.from(secN, x => x * k), curt: curt * k };
};
// 최소 신장 트리(내부 케이블 최소 연결 길이, m)
W.mstLength = function (xy) {
  const n = xy.length; if (n < 2) return { len: 0, edges: [] }; const inT = new Array(n).fill(false), dist = new Array(n).fill(Infinity), par = new Array(n).fill(-1); dist[0] = 0; let len = 0; const edges = [];
  for (let k = 0; k < n; k++) { let m = -1; for (let i = 0; i < n; i++) if (!inT[i] && (m < 0 || dist[i] < dist[m])) m = i; inT[m] = true; if (par[m] >= 0) { len += dist[m]; edges.push([par[m], m]); } for (let i = 0; i < n; i++) if (!inT[i]) { const d = Math.hypot(xy[i][0] - xy[m][0], xy[i][1] - xy[m][1]); if (d < dist[i]) { dist[i] = d; par[i] = m; } } }
  return { len, edges };
};
// 선(열린 폴리선)까지 거리
W.distToLine = (x, y, pts) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2)) : 0; d = Math.min(d, Math.hypot(x - x1 - t * dx, y - y1 - t * dy)); } return d; };
// 실측 분포(방향×풍속 구간 빈도)로 연간발전량
W.aepHist = function (hist, sectors, P, s, hours) {
  hours = hours || 8760; const fs = sectors.reduce((a, x) => a + x.freq, 0) || 100; const bins = new Array(41).fill(0); let tot = 0; const secE = [];
  sectors.forEach((x, si) => { const hb = hist.f[si] || []; let e = 0; hb.forEach((p, b) => { const v = (b + 0.5) * hist.dv * s; const kw = P(v) * p; e += kw; bins[Math.min(40, Math.floor(v))] += x.freq / fs * kw * hours / 1000; }); secE.push({ dir: x.dir, freq: 100 * x.freq / fs, mwh: e * hours / 1000, meanV: hb.reduce((a, p, b) => a + p * (b + 0.5) * hist.dv * s, 0) }); tot += x.freq / fs * e; });
  return { mwh: tot * hours / 1000, bins, sectors: secE };
};
// PDF: 터빈 배치 표 (이름 | ... | 6자리 E | 7자리 N), 연속 행 묶음
W.findLayouts = function (pages) {
  const out = [];
  pages.forEach((lines, pi) => {
    let cur = null;
    const flush = () => { if (cur && cur.rows.length >= 2) out.push(cur); cur = null; };
    lines.forEach((l, li) => {
      const t = l.cells.map(c => c.s); const label = t[0];
      let E = NaN, N = NaN, V = NaN;
      for (let i = 1; i < t.length - 1; i++) { const a = num(t[i]), b = num(t[i + 1]); if (a >= 100000 && a < 1000000 && b >= 1000000 && b < 10000000 && /^[\d,]+(\.\d+)?$/.test(t[i]) && /^[\d,]+(\.\d+)?$/.test(t[i + 1])) { E = a; N = b; const c = num(t[i + 2]); if (c > 2 && c < 20) V = c; break; } }
      if (label && !isNum(label) && Number.isFinite(E) && label.length <= 20) { if (!cur) cur = { page: pi + 1, rows: [], caption: (lines.slice(Math.max(0, li - 10), li).map(x => x.text).reverse().find(x => /^(table|표)\s*[\d-]+/i.test(x)) || '').replace(/\s*\|\s*/g, ' ') }; cur.rows.push({ name: label, x: E, y: N, v: Number.isFinite(V) ? V : undefined }); }
      else if (cur && cur.rows.length) flush();
    });
    flush();
  });
  return out;
};
// PDF: 터빈별 결과 표 (이름 | 풍속 | 총발전량 | ... | 효율%)
W.findWtgResults = function (pages) {
  const out = [];
  for (const l of pages.flat()) {
    const t = l.cells.map(c => c.s); if (t.length < 4 || !/^[A-Za-z가-힣#-]*\s*-?\d+$/.test(t[0]) || isNum(t[0])) continue;
    const nums = t.slice(1).map(s => ({ s, v: num(s.replace('%', '')), pct: /%$/.test(s) }));
    const v = nums.find(x => !x.pct && x.v >= 2 && x.v <= 15); const g = nums.find(x => !x.pct && x.v >= 1000);
    if (!v || !g || g.v > 500000) continue;
    const pcts = nums.filter(x => x.pct); const big = nums.filter(x => !x.pct && x.v >= 1000);
    out.push({ name: t[0], v: v.v, gross: g.v, net: big.length > 1 ? big[big.length - 1].v : NaN, eff: pcts.length ? pcts[pcts.length - 1].v : NaN });
  }
  return out;
};
W.normName = s => { const m = String(s || '').match(/^(.*?)(\d+)\s*$/); return m ? m[1].replace(/[\s_-]/g, '').toUpperCase() + (+m[2]) : String(s).toUpperCase(); };
// PDF: 손실·불확도 표 ("항목 | [%] | 값"), 분류 제목·A./A.1 기호 함께
W.findPctTables = function (pages) {
  const losses = [], unc = [], yields = {};
  let cat = '', uncMode = false;
  for (const l of pages.flat()) {
    const t = l.cells.map(c => c.s);
    const iu = t.findIndex(c => /^\[\s*(%|mwh\/a|mwh\/y|mwh)\s*\]$/i.test(c));
    if (iu < 0) { if (t.length === 1 && /^[A-Za-z가-힣][A-Za-z가-힣 ,\-\/()]+$/.test(t[0]) && t[0].length < 50) cat = t[0]; continue; }
    const val = num(t[t.length - 1]); if (!Number.isFinite(val)) continue;
    const unit = t[iu].replace(/[\[\]\s]/g, '').toLowerCase();
    const pre = t.slice(0, iu);
    if (unit !== '%') { yields[pre.join(' ')] = val; continue; }
    const code = /^[A-H](\.\d+)?\.?$/.test(pre[0]) ? pre[0].replace(/\.$/, '') : '';
    const label = (code ? pre.slice(1) : pre).join(' ').trim();
    if (code) uncMode = code !== 'F'; // 기호(A, A.1 …)가 나온 뒤 F(결합)까지는 불확도 표
    if (code || uncMode) { unc.push({ code, label, value: val }); continue; }
    if (/uncertain|calibration|measurement|regression|duration|evaluation|modell?ing|coordinate|land use|windward|park (efficiency|configuration)|performance curve|turbulence condition|rix|number of/i.test(label) && !/loss/i.test(cat)) unc.push({ code, label, value: val });
    else losses.push({ cat, label, value: val });
  }
  return { losses, unc, yields };
};
// DXF: POINT / INSERT / CIRCLE / TEXT
W.parseDxf = function (text) {
  const L = text.split(/\r?\n/); const ents = []; let inEnt = false, cur = null, heavy = null;
  const push = () => { if (cur && cur.type !== 'VTX') ents.push(cur); };
  for (let i = 0; i + 1 < L.length; i += 2) {
    const code = L[i].trim(), val = L[i + 1].trim();
    if (code === '2' && L[i - 2] && L[i - 2].trim() === '0' && L[i - 1].trim() === 'SECTION') { inEnt = val === 'ENTITIES'; continue; }
    if (!inEnt) continue;
    if (code === '0') {
      push(); cur = null;
      if (['POINT', 'INSERT', 'CIRCLE', 'TEXT', 'MTEXT'].includes(val)) cur = { type: val, layer: '', block: '', x: NaN, y: NaN, text: '' };
      else if (val === 'LWPOLYLINE') cur = { type: 'POLY', layer: '', pts: [], closed: false, x: NaN, y: NaN };
      else if (val === 'POLYLINE') { cur = { type: 'POLY', layer: '', pts: [], closed: false, x: NaN, y: NaN, heavy: true }; heavy = cur; }
      else if (val === 'VERTEX' && heavy) cur = { type: 'VTX', x: NaN, y: NaN };
      else if (val === 'SEQEND') heavy = null;
      if (val === 'ENDSEC') inEnt = false; continue;
    }
    if (!cur) continue;
    if (cur.type === 'VTX') { if (code === '10') cur.x = +val; else if (code === '20') { cur.y = +val; heavy.pts.push([cur.x, cur.y]); } continue; }
    if (cur.type === 'POLY') {
      if (code === '8') cur.layer = val; else if (code === '70') cur.closed = (+val & 1) === 1;
      else if (code === '10' && !cur.heavy) cur.pts.push([+val, NaN]); else if (code === '20' && !cur.heavy && cur.pts.length) cur.pts[cur.pts.length - 1][1] = +val;
      continue;
    }
    if (code === '8') cur.layer = val; else if (code === '2' && cur.type === 'INSERT') cur.block = val; else if (code === '10') cur.x = +val; else if (code === '20') cur.y = +val; else if (code === '1') cur.text = val; else if (code === '40' && cur.type === 'CIRCLE') cur.r = +val;
  }
  push();
  ents.forEach(e => { if (e.type === 'POLY') { e.pts = e.pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])); if (e.pts.length) { e.x = e.pts[0][0]; e.y = e.pts[0][1]; } const q = e.pts; if (q.length > 2 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) < 1e-6) { q.pop(); e.closed = true; } } });
  return ents.filter(e => Number.isFinite(e.x) && Number.isFinite(e.y) && (e.type !== 'POLY' || e.pts.length >= 3));
};
// 다각형: 면적(m²), 점 포함, 경계까지 거리
W.polyArea = pts => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
W.inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
W.distToEdge = (x, y, pts) => { let d = Infinity; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2)) : 0; d = Math.min(d, Math.hypot(x - x1 - t * dx, y - y1 - t * dy)); } return d; };
// 각도 글자 → 십진수 ("35°10'12.3\"", "35 10 12.3", "35.17", "N35-10-12")
W.parseAngle = s => { const t = String(s).trim(); const neg = /^[-−]|[SWsw서남]/.test(t); const ns = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number); if (!ns.length) return NaN; const v = ns[0] + (ns[1] || 0) / 60 + (ns[2] || 0) / 3600; return neg ? -v : v; };
// 손실 합계 (곱셈)
W.totalLoss = vals => 1 - vals.reduce((r, v) => r * (1 - (v || 0) / 100), 1);
W.PZ = { 50: 0, 55: 0.125661, 60: 0.253347, 65: 0.385320, 70: 0.524401, 75: 0.674490, 80: 0.841621, 85: 1.036433, 90: 1.281552, 95: 1.644854, 99: 2.326348 };

// 보고서의 측정 기간 ("Measurement period | 2017. 9. 22 ~ 2018. 9. 30")
W.findMeasPeriod = function (pages) {
  const re = /(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/g;
  for (const l of pages.flat()) {
    if (!/measurement period|측정\s*기간|data period/i.test(l.text)) continue;
    const ds = [...l.text.matchAll(re)].map(m => Date.UTC(+m[1], m[2] - 1, +m[3]));
    if (ds.length >= 2 && ds[1] > ds[0]) return { from: ds[0], to: ds[1], months: (ds[1] - ds[0]) / (86400000 * 30.4375), text: l.text.replace(/\s*\|\s*/g, ' ') };
  }
  return null;
};

// 보고서의 장기 보정 단서: 상관계수 r, 장기 자료 연수, 참조 자료 종류, 해안·해상 단서
W.findLtInfo = function (pages) {
  const lines = pages.flat().map(l => l.text.replace(/\s*\|\s*/g, ' | '));
  const text = lines.join('\n');
  const out = {};
  // r: "Regression | MBE | r | ..." 형태 또는 "correlation coefficient (r) 0.87"
  const rs = [];
  for (const t of lines) { if (!/regression|correlation|상관/i.test(t)) continue; for (const m of t.matchAll(/(?:^|[\s|(])(0\.\d{2,3})(?=[\s|)]|$)/g)) { const v = +m[1]; if (v >= 0.5 && v < 1) rs.push(v); } }
  if (!rs.length) for (let i = 0; i < lines.length && !rs.length; i++) {
    if (!/correlation\s*\(r\)|correlation coefficient|상관\s*계수/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 80); j++) { if (/^(table|figure|표|그림)\b/i.test(lines[j].trim())) break; const m = lines[j].trim().match(/^(0\.\d{2,3})$/); if (m && +m[1] >= 0.5) rs.push(+m[1]); }
  }
  if (rs.length) out.r = Math.max(...rs);
  // 장기 자료 기간: 장기·재분석 단서가 있는 줄 또는 그 근처의 "yyyy-mm-dd ~ yyyy-mm-dd"
  for (let i = 0; i < lines.length && !out.years; i++) {
    const m = lines[i].match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})\s*[~–-]\s*(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
    if (!m) continue;
    const ctx = lines.slice(Math.max(0, i - 4), i + 2).join(' ');
    if (!/era|merra|reanalys|long[- ]?term|wrf|reference|장기|재분석/i.test(ctx)) continue;
    if (/temperature|기온|온도/i.test(lines[i])) continue;
    const y = (Date.UTC(+m[4], m[5] - 1, +m[6]) - Date.UTC(+m[1], m[2] - 1, +m[3])) / (365.25 * 86400000);
    if (y >= 3) { out.years = y; out.yearsText = m[0]; }
  }
  if (!out.years) { const m = text.match(/(\d{1,2})\s*[- ]?year (?:period|long[- ]term|reference)/i) || text.match(/over a (\d{1,2}) year/i); if (m && +m[1] >= 3) { out.years = +m[1]; out.yearsText = m[0]; } }
  if (/era\s*-?\s*5|merra|reanalys|emd-wrf|cfsr|재분석/i.test(text)) out.refType = 'reanalysis';
  else if (/aws|asos|weather station|기상대|관측소/i.test(text)) out.refType = 'station';
  out.coastal = /lighthouse|island|coastal|coastline|near-shore|등대|섬|해안/i.test(text);
  out.offshore = /offshore|해상/i.test(text);
  out.verification = /verification report|verified against|검증 보고서/i.test(text) && !/no verification report/i.test(text);
  return out;
};

G.WindCore = W;
if (typeof module !== 'undefined') module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : this);
