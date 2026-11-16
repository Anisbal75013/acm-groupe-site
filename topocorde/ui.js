/* TopoCorde — interface. Conçue pour le terrain : gros boutons, une main, plein soleil, hors ligne. © ACM-GROUPE */
'use strict';
(function () {
  const h = TC.h, $ = id => document.getElementById(id);
  const view = $('view'), top = $('top'), bar = $('bar'), modals = $('modals');
  let installEvt = null, lastPdf = null, pendingExtra = null, cleanup = null, ghostClose = null;
  const debounce = (fn, ms = 350) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); return fn(...a); }; return d; };
  const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  /* Remplace le contenu d'un élément (accepte tableaux imbriqués, null, texte) */
  const fill = (el, ...kids) => { el.textContent = ''; const add = c => { if (c == null || c === false || c === '') return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(c)); }; kids.forEach(add); return el; };

  /* ---------- Briques d'interface ---------- */
  function setTop(title, sub, back, right) {
    fill(top, 
      back ? h('button.ib', { 'aria-label': 'Retour', onclick: () => go(back) }, '←') : h('img', { src: 'icon-192.png', alt: '', style: { width: '40px', height: '40px', borderRadius: '10px' } }),
      h('h1', title, sub ? h('small', sub) : null),
      right || null
    );
  }
  function setBar(...btns) { fill(bar, btns.length ? h('div.bar', btns) : ''); document.body.style.paddingBottom = btns.length ? '' : '24px'; }
  function modal(title, body, acts) {
    const close = () => m.remove();
    const m = h('div.modal', { onclick: e => { if (e.target === m) close(); } },
      h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', title), body,
        h('div.acts', (acts || [{ t: 'Fermer' }]).map(a => h('button.btn' + (a.cls ? '.' + a.cls : ''), { onclick: async () => { if (a.fn && (await a.fn()) === false) return; close(); } }, a.t)))));
    modals.append(m); return close;
  }
  const confirmBox = (msg, ok, danger) => new Promise(res => modal(msg, h('div'), [{ t: 'Annuler', fn: () => res(false) }, { t: ok || 'Confirmer', cls: danger ? 'danger' : 'pri', fn: () => res(true) }]));
  const field = (label, el) => [h('label.f', label), el];
  function chips(list, cur, on, opt = {}) {
    const box = h('div.chips' + (opt.scroll ? '.scroll' : ''), { role: 'group' });
    const draw = v => fill(box, ...list.map(it => { const id = it.id ?? it, nom = it.nom ?? it; return h('button.chip' + (opt.cls ? '.' + opt.cls(id) : ''), { type: 'button', 'aria-pressed': String(v === id), onclick: () => { const nv = (opt.toggle && v === id) ? '' : id; draw(nv); on(nv); } }, nom); }));
    draw(cur); return box;
  }
  function stepper(cur, on) {
    const L = TC.NIVEAUX; let i = L.indexOf(cur);
    const out = h('output'); const draw = () => out.textContent = i < 0 ? 'Niveau non précisé' : L[i];
    const mv = d => { i = (i < 0 && d > 0) ? L.indexOf('RDC') : Math.max(-1, Math.min(L.length - 1, i + d)); draw(); on(i < 0 ? '' : L[i]); };
    draw(); return h('div.stepper', h('button', { type: 'button', 'aria-label': 'Niveau inférieur', onclick: () => mv(-1) }, '−'), out, h('button', { type: 'button', 'aria-label': 'Niveau supérieur', onclick: () => mv(1) }, '+'));
  }
  function micBtn(ta, after) {
    if (!SR) return null;
    let rec = null;
    const b = h('button.btn.sm', { type: 'button', onclick: () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = false; rec.continuous = false;
      b.textContent = '● Parlez…'; b.classList.add('pri');
      rec.onresult = e => { const t = e.results[0][0].transcript.trim(); if (t) { ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '') + t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.'); ta.dispatchEvent(new Event('input')); } };
      rec.onerror = e => TC.toast(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans le navigateur' : 'Dictée indisponible (réseau nécessaire)', 'err');
      rec.onend = () => { rec = null; b.textContent = '🎤 Dicter'; b.classList.remove('pri'); after && after(); };
      rec.start();
    } }, '🎤 Dicter');
    return b;
  }

  /* ---------- Données ---------- */
  async function touchReport(r, photos) {
    r.updatedAt = Date.now();
    if (photos) { r.nb = photos.length; r.todo = photos.filter(p => !p.legende).length; r.cover = photos[0] ? photos[0].thumb : ''; }
    await TC.db.put('reports', r);
  }
  async function addPhotos(r, files, extra) {
    const cap = r.cap || {}; let n = 0; const made = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const c = await TC.compress(f);
        const cat = (extra && extra.cat) || cap.cat || 'avant';
        const p = { id: TC.uid(), reportId: r.id, blob: c.blob, w: c.w, h: c.h, cat, facade: (extra && extra.facade) ?? cap.facade ?? '', niveau: (extra && extra.niveau) ?? cap.niveau ?? '', repere: (extra && extra.repere) || '', legende: '', gravite: cat === 'desordre' ? 'surveiller' : '', pairId: (extra && extra.pairId) || '', takenAt: f.lastModified || Date.now(), order: Date.now() + n, strokes: [] };
        p.thumb = await TC.makeThumb(p);
        await TC.db.put('photos', p); made.push(p); n++;
        if (TC.settings.gps && navigator.geolocation) navigator.geolocation.getCurrentPosition(async pos => { p.gps = { lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6) }; await TC.db.put('photos', p); }, () => { }, { timeout: 5000, maximumAge: 60000 });
      } catch (e) { TC.toast('Une photo n’a pas pu être lue', 'err'); }
    }
    const all = await TC.db.photosOf(r.id); await touchReport(r, all);
    if (n) TC.toast(n > 1 ? `${n} photos ajoutées` : `Photo enregistrée — ${TC.catNom(made[0].cat)}${made[0].niveau ? ' · ' + made[0].niveau : ''}`, 'ok');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    return made;
  }

  function bindCam(r, after) {
    $('cam').onchange = $('gal').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; if (!files.length) return; const ex = pendingExtra; pendingExtra = null; TC.toast('Enregistrement…'); await addPhotos(r, files, ex); after && after(); };
  }

  /* ---------- Accueil ---------- */
  async function home() {
    setTop('TopoCorde', 'Rapports photos pour cordistes', null,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span.badge' + (TC.licence.ok ? '.ok' : ''), TC.licence.ok ? 'Licence' : 'Démo'), h('button.ib', { 'aria-label': 'Réglages', onclick: () => go('#/reglages') }, '⚙')));
    const reports = (await TC.db.all('reports')).sort((a, b) => b.updatedAt - a.updatedAt);
    fill(view, 
      !TC.licence.ok ? h('div.notice', h('b', TC.licence.expiree ? TC.licence.raison : 'Version démo'), 'Toutes les fonctions sont ouvertes. Le PDF porte un filigrane « démo » et n’affiche pas votre logo. ', h('a', { href: '#/reglages' }, 'Activer ma licence')) : null,
      h('button.btn.pri.big.block', { onclick: newReport }, '＋ Nouveau rapport'),
      h('div.sect', h('h3', 'Mes chantiers'), h('span', reports.length ? `${reports.length} rapport${reports.length > 1 ? 's' : ''}` : '')),
      reports.length ? reports.map(r => h('button.card.rcard', { onclick: () => go('#/r/' + r.id) },
        h('div.th', { style: r.cover ? { backgroundImage: `url(${r.cover})` } : null }, r.cover ? '' : '📷'),
        h('div', { style: { minWidth: 0, flex: 1 } }, h('b', r.adresse || 'Chantier sans adresse'), h('div.muted', `${r.num} · ${TC.fmtDate(r.date)}`), h('div.muted', `${r.nb || 0} photo${(r.nb || 0) > 1 ? 's' : ''}${r.todo ? ` · ${r.todo} à légender` : ''}`))))
        : h('div.card.empty', h('div.ico', '🧗'), h('p', h('b', 'Aucun rapport pour l’instant.')), h('p', 'Créez un rapport, prenez vos photos sur corde, légendez-les au sol : le PDF est prêt avant de quitter le chantier.')),
      installEvt ? h('button.btn.block', { style: { marginTop: '14px' }, onclick: async () => { installEvt.prompt(); installEvt = null; home(); } }, '⬇ Installer TopoCorde sur ce téléphone') : null,
      h('p.muted', { style: { textAlign: 'center', marginTop: '18px' } }, 'Vos photos restent sur cet appareil. ', h('a', { href: 'index.html' }, 'À propos de TopoCorde'))
    );
    setBar();
  }
  function reportForm(r, isNew) {
    const d = { adresse: r.adresse || '', objet: r.objet || '', client: r.client || '', type: r.type || '', num: r.num, date: r.date, intervenants: r.intervenants || '' };
    const inp = (k, ph, type) => h('input.in', { value: d[k], placeholder: ph || '', type: type || 'text', autocomplete: 'off', oninput: e => d[k] = e.target.value });
    const dateIn = h('input.in', { type: 'date', value: (dd => `${dd.getFullYear()}-${TC.pad(dd.getMonth() + 1)}-${TC.pad(dd.getDate())}`)(new Date(d.date)), oninput: e => { if (e.target.value) d.date = new Date(e.target.value + 'T12:00:00').getTime(); } });
    const body = h('div',
      field('Adresse du chantier *', inp('adresse', 'Ex. 12 rue de Paris, 92110 Clichy')),
      field('Type d’intervention', chips(TC.TYPES, d.type, v => d.type = v, { toggle: true })),
      field('Objet (facultatif)', inp('objet', 'Ex. Purge du balcon du 4e étage')),
      field('Client / gestionnaire (facultatif)', inp('client', 'Ex. Syndic Dupont — M. Martin')),
      field('Intervenants (facultatif)', inp('intervenants', 'Ex. 2 cordistes')),
      field('N° de rapport', inp('num')), field('Date d’intervention', dateIn));
    return { body, d };
  }
  function newReport() {
    const now = new Date(); const r = { id: TC.uid(), num: TC.numRapport(now), date: now.getTime(), createdAt: now.getTime(), cap: { cat: 'avant', facade: '', niveau: '' }, nb: 0 };
    const f = reportForm(r, true);
    modal('Nouveau rapport', f.body, [{ t: 'Annuler' }, { t: 'Créer et photographier', cls: 'pri', fn: async () => { if (!f.d.adresse.trim()) { TC.toast('Indiquez l’adresse du chantier', 'err'); return false; } Object.assign(r, f.d); await touchReport(r); go('#/r/' + r.id); } }]);
  }

  /* ---------- Chantier ---------- */
  async function reportView(id) {
    const r = await TC.db.get('reports', id); if (!r) return go('#/');
    r.cap = r.cap || { cat: 'avant', facade: '', niveau: '' };
    let photos = await TC.db.photosOf(id);
    const saveCap = debounce(() => TC.db.put('reports', r), 200);
    setTop(r.adresse || 'Chantier', `${r.num} · ${TC.fmtDate(r.date)}`, '#/', h('button.ib', { 'aria-label': 'Modifier le chantier', onclick: editReport }, '✎'));

    function editReport() {
      const f = reportForm(r);
      modal('Infos du chantier', h('div', f.body,
        h('div.row', { style: { marginTop: '16px' } }, h('button.btn.sm', { onclick: () => exportReport(r) }, 'Sauvegarder (fichier)'), h('button.btn.sm.danger', { onclick: async () => { if (await confirmBox('Supprimer ce rapport et toutes ses photos ?', 'Supprimer', true)) { await TC.db.delReport(r.id); fill(modals, ); go('#/'); } } }, 'Supprimer le rapport'))),
        [{ t: 'Annuler' }, { t: 'Enregistrer', cls: 'pri', fn: async () => { if (!f.d.adresse.trim()) { TC.toast('Indiquez l’adresse du chantier', 'err'); return false; } Object.assign(r, f.d); await touchReport(r); reportView(id); } }]);
    }
    const capCard = h('div.card',
      h('h2', 'Prochaine photo'),
      chips(TC.CATS.map(c => ({ id: c.id, nom: c.court })), r.cap.cat, v => { r.cap.cat = v; saveCap(); }, { scroll: true }),
      h('label.f', 'Où ?'),
      chips(TC.FACADES, r.cap.facade, v => { r.cap.facade = v; saveCap(); }, { scroll: true, toggle: true }),
      h('div', { style: { marginTop: '8px' } }, stepper(r.cap.niveau, v => { r.cap.niveau = v; saveCap(); })),
      h('p.muted', { style: { margin: '8px 0 0' } }, 'Ces réglages s’appliquent à chaque nouvelle photo : sur corde, il ne reste qu’à déclencher.'));
    const gridBox = h('div');
    function drawGrid() {
      const plan = TC.planRapport(photos);
      const todo = photos.filter(p => !p.legende).length;
      fill(gridBox, 
        photos.length ? h('div.kpi', h('div', h('b', String(photos.length)), 'photos'), h('div', h('b', String(plan.nbPairs)), 'avant / après'), h('div', h('b', String(todo)), 'à légender')) : h('div.card.empty', h('div.ico', '📷'), h('p', 'Aucune photo. Réglez la catégorie et le niveau ci-dessus, puis appuyez sur ', h('b', 'PHOTO'), '.')),
        TC.CATS.map(c => {
          const list = photos.filter(p => p.cat === c.id); if (!list.length) return null;
          return [h('div.sect', h('h3', c.nom), h('span', String(list.length))), h('div.grid', list.map(p => {
            const g = TC.GRAVITES.find(g => g.id === p.gravite);
            const hasApres = c.id === 'avant' && photos.some(q => q.pairId === p.id);
            return h('div', h('button.ph', { 'aria-label': `Photo ${plan.num[p.id]}`, onclick: () => go(`#/r/${id}/p/${p.id}`) },
              h('img', { src: p.thumb, alt: '', loading: 'lazy' }), h('span.n', String(plan.num[p.id])), !p.legende ? h('span.todo', 'à légender') : null,
              h('span.loc', [p.facade, p.niveau].filter(Boolean).join(' · ') || ' '), g && c.id === 'desordre' ? h('span.g', { style: { background: `rgb(${g.rgb})` } }) : null),
              c.id === 'avant' ? (hasApres ? h('div.muted', { style: { textAlign: 'center', fontWeight: 700, marginTop: '4px' } }, '✓ après fait') : h('button.btn.sm.pairbtn', { onclick: () => ghostCamera(r, p, refresh) }, '＋ Après')) : null);
          }))];
        }));
    }
    async function refresh() { photos = await TC.db.photosOf(id); drawGrid(); }
    fill(view, capCard, gridBox); drawGrid();
    const cam = $('cam'), gal = $('gal');
    bindCam(r, refresh);
    setBar(h('button.btn', { onclick: () => { pendingExtra = null; gal.click(); } }, 'Galerie'),
      h('button.btn.pri.grow', { onclick: () => { pendingExtra = null; cam.click(); } }, '📷 PHOTO'),
      h('button.btn.navy', { onclick: () => go(`#/r/${id}/fin`) }, 'Terminer'));
  }

  /* ---------- Calque « avant » pour cadrer l'« après » à l'identique ---------- */
  async function ghostCamera(r, avant, done) {
    const extra = { cat: 'apres', pairId: avant.id, facade: avant.facade, niveau: avant.niveau, repere: avant.repere };
    const native = () => { pendingExtra = extra; $('cam').click(); };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return native();
    const url = URL.createObjectURL(avant.blob);
    const video = h('video', { autoplay: true, playsinline: true, muted: true }); video.muted = true;
    const ov = h('img.ov', { src: url, alt: '', style: { opacity: '.45' } });
    let stream = null;
    const close = () => { ghostClose = null; if (stream) stream.getTracks().forEach(t => t.stop()); URL.revokeObjectURL(url); g.remove(); };
    const g = h('div.ghost', h('div.view', video, ov),
      h('div.ctl',
        h('div', h('b', 'Superposez le calque « avant » sur la vue en direct'), h('input', { type: 'range', min: 0, max: 90, value: 45, 'aria-label': 'Transparence du calque', oninput: e => ov.style.opacity = e.target.value / 100 })),
        h('div.row', h('button.btn', { onclick: close }, 'Annuler'),
          h('button.btn.pri', { style: { flex: 2 }, onclick: async () => {
            if (!video.videoWidth) return TC.toast('Caméra pas encore prête', 'err');
            const cv = document.createElement('canvas'); cv.width = video.videoWidth; cv.height = video.videoHeight; cv.getContext('2d').drawImage(video, 0, 0);
            const blob = await TC.canvasToBlob(cv, 0.9); close();
            await addPhotos(r, [new File([blob], 'apres.jpg', { type: 'image/jpeg' })], extra); done && done();
          } }, '📸 Déclencher')),
        h('button.btn.sm', { onclick: () => { close(); native(); } }, 'Utiliser plutôt l’appareil photo du téléphone')));
    document.body.append(g); ghostClose = close;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream; video.play().catch(() => { });
    } catch (e) { close(); TC.toast('Caméra en direct indisponible : appareil photo du téléphone utilisé'); /* le clic natif exige un geste : on laisse le bouton + Après faire le relais */ pendingExtra = extra; modal('Prendre la photo « après »', h('p', 'La vue en direct n’est pas autorisée sur ce navigateur. La photo sera quand même associée à son « avant ».'), [{ t: 'Annuler', fn: () => { pendingExtra = null; } }, { t: 'Ouvrir l’appareil photo', cls: 'pri', fn: () => { $('cam').click(); } }]); }
  }

  /* ---------- Photo : annotations, localisation, légende ---------- */
  async function photoView(rid, pid) {
    const r = await TC.db.get('reports', rid); let photos = await TC.db.photosOf(rid);
    const p = photos.find(x => x.id === pid); if (!r || !p) return go('#/r/' + rid);
    const idx = photos.indexOf(p), plan = TC.planRapport(photos);
    let thumbDirty = false;
    const persist = async () => { if (thumbDirty) { p.thumb = await TC.makeThumb(p); thumbDirty = false; } await TC.db.put('photos', p); photos = await TC.db.photosOf(rid); await touchReport(r, photos); };
    const save = debounce(persist, 400);
    cleanup = () => save.flush();
    bindCam(r, () => go('#/r/' + rid));
    setTop(`Photo ${plan.num[p.id]} sur ${photos.length}`, `${TC.fmtDate(p.takenAt)} à ${TC.fmtTime(p.takenAt)}`, '#/r/' + rid);

    /* Zone image + calque d'annotation */
    const url = URL.createObjectURL(p.blob);
    const img = h('img', { src: url, alt: 'Photo du chantier' }), cv = h('canvas');
    const stage = h('div.stage', img, cv);
    let tool = '', color = '#FF2D20', drawing = null;
    const fit = () => {
      const maxW = view.clientWidth - 24, maxH = window.innerHeight * 0.6, k = Math.min(maxW / p.w, maxH / p.h);
      const w = Math.round(p.w * k), hh = Math.round(p.h * k); stage.style.width = w + 'px'; stage.style.margin = '0 auto'; img.style.width = w + 'px'; img.style.height = hh + 'px';
      const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = w * dpr; cv.height = hh * dpr; paint();
    };
    const paint = () => { const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height); TC.drawStrokes(ctx, cv.width, cv.height, drawing ? p.strokes.concat([drawing]) : p.strokes); };
    const pos = e => { const b = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
    cv.onpointerdown = e => { if (!tool) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); const a = pos(e); drawing = tool === 'trait' ? { t: 'trait', c: color, p: [a] } : { t: tool, c: color, a, b: a }; };
    cv.onpointermove = e => { if (!drawing) return; const b = pos(e); if (drawing.t === 'trait') drawing.p.push(b); else drawing.b = b; paint(); };
    cv.onpointerup = cv.onpointercancel = e => {
      if (!drawing) return; const s = drawing; drawing = null;
      if (s.t === 'pin') {
        const next = Math.max(0, ...p.strokes.filter(x => x.t === 'pin').map(x => +x.n || 0)) + 1;
        const inp = h('input.in', { type: 'number', inputmode: 'numeric', min: 1, max: 99, value: next });
        modal('Numéro de la pastille', h('div', h('p.muted', 'Indiquez le numéro de la photo concernée : la vue d’ensemble devient un plan de repérage.'), inp), [{ t: 'Annuler', fn: paint }, { t: 'Placer', cls: 'pri', fn: () => { const n = parseInt(inp.value, 10); if (n > 0) { p.strokes.push({ t: 'pin', c: color, a: s.a, n }); thumbDirty = true; save(); } paint(); drawTools(); } }]);
        return;
      }
      if (s.t === 'texte') {
        const inp = h('input.in', { placeholder: 'Ex. Fissure, À purger, Ancrage…', maxlength: 40 });
        modal('Texte sur la photo', inp, [{ t: 'Annuler', fn: paint }, { t: 'Ajouter', cls: 'pri', fn: () => { const t = inp.value.trim(); if (t) { p.strokes.push({ t: 'texte', c: color, a: s.a, txt: t }); thumbDirty = true; save(); } paint(); drawTools(); } }]);
        setTimeout(() => inp.focus(), 60); return;
      }
      const small = s.t === 'trait' ? s.p.length < 3 : Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 0.03;
      if (!small) { p.strokes.push(s); thumbDirty = true; save(); }
      paint(); drawTools();
    };
    const toolBtns = h('div.tools');
    const drawTools = () => fill(toolBtns, 
      ...[['fleche', '↗ Flèche'], ['cercle', '◯ Cercle'], ['pin', '① N°'], ['texte', 'T Texte'], ['trait', '✎ Trait']].map(([id, nom]) => h('button.tool', { type: 'button', 'aria-pressed': String(tool === id), onclick: () => { tool = tool === id ? '' : id; stage.classList.toggle('draw', !!tool); drawTools(); } }, nom)),
      ...[['#FF2D20', 'Rouge'], ['#FFD60A', 'Jaune'], ['#FFFFFF', 'Blanc']].map(([c, nom]) => h('button.tool.col', { type: 'button', 'aria-label': nom, 'aria-pressed': String(color === c), style: { background: c }, onclick: () => { color = c; drawTools(); } })),
      h('button.tool', { type: 'button', disabled: !p.strokes.length, onclick: () => { p.strokes.pop(); thumbDirty = true; save(); paint(); drawTools(); } }, '↶ Annuler'));
    img.onload = fit; window.onresize = fit;

    /* Champs */
    const gravBox = h('div');
    const drawGrav = () => fill(gravBox, p.cat === 'desordre' ? [h('label.f', 'Gravité du désordre'), chips(TC.GRAVITES, p.gravite, v => { p.gravite = v; save(); }, { cls: id => 'g-' + id })] : '');
    const pairBox = h('div');
    const drawPair = () => {
      const apres = photos.find(q => q.pairId === p.id), avant = photos.find(q => q.id === p.pairId);
      fill(pairBox, 
        p.cat === 'avant' ? (apres ? h('p.muted', { style: { fontWeight: 700 } }, `✓ Photo « après » associée : photo ${plan.num[apres.id]}`) : h('button.btn.block', { style: { marginTop: '10px' }, onclick: async () => { await save.flush(); ghostCamera(r, p, () => go('#/r/' + rid)); } }, '＋ Prendre l’« après » avec le calque')) : '',
        p.cat === 'apres' ? h('button.btn.block', { style: { marginTop: '10px' }, onclick: choosePair }, avant ? `Comparé à l’avant : photo ${plan.num[avant.id]} (changer)` : 'Associer à une photo « avant »') : '');
    };
    function choosePair() {
      const taken = new Set(photos.filter(q => q.pairId && q.id !== p.id).map(q => q.pairId));
      const list = photos.filter(q => q.cat === 'avant' && !taken.has(q.id));
      const close = modal('Quelle photo « avant » ?', list.length ? h('div.grid', list.map(q => h('button.ph', { onclick: () => { p.pairId = q.id; save(); drawPair(); close(); } }, h('img', { src: q.thumb, alt: '' }), h('span.n', String(plan.num[q.id])), h('span.loc', [q.facade, q.niveau].filter(Boolean).join(' · ') || ' ')))) : h('p.muted', 'Aucune photo « avant » disponible.'),
        [{ t: 'Aucune', fn: () => { p.pairId = ''; save(); drawPair(); } }, { t: 'Fermer' }]);
    }
    const leg = h('textarea.in', { placeholder: 'Décrivez ce que montre la photo…', oninput: e => { p.legende = e.target.value; save(); } }); leg.value = p.legende || '';
    const phrases = () => { const close = modal('Phrases rapides', h('div', { style: { display: 'grid', gap: '8px' } }, (TC.settings.phrases || []).map(t => h('button.btn.block', { style: { justifyContent: 'flex-start', textAlign: 'left', fontWeight: 600 }, onclick: () => { leg.value = (leg.value ? leg.value.replace(/\s+$/, '') + ' ' : '') + t; p.legende = leg.value; save(); close(); } }, t))), [{ t: 'Fermer' }]); };

    fill(view, stage, toolBtns,
      h('div.card',
        h('label.f', { style: { marginTop: 0 } }, 'Légende'), leg,
        h('div.row', { style: { marginTop: '8px' } }, micBtn(leg), h('button.btn.sm', { type: 'button', onclick: phrases }, '⚡ Phrases rapides')),
        h('label.f', 'Catégorie'), chips(TC.CATS.map(c => ({ id: c.id, nom: c.court })), p.cat, v => { p.cat = v; if (v === 'desordre' && !p.gravite) p.gravite = 'surveiller'; if (v !== 'apres') p.pairId = ''; save(); drawGrav(); drawPair(); }, { scroll: true }),
        gravBox, pairBox,
        h('label.f', 'Localisation'), chips(TC.FACADES, p.facade, v => { p.facade = v; save(); }, { scroll: true, toggle: true }),
        h('div', { style: { marginTop: '8px' } }, stepper(p.niveau, v => { p.niveau = v; save(); })),
        h('label.f', 'Repère précis (facultatif)'), h('input.in', { value: p.repere || '', placeholder: 'Ex. 3e fenêtre en partant de la gauche', oninput: e => { p.repere = e.target.value; save(); } })));
    drawTools(); drawGrav(); drawPair();
    const nav = d => async () => { await save.flush(); const q = photos[idx + d]; go(q ? `#/r/${rid}/p/${q.id}` : '#/r/' + rid); };
    setBar(h('button.btn', { 'aria-label': 'Photo précédente', disabled: idx === 0, onclick: nav(-1) }, '◀'),
      h('button.btn.danger', { onclick: async () => { if (await confirmBox('Supprimer cette photo ?', 'Supprimer', true)) { save.flush = async () => { }; cleanup = null; for (const q of photos) if (q.pairId === p.id) { q.pairId = ''; await TC.db.put('photos', q); } await TC.db.del('photos', p.id); await touchReport(r, await TC.db.photosOf(rid)); go('#/r/' + rid); } } }, 'Suppr.'),
      h('button.btn.pri.grow', { onclick: nav(1) }, idx === photos.length - 1 ? '✓ Terminé' : 'Suivante ▶'));
  }

  /* ---------- Finalisation : observations, signature, PDF ---------- */
  async function finalView(rid) {
    const r = await TC.db.get('reports', rid); if (!r) return go('#/');
    const photos = await TC.db.photosOf(rid);
    const save = debounce(() => touchReport(r), 400); cleanup = () => save.flush();
    setTop('Terminer le rapport', r.adresse, '#/r/' + rid);
    const ta = (k, ph) => { const t = h('textarea.in', { placeholder: ph, oninput: e => { r[k] = e.target.value; save(); } }); t.value = r[k] || ''; return t; };
    const obs = ta('observations', 'Ce qui a été fait, ce qui a été constaté…'), pre = ta('preconisations', 'Travaux à prévoir, points à surveiller, délais conseillés…');
    /* Signature au doigt */
    const sig = h('canvas.sig'); let sctx, sdown = false, signed = !!r.signature;
    const sigInit = () => { const b = sig.getBoundingClientRect(); sig.width = b.width * 2; sig.height = b.height * 2; sctx = sig.getContext('2d'); sctx.lineWidth = 4; sctx.lineCap = 'round'; sctx.strokeStyle = '#0B1D2B'; if (r.signature) TC.loadImage(r.signature).then(i => sctx.drawImage(i, 0, 0, sig.width, sig.height)); };
    const sp = e => { const b = sig.getBoundingClientRect(); return [(e.clientX - b.left) * 2, (e.clientY - b.top) * 2]; };
    sig.onpointerdown = e => { e.preventDefault(); sig.setPointerCapture(e.pointerId); sdown = true; sctx.beginPath(); sctx.moveTo(...sp(e)); };
    sig.onpointermove = e => { if (!sdown) return; sctx.lineTo(...sp(e)); sctx.stroke(); };
    sig.onpointerup = () => { if (!sdown) return; sdown = false; signed = true; r.signature = sig.toDataURL('image/png'); r.signeLe = Date.now(); save(); };
    const todo = photos.filter(p => !p.legende).length;
    const out = h('div');
    async function gen() {
      if (!photos.length) return TC.toast('Ajoutez au moins une photo', 'err');
      await save.flush();
      const prog = h('i'); fill(out, h('div.card', h('b', 'Fabrication du PDF…'), h('div.prog', prog)));
      try {
        const blob = await TC.buildPDF(r, photos, (a, b) => prog.style.width = Math.round(a / b * 100) + '%');
        const name = TC.pdfName(r); lastPdf = { blob, name, rid };
        const mo = (blob.size / 1048576).toFixed(1).replace('.', ',');
        const tg = TC.settings.telegram.token && TC.settings.telegram.chatId;
        fill(out, h('div.card', { id: 'pdfReady' }, h('h2', `✓ Rapport prêt — ${mo} Mo`), h('p.muted', name),
          h('div', { style: { display: 'grid', gap: '8px' } },
            h('button.btn.pri.block', { onclick: async () => { const res = await TC.share(blob, name, `Rapport photos ${r.num}`); if (res === 'telecharge') TC.toast('PDF enregistré dans vos téléchargements', 'ok'); } }, '📤 Partager (WhatsApp, e-mail, Telegram…)'),
            h('button.btn.block', { onclick: () => window.open(URL.createObjectURL(blob), '_blank') }, '👁 Ouvrir le PDF'),
            h('button.btn.block', { onclick: () => { TC.download(blob, name); TC.toast('PDF enregistré', 'ok'); } }, '⬇ Télécharger'),
            h('button.btn.block', { onclick: async e => { if (!tg) return go('#/reglages'); const b = e.currentTarget; b.disabled = true; b.textContent = 'Envoi sur Telegram…'; try { await TC.sendTelegram(blob, name, `Rapport photos ${r.num}\n${r.adresse || ''}`); TC.toast('Envoyé sur Telegram', 'ok'); b.textContent = '✓ Envoyé sur Telegram'; } catch (err) { TC.toast('Telegram : ' + err.message, 'err'); b.disabled = false; b.textContent = '✈ Réessayer l’envoi Telegram'; } } }, tg ? '✈ Envoyer sur mon Telegram' : '✈ Relier mon Telegram (réglages)'))));
        out.scrollIntoView({ behavior: 'smooth' });
      } catch (e) { console.error(e); fill(out, h('div.notice', h('b', 'Le PDF n’a pas pu être créé.'), String(e.message || e))); }
    }
    fill(view, 
      todo ? h('div.notice', h('b', `${todo} photo${todo > 1 ? 's' : ''} sans légende`), 'Vous pouvez générer le rapport tel quel ou ', h('a', { href: '#/r/' + rid }, 'revenir les légender'), '.') : null,
      h('div.card', h('h2', 'Observations'), obs, h('div', { style: { marginTop: '8px' } }, micBtn(obs))),
      h('div.card', h('h2', 'Préconisations'), pre, h('div', { style: { marginTop: '8px' } }, micBtn(pre))),
      h('div.card', h('h2', 'Signature du client sur place (facultatif)'), sig,
        h('div.row', { style: { marginTop: '8px' } }, h('input.in', { placeholder: 'Nom du signataire', value: r.signataire || '', oninput: e => { r.signataire = e.target.value; save(); } }), h('button.btn.sm', { style: { flex: 'none' }, onclick: () => { sctx.clearRect(0, 0, sig.width, sig.height); r.signature = ''; signed = false; save(); } }, 'Effacer'))),
      h('div.card', h('h2', 'Poids du PDF'), chips([{ id: 'leger', nom: 'Léger (e-mail)' }, { id: 'standard', nom: 'Standard' }, { id: 'haute', nom: 'Haute qualité' }], TC.settings.qualite, v => { TC.settings.qualite = v; TC.saveSettings(); })),
      out);
    sigInit();
    setBar(h('button.btn.pri.block.big', { id: 'genBtn', onclick: gen }, '📄 Générer le rapport PDF'));
  }

  /* ---------- Sauvegarde / transfert d'un chantier ---------- */
  async function exportReport(r) {
    TC.toast('Préparation de la sauvegarde…');
    const photos = await TC.db.photosOf(r.id), out = [];
    for (const p of photos) out.push({ ...p, blob: await TC.blobToDataURL(p.blob) });
    const blob = new Blob([JSON.stringify({ topocorde: 1, report: r, photos: out })], { type: 'application/json' });
    await TC.share(blob, `TopoCorde_${r.num}.json`, 'Sauvegarde TopoCorde');
  }
  async function importReport(file) {
    try {
      const j = JSON.parse(await file.text()); if (!j.topocorde || !j.report) throw new Error('format');
      const map = {}; const r = { ...j.report, id: TC.uid() };
      j.photos.forEach(p => map[p.id] = TC.uid());
      for (const p of j.photos) await TC.db.put('photos', { ...p, id: map[p.id], reportId: r.id, pairId: p.pairId ? (map[p.pairId] || '') : '', blob: await (await fetch(p.blob)).blob() });
      await touchReport(r, await TC.db.photosOf(r.id)); TC.toast('Chantier importé', 'ok'); go('#/r/' + r.id);
    } catch (e) { TC.toast('Fichier de sauvegarde illisible', 'err'); }
  }

  /* ---------- Réglages ---------- */
  async function settingsView() {
    setTop('Réglages', 'TopoCorde ' + TC.VERSION, '#/');
    const S = TC.settings, soc = S.societe, save = debounce(() => TC.saveSettings(), 300); cleanup = () => save.flush();
    const inS = (o, k, ph, type) => h('input.in', { value: o[k] || '', placeholder: ph || '', type: type || 'text', autocomplete: 'off', oninput: e => { o[k] = e.target.value.trim(); save(); } });
    const licTa = h('textarea.in', { placeholder: 'Collez ici votre clé (elle commence par TC1-)', style: { minHeight: '84px', fontFamily: 'monospace', fontSize: '.8rem' } }); licTa.value = S.licence || '';
    const L = TC.licence;
    const logoPrev = h('div'); const drawLogo = () => fill(logoPrev, soc.logo ? h('div.row', h('img.logoprev', { src: soc.logo, alt: 'Logo' }), h('button.btn.sm', { onclick: () => { soc.logo = ''; save(); drawLogo(); } }, 'Retirer')) : h('button.btn.sm', { onclick: () => $('logoIn').click() }, 'Choisir le logo (PNG ou JPEG)'));
    $('logoIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const bmp = await TC.fileToBitmap(f); const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = bmp.width * k; c.height = bmp.height * k; c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); soc.logo = c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9); save(); drawLogo(); };
    const phr = h('textarea.in', { style: { minHeight: '170px' }, oninput: e => { S.phrases = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); save(); } }); phr.value = (S.phrases || []).join('\n');
    let est = ''; try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = `Espace utilisé : ${(e.usage / 1048576).toFixed(0)} Mo.`; } } catch (e) { }
    $('imp').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importReport(f); };
    fill(view, 
      h('div.card', h('h2', 'Licence'),
        h('p', { style: { margin: '0 0 8px', fontWeight: 700, color: L.ok ? 'var(--green)' : 'var(--orange-ink)' } }, L.ok ? `✓ ${L.info.s || 'Licence active'} — ${L.raison}` : L.raison),
        licTa, h('div.row', { style: { marginTop: '8px' } },
          h('button.btn.pri', { id: 'licBtn', onclick: async () => { const res = await TC.checkLicence(licTa.value); if (res.ok) { S.licence = licTa.value.trim(); TC.licence = res; if (!soc.nom && res.info.s) soc.nom = res.info.s; await TC.saveSettings(); TC.toast('Licence activée', 'ok'); settingsView(); } else TC.toast(res.raison, 'err'); } }, 'Activer'),
          h('a.btn', { href: 'index.html#tarifs' }, 'Obtenir une licence'))),
      h('div.card', h('h2', 'Votre société sur les rapports'), !L.ok ? h('p.muted', 'Votre nom, votre logo et vos mentions apparaissent sur le PDF dès que la licence est active.') : null,
        field('Nom de la société', inS(soc, 'nom', 'Ex. ACM-GROUPE')), field('Logo', logoPrev),
        field('Mention en pied de page', inS(soc, 'mention', 'Ex. SIREN 000 000 000 — 12 rue…, 75000 Paris')),
        h('div.row', h('div', field('Téléphone', inS(soc, 'tel', '', 'tel'))), h('div', field('E-mail', inS(soc, 'email', '', 'email')))),
        field('Couleur des rapports', h('input.swatch', { type: 'color', value: soc.couleur || '#09446E', oninput: e => { soc.couleur = e.target.value; save(); } }))),
      h('div.card', h('h2', 'Telegram'), h('p.muted', 'Recevez chaque rapport dans une conversation Telegram, en un appui. Le jeton de votre bot reste sur cet appareil : il n’est envoyé qu’à Telegram.'),
        field('Jeton du bot (donné par @BotFather)', inS(S.telegram, 'token', '123456:ABC…', 'password')), field('Identifiant de la conversation (chat ID)', inS(S.telegram, 'chatId', 'Ex. 123456789', 'text')),
        h('button.btn.block', { style: { marginTop: '10px' }, onclick: async () => { await save.flush(); if (!S.telegram.token || !S.telegram.chatId) return TC.toast('Renseignez le jeton et l’identifiant', 'err'); try { await TC.testTelegram(); TC.toast('Message de test envoyé sur Telegram', 'ok'); } catch (e) { TC.toast('Telegram : ' + e.message, 'err'); } } }, 'Enregistrer et envoyer un test')),
      h('div.card', h('h2', 'Affichage et photos'),
        h('label.f', { style: { marginTop: 0 } }, 'Thème'), chips([{ id: 'soleil', nom: '☀ Plein soleil' }, { id: 'sombre', nom: '🌙 Sombre' }], S.theme, v => { S.theme = v; document.documentElement.dataset.theme = v; save(); }),
        h('label.f', 'Position GPS des photos'), chips([{ id: false, nom: 'Non' }, { id: true, nom: 'Oui' }], !!S.gps, v => { S.gps = v; save(); })),
      h('div.card', h('h2', 'Phrases rapides'), h('p.muted', 'Une phrase par ligne. Elles s’insèrent d’un appui dans les légendes.'), phr, h('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => { S.phrases = TC.PHRASES_DEFAUT.slice(); phr.value = S.phrases.join('\n'); save(); } }, 'Remettre la liste d’origine')),
      h('div.card', h('h2', 'Données'), h('p.muted', `Les chantiers sont enregistrés sur cet appareil uniquement. ${est} Pour passer un chantier du téléphone à l’ordinateur, utilisez « Sauvegarder (fichier) » dans les infos du chantier, puis importez-le ici.`), h('button.btn.block', { onclick: () => $('imp').click() }, 'Importer un chantier sauvegardé')));
    setBar();
  }

  /* ---------- Navigation ---------- */
  async function route() {
    if (cleanup) { try { await cleanup(); } catch (e) { } cleanup = null; }
    window.onresize = null; window.scrollTo(0, 0); modals.textContent = ''; if (ghostClose) { ghostClose(); }
    const m = location.hash.replace(/^#\/?/, '').split('/');
    if (m[0] === 'r' && m[1] && m[2] === 'p' && m[3]) return photoView(m[1], m[3]);
    if (m[0] === 'r' && m[1] && m[2] === 'fin') return finalView(m[1]);
    if (m[0] === 'r' && m[1]) return reportView(m[1]);
    if (m[0] === 'reglages') return settingsView();
    return home();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!location.hash || location.hash === '#/') home(); });
  window.addEventListener('pagehide', () => { if (cleanup) cleanup(); });
  (async function start() {
    try { await TC.loadSettings(); } catch (e) { TC.toast('Stockage local indisponible (navigation privée ?)', 'err'); }
    document.documentElement.dataset.theme = TC.settings.theme || 'soleil';
    TC.licence = await TC.checkLicence(TC.settings.licence);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
    route();
  })();
  TC._test = { addPhotos, importReport };
})();
