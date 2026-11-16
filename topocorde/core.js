/* TopoCorde — cœur : utilitaires, stockage local, licence. © ACM-GROUPE */
'use strict';
const TC = {};
TC.VERSION = '1.0.0';

/* ---------- Petits utilitaires ---------- */
TC.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
TC.pad = n => String(n).padStart(2, '0');
TC.fmtDate = d => { d = new Date(d); return `${TC.pad(d.getDate())}/${TC.pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
TC.fmtTime = d => { d = new Date(d); return `${TC.pad(d.getHours())}h${TC.pad(d.getMinutes())}`; };
TC.numRapport = (d = new Date()) => `RAP-${d.getFullYear()}${TC.pad(d.getMonth() + 1)}${TC.pad(d.getDate())}-${TC.pad(d.getHours())}${TC.pad(d.getMinutes())}`;
TC.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Fabrique d'éléments : h('button.btn', {onclick}, 'Texte') */
TC.h = function (sel, attrs, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(c)); };
  kids.forEach(add);
  return el;
};

TC.toast = function (msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + (kind || '');
  clearTimeout(TC._tt); TC._tt = setTimeout(() => t.className = '', 3200);
};

/* ---------- Référentiels métier ---------- */
TC.CATS = [
  { id: 'reperage', nom: 'Repérage', court: 'Repérage', titre: 'Repérage et vues d’ensemble' },
  { id: 'avant', nom: 'Avant', court: 'Avant', titre: 'État avant intervention' },
  { id: 'pendant', nom: 'Pendant', court: 'Pendant', titre: 'Intervention en cours' },
  { id: 'apres', nom: 'Après', court: 'Après', titre: 'État après intervention' },
  { id: 'desordre', nom: 'Désordre', court: 'Désordre', titre: 'Désordres constatés' },
  { id: 'securite', nom: 'Sécurité / accès', court: 'Sécurité', titre: 'Sécurité, accès et ancrages' },
];
TC.catNom = id => (TC.CATS.find(c => c.id === id) || {}).nom || id;
TC.FACADES = ['Rue', 'Cour', 'Pignon gauche', 'Pignon droit', 'Toiture', 'Courette', 'Intérieur'];
TC.NIVEAUX = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3', 'R+4', 'R+5', 'R+6', 'R+7', 'R+8', 'R+9', 'R+10+', 'Toiture'];
TC.GRAVITES = [
  { id: 'ras', nom: 'Sans gravité', rgb: [30, 123, 75] },
  { id: 'surveiller', nom: 'À surveiller', rgb: [214, 137, 16] },
  { id: 'urgent', nom: 'Urgent', rgb: [200, 35, 35] },
];
TC.TYPES = ['Purge / sécurisation de façade', 'Inspection / diagnostic', 'Dépigeonnage', 'Étanchéité / couverture', 'Nettoyage (façade, vitrerie)', 'Maçonnerie / ravalement', 'Pose / installation', 'Autre intervention'];
TC.PHRASES_DEFAUT = [
  'Vue d’ensemble de la zone d’intervention.',
  'Fissure visible sur l’enduit.',
  'Éclat de béton avec fer apparent.',
  'Élément instable, risque de chute.',
  'Élément instable déposé, zone purgée et sécurisée.',
  'Joints dégradés à reprendre.',
  'Reprise de maçonnerie effectuée.',
  'Étanchéité reprise.',
  'Gouttière nettoyée et débouchée.',
  'Filet anti-pigeons posé.',
  'Pics anti-pigeons posés.',
  'Nettoyage effectué.',
  'Point d’ancrage utilisé pour l’intervention.',
  'Balisage au sol en place.',
];

/* ---------- Stockage local (IndexedDB) : rien ne quitte l'appareil ---------- */
TC.db = {
  _p: null,
  open() {
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      const rq = indexedDB.open('topocorde', 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        d.createObjectStore('reports', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' }).createIndex('reportId', 'reportId');
        d.createObjectStore('kv');
      };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    return this._p;
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store);
      let out; const r = fn(s); if (r && 'onsuccess' in r) r.onsuccess = () => out = r.result;
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  put(store, val, key) { return this.tx(store, 'readwrite', s => key !== undefined ? s.put(val, key) : s.put(val)); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  photosOf(reportId) { return this.tx('photos', 'readonly', s => s.index('reportId').getAll(reportId)).then(a => a.sort((x, y) => x.order - y.order)); },
  async delReport(id) {
    const ps = await this.photosOf(id);
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(['reports', 'photos'], 'readwrite');
      t.objectStore('reports').delete(id); ps.forEach(p => t.objectStore('photos').delete(p.id));
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  },
};

/* ---------- Réglages ---------- */
TC.settings = {
  societe: { nom: '', adresse: '', tel: '', email: '', site: '', mention: '', logo: '', couleur: '#09446E' },
  telegram: { token: '', chatId: '' },
  theme: 'soleil', gps: false, qualite: 'standard', phrases: null, licence: '',
};
TC.loadSettings = async function () {
  const s = await TC.db.get('kv', 'settings');
  if (s) { for (const k in s) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) Object.assign(TC.settings[k] || (TC.settings[k] = {}), s[k]); else TC.settings[k] = s[k]; } }
  if (!TC.settings.phrases) TC.settings.phrases = TC.PHRASES_DEFAUT.slice();
};
TC.saveSettings = () => TC.db.put('kv', TC.settings, 'settings');

/* ---------- Licence : clé signée, vérifiée sur l'appareil (fonctionne hors ligne) ---------- */
TC.LICENCE_PUB = /*PUBKEY*/{"kty":"EC","x":"BSiXsUW2rgYxHHfnEKa9r3xAKPM_Dqy6Ehe9shmPpRA","y":"Z26OIjcHcPqt925b1F3DKdsmk2Vh59bIa52CRtblrfg","crv":"P-256"}/*END*/;
TC.b64uToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
TC.licence = { ok: false, raison: 'Version démo' };
TC.checkLicence = async function (cle) {
  const out = { ok: false, raison: 'Version démo' };
  cle = (cle || '').trim().replace(/\s+/g, '');
  if (!cle) return out;
  try {
    if (!cle.startsWith('TC1-')) throw new Error('format');
    const [p, sig] = cle.slice(4).split('.');
    const key = await crypto.subtle.importKey('jwk', TC.LICENCE_PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = new TextEncoder().encode(p);
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, TC.b64uToBytes(sig), data);
    if (!good) throw new Error('signature');
    const info = JSON.parse(new TextDecoder().decode(TC.b64uToBytes(p)));
    if (info.x && new Date(info.x + 'T23:59:59') < new Date()) return { ok: false, raison: `Licence expirée le ${TC.fmtDate(info.x)}`, info, expiree: true };
    return { ok: true, info, raison: info.x ? `Licence valable jusqu’au ${TC.fmtDate(info.x)}` : 'Licence sans limite de durée' };
  } catch (e) { out.raison = 'Clé de licence non reconnue'; out.invalide = true; return out; }
};

/* ---------- Images ---------- */
TC.blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
TC.loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image illisible')); i.src = src; });
TC.fileToBitmap = async function (file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* repli ci-dessous */ } }
  const url = URL.createObjectURL(file);
  try { return await TC.loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
};
TC.canvasToBlob = (cv, q = 0.82) => new Promise(res => cv.toBlob(res, 'image/jpeg', q));
/* Réduit une photo (1600 px de grand côté) : un rapport de 40 photos reste léger */
TC.compress = async function (file, max = 1600, q = 0.82) {
  const bmp = await TC.fileToBitmap(file);
  const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, max / Math.max(w0, h0));
  const cv = document.createElement('canvas'); cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  if (bmp.close) bmp.close();
  return { blob: await TC.canvasToBlob(cv, q), w: cv.width, h: cv.height };
};
/* Rend une photo avec ses annotations, à la taille voulue */
TC.renderPhoto = async function (photo, max, q = 0.8) {
  const url = URL.createObjectURL(photo.blob);
  try {
    const img = await TC.loadImage(url);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    if (photo.strokes && photo.strokes.length) TC.drawStrokes(ctx, cv.width, cv.height, photo.strokes);
    return { dataURL: cv.toDataURL('image/jpeg', q), w: cv.width, h: cv.height };
  } finally { URL.revokeObjectURL(url); }
};
TC.makeThumb = async photo => (await TC.renderPhoto(photo, 360, 0.7)).dataURL;

/* ---------- Annotations (coordonnées relatives 0..1) ---------- */
TC.drawStrokes = function (ctx, W, H, strokes) {
  const base = Math.max(W, H);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    const lw = base * 0.007;
    const paint = (fn) => { ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = lw * 1.9; fn(); ctx.stroke(); ctx.strokeStyle = s.c; ctx.lineWidth = lw; fn(); ctx.stroke(); };
    if (s.t === 'fleche') {
      const x1 = s.a[0] * W, y1 = s.a[1] * H, x2 = s.b[0] * W, y2 = s.b[1] * H;
      const ang = Math.atan2(y2 - y1, x2 - x1), L = base * 0.035;
      paint(() => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.moveTo(x2 - L * Math.cos(ang - 0.45), y2 - L * Math.sin(ang - 0.45)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(ang + 0.45), y2 - L * Math.sin(ang + 0.45)); });
    } else if (s.t === 'cercle') {
      const cx = (s.a[0] + s.b[0]) / 2 * W, cy = (s.a[1] + s.b[1]) / 2 * H, rx = Math.abs(s.b[0] - s.a[0]) / 2 * W, ry = Math.abs(s.b[1] - s.a[1]) / 2 * H;
      paint(() => { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2); });
    } else if (s.t === 'trait') {
      paint(() => { ctx.beginPath(); s.p.forEach((pt, i) => i ? ctx.lineTo(pt[0] * W, pt[1] * H) : ctx.moveTo(pt[0] * W, pt[1] * H)); });
    } else if (s.t === 'pin') {
      const r = base * 0.03, x = s.a[0] * W, y = s.a[1] * H;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = s.c; ctx.fill(); ctx.lineWidth = r * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.stroke();
      ctx.fillStyle = s.c === '#FFFFFF' || s.c === '#FFD60A' ? '#111' : '#fff'; ctx.font = `800 ${r * 1.15}px system-ui, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(s.n), x, y + r * 0.06); ctx.textAlign = 'start';
    } else if (s.t === 'texte') {
      const fs = base * 0.034; ctx.font = `700 ${fs}px system-ui, Arial, sans-serif`; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(s.txt).width, x = s.a[0] * W, y = s.a[1] * H, px = fs * 0.35;
      ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(x - px, y - fs * 0.7, tw + px * 2, fs * 1.4);
      ctx.fillStyle = s.c; ctx.fillText(s.txt, x, y);
    }
  }
  ctx.restore();
};

/* ---------- Partage ---------- */
TC.download = function (blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};
TC.share = async function (blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'partage'; } catch (e) { if (e.name === 'AbortError') return 'annule'; }
  }
  TC.download(blob, name); return 'telecharge';
};
/* Envoi direct dans une conversation Telegram via le bot de l'entreprise (jeton saisi par l'utilisateur, gardé sur l'appareil) */
TC.sendTelegram = async function (blob, name, caption) {
  const { token, chatId } = TC.settings.telegram;
  if (!token || !chatId) throw new Error('Telegram non configuré');
  const fd = new FormData(); fd.append('chat_id', chatId); fd.append('caption', caption || ''); fd.append('document', new File([blob], name, { type: blob.type }));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || 'Envoi refusé par Telegram');
  return true;
};
TC.testTelegram = async function () {
  const { token, chatId } = TC.settings.telegram;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: 'TopoCorde est relié à cette conversation. Vos rapports photos arriveront ici.' }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || 'Refusé par Telegram');
};
