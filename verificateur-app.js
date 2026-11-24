/*!
 * ACM Groupe — Vérificateur de devis : interface, lecture du fichier, rapport et demande de contre-devis.
 * Le devis est lu et analysé dans le navigateur. Il n'est transmis à ACM Groupe
 * qu'après demande de contre-devis et consentement explicite.
 */
(function () {
  'use strict';

  /* ========= Configuration ========= */
  // URL de l'application Web Google Apps Script (Déployer > Application Web > URL /exec)
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbyV17YBs__RPkKUtfMSX1OA84jH2B8m3_TBkr97rBZ2q29dOuaTcK78Zg_DIySjpTcR/exec';
  var TAILLE_MAX = 10 * 1024 * 1024; // 10 Mo
  var PAGES_MAX = 10;
  var CDN = {
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    jspdf: 'topocorde/jspdf.umd.min.js'
  };
  var TEXTE_CONSENTEMENT = 'J’accepte qu’ACM Groupe reçoive mes coordonnées, le devis que j’ai déposé et le rapport d’analyse, afin d’établir un contre-devis et de me recontacter à ce sujet. Je confirme être autorisé(e) à transmettre ce devis.';

  var EXEMPLE = [
    'ENTREPRISE EXEMPLE BÂTIMENT SARL (devis fictif de démonstration)',
    '5 rue de l’Exemple 93200 Saint-Denis',
    'SIRET 123 456 789 00010 - RCS Bobigny',
    '',
    'DEVIS N° 2026-0412 du 04/11/2026',
    'Client : Syndicat des copropriétaires, représenté par son syndic',
    'Adresse du chantier : 18 rue Exemple, 92110 Clichy - façade rue',
    '',
    'Désignation                                         Qté   U     PU HT     Total HT',
    'Installation de chantier                              1    ens    850,00      850,00',
    'Échafaudage de pied façade rue : montage / démontage 220   m2     18,00    3 960,00',
    'Location échafaudage                                  6    sem   420,00    2 520,00',
    'Purge des bétons dégradés des balcons            forfait                   1 800,00',
    'Reprises ponctuelles des nez de dalle                                      1 200,00',
    'Remplacement gouttière zinc                          24    ml     65,00    1 560,00',
    'Divers et imprévus                                                           600,00',
    '',
    'Total HT                                                                12 490,00 €',
    'TVA 20 %                                                                 2 498,00 €',
    'Total TTC                                                               14 988,00 €',
    '',
    'Acompte de 50 % à la commande, solde à réception.',
    'Travaux supplémentaires éventuels facturés selon métré.'
  ].join('\n');

  /* ========= Utilitaires ========= */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return [].slice.call((c || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var fmtEur = function (n) { return window.ACMVerif.fmtEur(n); };
  var chargements = {};
  function charger(src) {
    if (!chargements[src]) chargements[src] = new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = ok; s.onerror = function () { delete chargements[src]; ko(new Error('Chargement impossible : ' + src)); };
      document.head.appendChild(s);
    });
    return chargements[src];
  }
  function lireDataURL(file) {
    return new Promise(function (ok, ko) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = ko; fr.readAsDataURL(file); });
  }
  function lireBuffer(file) {
    return new Promise(function (ok, ko) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = ko; fr.readAsArrayBuffer(file); });
  }
  function lireTexte(file) {
    return new Promise(function (ok, ko) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.onerror = ko; fr.readAsText(file); });
  }

  /* ========= État ========= */
  var etat = { fichier: null, texteColle: '', rapport: null, source: null, debut: Date.now(), envoye: false };

  /* ========= Progression ========= */
  var prog = $('#vd-prog'), progTxt = $('#vd-prog-txt'), progBar = $('#vd-prog-bar');
  function progression(txt, pct) {
    prog.hidden = false;
    progTxt.textContent = txt;
    if (pct === null || pct === undefined) progBar.removeAttribute('value');
    else progBar.value = Math.max(0, Math.min(100, pct));
  }
  function erreur(msg) {
    var e = $('#vd-err');
    e.hidden = !msg;
    e.innerHTML = msg || '';
    if (msg) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ========= Lecture des fichiers ========= */
  function lignesDepuisItems(items) {
    // Regroupe les fragments de texte pdf.js en lignes (même ordonnée), triées de gauche à droite
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || 10;
      var row = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) <= Math.max(2, h * 0.45)) { row = rows[i]; break; }
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ x: x, w: it.width || 0, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var out = '', fin = null;
      r.items.forEach(function (it) {
        if (fin !== null) out += (it.x - fin > 12 ? '   ' : (it.x - fin > 1.5 ? ' ' : ''));
        out += it.s; fin = it.x + it.w;
      });
      return out;
    }).join('\n');
  }

  var workerOCR = null;
  function ocr(image, etiquette) {
    return charger(CDN.tesseract).then(function () {
      if (!workerOCR) {
        progression('Préparation de la lecture optique (premier usage : quelques secondes)…', null);
        workerOCR = window.Tesseract.createWorker('fra', 1, {
          logger: function (m) {
            if (m.status === 'recognizing text') progression((etiquette || 'Lecture optique') + '… ' + Math.round(m.progress * 100) + ' %', m.progress * 100);
            else if (/loading|initializ/.test(m.status)) progression('Chargement du moteur de lecture (' + Math.round((m.progress || 0) * 100) + ' %)…', (m.progress || 0) * 100);
          }
        });
      }
      return workerOCR;
    }).then(function (w) { return w.recognize(image); }).then(function (res) { return res.data.text || ''; });
  }

  function lirePDF(file) {
    return charger(CDN.pdfjs).then(function () {
      var lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
      return lireBuffer(file).then(function (buf) { return lib.getDocument({ data: buf, isEvalSupported: false }).promise; });
    }).then(function (pdf) {
      var n = Math.min(pdf.numPages, PAGES_MAX), textes = [], i = 0;
      function page() {
        i++;
        if (i > n) return Promise.resolve();
        progression('Lecture du PDF : page ' + i + ' / ' + n, (i - 1) / n * 100);
        return pdf.getPage(i).then(function (p) {
          return p.getTextContent().then(function (tc) {
            var t = lignesDepuisItems(tc.items);
            if (t.replace(/\s/g, '').length >= 60) { textes.push(t); return; }
            // page scannée : rendu image puis lecture optique
            var vp = p.getViewport({ scale: 2.2 });
            var cv = document.createElement('canvas');
            cv.width = vp.width; cv.height = vp.height;
            return p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
              .then(function () { return ocr(cv, 'Lecture optique de la page ' + i + ' / ' + n); })
              .then(function (txt) { textes.push(txt); etat.ocr = true; });
          });
        }).then(page);
      }
      return page().then(function () {
        if (pdf.numPages > PAGES_MAX) etat.tronque = pdf.numPages;
        return textes.join('\n');
      });
    });
  }

  function extraireTexte(f) {
    etat.ocr = false; etat.tronque = 0;
    if (f) {
      var t = (f.type || '').toLowerCase(), nom = f.name.toLowerCase();
      if (t === 'application/pdf' || /\.pdf$/.test(nom)) return lirePDF(f);
      if (/^image\//.test(t) || /\.(jpe?g|png|webp)$/.test(nom)) { etat.ocr = true; return ocr(f, 'Lecture optique de la photo'); }
      if (t === 'text/plain' || /\.txt$/.test(nom)) return lireTexte(f);
      return Promise.reject(new Error('format'));
    }
    return Promise.resolve(etat.texteColle);
  }

  /* ========= Dépôt du fichier ========= */
  var zone = $('#vd-drop'), input = $('#vd-file'), infoFichier = $('#vd-file-info');
  function choisirFichier(f) {
    erreur('');
    if (!f) return;
    var nom = f.name.toLowerCase();
    if (/\.(heic|heif)$/.test(nom) || /heic|heif/.test(f.type)) { erreur('Les photos HEIC (iPhone) ne sont pas lisibles par tous les navigateurs. Faites une capture d’écran du devis ou exportez-le en JPG / PDF.'); return; }
    if (!/\.(pdf|jpe?g|png|webp|txt)$/.test(nom) && !/pdf|image\/(jpeg|png|webp)|text\/plain/.test(f.type)) { erreur('Format non pris en charge. Déposez un PDF, une photo (JPG, PNG, WebP) ou collez le texte du devis.'); return; }
    if (f.size > TAILLE_MAX) { erreur('Le fichier dépasse 10 Mo. Compressez-le, envoyez seulement les pages du devis, ou collez son texte.'); return; }
    etat.fichier = f;
    infoFichier.hidden = false;
    infoFichier.innerHTML = '<strong>' + esc(f.name) + '</strong> · ' + (f.size / 1024 / 1024).toFixed(2).replace('.', ',') + ' Mo <button type="button" class="vd-link" id="vd-file-x">Retirer</button>';
    $('#vd-file-x').onclick = function () { etat.fichier = null; input.value = ''; infoFichier.hidden = true; };
  }
  input.addEventListener('change', function () { choisirFichier(input.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); }); });
  zone.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) choisirFichier(e.dataTransfer.files[0]); });

  // Onglets fichier / texte
  $$('.vd-tabs [role="tab"]').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.vd-tabs [role="tab"]').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      $$('.vd-panel').forEach(function (p) { p.hidden = p.id !== b.getAttribute('aria-controls'); });
      etat.mode = b.getAttribute('aria-controls');
    });
  });
  etat.mode = 'vd-p-fichier';

  $('#vd-exemple').addEventListener('click', function () {
    $('[aria-controls="vd-p-texte"]').click();
    $('#vd-texte').value = EXEMPLE;
    etat.exemple = true;
    lancer();
  });

  /* ========= Analyse ========= */
  $('#vd-form').addEventListener('submit', function (e) { e.preventDefault(); etat.exemple = false; lancer(); });

  function lancer() {
    erreur('');
    var modeTexte = etat.mode === 'vd-p-texte';
    if (modeTexte) {
      etat.texteColle = $('#vd-texte').value;
      etat.source = 'texte';
      if (etat.texteColle.replace(/\s/g, '').length < 120) { erreur('Collez le texte complet du devis (au moins quelques lignes avec les postes et les montants).'); return; }
    } else {
      if (!etat.fichier) { erreur('Déposez d’abord votre devis (PDF ou photo), ou choisissez « Coller le texte ».'); return; }
      etat.source = 'fichier';
    }
    var btn = $('#vd-go');
    btn.disabled = true;
    var f = modeTexte ? null : etat.fichier;
    progression('Lecture du devis…', 5);
    extraireTexte(f).then(function (texte) {
      etat.fichierAnalyse = f;
      etat.texte = texte;
      progression('Analyse technique…', 95);
      var r = window.ACMVerif.analyser(texte);
      if (!r.lisible) {
        erreur('Le texte du devis n’a pas pu être lu' + (etat.ocr ? ' (photo floue, trop sombre ou de travers ?)' : '') + '. Essayez une photo plus nette, le PDF d’origine, ou collez le texte du devis.');
        prog.hidden = true; btn.disabled = false; return;
      }
      etat.rapport = r;
      afficher(r);
      prog.hidden = true; btn.disabled = false;
    }).catch(function (err) {
      console.error(err);
      prog.hidden = true; btn.disabled = false;
      erreur(err && err.message === 'format' ? 'Format non pris en charge.' : 'La lecture du fichier a échoué (connexion ou fichier protégé). Réessayez, ou collez le texte du devis dans l’onglet « Coller le texte ».');
    });
  }

  /* ========= Affichage du diagnostic ========= */
  var ICONES = { ok: '✓', alerte: '!', manquant: '✕' };
  var LIB_STATUT = { ok: 'Conforme', alerte: 'À vérifier', manquant: 'Manquant' };

  function afficher(r) {
    var res = $('#vd-resultats');
    res.hidden = false;
    $('#vd-steps').setAttribute('data-step', '2');

    // Verdict
    $('#vd-score').textContent = r.score;
    $('#vd-gauge').style.setProperty('--s', r.score);
    $('#vd-verdict').textContent = r.verdict;
    $('#vd-verdict-card').setAttribute('data-niveau', r.niveau);
    $('#vd-resume').textContent = r.resume;
    var infos = [];
    if (r.entreprise) infos.push('<div><dt>Entreprise</dt><dd>' + esc(r.entreprise) + '</dd></div>');
    if (r.montants.totalHT) infos.push('<div><dt>Total HT</dt><dd>' + fmtEur(r.montants.totalHT) + '</dd></div>');
    else if (r.montants.totalNonPrecise) infos.push('<div><dt>Total (HT/TTC ?)</dt><dd>' + fmtEur(r.montants.totalNonPrecise) + '</dd></div>');
    if (r.montants.tva) infos.push('<div><dt>TVA</dt><dd>' + String(r.montants.tva).replace('.', ',') + ' %</dd></div>');
    infos.push('<div><dt>Source</dt><dd>' + (etat.exemple ? 'Exemple fictif' : etat.source === 'texte' ? 'Texte collé' : esc(etat.fichierAnalyse ? etat.fichierAnalyse.name : '')) + (etat.ocr ? ' (lecture optique)' : '') + '</dd></div>');
    $('#vd-infos').innerHTML = infos.join('');
    $('#vd-ocr-note').hidden = !etat.ocr && !etat.tronque;
    $('#vd-ocr-note').textContent = (etat.ocr ? 'Lecture optique : quelques chiffres ou mots peuvent être mal reconnus, vérifiez les points signalés sur l’original. ' : '') + (etat.tronque ? 'Seules les ' + PAGES_MAX + ' premières pages sur ' + etat.tronque + ' ont été analysées.' : '');

    // Postes ACM (contextuel)
    var postes = r.postes.filter(function (p) { return p.k !== 'acces'; });
    $('#vd-postes').innerHTML = r.postes.map(function (p) { return '<span>' + esc(p.label) + '</span>'; }).join('') || '<em>Aucun poste de travaux en hauteur identifié.</em>';
    $('#vd-postes-cta').hidden = !postes.length;

    // 1. Mentions & assurances
    var cats = {};
    r.controles.forEach(function (c) { (cats[c.cat] = cats[c.cat] || []).push(c); });
    $('#vd-controles').innerHTML = Object.keys(cats).map(function (k) {
      return '<h4>' + esc(k) + '</h4><ul class="vd-checks">' + cats[k].map(function (c) {
        return '<li data-s="' + c.statut + '"><span class="vd-ic" aria-hidden="true">' + ICONES[c.statut] + '</span><div><strong>' + esc(c.label) + ' <em>' + LIB_STATUT[c.statut] + '</em></strong><p>' + esc(c.detail) + '</p></div></li>';
      }).join('') + '</ul>';
    }).join('');
    var nM = r.controles.filter(function (c) { return c.statut === 'manquant'; }).length, nA = r.controles.filter(function (c) { return c.statut === 'alerte'; }).length;
    $('#vd-c1-count').textContent = nM + ' manquant' + (nM > 1 ? 's' : '') + ' · ' + nA + ' à vérifier';

    // 2. Zones floues & oublis
    var h = '';
    if (r.flous.length) h += '<h4>Zones floues</h4><ul class="vd-risks">' + r.flous.map(function (f) { return '<li><strong>' + esc(f.label) + '</strong>' + (f.extrait ? '<q>' + esc(f.extrait) + '</q>' : '') + '<p>' + esc(f.risque) + '</p></li>'; }).join('') + '</ul>';
    if (r.omissions.length) h += '<h4>Oublis fréquents</h4><ul class="vd-risks">' + r.omissions.map(function (o) { return '<li><strong>' + esc(o.label) + '</strong><p>' + esc(o.risque) + '</p></li>'; }).join('') + '</ul>';
    $('#vd-flous').innerHTML = h || '<p class="vd-ok">Aucune formulation floue ni oubli fréquent détecté.</p>';
    $('#vd-c2-count').textContent = (r.flous.length + r.omissions.length) + ' point' + (r.flous.length + r.omissions.length > 1 ? 's' : '');

    // 3. Moyens d'accès
    var a = r.acces, ha = '';
    var carteAcces = $('#vd-acces-alerte');
    if (a && a.alerte) {
      carteAcces.hidden = false;
      $('#vd-acces-titre').textContent = a.type + ' facturé' + (a.accord || '') + (a.cout ? ' ' + fmtEur(a.cout) + ' HT' : '') + (a.part !== null && a.part !== undefined ? ' (' + a.part + ' % du devis)' : '');
      $('#vd-acces-msg').textContent = a.message;
      $('#vd-acces-eco').innerHTML = a.economieMin ? 'Économie potentielle sur le poste accès : <strong>' + fmtEur(a.economieMin) + ' à ' + fmtEur(a.economieMax) + ' HT</strong><small>Ordre de grandeur indicatif, calculé sur 40 à 80 % du coût d’accès détecté. Seul un contre-devis après visite donne un prix ferme.</small>' : 'Le coût de l’accès n’est pas isolé dans le devis : demandez-le, puis comparez avec une intervention sur cordes.';
    } else carteAcces.hidden = true;
    if (a) {
      ha += '<p><strong>Moyen d’accès détecté : ' + esc(a.type) + '.</strong> ' + esc(a.message) + '</p>';
      if (a.lignes && a.lignes.length) ha += '<ul class="vd-lines">' + a.lignes.map(function (l) { return '<li><q>' + esc(l.extrait) + '</q>' + (l.montant ? '<b>' + fmtEur(l.montant) + '</b>' : (l.mixte ? '<i>coût mêlé aux travaux</i>' : '')) + '</li>'; }).join('') + '</ul>';
      if (a.dureeLocation) ha += '<p>Durée de location prévue : <strong>' + esc(a.dureeLocation) + '</strong>. Chaque semaine de retard ou d’intempéries peut être refacturée.</p>';
    } else ha = '<p>Aucun moyen d’accès en hauteur détecté dans ce devis.</p>';
    $('#vd-acces').innerHTML = ha;
    $('#vd-c3-count').textContent = a ? a.type : '—';

    // 4. Questions
    $('#vd-questions').innerHTML = r.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    $('#vd-c4-count').textContent = r.questions.length + ' question' + (r.questions.length > 1 ? 's' : '');

    preremplir(r);
    setTimeout(function () { res.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  }

  $('#vd-copy-q').addEventListener('click', function () {
    var b = this, r = etat.rapport; if (!r) return;
    var txt = 'Questions à poser avant signature :\n' + r.questions.map(function (q, i) { return (i + 1) + '. ' + q; }).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { b.textContent = 'Questions copiées'; setTimeout(function () { b.textContent = 'Copier les questions'; }, 2500); })
      .catch(function () { b.textContent = 'Copie impossible : sélectionnez la liste'; });
  });
  $('#vd-restart').addEventListener('click', function () {
    $('#vd-resultats').hidden = true; $('#vd-steps').setAttribute('data-step', '1');
    $('#vd-outil').scrollIntoView({ behavior: 'smooth' });
  });

  /* ========= Rapport PDF ========= */
  function rapportPDF() {
    return charger(CDN.jspdf).then(function () {
      var r = etat.rapport, J = window.jspdf.jsPDF, doc = new J({ unit: 'mm', format: 'a4' });
      var y = 0, W = 210, M = 16, L = W - 2 * M;
      var navy = [9, 68, 110], orange = [243, 153, 30], gris = [82, 103, 121];
      function propre(t) { return String(t == null ? '' : t).replace(/[  ]/g, ' ').replace(/[≥]/g, '>=').replace(/[✓]/g, 'OK').replace(/[^\x00-\xFF€’‘“”«»…–—•œŒ]/g, ''); }
      function saut(h) { if (y + h > 280) { doc.addPage(); y = 18; } }
      function txt(t, o) {
        o = o || {};
        doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.s || 10); doc.setTextColor.apply(doc, o.c || [14, 34, 51]);
        var ls = doc.splitTextToSize(propre(t), o.w || L);
        ls.forEach(function (l) { saut(o.lh || 5); doc.text(l, (o.x || M), y); y += (o.lh || 5); });
      }
      function titre(t) { y += 4; saut(12); doc.setFillColor.apply(doc, orange); doc.rect(M, y - 4.2, 2, 6, 'F'); txt(t.toUpperCase(), { b: true, s: 12, c: navy, x: M + 4 }); y += 1; }
      // En-tête
      doc.setFillColor.apply(doc, navy); doc.rect(0, 0, W, 30, 'F');
      doc.setFillColor.apply(doc, orange); doc.rect(0, 30, W, 1.5, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('Rapport de vérification de devis', M, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(185, 204, 220);
      doc.text(propre('ACM Groupe · Cordistes & rénovation Île-de-France · acm-groupe.pro · 06 52 25 24 03'), M, 21);
      doc.text(propre('Généré le ' + new Date().toLocaleDateString('fr-FR') + (etat.exemple ? ' · exemple fictif' : '')), M, 26);
      y = 42;
      txt('Verdict : ' + r.verdict + ' (score ' + r.score + ' / 100)', { b: true, s: 13 });
      y += 1; txt(r.resume, { c: gris });
      if (r.acces && r.acces.alerte) {
        titre('Moyens d’accès');
        txt(r.acces.message);
        if (r.acces.economieMin) txt('Économie potentielle indicative sur le poste accès : ' + fmtEur(r.acces.economieMin) + ' à ' + fmtEur(r.acces.economieMax) + ' HT (40 à 80 % du coût d’accès détecté, à confirmer par contre-devis).', { b: true });
      }
      titre('1. Mentions obligatoires et assurances');
      r.controles.forEach(function (c) { txt('[' + LIB_STATUT[c.statut] + '] ' + c.label, { b: true, c: c.statut === 'ok' ? [45, 155, 90] : c.statut === 'alerte' ? [184, 106, 0] : [190, 40, 40] }); txt(c.detail, { c: gris, x: M + 4, w: L - 4 }); y += 1; });
      titre('2. Zones floues et oublis fréquents');
      if (!r.flous.length && !r.omissions.length) txt('Aucun point détecté.');
      r.flous.forEach(function (f) { txt('• ' + f.label, { b: true }); if (f.extrait) txt('« ' + f.extrait + ' »', { c: gris, x: M + 4, w: L - 4 }); txt(f.risque, { c: gris, x: M + 4, w: L - 4 }); y += 1; });
      r.omissions.forEach(function (o) { txt('• Oubli : ' + o.label, { b: true }); txt(o.risque, { c: gris, x: M + 4, w: L - 4 }); y += 1; });
      titre('3. Moyens d’accès');
      txt(r.acces ? r.acces.type + ' : ' + r.acces.message : 'Aucun moyen d’accès en hauteur détecté.');
      titre('4. Questions à poser avant signature');
      r.questions.forEach(function (q, i) { txt((i + 1) + '. ' + q); y += 0.5; });
      y += 4; saut(26);
      doc.setFillColor(232, 239, 245); doc.rect(M, y, L, 22, 'F'); y += 6;
      txt('Contre-devis comparatif gratuit sous 24 à 48 h : acm-groupe.pro/verificateur-devis.html · 06 52 25 24 03 · contact@acm-groupe.pro', { b: true, x: M + 4, w: L - 8, c: navy });
      txt('Aide à la lecture technique générée automatiquement à partir du texte du devis. Elle peut comporter des erreurs et ne constitue ni un avis juridique, ni une expertise.', { s: 8, c: gris, x: M + 4, w: L - 8, lh: 4 });
      return doc;
    });
  }
  $('#vd-pdf').addEventListener('click', function () {
    var b = this; b.disabled = true;
    rapportPDF().then(function (doc) { doc.save('rapport-verification-devis-acm.pdf'); }).catch(function () { alert('Téléchargement impossible pour le moment.'); }).then(function () { b.disabled = false; });
  });

  /* ========= Contre-devis : pré-remplissage ========= */
  function synthese() {
    var r = etat.rapport || {};
    return {
      verdict: r.verdict, score: r.score, resume: r.resume, entreprise: r.entreprise || '',
      totalHT: (r.montants && (r.montants.totalHT || r.montants.totalNonPrecise)) || '',
      postes: (r.postes || []).map(function (p) { return p.label; }),
      acces: r.acces ? r.acces.type : '', accesMontant: r.acces && r.acces.cout ? r.acces.cout : '',
      economieMin: r.acces && r.acces.economieMin ? r.acces.economieMin : '', economieMax: r.acces && r.acces.economieMax ? r.acces.economieMax : ''
    };
  }
  function preremplir(r) {
    var s = synthese();
    var lignes = [];
    lignes.push('<li><span>Devis analysé</span><b>' + esc(etat.exemple ? 'Exemple fictif' : (etat.fichierAnalyse ? etat.fichierAnalyse.name : 'Texte collé')) + '</b></li>');
    if (s.entreprise) lignes.push('<li><span>Entreprise</span><b>' + esc(s.entreprise) + '</b></li>');
    if (s.totalHT) lignes.push('<li><span>Montant</span><b>' + fmtEur(s.totalHT) + (r.montants.totalHT ? ' HT' : '') + '</b></li>');
    lignes.push('<li><span>Postes identifiés</span><b>' + esc(s.postes.join(', ') || 'à préciser') + '</b></li>');
    if (s.acces) lignes.push('<li><span>Moyen d’accès</span><b>' + esc(s.acces) + (s.accesMontant ? ' · ' + fmtEur(s.accesMontant) + ' HT' : '') + '</b></li>');
    if (s.economieMin) lignes.push('<li class="eco"><span>Économie potentielle</span><b>' + fmtEur(s.economieMin) + ' à ' + fmtEur(s.economieMax) + ' HT (indicatif)</b></li>');
    lignes.push('<li><span>Diagnostic</span><b>' + esc(r.verdict) + ' · ' + r.pointsCles.length + ' point(s) relevé(s)</b></li>');
    $('#vd-dossier').innerHTML = lignes.join('');
    $('#vd-lead-titre').textContent = (r.acces && r.acces.alerte) ? 'Recevez un contre-devis sans ' + r.acces.type.toLowerCase() + ', sous 24 à 48 h' : 'Recevez un contre-devis comparatif gratuit sous 24 à 48 h';
    var joint = $('#vd-joint');
    joint.textContent = etat.exemple ? 'Exemple fictif : la demande sera envoyée avec le texte de l’exemple.' : (etat.fichierAnalyse ? 'Le fichier « ' + etat.fichierAnalyse.name + ' » et le rapport d’analyse seront joints à votre demande.' : 'Le texte collé et le rapport d’analyse seront joints à votre demande.');
    $('#vd-lead').hidden = false;
    $('#vd-lead-ok').hidden = true;
    $('#vd-lead-form').hidden = false;
  }

  /* ========= Contre-devis : envoi ========= */
  var form = $('#vd-lead-form');
  function champErreur(el, msg) {
    var p = el.closest('label') || el.parentNode;
    var e = p.querySelector('.vd-fe');
    if (!msg) { if (e) e.remove(); el.removeAttribute('aria-invalid'); return true; }
    if (!e) { e = document.createElement('span'); e.className = 'vd-fe'; p.appendChild(e); }
    e.textContent = msg; el.setAttribute('aria-invalid', 'true');
    return false;
  }
  function valider() {
    var ok = true, premier = null;
    function chk(el, cond, msg) { var v = champErreur(el, cond ? '' : msg); if (!v && !premier) premier = el; ok = ok && v; }
    chk(form.nom, form.nom.value.trim().length >= 2, 'Indiquez votre nom.');
    chk(form.organisation, form.organisation.value.trim().length >= 2, 'Indiquez le syndic ou la société (ou « Particulier »).');
    var tel = form.tel.value.replace(/[\s.\-()]/g, '');
    chk(form.tel, /^(\+33|0033|0)[1-9]\d{8}$/.test(tel) || /^\+\d{8,15}$/.test(tel), 'Numéro de téléphone invalide.');
    chk(form.email, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim()), 'Adresse e-mail invalide.');
    chk(form.cp, /^\d{5}$/.test(form.cp.value.trim()), 'Code postal à 5 chiffres.');
    chk(form.consent, form.consent.checked, 'Votre accord est nécessaire pour transmettre le devis.');
    if (premier) premier.focus();
    return ok;
  }
  [].forEach.call(form.querySelectorAll('input,textarea'), function (el) { el.addEventListener('input', function () { if (el.getAttribute('aria-invalid')) champErreur(el, ''); }); el.addEventListener('change', function () { if (el.getAttribute('aria-invalid')) champErreur(el, ''); }); });

  function lead() {
    return {
      nom: form.nom.value.trim(), organisation: form.organisation.value.trim(), profil: form.profil.value,
      tel: form.tel.value.trim(), email: form.email.value.trim(), cp: form.cp.value.trim(), precisions: form.precisions.value.trim()
    };
  }
  function recapTexte(l) {
    var s = synthese();
    return 'Demande de contre-devis (vérificateur de devis)\n\nNom : ' + l.nom + '\nSyndic / société : ' + l.organisation + '\nProfil : ' + l.profil + '\nTéléphone : ' + l.tel + '\nE-mail : ' + l.email + '\nCode postal du chantier : ' + l.cp + '\n' + (l.precisions ? 'Précisions : ' + l.precisions + '\n' : '') +
      '\nSynthèse : ' + s.resume + '\nPostes : ' + s.postes.join(', ') + '\n\nPoints relevés :\n- ' + (etat.rapport.pointsCles || []).join('\n- ');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!etat.rapport || etat.envoye) return;
    if (!valider()) return;
    var l = lead();
    var btn = $('#vd-send'); btn.disabled = true; var lib = btn.textContent; btn.textContent = 'Envoi en cours…';
    var ko = $('#vd-lead-err'); ko.hidden = true;

    if (form.website.value || Date.now() - etat.debut < 4000) { // robot probable : on ne transmet rien
      succes('VD-' + Date.now().toString(36).toUpperCase(), l); return;
    }
    var payload = {
      page: location.href.split('#')[0], ua: navigator.userAgent.slice(0, 180), website: form.website.value,
      lead: l,
      consentement: { accepte: true, texte: TEXTE_CONSENTEMENT, horodatage: new Date().toISOString() },
      synthese: synthese(),
      rapport: { verdict: etat.rapport.verdict, score: etat.rapport.score, pointsCles: etat.rapport.pointsCles, questions: etat.rapport.questions, controles: etat.rapport.controles, flous: etat.rapport.flous, omissions: etat.rapport.omissions, acces: etat.rapport.acces, montants: etat.rapport.montants, postes: etat.rapport.postes, exemple: !!etat.exemple }
    };
    var prep = [rapportPDF().then(function (doc) { payload.rapportPdf = doc.output('datauristring').split(',')[1]; }).catch(function () { })];
    var fa = etat.fichierAnalyse;
    if (fa) prep.push(lireDataURL(fa).then(function (d) {
      var nom = fa.name, type = fa.type || (/\.pdf$/i.test(nom) ? 'application/pdf' : /\.txt$/i.test(nom) ? 'text/plain' : 'image/jpeg');
      payload.fichier = { nom: nom, type: type, taille: fa.size, base64: d.split(',')[1] };
    }));
    else payload.texteDevis = (etat.texte || '').slice(0, 200000);

    Promise.all(prep).then(function () {
      if (!ENDPOINT) throw new Error('endpoint');
      var ctrl = window.AbortController ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 60000);
      return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' })
        .then(function (res) { clearTimeout(t); return res.json(); });
    }).then(function (rep) {
      if (rep && rep.ok) succes(rep.ref, l);
      else throw new Error((rep && rep.message) || (rep && rep.error) || 'erreur');
    }).catch(function (err) {
      console.error(err);
      btn.disabled = false; btn.textContent = lib;
      var sujet = 'Demande de contre-devis – ' + l.organisation + ' – ' + l.cp;
      ko.hidden = false;
      ko.innerHTML = '<strong>L’envoi automatique n’a pas abouti.</strong> ' + (err && err.message && !/endpoint|erreur|fetch|abort|json/i.test(err.message) ? esc(err.message) + ' ' : '') +
        'Vous pouvez : <a href="mailto:contact@acm-groupe.pro?subject=' + encodeURIComponent(sujet) + '&body=' + encodeURIComponent(recapTexte(l) + '\n\n(Pensez à joindre votre devis et le rapport PDF.)') + '">envoyer la demande par e-mail</a> en joignant le devis et <button type="button" class="vd-link" id="vd-pdf2">le rapport PDF</button>, ou nous appeler au <a href="tel:+33652252403">06 52 25 24 03</a>.';
      var b2 = $('#vd-pdf2'); if (b2) b2.onclick = function () { rapportPDF().then(function (d) { d.save('rapport-verification-devis-acm.pdf'); }); };
    });
  });

  function succes(ref, l) {
    etat.envoye = true;
    $('#vd-lead-form').hidden = true;
    var ok = $('#vd-lead-ok');
    ok.hidden = false;
    $('#vd-ref').textContent = ref;
    $('#vd-ok-mail').textContent = l.email;
    $('#vd-ok-tel').textContent = l.tel;
    $('#vd-steps').setAttribute('data-step', '3');
    ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Liens « contre-devis » contextuels : défilement vers le formulaire pré-rempli
  $$('[data-vd-cta]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var f = $('#vd-lead'); f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { form.nom.focus({ preventScroll: true }); }, 500);
    });
  });

  // Exposé pour les tests automatisés
  window.ACMVerifApp = { etat: etat, setEndpoint: function (u) { ENDPOINT = u; } };
})();
