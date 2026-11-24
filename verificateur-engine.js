/*!
 * ACM Groupe — Vérificateur de devis travaux & copropriété
 * Moteur d'analyse (exécuté dans le navigateur, aucune donnée envoyée).
 * Aide à la lecture technique : ne remplace pas un avis juridique ou d'expert.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ACMVerif = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Outils texte ---------- */
  function sansAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function norm(s) {
    return sansAccents(s).toLowerCase().replace(/[   ]/g, ' ').replace(/[’`]/g, "'");
  }
  function extrait(ligne, max) {
    var t = String(ligne || '').replace(/\s+/g, ' ').trim();
    max = max || 140;
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  function arrondi(n) { return Math.round(n); }

  /* ---------- Montants ---------- */
  // Nombre au format français ou anglais : 1 250,00 / 1.250,00 / 1250.00 / 1,250.00 / 980
  var RE_NOMBRE = /(\d{1,3}(?:[ .  ]\d{3})+(?:[,.]\d{1,2})?|\d+(?:[,.]\d{1,2})?)(\s*(?:€|eur\b|euros?\b|%|m²|m2\b|m³|m3\b|ml\b|m\b|u\b|unites?\b|h\b|heures?\b|j\b|jours?\b|kg\b|t\b|sem\w*|mois\b|pcs?\b|ens\b|ft\b|forfaits?\b))?/gi;

  function parseNombre(s) {
    s = String(s).replace(/[   ]/g, '');
    var lc = s.lastIndexOf(','), lp = s.lastIndexOf('.');
    if (lc > -1 && lp > -1) {
      if (lc > lp) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lc > -1) {
      s = s.replace(',', '.');
    } else if (lp > -1) {
      // 1.250 (milliers) vs 12.50 (décimales)
      if (/\.\d{3}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    }
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /** Renvoie le dernier montant « monétaire » plausible d'une ligne (colonne total). */
  function montantLigne(ligne) {
    var l = norm(ligne);
    // retirer dates, téléphones, numéros de SIRET / police pour éviter les faux montants
    l = l.replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g, ' ')
         .replace(/(?:\+33|0)\s?[1-9](?:[ .]?\d{2}){4}/g, ' ')
         .replace(/\b\d{3} ?\d{3} ?\d{3}(?: ?\d{5})?\b/g, function (m) { return m.replace(/\s/g, '').length >= 9 ? ' ' : m; });
    var candidats = [];
    var m;
    RE_NOMBRE.lastIndex = 0;
    while ((m = RE_NOMBRE.exec(l)) !== null) {
      var unite = (m[2] || '').trim();
      var val = parseNombre(m[1]);
      if (val === null) continue;
      var euro = /^(€|eur|euro)/.test(unite);
      var decimales = /[,.]\d{1,2}$/.test(m[1]);
      var milliers = /\d[ .\u00a0\u202f]\d{3}$/.test(m[1].replace(/[,.]\d{1,2}$/, ''));
      if (unite && !euro) continue; // quantités, %, durées
      // un montant porte un symbole €, des décimales ou un séparateur de milliers (exclut codes postaux, années, n° de devis)
      if (!euro && !decimales && !milliers) continue;
      candidats.push({ v: val, euro: euro });
    }
    if (!candidats.length) return null;
    var eur = candidats.filter(function (c) { return c.euro; });
    var c = (eur.length ? eur : candidats)[(eur.length ? eur : candidats).length - 1];
    return c.v > 0 && c.v < 50000000 ? c.v : null;
  }

  /** Premier montant situé après le libellé (ex. « Total HT 10 330,00 € TVA … »). */
  function montantApres(ligne, re) {
    var l = norm(ligne), m = l.match(re);
    if (!m) return null;
    var suite = String(ligne).slice(m.index + m[0].length);
    var mots = suite.split(/(?=\b(?:total|tva|t\.v\.a|net|montant|acompte)\b)/i);
    return montantLigne(mots[0]) !== null ? montantLigne(mots[0]) : montantLigne(suite);
  }

  /* ---------- SIRET / SIREN ---------- */
  function luhn(num) {
    var s = 0, dbl = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = +num[i];
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      s += d; dbl = !dbl;
    }
    return s % 10 === 0;
  }

  /* ---------- Référentiels ---------- */
  var POSTES_ACM = [
    { k: 'facade', label: 'Façade / ravalement', re: /facade|ravalement|enduit|hydrofug|pignon|peinture (de |des )?(murs? )?exterieur|nettoyage (de |des )?(la )?facade|fissures?/ },
    { k: 'purge', label: 'Purge & mise en sécurité', re: /purge|mise en securite|securisation|epaufr|beton (degrade|eclate|effrite)|aciers? (apparents?|corrodes?)|passivation|balcons?|nez de dalle|ragreage/ },
    { k: 'toiture', label: 'Toiture / couverture', re: /toiture|couverture|tuiles?\b|ardoises?|faitage|faitiere|chatiere|souches?\b|cheminee|lucarne|velux|bac acier|ecran sous toiture/ },
    { k: 'zinguerie', label: 'Zinguerie', re: /zinguerie|gouttieres?|cheneaux?|cheneau|descentes? (d'eau|ep|pluviales?)|\bzinc\b|noues?\b|solins?\b|naissance|dauphin|crochets? de gouttiere/ },
    { k: 'etancheite', label: 'Étanchéité', re: /etancheite|membrane|bitum|asphalte|toiture[- ]terrasse|joints? (de dilatation|silicone|mastic|souples?)|calfeutrement|infiltrations?|releves? d'etanch/ },
    { k: 'pigeons', label: 'Dépigeonnage', re: /pigeons?|depigeon|fientes?|volatiles?|anti[- ]oiseaux|pics anti|picots|filets? anti/ },
    { k: 'maintenance', label: 'Nettoyage & maintenance en hauteur', re: /demoussage|lavage (haute pression|hp)|nettoyage (de |des )?(vitres?|vitrages?|verriere|gouttieres?|cheneaux?)|maintenance|inspection|vitrerie|verriere|curage/ },
    { k: 'acces', label: 'Travaux en accès difficile', re: /cordistes?|sur cordes?|acces difficile|courette|cour (interieure|anglaise)|puits de lumiere|travaux en hauteur/ }
  ];

  var RE_ECHAF = /echafaudages?|echaf\b|pied de facade|montage[ \/-]+demontage|demontage[ \/-]+montage|plancher(s)? de travail|parapluie|filets? de protection d'echafaudage/;
  var RE_NACELLE = /nacelles?|pemp\b|camion[- ]nacelle|bras articule|plateforme elevatrice|elevateur de personnes|monte[- ]materiaux/;
  var RE_VOIRIE = /voirie|domaine public|permis de stationnement|occupation (du )?(trottoir|domaine)|emprise (sur )?(la )?(voie|trottoir)|arrete municipal/;
  var RE_CORDE = /cordistes?|sur cordes?|travaux sur cordes?|acces par cordes?|technique(s)? d'acces sur cordes?/;
  var RE_LOURD = /isolation thermique (par l')?exterieur|\bite\b|refection (complete|totale) (de la )?(couverture|toiture)|remplacement (de la )?charpente|charpente|demolition|surelevation|gros oeuvre|reprise en sous[- ]oeuvre|remplacement (des |de la )?menuiseries? exterieures?/;
  var RE_RESIDENTIEL = /copropriete|syndic|logements?|habitation|appartements?|residence|immeuble d'habitation|parties communes|syndicat des coproprietaires/;

  var ASSUREURS = /axa|allianz|maaf|maif|macif|smabtp|\bsma\b|groupama|generali|\bmma\b|hiscox|\bqbe\b|l'auxiliaire|auxiliaire du batiment|\bhdi\b|swisslife|swiss life|abeille|aviva|thelem|matmut|april|covea|camca|leader underwriting|millennial|elite insurance|alpha insurance|ergo|zurich|chubb|lloyd|cnp|credit agricole assurances|pacifica|mutuelle/;

  var FLOUS = [
    { k: 'divers', re: /\bdivers\b|\bfrais annexes\b|\bimprevus?\b|\baleas\b/, label: 'Poste « divers », « imprévus » ou « aléas »', risque: 'Montant sans contenu défini : il peut servir de variable d’ajustement.', q: 'Que recouvre précisément le poste « divers / imprévus », et peut-il être détaillé ou supprimé ?' },
    { k: 'conditionnel', re: /selon (besoin|necessite|etat|constat)|si necessaire|le cas echeant|eventuel(le)?s?\b|en option|si besoin/, label: 'Prestations conditionnelles (« si nécessaire », « éventuel »)', risque: 'Risque de surcoût découvert en cours de chantier.', q: 'Dans quels cas ces prestations « si nécessaire » seront-elles déclenchées, à quel prix unitaire et avec quelle validation écrite préalable ?' },
    { k: 'exclusions', re: /non compris|non inclus|hors (lot|prestation|devis|marche)|\bexclu|en sus\b|en supplement|a la charge (du client|du maitre d'ouvrage|de la copropriete|du syndicat)/, label: 'Exclusions ou prestations « en sus »', risque: 'Des postes nécessaires au chantier peuvent être facturés à part.', q: 'Quelles prestations nécessaires au chantier ne sont pas incluses, et quel est leur coût estimé ?' },
    { k: 'reserve', re: /sous reserve|apres (decouverte|sondage|depose|piochage|ouverture|purge)|a determiner|a definir|a confirmer|a chiffrer|a preciser/, label: 'Chiffrage sous réserve ou « à déterminer »', risque: 'Le prix final dépendra de constats ultérieurs.', q: 'Quels points restent « sous réserve » et quel plafond de dépense proposez-vous pour ces aléas ?' },
    { k: 'estimatif', re: /prix (indicatif|estimatif)|a titre indicatif|\bestimati|\benviron\b|approximati|budget previsionnel/, label: 'Prix indicatif ou estimatif', risque: 'Un prix non ferme peut être revu à la hausse.', q: 'Le prix est-il ferme et définitif pour la durée de validité du devis ?' },
    { k: 'revision', re: /travaux supplementaires|plus[- ]values?|revision (des |de )?prix|revisable|actualisation|index bt ?\d+|indexation/, label: 'Révision de prix ou travaux supplémentaires prévus', risque: 'Le montant peut évoluer (indexation, avenants).', q: 'Le prix est-il révisable ? Si oui, selon quel indice et à partir de quelle date ?' },
    { k: 'metre', re: /selon metre|sur metre|au metre reel|quantites? (estimee|approximative|previsionnelle)|metre (definitif|contradictoire)|a l'avancement/, label: 'Quantités à métrer en fin de chantier', risque: 'La facture finale peut dépasser le devis si le métré augmente.', q: 'Les quantités sont-elles plafonnées ? Le métré final sera-t-il contradictoire (avec photos) ?' },
    { k: 'ponctuel', re: /reprises? (ponctuelles?|localisees?)|\bponctuel(le)?s?\b/, label: 'Reprises « ponctuelles » non quantifiées', risque: 'Sans surface ni nombre, impossible de vérifier ce qui sera réellement fait.', q: 'Combien de m², de mètres linéaires ou de points de reprise sont prévus, et à quel prix unitaire au-delà ?' }
  ];

  /* ---------- Analyse ---------- */
  function analyser(texteBrut, options) {
    options = options || {};
    var texte = String(texteBrut || '');
    var lignes = texte.split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var lignesN = lignes.map(norm);
    var T = lignesN.join('\n');

    var r = {
      version: 1,
      date: new Date().toISOString(),
      longueur: texte.length,
      lisible: texte.replace(/\s/g, '').length >= 120,
      estDevis: /devis|proposition (commerciale|de prix|tarifaire)|offre de prix|estimation|bon pour accord|total|montant/.test(T),
      entreprise: null,
      montants: {},
      controles: [],
      flous: [],
      omissions: [],
      acces: null,
      postes: [],
      questions: [],
      score: 0,
      verdict: '',
      niveau: '',
      resume: '',
      pointsCles: []
    };
    if (!r.lisible) {
      r.verdict = 'Texte illisible ou trop court';
      r.niveau = 'erreur';
      return r;
    }

    /* Entreprise émettrice (meilleure estimation) */
    var entIdx = -1;
    var exclEnt = /client|destinataire|syndic|copropriet|madame|monsieur|m\.\s|adresse|chantier|devis n|objet|date|tel\b|tel\.|e-?mail|siret|siren|rcs/;
    for (var pass = 0; pass < 2 && entIdx < 0; pass++) for (var i = 0; i < Math.min(lignes.length, 12); i++) {
      var ln = lignesN[i];
      var reEnt = pass === 0 ? /\b(sarl|sas|sasu|eurl|sa|scop|eirl)\b/ : /\b(entreprise|batiment|btp|couverture|renovation|toitures?|facades?|ravalement|etancheite|peinture|construction|travaux)\b/;
      if (reEnt.test(ln) && !exclEnt.test(ln) && lignes[i].length <= 90 && montantLigne(lignes[i]) === null) {
        entIdx = i;
        r.entreprise = lignes[i].split(/\s[-–—|·]\s|,\s*capital|\s\(/i)[0].trim();
        break;
      }
    }

    /* Montants */
    var totalHT = null, totalTTC = null, tva = null, totalGeneral = null;
    lignesN.forEach(function (l, idx) {
      var v;
      var reHT = /(total|montant|prix)\s*(general\s*)?(net\s*)?(h\.?\s?t\b\.?|hors tax\w*)/;
      if (reHT.test(l) && !/sous[- ]total/.test(l)) {
        v = montantApres(lignes[idx], reHT);
        if (v !== null && (totalHT === null || v > totalHT)) totalHT = v;
      }
      var reTTC = /(total|montant|net)\s*(a payer\s*)?(t\.?\s?t\.?\s?c\b\.?|toutes taxes\w*)|net a payer/;
      if (reTTC.test(l)) {
        v = montantApres(lignes[idx], reTTC);
        if (v !== null && (totalTTC === null || v > totalTTC)) totalTTC = v;
      }
      if (/^\s*(total|montant total|total general|total devis)\b/.test(l) && !/sous[- ]total|ht|ttc|hors tax|toutes taxes|tva/.test(l)) {
        v = montantApres(lignes[idx], /(total general|montant total|total devis|total)/);
        if (v !== null && (totalGeneral === null || v > totalGeneral)) totalGeneral = v;
      }
      var mt = l.match(/t\.?v\.?a\.?[^\n%]{0,25}?(5[,.]5|10|20)\s*%|(5[,.]5|10|20)\s*%[^\n]{0,15}t\.?v\.?a/);
      if (mt && tva === null) tva = parseFloat((mt[1] || mt[2]).replace(',', '.'));
    });
    if (totalHT === null && totalTTC !== null && tva !== null) totalHT = arrondi(totalTTC / (1 + tva / 100));
    if (totalHT !== null && totalTTC !== null && totalTTC < totalHT) { var tmp = totalHT; totalHT = totalTTC; totalTTC = tmp; }
    r.montants = { totalHT: totalHT, totalTTC: totalTTC, tva: tva, totalNonPrecise: totalHT === null && totalTTC === null ? totalGeneral : null };
    var totalRef = totalHT !== null ? totalHT : (totalGeneral !== null ? totalGeneral : null);

    /* Lignes chiffrées / détail */
    var lignesChiffrees = 0, lignesQuantifiees = 0, forfaits = 0;
    lignesN.forEach(function (l, idx) {
      if (/total|tva|acompte|net a payer|sous[- ]total|capital|siret|siren|iban|bic/.test(l)) return;
      var v = montantLigne(lignes[idx]);
      if (v === null) return;
      lignesChiffrees++;
      if (/\b\d+(?:[,.]\d+)?\s*(m²|m2|ml|m³|m3|u\b|unites?|h\b|heures?|jours?|j\b|kg|pcs?|pieces?|points?|sem\w*|mois)/.test(l)) lignesQuantifiees++;
      if (/\bforfaits?\b|\bens\b|\bensemble\b|\bft\b|\bglobal\b/.test(l)) forfaits++;
    });

    function controle(id, cat, label, statut, detail, question, poids) {
      r.controles.push({ id: id, cat: cat, label: label, statut: statut, detail: detail, question: question || null, poids: poids || 1 });
    }

    /* 1. Identification de l'entreprise */
    var siretOk = null, siretTrouve = null;
    var reSiret = /(\d{3}\s?\d{3}\s?\d{3}\s?\d{5})/g, ms;
    var zoneId = T.replace(/(?:\+33|0)\s?[1-9](?:[ .]?\d{2}){4}/g, ' ');
    while ((ms = reSiret.exec(zoneId)) !== null) {
      var num = ms[1].replace(/\s/g, '');
      if (num.length !== 14) continue;
      siretTrouve = num;
      if (luhn(num) || /^356000000/.test(num)) { siretOk = num; break; }
    }
    var sirenSeul = /siren|r\.?c\.?s|rcs|rne|registre/.test(T) && /\b\d{3}\s?\d{3}\s?\d{3}\b/.test(zoneId);
    if (siretOk) controle('siret', 'Mentions obligatoires', 'Numéro SIRET', 'ok', 'SIRET ' + siretOk.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4') + ' (clé de contrôle valide). Vérifiez qu’il correspond bien à l’entreprise sur annuaire-entreprises.data.gouv.fr.', null, 2);
    else if (siretTrouve) controle('siret', 'Mentions obligatoires', 'Numéro SIRET', 'alerte', 'Un numéro à 14 chiffres est présent mais sa clé de contrôle est invalide (erreur de saisie ou numéro erroné).', 'Pouvez-vous confirmer votre numéro SIRET exact ? Celui du devis semble erroné.', 2);
    else if (sirenSeul) controle('siret', 'Mentions obligatoires', 'Numéro SIRET', 'alerte', 'Un numéro SIREN / RCS semble présent, mais pas de SIRET complet (14 chiffres) identifiant l’établissement.', 'Pouvez-vous indiquer le SIRET de l’établissement qui réalisera les travaux ?', 2);
    else controle('siret', 'Mentions obligatoires', 'Numéro SIRET', 'manquant', 'Aucun numéro SIRET détecté : impossible d’identifier l’entreprise et de vérifier qu’elle est en activité.', 'Quel est votre numéro SIRET ? (à vérifier sur annuaire-entreprises.data.gouv.fr)', 2);

    if (/r\.?c\.?s\b|registre du commerce|\brm\b|repertoire des metiers|\brne\b|chambre des metiers/.test(T)) controle('rcs', 'Mentions obligatoires', 'Immatriculation (RCS / RM)', 'ok', 'Mention d’immatriculation présente.');
    else controle('rcs', 'Mentions obligatoires', 'Immatriculation (RCS / RM)', 'alerte', 'Pas de mention RCS ou Répertoire des métiers détectée.', 'Où l’entreprise est-elle immatriculée (RCS ou Répertoire des métiers) ?');

    if (/\bfr\s?[0-9a-z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\b|tva intra|n° ?tva|numero de tva/.test(T)) controle('tvaintra', 'Mentions obligatoires', 'N° de TVA intracommunautaire', 'ok', 'Numéro de TVA présent.', null, 0.5);
    else controle('tvaintra', 'Mentions obligatoires', 'N° de TVA intracommunautaire', 'alerte', 'Non détecté (obligatoire sur la facture, attendu sur le devis).', null, 0.5);

    /* 2. Date, validité, client, lieu */
    var reDate = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](20)?\d{2}\b|\b\d{1,2}(er)? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre) 20\d{2}\b/;
    if (reDate.test(T)) controle('date', 'Mentions obligatoires', 'Date du devis', 'ok', 'Date détectée.', null, 0.5);
    else controle('date', 'Mentions obligatoires', 'Date du devis', 'manquant', 'Aucune date détectée sur le devis.', 'Pouvez-vous dater le devis ?', 0.5);

    if (/valable|validite|offre valable|duree de validite|valide jusqu/.test(T)) controle('validite', 'Mentions obligatoires', 'Durée de validité de l’offre', 'ok', 'Durée de validité indiquée.', null, 0.5);
    else controle('validite', 'Mentions obligatoires', 'Durée de validité de l’offre', 'alerte', 'Pas de durée de validité : le prix peut être remis en cause.', 'Jusqu’à quelle date ce prix est-il garanti ?', 0.5);

    if (/adresse (du |des )?(chantier|travaux)|lieu (d'intervention|des travaux|d'execution|du chantier)|chantier\s*:|site\s*:|adresse d'intervention/.test(T)) controle('lieu', 'Mentions obligatoires', 'Adresse du chantier', 'ok', 'Lieu d’intervention précisé.', null, 0.5);
    else controle('lieu', 'Mentions obligatoires', 'Adresse du chantier', 'alerte', 'Le lieu exact d’exécution n’est pas clairement indiqué.', 'Pouvez-vous préciser l’adresse et la zone exacte d’intervention (bâtiment, façade, cour) ?', 0.5);

    /* 3. Détail des postes et prix */
    if (lignesChiffrees >= 3 && lignesQuantifiees >= Math.max(2, Math.ceil(lignesChiffrees * 0.4)) && forfaits < lignesChiffrees * 0.5)
      controle('detail', 'Contenu technique', 'Détail des postes (quantités × prix unitaires)', 'ok', lignesChiffrees + ' lignes chiffrées dont ' + lignesQuantifiees + ' avec quantité et unité.', null, 2);
    else if (lignesChiffrees >= 1)
      controle('detail', 'Contenu technique', 'Détail des postes (quantités × prix unitaires)', 'alerte', lignesChiffrees + ' ligne(s) chiffrée(s), ' + lignesQuantifiees + ' avec quantité, ' + forfaits + ' au forfait : le détail est insuffisant pour comparer les offres.', 'Pouvez-vous détailler chaque poste avec quantité, unité (m², ml, u) et prix unitaire ?', 2);
    else
      controle('detail', 'Contenu technique', 'Détail des postes (quantités × prix unitaires)', 'manquant', 'Aucune ligne chiffrée détectée : le devis n’est pas décomposé.', 'Pouvez-vous fournir un devis décomposé poste par poste (quantité, unité, prix unitaire) ?', 2);

    if (totalHT !== null && (totalTTC !== null || tva !== null))
      controle('prix', 'Contenu technique', 'Prix HT, taux de TVA et TTC', 'ok', 'Total HT ' + fmtEur(totalHT) + (tva !== null ? ' · TVA ' + String(tva).replace('.', ',') + ' %' : '') + (totalTTC !== null ? ' · TTC ' + fmtEur(totalTTC) : '') + '.', null, 1);
    else
      controle('prix', 'Contenu technique', 'Prix HT, taux de TVA et TTC', 'alerte', 'Les totaux HT / TVA / TTC ne sont pas tous identifiables.', 'Pouvez-vous indiquer clairement le total HT, le taux de TVA appliqué et le total TTC ?', 1);

    if (tva === 20 && RE_RESIDENTIEL.test(T) && !/neuf|construction neuve|local commercial|bureaux?\b/.test(T))
      controle('tvataux', 'Contenu technique', 'Taux de TVA', 'alerte', 'TVA à 20 % sur des travaux qui semblent concerner un immeuble d’habitation : un taux réduit (10 %, voire 5,5 % pour certains travaux énergétiques) peut s’appliquer aux logements de plus de 2 ans, sur attestation.', 'Pourquoi la TVA est-elle à 20 % ? Le taux de 10 % pour travaux dans des locaux d’habitation de plus de 2 ans est-il applicable ?', 1);

    /* 4. Délais et paiement */
    if (/delai|duree (des |du |d'execution|estimee|previsionnelle)|date (de |du )?(debut|demarrage)|demarrage|planning|semaines? de travaux|jours? ouvr|intervention prevue/.test(T)) controle('delais', 'Contenu technique', 'Délais / date de démarrage', 'ok', 'Délai ou date de démarrage mentionné.', null, 1);
    else controle('delais', 'Contenu technique', 'Délais / date de démarrage', 'manquant', 'Aucun délai d’exécution ni date de début détecté.', 'Quelle est la date de démarrage et la durée prévisionnelle du chantier ? Des pénalités de retard sont-elles prévues ?', 1);

    var mAcompte = T.match(/acompte[^\n%]{0,40}?(\d{1,3})\s*%|(\d{1,3})\s*%[^\n]{0,30}acompte/);
    var acompte = mAcompte ? parseInt(mAcompte[1] || mAcompte[2], 10) : null;
    if (acompte !== null && acompte > 40) controle('paiement', 'Contenu technique', 'Conditions de paiement', 'alerte', 'Acompte de ' + acompte + ' % à la commande : niveau élevé qui vous expose en cas de défaillance de l’entreprise.', 'Peut-on limiter l’acompte à 30 % maximum et régler le solde à la réception, sans réserve ?', 1);
    else if (/acompte|conditions de (reglement|paiement)|modalites de (reglement|paiement)|echeancier|reglement a|paiement a/.test(T)) controle('paiement', 'Contenu technique', 'Conditions de paiement', 'ok', 'Modalités de paiement indiquées' + (acompte !== null ? ' (acompte ' + acompte + ' %)' : '') + '.', null, 0.5);
    else controle('paiement', 'Contenu technique', 'Conditions de paiement', 'alerte', 'Les modalités de paiement (acompte, échéancier, solde) ne sont pas précisées.', 'Quelles sont les conditions de paiement (acompte, situations, solde à la réception) ?', 0.5);

    /* 5. Déchets (loi AGEC) */
    var lDechets = lignesN.filter(function (l) { return /dechets?|gravats|evacuation|bennes?\b|decharge|\btri\b|recyclage|enlevement des? (dechets|gravats|deblais)|point de collecte|decheterie/.test(l); });
    if (lDechets.length) {
      var dechetsChiffre = lDechets.some(function (l, j) { return montantLigne(l) !== null; });
      var dechetsQte = lDechets.some(function (l) { return /\d+(?:[,.]\d+)?\s*(m3|m³|t\b|tonnes?|kg|bennes?)/.test(l); });
      var dechetsLieu = lDechets.some(function (l) { return /decheterie|point de collecte|installation|centre de tri|recycl/.test(l); });
      if (dechetsChiffre && (dechetsQte || dechetsLieu)) controle('dechets', 'Contenu technique', 'Gestion et évacuation des déchets', 'ok', 'Évacuation des déchets prévue et chiffrée.', null, 1);
      else controle('dechets', 'Contenu technique', 'Gestion et évacuation des déchets', 'alerte', 'Les déchets sont mentionnés mais sans tous les éléments attendus : quantité estimée, modalités d’enlèvement, point de collecte et coût.', 'Pouvez-vous préciser la quantité de déchets estimée, le lieu de dépôt (déchèterie, centre de tri) et le coût de leur évacuation ?', 1);
    } else controle('dechets', 'Contenu technique', 'Gestion et évacuation des déchets', 'manquant', 'Rien sur l’évacuation des déchets. Depuis la loi AGEC, un devis de travaux doit indiquer la quantité estimée de déchets, leur mode de gestion, le point de collecte et le coût associé.', 'L’évacuation des déchets et gravats est-elle incluse ? Quelle quantité, vers quel site et pour quel coût ?', 1);

    /* 6. Assurances */
    var aDecennale = /decennale|responsabilite civile decennale|\brcd\b|garantie decennale|assurance decennale/.test(T);
    var aAssureur = ASSUREURS.test(T) || /assureur|compagnie d'assurance|assure aupres|assure par/.test(T);
    var aPolice = /(police|contrat|attestation)\s*(d'assurance\s*)?(n°|no|n°\s|numero|num\.?)\s*[:#]?\s*[a-z0-9][a-z0-9\-\/. ]{3,}/.test(T);
    var aZone = /couverture geographique|zone geographique|france (metropolitaine|entiere)|territoire (national|francais)|ile[- ]de[- ]france|validite territoriale/.test(T);
    if (aDecennale && aAssureur && (aPolice || aZone)) controle('decennale', 'Assurances', 'Assurance décennale', 'ok', 'Assurance décennale mentionnée (assureur' + (aPolice ? ', n° de contrat' : '') + (aZone ? ', couverture géographique' : '') + '). Demandez l’attestation de l’année en cours.', 'Pouvez-vous transmettre l’attestation décennale en cours de validité, couvrant précisément ces activités ?', 3);
    else if (aDecennale) controle('decennale', 'Assurances', 'Assurance décennale', 'alerte', 'La décennale est citée, mais il manque ' + [!aAssureur && 'le nom de l’assureur', !aPolice && 'le numéro de contrat', !aZone && 'la couverture géographique'].filter(Boolean).join(', ') + '. Ces mentions doivent figurer sur le devis (art. L243-2 du Code des assurances).', 'Pouvez-vous transmettre l’attestation décennale (assureur, n° de contrat, activités couvertes, zone géographique, période de validité) ?', 3);
    else controle('decennale', 'Assurances', 'Assurance décennale', 'manquant', 'Aucune assurance décennale mentionnée. Elle est obligatoire pour les travaux de façade, toiture ou étanchéité, et ses références doivent figurer sur le devis.', 'Quelle est votre assurance décennale (assureur, n° de contrat, activités couvertes) ? Pouvez-vous fournir l’attestation en cours de validité ?', 3);

    if (/responsabilite civile (pro|professionnelle|exploitation)|\brc pro\b|\brcp\b|rc exploitation/.test(T)) controle('rcpro', 'Assurances', 'Responsabilité civile professionnelle', 'ok', 'RC professionnelle mentionnée.', null, 1);
    else controle('rcpro', 'Assurances', 'Responsabilité civile professionnelle', 'alerte', 'Pas de RC professionnelle détectée (dommages causés aux tiers pendant le chantier : passants, véhicules, vitrages).', 'Avez-vous une RC professionnelle couvrant les dommages aux tiers pendant le chantier ? Pouvez-vous fournir l’attestation ?', 1);

    /* 7. Zones floues */
    var usageLigne = {};
    FLOUS.forEach(function (f) {
      for (var j = 0; j < lignesN.length; j++) {
        if (f.re.test(lignesN[j]) && (usageLigne[j] || 0) < 2) {
          usageLigne[j] = (usageLigne[j] || 0) + 1;
          r.flous.push({ k: f.k, label: f.label, risque: f.risque, question: f.q, extrait: extrait(lignes[j]) });
          break;
        }
      }
    });
    if (lignesChiffrees >= 2 && forfaits >= 2 && forfaits >= lignesChiffrees * 0.4)
      r.flous.push({ k: 'forfaits', label: forfaits + ' postes au forfait sans quantité', risque: 'Un forfait sans quantité ni prix unitaire ne permet pas de vérifier ce qui sera réellement fait.', question: 'Pouvez-vous décomposer les postes au forfait (quantités, unités, prix unitaires) ?', extrait: '' });

    /* 8. Omissions fréquentes */
    function omission(cond, label, risque, question) { if (cond) r.omissions.push({ label: label, risque: risque, question: question }); }
    // les postes sont cherchés hors en-tête de l'entreprise (ex. « Toitures & Façades SARL »)
    var TPostes = lignesN.filter(function (l, j) { return j !== entIdx && !/^(sarl|sas|eurl)\b|siret|rcs|capital/.test(l); }).join('\n');
    var postesTrouves = POSTES_ACM.filter(function (p) { return p.re.test(TPostes); });
    var aEchaf = RE_ECHAF.test(T), aNacelle = RE_NACELLE.test(T), aCorde = RE_CORDE.test(T);
    var exterieur = postesTrouves.length > 0 || aEchaf || aNacelle;

    omission(exterieur && !/protection|bach(e|age)|calfeutr|film|polyane/.test(T), 'Protection des existants', 'Vitrages, sols, balcons, végétation ou véhicules pourraient être dégradés sans protection prévue.', 'Quelles protections sont prévues (vitrages, sols, balcons, voitures, passants) et sont-elles incluses ?');
    omission(!/nettoyage (de )?fin de chantier|repli( de chantier)?|remise en etat|nettoyage (des )?abords|nettoyage du chantier/.test(T), 'Nettoyage et repli de fin de chantier', 'Le nettoyage final est souvent facturé à part s’il n’est pas écrit.', 'Le nettoyage des abords et le repli du chantier sont-ils inclus ?');
    omission(exterieur && !/balisage|perimetre de securite|signalisation|installation de chantier|securite des (pietons|passants|tiers)|ppsps|plan de prevention/.test(T), 'Sécurité du chantier (balisage, périmètre, plan de prévention)', 'Travaux en hauteur au-dessus de passages : la sécurisation des accès doit être prévue.', 'Comment la zone sera-t-elle balisée et sécurisée pour les occupants et les passants ? Un plan de prévention / PPSPS est-il prévu ?');
    omission((aEchaf || aNacelle) && /\brue\b|trottoir|voie publique|chaussee|sur rue|cote rue|facade rue|avenue|boulevard/.test(T) && !RE_VOIRIE.test(T), 'Autorisation de voirie', 'Un échafaudage ou une nacelle sur le trottoir exige une autorisation d’occupation du domaine public, payante et parfois longue à obtenir.', 'Qui demande l’autorisation de voirie, dans quel délai, et son coût (redevance) est-il inclus ?');
    omission(!/proces[- ]verbal|pv de reception|reception (des travaux|du chantier)|rapport (photo|d'intervention|de fin)|photos? (avant|apres)/.test(T), 'Réception des travaux et rapport photo', 'Sans procès-verbal de réception, le point de départ des garanties est flou ; sans photos, les travaux en hauteur sont difficiles à contrôler.', 'Prévoyez-vous un procès-verbal de réception et un rapport photo avant / après ?');
    omission(/purge|epaufr|aciers?|balcons?|beton/.test(T) && !/passiv|traitement des aciers|inhibiteur|anticorros|traitement anti[- ]?corrosion/.test(T), 'Traitement des aciers après purge', 'Une purge sans traitement des armatures (passivation) laisse la corrosion reprendre : les éclats reviennent.', 'Le traitement des aciers (brossage, passivation) et la reconstitution du béton sont-ils prévus après la purge ?');
    omission(/etancheite|toiture[- ]terrasse|membrane|zinguerie|couverture/.test(T) && !/garantie (de |d')?\d+ ?ans|garantie decennale|garantie biennale|garantie fabricant|garantie de parfait/.test(T), 'Garanties sur les ouvrages d’étanchéité / couverture', 'La durée et l’étendue des garanties ne sont pas précisées.', 'Quelles garanties s’appliquent (parfait achèvement, biennale, décennale, garantie fabricant) et pour quelle durée ?');

    /* 9. Moyens d'accès */
    var lAcces = [];
    var coutAcces = 0, coutTrouve = false;
    lignesN.forEach(function (l, idx) {
      if (/total|tva|acompte|net a payer/.test(l)) return;
      var type = RE_ECHAF.test(l) ? 'echafaudage' : RE_NACELLE.test(l) ? 'nacelle' : (RE_VOIRIE.test(l) ? 'voirie' : null);
      if (!type) return;
      var v = montantLigne(lignes[idx]);
      // ligne mixte (accès + travaux) : le coût de l'accès n'est pas isolé
      var mixte = POSTES_ACM.some(function (p) { return p.k !== 'acces' && p.re.test(l.replace(RE_ECHAF, ' ').replace(RE_NACELLE, ' ')); }) && !/location|montage|demontage|installation|amenee|repli/.test(l);
      lAcces.push({ type: type, extrait: extrait(lignes[idx]), montant: mixte ? null : v, mixte: mixte });
      if (v !== null && !mixte) { coutAcces += v; coutTrouve = true; }
    });
    var mLoc = T.match(/(\d{1,3})\s*(semaines?|sem\b|mois|jours?)[^\n]{0,30}location|location[^\n]{0,40}?(\d{1,3})\s*(semaines?|sem\b|mois|jours?)/);
    var dureeLocation = mLoc ? (mLoc[1] || mLoc[3]) + ' ' + (mLoc[2] || mLoc[4]) : null;
    var lourd = RE_LOURD.test(T);
    var compatibleCorde = postesTrouves.some(function (p) { return ['facade', 'purge', 'toiture', 'zinguerie', 'etancheite', 'pigeons', 'maintenance'].indexOf(p.k) > -1; });

    if (aEchaf || aNacelle) {
      var typeAcces = aEchaf && aNacelle ? 'Échafaudage et nacelle' : aEchaf ? 'Échafaudage' : 'Nacelle';
      var part = (coutTrouve && totalRef) ? coutAcces / totalRef : null;
      var fem = !aEchaf && aNacelle ? 'e' : '';
      var accord = aEchaf && aNacelle ? 's' : fem;
      var a = {
        type: typeAcces,
        lignes: lAcces.slice(0, 6),
        cout: coutTrouve ? arrondi(coutAcces) : null,
        part: part !== null ? Math.round(part * 100) : null,
        dureeLocation: dureeLocation,
        travauxLourds: lourd,
        compatibleCorde: compatibleCorde,
        alerte: false,
        niveau: 'info',
        message: '',
        economieMin: null,
        economieMax: null
      };
      if (compatibleCorde && !lourd) {
        a.alerte = true;
        a.niveau = (part !== null && part >= 0.15) || (!coutTrouve) ? 'forte' : 'moyenne';
        a.message = typeAcces + ' facturé' + accord + ' pour des travaux (' + postesTrouves.map(function (p) { return p.label.toLowerCase(); }).join(', ') + ') généralement réalisables sur cordes : pas de montage, pas de location à la semaine, pas d’emprise prolongée sur le trottoir, et une intervention souvent plus rapide.';
        if (coutTrouve) {
          a.economieMin = arrondi(coutAcces * 0.4 / 10) * 10;
          a.economieMax = arrondi(coutAcces * 0.8 / 10) * 10;
        }
      } else if (lourd) {
        a.niveau = 'info';
        a.message = 'Le devis comprend des travaux lourds (' + (T.match(RE_LOURD) || [''])[0] + ') qui peuvent justifier un échafaudage. Une partie des travaux (purges, reprises ponctuelles, zinguerie) peut néanmoins être réalisée sur cordes : demandez un chiffrage en variante.';
      } else {
        a.message = typeAcces + ' prévu. Vérifiez que ce moyen d’accès est dimensionné au juste besoin.';
      }
      if (!coutTrouve) r.flous.push({ k: 'acces_non_isole', label: 'Coût de l’accès (' + typeAcces.toLowerCase() + ') non isolé', risque: 'Le prix de l’accès est noyé dans les autres postes : impossible de comparer avec une intervention sur cordes.', question: 'Quel est le coût isolé de l’' + typeAcces.toLowerCase() + ' (montage, location, démontage, autorisation de voirie) ?', extrait: lAcces[0] ? lAcces[0].extrait : '' });
      a.accord = accord;
      r.acces = a;
    } else if (aCorde) {
      r.acces = { type: 'Cordes', lignes: [], cout: null, part: null, alerte: false, niveau: 'ok', message: 'Le devis prévoit déjà une intervention sur cordes : vérifiez la qualification des intervenants (CQP cordiste ou certification IRATA) et le plan de prévention.', compatibleCorde: true };
    } else if (exterieur) {
      r.acces = { type: 'Non précisé', lignes: [], cout: null, part: null, alerte: false, niveau: 'moyenne', message: 'Le moyen d’accès aux zones en hauteur n’est pas précisé. C’est souvent là que naissent les surcoûts (échafaudage ajouté en cours de chantier).', compatibleCorde: compatibleCorde };
      r.omissions.push({ label: 'Moyen d’accès en hauteur non précisé', risque: 'Un échafaudage ou une nacelle peut être ajouté après signature.', question: 'Comment accéderez-vous aux zones en hauteur (échafaudage, nacelle, cordes) et ce coût est-il inclus ?' });
    }

    /* 10. Postes relevant d'ACM */
    r.postes = postesTrouves.map(function (p) { return { k: p.k, label: p.label }; });

    /* 11. Questions (priorisées, sans doublon) */
    var qs = [];
    function addQ(q, prio) { if (q && !qs.some(function (x) { return x.q === q; })) qs.push({ q: q, prio: prio }); }
    r.controles.forEach(function (c) {
      if (c.statut === 'manquant') addQ(c.question, 10 * c.poids);
      else if (c.statut === 'alerte') addQ(c.question, 6 * c.poids);
    });
    if (r.acces && r.acces.alerte) addQ('Une intervention sur cordes a-t-elle été étudiée ? Quel serait le prix sans ' + r.acces.type.toLowerCase() + ' ?', 25);
    if (r.acces && r.acces.dureeLocation) addQ('La location (' + r.acces.dureeLocation + ') est-elle plafonnée ? Que coûte chaque semaine supplémentaire en cas de retard ou d’intempéries ?', 14);
    r.flous.forEach(function (f) { addQ(f.question, 8); });
    r.omissions.forEach(function (o) { addQ(o.question, 5); });
    addQ('Qui sera l’interlocuteur sur place, et les intervenants sont-ils salariés de l’entreprise ou sous-traitants ?', 2);
    r.questions = qs.sort(function (a, b) { return b.prio - a.prio; }).map(function (x) { return x.q; });

    /* 12. Score et verdict */
    var score = 100;
    r.controles.forEach(function (c) {
      if (c.statut === 'manquant') score -= 5 * c.poids;
      else if (c.statut === 'alerte') score -= 2 * c.poids;
    });
    score -= Math.min(15, r.flous.length * 3);
    score -= Math.min(10, r.omissions.length * 2);
    if (r.acces && r.acces.alerte) score -= r.acces.niveau === 'forte' ? 8 : 4;
    r.score = Math.max(10, Math.min(100, Math.round(score)));
    if (r.score >= 75) { r.verdict = 'Devis globalement solide'; r.niveau = 'bon'; }
    else if (r.score >= 50) { r.verdict = 'À clarifier avant signature'; r.niveau = 'moyen'; }
    else { r.verdict = 'Vigilance : devis incomplet ou flou'; r.niveau = 'faible'; }

    /* 13. Points clés et résumé */
    var manquants = r.controles.filter(function (c) { return c.statut === 'manquant'; });
    var alertes = r.controles.filter(function (c) { return c.statut === 'alerte'; });
    manquants.forEach(function (c) { r.pointsCles.push('Manquant : ' + c.label); });
    alertes.forEach(function (c) { r.pointsCles.push('À vérifier : ' + c.label); });
    r.flous.forEach(function (f) { r.pointsCles.push('Zone floue : ' + f.label); });
    r.omissions.forEach(function (o) { r.pointsCles.push('Oubli fréquent : ' + o.label); });
    if (r.acces && r.acces.alerte) r.pointsCles.unshift('Moyen d’accès : ' + r.acces.type + (r.acces.cout ? ' (' + fmtEur(r.acces.cout) + ' HT' + (r.acces.part !== null ? ', ' + r.acces.part + ' % du total' : '') + ')' : '') + ', une intervention sur cordes est à étudier');

    var phr = [];
    phr.push('Devis' + (r.entreprise ? ' de ' + r.entreprise : '') + (totalHT ? ' de ' + fmtEur(totalHT) + ' HT' : (totalGeneral ? ' de ' + fmtEur(totalGeneral) + ' (HT/TTC non précisé)' : '')) + (r.postes.length ? ' portant sur : ' + r.postes.map(function (p) { return p.label.toLowerCase(); }).join(', ') : '') + '.');
    phr.push(manquants.length + ' mention(s) importante(s) manquante(s), ' + alertes.length + ' point(s) à vérifier, ' + r.flous.length + ' zone(s) floue(s), ' + r.omissions.length + ' oubli(s) fréquent(s).');
    if (r.acces && r.acces.alerte) phr.push(r.acces.type + ' facturé' + (r.acces.accord || '') + (r.acces.cout ? ' ' + fmtEur(r.acces.cout) + ' HT' : '') + ' : intervention sur cordes à comparer' + (r.acces.economieMin ? ' (économie indicative ' + fmtEur(r.acces.economieMin) + ' à ' + fmtEur(r.acces.economieMax) + ' HT)' : '') + '.');
    r.resume = phr.join(' ');
    return r;
  }

  function fmtEur(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0 ]/g, '\u00a0') + '\u00a0€'; // espaces insécables
  }

  return { analyser: analyser, montantLigne: montantLigne, parseNombre: parseNombre, luhn: luhn, fmtEur: fmtEur, norm: norm };
});
