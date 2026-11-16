/* TopoCorde — fabrication du rapport PDF, entièrement sur l'appareil. © ACM-GROUPE */
'use strict';
(function () {
  const hexRgb = h => { h = (h || '#09446E').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  /* Les polices PDF de base ne connaissent que le jeu latin : on remplace les caractères typographiques */
  const clean = s => String(s ?? '').replace(/[‘’′]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/[   ]/g, ' ').replace(/[^\x09\x0A\x20-\xFF]/g, '');
  const QUAL = { leger: [1000, 0.66], standard: [1400, 0.78], haute: [1600, 0.86] };
  const GREY = [107, 115, 128], LINE = [213, 218, 226], LIGHT = [243, 245, 248], INK = [33, 37, 41], GREEN = [30, 123, 75], SLATE = [84, 96, 112];

  TC.locTxt = p => [p.facade && (/^(Toiture|Intérieur|Courette)$/.test(p.facade) ? p.facade : (/^Pignon/.test(p.facade) ? p.facade : 'Façade ' + p.facade.toLowerCase())), p.niveau && p.niveau !== p.facade ? p.niveau : '', p.repere].filter(Boolean).join(' · ');

  /* Ordre des photos dans le rapport : repérage, paires avant/après, puis le reste par catégorie */
  TC.planRapport = function (photos) {
    const byId = Object.fromEntries(photos.map(p => [p.id, p]));
    const pairs = [], used = new Set();
    photos.filter(p => p.cat === 'apres' && p.pairId && byId[p.pairId]).forEach(ap => { if (used.has(ap.pairId)) return; pairs.push([byId[ap.pairId], ap]); used.add(ap.pairId); used.add(ap.id); });
    const rest = id => photos.filter(p => p.cat === id && !used.has(p.id));
    const sections = [];
    if (rest('reperage').length) sections.push({ titre: 'Repérage et vues d’ensemble', items: rest('reperage') });
    if (pairs.length) sections.push({ titre: 'Avant / Après', sous: 'Comparatif de l’état avant et après intervention.', pairs });
    for (const id of ['avant', 'pendant', 'apres', 'desordre', 'securite']) { const it = rest(id); if (it.length) sections.push({ titre: TC.CATS.find(c => c.id === id).titre, items: it }); }
    let n = 0; const num = {};
    sections.forEach(s => (s.pairs ? s.pairs.flat() : s.items).forEach(p => num[p.id] = ++n));
    return { sections, num, total: n, nbPairs: pairs.length };
  };

  TC.buildPDF = async function (report, photos, onProgress) {
    const { jsPDF } = window.jspdf;
    const lic = TC.licence.ok, soc = TC.settings.societe;
    const brand = lic && soc.nom ? soc : { nom: lic ? 'Votre société' : 'TopoCorde', couleur: soc.couleur || '#09446E' };
    const C = hexRgb(brand.couleur), [maxPx, q] = QUAL[TC.settings.qualite] || QUAL.standard;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const W = 210, H = 297, M = 14, CW = W - 2 * M, TOP = 31, BOT = 279;
    let y = TOP;
    const plan = TC.planRapport(photos);

    /* Pré-rendu des photos (annotations incluses) */
    const img = {}; let done = 0;
    for (const p of photos) { img[p.id] = await TC.renderPhoto(p, maxPx, q); onProgress && onProgress(++done, photos.length); }

    const font = (style, size, color) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...(color || INK)); };
    const lines = (t, w) => doc.splitTextToSize(clean(t), w);
    const newPage = () => { doc.addPage(); y = TOP; };
    const need = h => { if (y + h > BOT) newPage(); };

    const sectionTitle = (t, sous, extra) => {
      need(12 + (sous ? 6 : 0) + (extra || 12));
      doc.setFillColor(...C); doc.rect(M, y, CW, 9, 'F');
      font('bold', 11.5, [255, 255, 255]); doc.text(clean(t), M + 4, y + 6.2);
      y += 12;
      if (sous) { font('italic', 8.5, GREY); doc.text(clean(sous), M, y + 1); y += 6; }
    };

    const bloc = (t, txt) => {
      if (!txt || !txt.trim()) return;
      sectionTitle(t);
      font('normal', 10);
      clean(txt).split('\n').forEach(par => { const ls = doc.splitTextToSize(par || ' ', CW - 4); ls.forEach(l => { need(6); doc.text(l, M + 2, y + 3); y += 5; }); });
      y += 5;
    };

    /* ----- Page de garde ----- */
    y = 52;
    font('bold', 22, C); doc.text('RAPPORT D’INTERVENTION'.replace('’', "'"), W / 2, y, { align: 'center' });
    y += 8; font('bold', 12, GREY); doc.text('Rapport photos', W / 2, y, { align: 'center' });
    y += 4; doc.setDrawColor(243, 153, 30); doc.setLineWidth(1); doc.line(M + 30, y, W - M - 30, y);
    y += 12;
    font('bold', 13, INK); lines(report.adresse || 'Chantier', CW - 20).forEach(l => { doc.text(l, W / 2, y, { align: 'center' }); y += 6; });
    if (report.objet) { font('normal', 10.5, GREY); lines(report.objet, CW - 20).forEach(l => { doc.text(l, W / 2, y, { align: 'center' }); y += 5; }); }
    y += 8;
    const nbDes = photos.filter(p => p.cat === 'desordre').length, nbUrg = photos.filter(p => p.cat === 'desordre' && p.gravite === 'urgent').length;
    const rows = [
      ['Numéro de rapport', report.num],
      ['Chantier', report.adresse],
      report.client && ['Client / gestionnaire', report.client],
      report.type && ['Type d’intervention', report.type],
      ['Date d’intervention', TC.fmtDate(report.date)],
      report.intervenants && ['Intervenants', report.intervenants],
      ['Photos', `${plan.total} photo${plan.total > 1 ? 's' : ''}` + (plan.nbPairs ? ` · ${plan.nbPairs} comparatif${plan.nbPairs > 1 ? 's' : ''} avant / après` : '') + (nbDes ? ` · ${nbDes} désordre${nbDes > 1 ? 's' : ''}${nbUrg ? ` dont ${nbUrg} urgent${nbUrg > 1 ? 's' : ''}` : ''}` : '')],
      ['Rédigé par', brand.nom],
    ].filter(Boolean);
    const kw = 52, tx = M + 8, tw = CW - 16;
    for (const [k, v] of rows) {
      font('normal', 9.5); const vl = lines(v, tw - kw - 8); const rh = Math.max(10, vl.length * 4.6 + 5.4);
      doc.setFillColor(...LIGHT); doc.rect(tx, y, kw, rh, 'F');
      doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.rect(tx, y, tw, rh); doc.line(tx + kw, y, tx + kw, y + rh);
      font('bold', 9.5); doc.text(clean(k), tx + 3, y + 6.2);
      font('normal', 9.5); doc.text(vl, tx + kw + 4, y + 6.2);
      y += rh;
    }
    /* Tableau de synthèse des désordres : ce que le gestionnaire lit en premier */
    const des = photos.filter(p => p.cat === 'desordre');
    if (des.length) {
      y += 10; need(30);
      font('bold', 11, C); doc.text('Synthèse des désordres constatés', tx, y); y += 4;
      const cw = [16, 50, tw - 16 - 50 - 30, 30];
      const head = ['Photo', 'Localisation', 'Constat', 'Gravité'];
      const drawHead = () => { doc.setFillColor(...C); doc.rect(tx, y, tw, 7, 'F'); font('bold', 8.5, [255, 255, 255]); let x = tx; head.forEach((t, i) => { doc.text(t, x + 2.5, y + 4.8); x += cw[i]; }); y += 7; };
      drawHead();
      const order = { urgent: 0, surveiller: 1, ras: 2 };
      des.slice().sort((a, b) => (order[a.gravite] ?? 3) - (order[b.gravite] ?? 3)).forEach(p => {
        font('normal', 8.5);
        const l1 = lines(TC.locTxt(p) || '-', cw[1] - 5), l2 = lines(p.legende || '-', cw[2] - 5);
        const rh = Math.max(l1.length, l2.length) * 4 + 4;
        if (y + rh > BOT) { newPage(); drawHead(); }
        doc.setDrawColor(...LINE); doc.rect(tx, y, tw, rh);
        font('bold', 8.5); doc.text('n° ' + plan.num[p.id], tx + 2.5, y + 5);
        font('normal', 8.5); doc.text(l1, tx + cw[0] + 2.5, y + 5); doc.text(l2, tx + cw[0] + cw[1] + 2.5, y + 5);
        const g = TC.GRAVITES.find(g => g.id === p.gravite);
        if (g) { doc.setFillColor(...g.rgb); doc.roundedRect(tx + tw - cw[3] + 2, y + 1.6, cw[3] - 4, 5, 1.2, 1.2, 'F'); font('bold', 7.5, [255, 255, 255]); doc.text(clean(g.nom), tx + tw - cw[3] / 2, y + 5.1, { align: 'center' }); }
        y += rh;
      });
    }

    y += 9;
    bloc('Observations', report.observations);
    bloc('Préconisations', report.preconisations);
    /* Photo de couverture si la place le permet : la première vue d'ensemble */
    const couv = photos.find(p => p.cat === 'reperage') || photos[0];
    if (couv && doc.getNumberOfPages() === 1 && BOT - y >= 70) {
      const im = img[couv.id], maxW = CW - 30, maxH = Math.min(120, BOT - y - 6); let iw = maxW, ih = iw * im.h / im.w; if (ih > maxH) { ih = maxH; iw = ih * im.w / im.h; }
      doc.addImage(im.dataURL, 'JPEG', (W - iw) / 2, y + 2, iw, ih, undefined, 'FAST'); doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.rect((W - iw) / 2, y + 2, iw, ih);
    }
    if (plan.sections.length) newPage();

    /* ----- Photos ----- */
    const COL = (CW - 6) / 2, MAXH = 92;
    const measure = (p, w, maxH) => {
      const im = img[p.id]; let iw = w, ih = w * im.h / im.w; if (ih > maxH) { ih = maxH; iw = ih * im.w / im.h; }
      font('normal', 8.5); const cap = p.legende ? lines(p.legende, w - 6) : [];
      const loc = TC.locTxt(p), stamp = p.takenAt ? `${TC.fmtDate(p.takenAt)} à ${TC.fmtTime(p.takenAt)}` : '';
      const capH = 3 + (loc ? 4.2 : 0) + cap.length * 3.9 + (stamp ? 4 : 0) + 2;
      return { iw, ih, cap, loc, stamp, capH, h: 6 + ih + capH };
    };
    const cell = (p, x, w, m, rowImgH, label, lc) => {
      doc.setFillColor(...lc); doc.rect(x, y, w, 6, 'F');
      font('bold', 8, [255, 255, 255]); doc.text(clean(label), x + w / 2, y + 4.2, { align: 'center' });
      doc.setFillColor(...LIGHT); doc.rect(x, y + 6, w, rowImgH, 'F');
      doc.addImage(img[p.id].dataURL, 'JPEG', x + (w - m.iw) / 2, y + 6 + (rowImgH - m.ih) / 2, m.iw, m.ih, undefined, 'FAST');
      let cy = y + 6 + rowImgH;
      doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.rect(x, cy, w, m.capH);
      cy += 4.4;
      if (m.loc) { font('bold', 8.5, C); doc.text(clean(m.loc), x + 3, cy, { maxWidth: w - 6 }); cy += 4.2; }
      if (m.cap.length) { font('normal', 8.5); doc.text(m.cap, x + 3, cy); cy += m.cap.length * 3.9; }
      if (m.stamp) { font('normal', 7, GREY); doc.text(m.stamp, x + 3, cy + 0.6); }
    };
    const labelOf = p => {
      const n = 'PHOTO ' + plan.num[p.id];
      if (p.cat === 'desordre') { const g = TC.GRAVITES.find(g => g.id === p.gravite); return [n + ' — DÉSORDRE' + (g ? ' · ' + g.nom.toUpperCase() : ''), g ? g.rgb : C]; }
      return [n, C];
    };
    const rowH = (a, b) => { const ma = measure(a, COL, MAXH), mb = b ? measure(b, COL, MAXH) : null; return 6 + Math.max(ma.ih, mb ? mb.ih : 0) + Math.max(ma.capH, mb ? mb.capH : 0) + 2; };
    const row = (a, b, la, lb) => {
      const ma = measure(a, COL, MAXH), mb = b ? measure(b, COL, MAXH) : null;
      const ih = Math.max(ma.ih, mb ? mb.ih : 0), capH = Math.max(ma.capH, mb ? mb.capH : 0);
      ma.capH = capH; if (mb) mb.capH = capH;
      need(6 + ih + capH + 2);
      cell(a, M, COL, ma, ih, la[0], la[1]); if (b) cell(b, M + COL + 6, COL, mb, ih, lb[0], lb[1]);
      y += 6 + ih + capH + 6;
    };
    for (const s of plan.sections) {
      sectionTitle(s.titre, s.sous, s.pairs ? rowH(s.pairs[0][0], s.pairs[0][1]) : rowH(s.items[0], s.items[1]));
      if (s.pairs) s.pairs.forEach(([av, ap]) => row(av, ap, ['AVANT — photo ' + plan.num[av.id], SLATE], ['APRÈS — photo ' + plan.num[ap.id], GREEN]));
      else for (let i = 0; i < s.items.length; i += 2) row(s.items[i], s.items[i + 1], labelOf(s.items[i]), s.items[i + 1] ? labelOf(s.items[i + 1]) : null);
    }

    /* ----- Signature ----- */
    if (report.signature) {
      need(52);
      font('bold', 10, C); doc.text('Visa du client / du représentant sur site', M, y + 4); y += 7;
      doc.setDrawColor(...LINE); doc.rect(M, y, 86, 34);
      try { doc.addImage(report.signature, 'PNG', M + 3, y + 2, 80, 30, undefined, 'FAST'); } catch (e) { /* signature illisible : cadre vide */ }
      font('normal', 8.5, GREY); doc.text(clean(`${report.signataire || ''}${report.signataire ? ' — ' : ''}${TC.fmtDate(report.signeLe || Date.now())}`), M, y + 38.5);
      y += 44;
    }

    /* ----- En-tête, pied de page, filigrane sur chaque page ----- */
    const n = doc.getNumberOfPages();
    let logo = null;
    if (lic && soc.logo) { try { const li = await TC.loadImage(soc.logo); logo = { k: li.naturalWidth / li.naturalHeight, fmt: soc.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG' }; } catch (e) { logo = null; } }
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      if (logo) { let lh = 14, lw = lh * logo.k; if (lw > 52) { lw = 52; lh = lw / logo.k; } doc.addImage(soc.logo, logo.fmt, M, 8 + (14 - lh) / 2, lw, lh, 'logo', 'FAST'); }
      else { font('bold', 14, C); doc.text(clean(brand.nom), M, 17); }
      font('bold', 8.5, C); doc.text('RAPPORT PHOTOS', W - M, 12, { align: 'right' });
      font('normal', 7.5, GREY); doc.text(clean(`N° ${report.num} — ${(report.adresse || '').slice(0, 62)}`), W - M, 16.2, { align: 'right' });
      doc.text(clean(TC.fmtDate(report.date)), W - M, 20.2, { align: 'right' });
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, 25, W - M, 25);
      doc.setFillColor(...C); doc.rect(0, H - 12, W, 7.5, 'F');
      doc.setFillColor(243, 153, 30); doc.rect(0, H - 4.5, W, 1, 'F');
      font('normal', 7, [255, 255, 255]);
      const pied = lic ? [soc.nom, soc.mention, soc.tel, soc.email].filter(Boolean).join(' — ') : 'Rapport créé avec la version démo de TopoCorde — acm-groupe.pro/topocorde';
      doc.text(clean(pied).slice(0, 150), M, H - 7.2);
      doc.text(`Page ${i} / ${n}`, W - M, H - 7.2, { align: 'right' });
      if (!lic) {
        doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.13 }));
        font('bold', 74, [200, 35, 35]); doc.text('VERSION DÉMO', W / 2 + 12, H / 2 + 40, { align: 'center', angle: 52 });
        doc.restoreGraphicsState();
      }
    }
    doc.setProperties({ title: clean(`Rapport photos ${report.num} — ${report.adresse || ''}`), author: clean(brand.nom), creator: 'TopoCorde' });
    return doc.output('blob');
  };

  TC.pdfName = r => `Rapport_${r.num}_${(r.adresse || 'chantier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)}.pdf`;
})();
