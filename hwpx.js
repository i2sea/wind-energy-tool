// HWPX(한글) 보고서 만들기 — 보고서 블록(reportBlocks)을 한글 문서로. 레이아웃 정보(linesegarray)는 넣지 않아 한글이 열 때 다시 계산함
(function (G) {
  const T = () => G.HWPX_TPL;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const TEXT_W = 42520; // A4 본문 폭 (HWPUNIT, 1 mm ≈ 283.46)
  const BLUE = '#1F5FA8', NAVY = '#0B5CAD';

  // 글자 모양: [id, 크기(1/100pt), 글꼴(0 돋움·1 바탕), 굵게, 색]
  const CH = { body: 7, bold: 8, h1: 9, h2: 10, h3: 11, cell: 12, cellB: 13, cellW: 14, small: 15, cap: 16, hdr: 17, coverT: 18, coverS: 19, coverM: 20, tocH: 21, blueB: 22, coverW: 23 };
  const CH_DEF = [[CH.body, 950, 0, false, '#000000'], [CH.bold, 950, 0, true, '#000000'], [CH.h1, 1250, 0, true, BLUE], [CH.h2, 1100, 0, true, BLUE], [CH.h3, 1000, 0, true, BLUE],
    [CH.cell, 850, 0, false, '#000000'], [CH.cellB, 850, 0, true, '#000000'], [CH.cellW, 850, 0, true, '#FFFFFF'], [CH.small, 800, 0, false, '#555555'], [CH.cap, 850, 0, false, '#000000'],
    [CH.hdr, 750, 0, false, '#333333'], [CH.coverT, 2600, 0, true, '#000000'], [CH.coverS, 1700, 0, true, '#000000'], [CH.coverM, 1200, 0, true, '#000000'], [CH.tocH, 1400, 0, true, BLUE], [CH.blueB, 950, 0, true, BLUE], [CH.coverW, 2400, 0, true, '#FFFFFF']];
  // 문단 모양: [id, 정렬, 앞, 뒤, 줄간격%, 다음과 함께, 왼쪽, 테두리(borderFill id)]
  const PA = { body: 30, center: 31, right: 32, h1: 33, h2: 34, h3: 35, cellC: 36, cellL: 37, cellR: 38, capT: 39, capF: 40, bullet: 41, hdr: 42, ftr: 43, toc1: 44, toc2: 45, cover: 46 };
  const PA_DEF = [[PA.body, 'JUSTIFY', 0, 300, 180, 0, 0, 0], [PA.center, 'CENTER', 0, 200, 160, 0, 0, 0], [PA.right, 'RIGHT', 0, 200, 160, 0, 0, 0],
    [PA.h1, 'LEFT', 1200, 500, 160, 1, 0, 0], [PA.h2, 'LEFT', 800, 400, 160, 1, 0, 0], [PA.h3, 'LEFT', 600, 300, 160, 1, 0, 0],
    [PA.cellC, 'CENTER', 0, 0, 130, 0, 0, 0], [PA.cellL, 'LEFT', 0, 0, 130, 0, 0, 0], [PA.cellR, 'RIGHT', 0, 0, 130, 0, 0, 0],
    [PA.capT, 'CENTER', 600, 200, 140, 1, 0, 0], [PA.capF, 'CENTER', 150, 600, 140, 0, 0, 0], [PA.bullet, 'JUSTIFY', 0, 200, 180, 0, 1100, 0],
    [PA.hdr, 'LEFT', 0, 0, 130, 0, 0, 9], [PA.ftr, 'CENTER', 0, 0, 130, 0, 0, 10], [PA.toc1, 'LEFT', 300, 100, 150, 0, 0, 0], [PA.toc2, 'LEFT', 0, 60, 150, 0, 900, 0], [PA.cover, 'CENTER', 0, 0, 160, 0, 0, 0]];
  // 테두리·채우기
  const BF = { grid: 3, title: 4, head: 5, band: 6, label: 7, none: 8, hline: 9, fline: 10, cover: 11 };

  function buildHeader() {
    let h = T().header;
    const c0 = h.match(/<hh:charPr id="0"[\s\S]*?<\/hh:charPr>/)[0];
    const chars = CH_DEF.map(([id, ht, font, bold, color]) => {
      let c = c0.replace(/id="0"/, `id="${id}"`).replace(/height="\d+"/, `height="${ht}"`).replace(/textColor="[^"]*"/, `textColor="${color}"`)
        .replace(/<hh:fontRef [^>]*\/>/, `<hh:fontRef hangul="${font}" latin="${font}" hanja="${font}" japanese="${font}" other="${font}" symbol="${font}" user="${font}"/>`);
      if (bold) c = c.replace('<hh:underline', '<hh:bold/><hh:underline');
      return c;
    }).join('');
    h = h.replace(/<hh:charProperties itemCnt="(\d+)">([\s\S]*?)<\/hh:charProperties>/, (m, n, body) => `<hh:charProperties itemCnt="${+n + CH_DEF.length}">${body}${chars}</hh:charProperties>`);
    const p0 = h.match(/<hh:paraPr id="0"[\s\S]*?<\/hh:paraPr>/)[0];
    const paras = PA_DEF.map(([id, al, prev, next, ls, kwn, left, bfid]) => p0.replace(/id="0"/, `id="${id}"`).replace(/horizontal="[A-Z]+"/, `horizontal="${al}"`)
      .replace(/keepWithNext="\d"/, `keepWithNext="${kwn}"`).replace(/<hc:left value="0"/g, `<hc:left value="${left}"`)
      .replace(/<hc:prev value="0"/g, `<hc:prev value="${prev}"`).replace(/<hc:next value="0"/g, `<hc:next value="${next}"`)
      .replace(/<hh:lineSpacing type="PERCENT" value="\d+"/g, `<hh:lineSpacing type="PERCENT" value="${ls}"`)
      .replace(/<hh:border borderFillIDRef="\d+"/, `<hh:border borderFillIDRef="${bfid || 2}"`)).join('');
    h = h.replace(/<hh:paraProperties itemCnt="(\d+)">([\s\S]*?)<\/hh:paraProperties>/, (m, n, body) => `<hh:paraProperties itemCnt="${+n + PA_DEF.length}">${body}${paras}</hh:paraProperties>`);
    const sides = s => ['left', 'right', 'top', 'bottom'].map(k => { const [t, w, c] = s[k] || ['NONE', '0.1 mm', '#000000']; return `<hh:${k}Border type="${t}" width="${w}" color="${c}"/>`; }).join('');
    const g = ['SOLID', '0.12 mm', '#7F7F7F'], all = { left: g, right: g, top: g, bottom: g };
    const bf = (id, s, fill) => `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>${sides(s)}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>${fill ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : ''}</hh:borderFill>`;
    const list = [bf(BF.grid, all), bf(BF.title, all, NAVY), bf(BF.head, all, '#D9D9D9'), bf(BF.band, all, '#E7E6E6'), bf(BF.label, all, '#F2F2F2'), bf(BF.none, {}),
      bf(BF.hline, { bottom: ['SOLID', '0.4 mm', BLUE] }), bf(BF.fline, { top: ['SOLID', '0.12 mm', '#7F7F7F'] }), bf(BF.cover, {}, NAVY)];
    h = h.replace(/<hh:borderFills itemCnt="(\d+)">([\s\S]*?)<\/hh:borderFills>/, (m, n, body) => `<hh:borderFills itemCnt="${+n + list.length}">${body}${list.join('')}</hh:borderFills>`);
    return h;
  }

  let pid = 1000; const nid = () => String(++pid);
  const run = (text, ch) => `<hp:run charPrIDRef="${ch}"><hp:t>${esc(text)}</hp:t></hp:run>`;
  const para = (inner, pp, br) => `<hp:p id="${nid()}" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="${br ? 1 : 0}" columnBreak="0" merged="0">${inner}</hp:p>`;
  const subList = (inner, va = 'CENTER', w = 0, h = 0) => `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${va}" linkListIDRef="0" linkListNextIDRef="0" textWidth="${w}" textHeight="${h}" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>`;
  const autoNum = type => `<hp:ctrl><hp:autoNum num="1" numType="${type}"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl>`;

  class Doc {
    constructor() { this.body = []; this.bins = []; this.objId = 1900000000; }
    _oid() { return String(++this.objId); }
    raw(x) { this.body.push(x); }
    p(text, ch = CH.body, pp = PA.body, br) { const parts = Array.isArray(text) ? text : [[text, ch]]; this.body.push(para(parts.map(([s, c]) => run(s, c ?? ch)).join(''), pp, br)); }
    // rows: [{cells:[{t, span, bf, ch, al}]}], widths: 비율
    table(rows, widths, frac = 1, pp = PA.center) {
      const nC = widths.length, totalW = Math.round(TEXT_W * frac); const ws = widths.reduce((a, b) => a + b, 0);
      const cw = widths.map(w => Math.round(totalW * w / ws)); cw[nC - 1] += totalW - cw.reduce((a, b) => a + b, 0);
      const rh = 1300, hdrRows = rows.filter(r => r.head).length;
      let x = `<hp:tbl id="${this._oid()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${hdrRows ? 1 : 0}" rowCnt="${rows.length}" colCnt="${nC}" cellSpacing="0" borderFillIDRef="${BF.grid}" noAdjust="0"><hp:sz width="${totalW}" widthRelTo="ABSOLUTE" height="${rh * rows.length}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="400" right="400" top="100" bottom="100"/>`;
      rows.forEach((r, ri) => {
        x += '<hp:tr>'; let col = 0;
        r.cells.forEach(c => {
          const span = Math.min(c.span || 1, nC - col); const w = cw.slice(col, col + span).reduce((a, b) => a + b, 0);
          const pp2 = c.al === 'C' ? PA.cellC : c.al === 'R' ? PA.cellR : PA.cellL;
          const txt = String(c.t == null ? '' : c.t).split('\n').map(line => para(run(line, c.ch || CH.cell), pp2)).join('');
          x += `<hp:tc name="" header="${r.head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${c.bf || BF.grid}">${subList(txt)}<hp:cellAddr colAddr="${col}" rowAddr="${ri}"/><hp:cellSpan colSpan="${span}" rowSpan="1"/><hp:cellSz width="${w}" height="${rh}"/><hp:cellMargin left="400" right="400" top="100" bottom="100"/></hp:tc>`;
          col += span;
        });
        x += '</hp:tr>';
      });
      x += '</hp:tbl>';
      this.body.push(para(`<hp:run charPrIDRef="${CH.cell}">${x}<hp:t/></hp:run>`, pp));
    }
    image(png, wPx, hPx, frac = 0.8) {
      const id = `image${this.bins.length + 1}`; this.bins.push({ id, data: png });
      const w = Math.round(TEXT_W * frac), h = Math.round(w * hPx / wPx); const oid = this._oid();
      const pic = `<hp:pic id="${oid}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${oid}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hc:img binaryItemIDRef="${id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect><hp:imgClip left="0" right="${wPx * 75}" top="0" bottom="${hPx * 75}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${wPx * 75}" dimheight="${hPx * 75}"/><hp:effects/><hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`;
      this.body.push(para(`<hp:run charPrIDRef="${CH.body}">${pic}<hp:t/></hp:run>`, PA.center));
    }
    async build(meta = {}) {
      const t = T(); const Z = new G.JSZip();
      // 머리말(문서 이름 + 파란 밑줄), 꼬리말(보고서 번호 · 개정 · 쪽), 표지에는 숨김
      const hdr = `<hp:ctrl><hp:header id="1" applyPageType="BOTH">${subList(para(run(meta.header || '', CH.hdr), PA.hdr), 'TOP', TEXT_W, 4252)}</hp:header></hp:ctrl>`;
      const ftr = `<hp:ctrl><hp:footer id="2" applyPageType="BOTH">${subList(para(`${run(`${meta.footer || ''}        쪽 `, CH.hdr)}<hp:run charPrIDRef="${CH.hdr}">${autoNum('PAGE')}<hp:t> / </hp:t>${autoNum('TOTAL_PAGE')}<hp:t/></hp:run>`, PA.ftr), 'BOTTOM', TEXT_W, 4252)}</hp:footer></hp:ctrl>`;
      const first = t.firstP.replace('hideFirstHeader="0" hideFirstFooter="0"', 'hideFirstHeader="1" hideFirstFooter="1"').replace('hideFirstPageNum="0"', 'hideFirstPageNum="1"')
        .replace('</hp:ctrl></hp:run>', `</hp:ctrl>${hdr}${ftr}</hp:run>`);
      const sec = `${t.secOpen}${first}${this.body.join('')}</hs:sec>`;
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      let hpf = t.hpf.replace('<opf:title/>', `<opf:title>${esc(meta.title || '')}</opf:title>`).replace(/synthetic-fixture-author/g, esc(meta.author || '발전량 계산 도구'))
        .replace(/(name="CreatedDate" content="text">)[^<]*/, `$1${now}`).replace(/(name="ModifiedDate" content="text">)[^<]*/, `$1${now}`).replace(/(name="date" content="text">)[^<]*/, `$1${now}`);
      hpf = hpf.replace('<opf:item id="section0"', `${this.bins.map(b => `<opf:item id="${b.id}" href="BinData/${b.id}.png" media-type="image/png" isEmbeded="1"/>`).join('')}<opf:item id="section0"`);
      const o = { createFolders: false };
      Z.file('mimetype', 'application/hwp+zip', { compression: 'STORE', createFolders: false });
      Z.file('version.xml', t.version, o);
      Z.file('Contents/header.xml', buildHeader(), o);
      Z.file('Contents/section0.xml', sec, o);
      this.bins.forEach(b => Z.file(`BinData/${b.id}.png`, b.data, o));
      Z.file('Preview/PrvText.txt', (meta.preview || '').slice(0, 1000), o);
      Z.file('settings.xml', t.settings, o);
      Z.file('META-INF/container.rdf', t.rdf, o);
      Z.file('Contents/content.hpf', hpf, o);
      Z.file('META-INF/container.xml', t.container, o);
      Z.file('META-INF/manifest.xml', t.manifest, o);
      return Z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
    }
  }

  // 보고서 블록 → HWPX
  async function renderHwpx(model) {
    const { meta, blocks } = model; const D = new Doc();
    const cell = (t, o = {}) => ({ t, ...o });
    const tableRows = b => {
      const nC = b.widths.length, rows = [];
      if (b.title) rows.push({ head: true, cells: [cell(b.title, { span: nC, bf: BF.title, ch: CH.cellW, al: 'C' })] });
      (b.head || []).forEach(hr => rows.push({ head: true, cells: hr.map(h => typeof h === 'object' && h ? cell(h.t, { span: h.span, bf: BF.head, ch: CH.cellB, al: 'C' }) : cell(h, { bf: BF.head, ch: CH.cellB, al: 'C' })) }));
      b.rows.forEach(r => {
        if (r && r.band != null) { rows.push({ cells: [cell(r.band, { span: nC, bf: BF.band, ch: CH.cellB, al: 'L' })] }); return; }
        const cells = r.cells || r; const strong = r.strong;
        rows.push({ cells: cells.map((v, ci) => cell(v, { bf: strong ? BF.band : (b.label && ci === 0 ? BF.label : BF.grid), ch: strong ? CH.cellB : CH.cell, al: (b.align || [])[ci] || (ci === 0 ? 'L' : 'C') })) });
      });
      return rows;
    };
    for (const b of blocks) {
      switch (b.t) {
        case 'cover':
          D.table([{ cells: [cell(meta.coverBand || '발전량 평가 보고서', { bf: BF.cover, ch: CH.coverW, al: 'C' })] }], [1], 1);
          D.p('', CH.body, PA.cover); D.p('', CH.body, PA.cover);
          D.p(meta.project + ':', CH.coverS, PA.cover); D.p(meta.typeName, CH.coverS, PA.cover);
          for (let i = 0; i < 9; i++) D.p('', CH.body, PA.cover);
          D.p(`보고서 번호 : ${meta.reportNo || ''}`, CH.coverM, PA.cover); D.p(`개정 ${meta.rev ?? ''}`, CH.coverM, PA.cover); D.p(`날짜 : ${meta.date || ''}`, CH.coverM, PA.cover);
          break;
        case 'break': D.p('', CH.body, PA.body, true); break;
        case 'pagetitle': D.p(b.text, CH.tocH, PA.center, b.br !== false); break;
        case 'h1': D.p(`${b.num}  ${b.text}`, CH.h1, PA.h1, b.br); break;
        case 'h2': D.p(`${b.num}  ${b.text}`, CH.h2, PA.h2); break;
        case 'h3': D.p(`${b.num}  ${b.text}`, CH.h3, PA.h3); break;
        case 'h2x': D.p(b.text, CH.h2, PA.h2); break;
        case 'p': D.p(b.text); break;
        case 'small': D.p(b.text, CH.small); break;
        case 'bullet': D.p(`•  ${b.text}`, CH.body, PA.bullet); break;
        case 'kv': D.table(b.rows.map(r => ({ cells: [cell(r[0], { bf: BF.none, ch: CH.bold, al: 'L' }), cell(r[1], { bf: BF.none, ch: CH.body, al: 'L' })] })), b.widths || [1, 2.2], b.frac || 1); break;
        case 'table':
          if (b.caption && !b.nocap) D.p(b.caption, CH.cap, PA.capT);
          D.table(tableRows(b), b.widths, b.frac || 1); break;
        case 'fig':
          if (b.png) D.image(b.png.data, b.png.w, b.png.h, b.frac || 0.75);
          if (b.caption) D.p(b.caption, CH.cap, PA.capF); break;
        case 'toc': b.items.forEach(it => D.p(it.lvl === 1 ? `${it.num}.  ${it.text}` : it.lvl === 0 ? it.text : `${it.num}  ${it.text}`, it.lvl <= 1 ? CH.bold : CH.body, it.lvl <= 1 ? PA.toc1 : PA.toc2)); break;
        case 'list': b.items.forEach(it => D.p(it, CH.body, PA.toc2)); break;
      }
    }
    return D.build({ title: meta.title, header: meta.header, footer: meta.footer, preview: meta.preview });
  }
  G.HwpxDoc = Doc; G.renderHwpx = renderHwpx;
})(window);
