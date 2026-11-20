/* Motore di calcolo: ferie, permessi / ex festività, banca ore.
   Funziona sia nel browser (window.Engine) sia in Node (per i test). */
(function (root) {
  'use strict';

  var MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
    'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

  var DEFAULT_SETTINGS = { oreGiorno: 5.5, oreTurno: 8, rateFerie: 11.94, ratePermessi: 2.75,
    domenicaGratis: true, festivitaComePermessi: true };

  function r2(x) { return Math.round(x * 100) / 100; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  /* "1.234,50" / "12,5" / "12.5" -> numero, oppure null se vuoto o non valido */
  function parseNum(s) {
    if (s === null || s === undefined) return null;
    if (isNum(s)) return s;
    s = String(s).trim().replace(/\s/g, '').replace('−', '-');
    if (s === '') return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function fmt(n, dec) {
    if (!isNum(n)) return '–';
    if (dec === undefined) dec = 2;
    var s = (Math.abs(n) < 0.005 ? 0 : n).toFixed(dec).replace('.', ',');
    return s;
  }

  /* giorni interi per difetto (ore / ore di un giorno) */
  function giorni(ore, oreGiorno) { return Math.floor(Math.round(ore / oreGiorno * 1e6) / 1e6); }
  /* turni interi, troncati verso lo zero */
  function turni(ore, oreTurno) { return Math.trunc(Math.round(ore / oreTurno * 1e6) / 1e6); }

  function key(y, m) { return y + '-' + (m < 10 ? '0' : '') + m; }
  function parseKey(k) { var p = k.split('-'); return { y: +p[0], m: +p[1] }; }
  function monthLabel(k) { var p = parseKey(k); return MESI[p.m - 1] + ' ' + p.y; }

  function settingsOf(data) {
    var s = Object.assign({}, DEFAULT_SETTINGS, (data && data.settings) || {});
    return s;
  }

  function sortedKeys(data) { return Object.keys(data.records || {}).sort(); }
  function isReal(rec) { return rec && !rec.seed; }

  /* Ultimo mese con una busta paga vera (non ricostruita) */
  function latestReal(data) {
    var ks = sortedKeys(data).filter(function (k) { return isReal(data.records[k]); });
    return ks.length ? ks[ks.length - 1] : null;
  }

  /* ----- stato "adesso" di un blocco (ferie, perm, banca) in base all'ultima busta paga ----- */
  var BLOCKS = ['ferie', 'perm', 'banca'];

  function statoBlocco(rec, name, month, set) {
    var b = (rec && rec[name]) || {};
    var prec = isNum(b.prec) ? b.prec : 0;
    var mat = isNum(b.mat) ? b.mat : 0;
    var god = isNum(b.god) ? b.god : 0;
    var pag = isNum(b.pag) ? b.pag : 0;
    var calc = r2(prec + mat - god - pag);
    var res = isNum(b.res) ? b.res : calc;
    var out = { prec: prec, mat: mat, god: god, pag: pag, res: res, calcolato: calc, diff: r2(calc - res) };
    if (name !== 'banca') {
      var pos = Math.max(prec, 0);
      var usati = Math.min(Math.max(god, 0), pos);
      var rimasti = Math.max(0, r2(pos - usati - pag));
      out.arretratiUsati = r2(usati);
      out.arretratiRimasti = rimasti;
      var rate = name === 'ferie' ? set.rateFerie : set.ratePermessi;
      out.fineAnno = r2(res + (12 - month) * rate);
    } else {
      out.fineAnno = res;
    }
    return out;
  }

  /* ----- apertura di un anno: da busta paga di gennaio o dalla proiezione dell'anno prima ----- */

  function statoAdesso(data) {
    var set = settingsOf(data);
    var k = latestReal(data);
    if (!k) return null;
    var p = parseKey(k), rec = data.records[k];
    var st = { key: k, anno: p.y, mese: p.m, label: monthLabel(k), set: set };
    BLOCKS.forEach(function (n) { st[n] = statoBlocco(rec, n, p.m, set); });
    return st;
  }

  /* Cosa avrà a gennaio dell'anno dopo (se non usa altro): arretrati e pagamento permessi */
  function prossimoAnno(data) {
    var st = statoAdesso(data);
    if (!st) return null;
    var set = st.set, anno = st.anno + 1;
    var pg = (data.pagaGennaio && data.pagaGennaio[String(anno)]) || { attivo: false, ore: null };
    var ferie = Math.max(0, st.ferie.fineAnno);
    var permTot = Math.max(0, st.perm.fineAnno);
    var pagare = 0;
    if (pg.attivo) pagare = isNum(pg.ore) ? Math.min(Math.max(pg.ore, 0), permTot) : permTot;
    pagare = r2(pagare);
    return {
      anno: anno,
      ferieArretrati: r2(ferie),
      permArretratiTot: r2(permTot),
      permPagati: pagare,
      permArretratiRimasti: r2(permTot - pagare),
      bancaOre: st.banca.fineAnno,
      pagaGennaio: pg,
      scadenza: '31 marzo ' + anno
    };
  }

  /* ----- controlli sulla busta paga inserita ----- */
  function controllaRecord(rec) {
    var problemi = [];
    var nomi = { ferie: 'Ferie', perm: 'Permessi / ex festività', banca: 'Banca ore' };
    BLOCKS.forEach(function (n) {
      var b = rec[n];
      if (!b) return;
      if (isNum(b.res) && isNum(b.prec) && isNum(b.mat) && isNum(b.god)) {
        var calc = r2(b.prec + b.mat - b.god - (b.pag || 0));
        var d = r2(calc - b.res);
        if (Math.abs(d) > 0.01) {
          problemi.push({ blocco: n, diff: d, testo: nomi[n] + ': anni precedenti + maturati − goduti' +
            (b.pag ? ' − pagati' : '') + ' fa ' + fmt(calc) + ', ma il residuo scritto è ' + fmt(b.res) +
            ' (differenza ' + fmt(d) + ' ore).' });
        }
      }
    });
    return problemi;
  }

  /* ----- differenze mese per mese (per lo storico e per il Google Fogli) ----- */
  function seriesCum(data, year, name, field) {
    var out = {};
    sortedKeys(data).forEach(function (k) {
      var p = parseKey(k);
      if (p.y !== year) return;
      var b = data.records[k][name];
      if (b && isNum(b[field])) out[p.m] = b[field];
    });
    return out;
  }

  function deltas(cum) {
    // cum: { mese: valore cumulato da gennaio } -> { mese: {val, span} }
    var res = {}, prevM = 0, prevV = 0;
    for (var m = 1; m <= 12; m++) {
      if (cum[m] === undefined) continue;
      res[m] = { val: r2(cum[m] - prevV), span: m - prevM };
      prevM = m; prevV = cum[m];
    }
    return res;
  }

  function annoPrec(data, year, name) {
    var ks = sortedKeys(data);
    for (var i = 0; i < ks.length; i++) {
      var p = parseKey(ks[i]);
      if (p.y !== year) continue;
      var b = data.records[ks[i]][name];
      if (b && isNum(b.prec)) return b.prec;
    }
    return null;
  }

  function mensili(data, year) {
    var o = {
      ferieGod: deltas(seriesCum(data, year, 'ferie', 'god')),
      permGod: deltas(seriesCum(data, year, 'perm', 'god')),
      permPag: deltas(seriesCum(data, year, 'perm', 'pag')),
      bancaMat: deltas(seriesCum(data, year, 'banca', 'mat')),
      bancaGod: deltas(seriesCum(data, year, 'banca', 'god'))
    };
    return o;
  }

  function anniConDati(data) {
    var s = {};
    sortedKeys(data).forEach(function (k) { s[parseKey(k).y] = true; });
    return Object.keys(s).map(Number).sort();
  }

  /* Pagamento permessi a gennaio, in ore, per un dato anno (usato dal Google Fogli) */
  function pagamentoGennaio(data, year) {
    var pg = (data.pagaGennaio && data.pagaGennaio[String(year)]);
    if (!pg || !pg.attivo) return 0;
    var set = settingsOf(data);
    var ks = sortedKeys(data), apertura = null;
    var aperturaAnno = annoPrec(data, year, 'perm');
    if (aperturaAnno !== null) apertura = Math.max(0, aperturaAnno);
    else {
      var pa = prossimoAnno(data);
      if (pa && pa.anno === year) apertura = pa.permArretratiTot;
    }
    if (apertura === null) return isNum(pg.ore) ? pg.ore : 0;
    return r2(isNum(pg.ore) ? Math.min(pg.ore, apertura) : apertura);
  }

  /* Dati pronti da scrivere nel Google Fogli: array da 12 (null = vuoto) */
  function perFoglio(data) {
    var out = { years: {} };
    anniConDati(data).forEach(function (y) {
      var md = mensili(data, y);
      function arr(d, f) {
        var a = [], span = [];
        for (var m = 1; m <= 12; m++) {
          a.push(d[m] ? d[m][f || 'val'] : null);
          span.push(d[m] ? d[m].span : null);
        }
        return { v: a, span: span };
      }
      out.years[y] = {
        ferieGod: arr(md.ferieGod), permGod: arr(md.permGod),
        bancaMat: arr(md.bancaMat), bancaGod: arr(md.bancaGod),
        apertura: { ferie: annoPrec(data, y, 'ferie'), perm: annoPrec(data, y, 'perm'), banca: annoPrec(data, y, 'banca') },
        pagamentoGennaio: pagamentoGennaio(data, y)
      };
    });
    // anno successivo senza ancora buste paga: serve solo il pagamento previsto
    var pa = prossimoAnno(data);
    // (anche quando è spento: così il foglio viene svuotato se cambi idea)
    if (pa && !out.years[pa.anno]) {
      out.years[pa.anno] = {
        ferieGod: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        permGod: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        bancaMat: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        bancaGod: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        apertura: { ferie: null, perm: null, banca: null },
        pagamentoGennaio: pa.pagaGennaio && pa.pagaGennaio.attivo ? pa.permPagati : 0
      };
    }
    return out;
  }

  /* ----- dati iniziali: ricostruiti dal prospetto della cooperativa (gen-set 2026) + busta paga di ottobre ----- */
  function datiIniziali() {
    var records = {};
    var ferieCum = [16.5, 16.5, 16.5, 16.5, 16.5, 38.5, 71.5, 121, 137.5];
    var permCum = [22, 22, 22, 22, 22, 22, 22, 33, 33];
    for (var i = 0; i < 9; i++) {
      records[key(2026, i + 1)] = { seed: true, ferie: { god: ferieCum[i] }, perm: { god: permCum[i] } };
    }
    records['2026-10'] = {
      ferie: { prec: 19.19, mat: 119.40, god: 137.50, res: 1.09 },
      perm: { prec: 24.61, mat: 27.50, god: 33.00, res: 19.11 },
      banca: { prec: -10.50, mat: 69.00, god: 58.00, res: 0.50 }
    };
    return {
      v: 1, updatedAt: '2026-11-19T22:00:00.000Z',
      settings: Object.assign({}, DEFAULT_SETTINGS),
      pagaGennaio: {},
      records: records
    };
  }


  /* ================= PIANIFICAZIONE FERIE ================= */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseDate(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function dow(s) { var p = parseDate(s); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); } // 0 = domenica
  function addDays(s, n) {
    var p = parseDate(s), d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function pasqua(y) { // calendario gregoriano
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), mese = Math.floor((h + l - 7 * m + 114) / 31),
      giorno = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, mese, giorno);
  }
  /* festività nazionali italiane + quelle extra aggiunte (es. patrono) -> { 'AAAA-MM-GG': nome } */
  function festivita(y, extra) {
    var o = {};
    o[ymd(y, 1, 1)] = 'Capodanno'; o[ymd(y, 1, 6)] = 'Epifania';
    o[pasqua(y)] = 'Pasqua'; o[addDays(pasqua(y), 1)] = 'Lunedì dell’Angelo';
    o[ymd(y, 4, 25)] = 'Liberazione'; o[ymd(y, 5, 1)] = 'Festa del lavoro'; o[ymd(y, 6, 2)] = 'Festa della Repubblica';
    o[ymd(y, 8, 15)] = 'Ferragosto'; o[ymd(y, 11, 1)] = 'Ognissanti'; o[ymd(y, 12, 8)] = 'Immacolata';
    o[ymd(y, 12, 25)] = 'Natale'; o[ymd(y, 12, 26)] = 'Santo Stefano';
    (extra || []).forEach(function (x) {
      if (x && x.data && parseDate(x.data).y === y) o[x.data] = x.nome || 'Festività locale';
    });
    return o;
  }
  var GIORNI_SETT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

  /* Espande un periodo in giorni, con le regole provvisorie:
     - domenica dentro un periodo: gratis
     - festività dentro un periodo di ferie: conta come permesso invece che come ferie */
  function espandiPeriodo(p, set, extra) {
    var out = { giorni: [], ferieOre: 0, permOre: 0, ferieGg: 0, permGg: 0, domenicheGratis: 0, festivitaGg: 0 };
    if (p.tipo === 'permOre') {
      var h = isNum(p.ore) ? p.ore : 0;
      out.giorni.push({ data: p.da, cat: 'perm', ore: h, tipo: 'permesso a ore' });
      out.permOre = h;
      return out;
    }
    if (!p.da || !p.a || p.a < p.da) return out;
    var d = p.da, guard = 0;
    var cache = {};
    while (d <= p.a && guard++ < 400) {
      var y = parseDate(d).y;
      var fest = cache[y] || (cache[y] = festivita(y, extra));
      var isDom = dow(d) === 0, nomeFest = fest[d];
      if (isDom && set.domenicaGratis) {
        out.domenicheGratis++;
        out.giorni.push({ data: d, cat: null, ore: 0, tipo: 'domenica (non conta)' });
      } else if (p.tipo === 'ferie' && nomeFest && set.festivitaComePermessi) {
        out.festivitaGg++; out.permGg++; out.permOre += set.oreGiorno;
        out.giorni.push({ data: d, cat: 'perm', ore: set.oreGiorno, tipo: nomeFest + ' (conta come permesso)' });
      } else if (p.tipo === 'ferie') {
        out.ferieGg++; out.ferieOre += set.oreGiorno;
        out.giorni.push({ data: d, cat: 'ferie', ore: set.oreGiorno, tipo: 'ferie' });
      } else { // permesso a giorni
        out.permGg++; out.permOre += set.oreGiorno;
        out.giorni.push({ data: d, cat: 'perm', ore: set.oreGiorno, tipo: 'permesso' });
      }
      d = addDays(d, 1);
    }
    return out;
  }

  /* Simula mese per mese dall'ultima busta paga fino a dicembre di annoTarget.
     Restituisce la previsione dell'anno e il dettaglio dei periodi pianificati. */
  function previsione(data, annoTarget) {
    var st = statoAdesso(data);
    if (!st || annoTarget < st.anno) return null;
    var set = st.set, extra = data.festivitaExtra || [];
    var piano = data.piano || [];
    var det = piano.map(function (p) { return { p: p, e: espandiPeriodo(p, set, extra) }; });
    // eventi (giorni che contano) per mese
    var ev = {};
    det.forEach(function (x) {
      x.e.giorni.forEach(function (g) {
        if (!g.cat || !g.ore) return;
        var dd = parseDate(g.data), k = dd.y + '-' + pad(dd.m);
        (ev[k] = ev[k] || []).push(g);
      });
    });
    var fRes = st.ferie.res, pRes = st.perm.res, fArr = st.ferie.arretratiRimasti, pArr = st.perm.arretratiRimasti;
    var y = st.anno, m = st.mese;
    var out = { anno: annoTarget, mesi: [], apertura: null, marzo: null, pagamento: 0, set: set,
      pianificato: { ferieOre: 0, permOre: 0, ferieGg: 0, permGg: 0, festivitaGg: 0 }, dettaglio: [] };
    while (!(y === annoTarget && m === 12)) {
      m++; if (m === 13) { m = 1; y++; }
      var k = y + '-' + pad(m);
      if (m === 1) { // passaggio d'anno: i residui diventano arretrati
        fArr = Math.max(0, fRes); pArr = Math.max(0, pRes);
        if (y === annoTarget) out.apertura = { ferieArretrati: r2(fArr), permArretrati: r2(pArr) };
      }
      fRes += set.rateFerie; pRes += set.ratePermessi;
      (ev[k] || []).sort(function (a, b) { return a.data < b.data ? -1 : 1; }).forEach(function (g) {
        if (g.cat === 'ferie') { fRes -= g.ore; fArr -= Math.min(Math.max(fArr, 0), g.ore); }
        else { pRes -= g.ore; pArr -= Math.min(Math.max(pArr, 0), g.ore); }
        if (y === annoTarget) {
          if (g.cat === 'ferie') { out.pianificato.ferieOre += g.ore; out.pianificato.ferieGg++; }
          else { out.pianificato.permOre += g.ore; out.pianificato.permGg++; if (/conta come permesso/.test(g.tipo)) out.pianificato.festivitaGg++; }
        }
      });
      if (m === 1) { // pagamento dei permessi arretrati rimasti a fine gennaio
        var pg = data.pagaGennaio && data.pagaGennaio[String(y)];
        if (pg && pg.attivo) {
          var pay = isNum(pg.ore) ? Math.min(Math.max(pg.ore, 0), Math.max(pArr, 0)) : Math.max(pArr, 0);
          pay = r2(pay); pArr -= pay; pRes -= pay;
          if (y === annoTarget) out.pagamento = pay;
        }
      }
      if (m === 3 && y === annoTarget) out.marzo = { ferie: r2(Math.max(0, fArr)), perm: r2(Math.max(0, pArr)) };
      if (y === annoTarget) out.mesi.push({ m: m, ferie: r2(fRes), perm: r2(pRes) });
    }
    out.fineAnno = { ferie: r2(fRes), perm: r2(pRes) };
    out.pianificato.ferieOre = r2(out.pianificato.ferieOre); out.pianificato.permOre = r2(out.pianificato.permOre);
    out.maturano = { ferie: r2(12 * set.rateFerie), perm: r2(12 * set.ratePermessi) };
    if (annoTarget === st.anno) { out.maturano = { ferie: r2((12 - st.mese) * set.rateFerie), perm: r2((12 - st.mese) * set.ratePermessi) }; }
    out.dettaglio = det.filter(function (x) {
      var a = parseDate(x.p.da).y, b = parseDate(x.p.a || x.p.da).y; return a <= annoTarget && b >= annoTarget;
    });
    return out;
  }

  function etichettaPeriodo(p) {
    var a = parseDate(p.da), b = parseDate(p.a || p.da);
    if (p.tipo === 'permOre' || p.da === p.a) return a.d + ' ' + MESI[a.m - 1].toLowerCase() + ' ' + a.y;
    if (a.y === b.y && a.m === b.m) return a.d + '–' + b.d + ' ' + MESI[a.m - 1].toLowerCase() + ' ' + a.y;
    if (a.y === b.y) return a.d + ' ' + MESI[a.m - 1].toLowerCase() + ' – ' + b.d + ' ' + MESI[b.m - 1].toLowerCase() + ' ' + a.y;
    return a.d + ' ' + MESI[a.m - 1].toLowerCase() + ' ' + a.y + ' – ' + b.d + ' ' + MESI[b.m - 1].toLowerCase() + ' ' + b.y;
  }

  var Engine = {
    MESI: MESI, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    parseNum: parseNum, fmt: fmt, giorni: giorni, turni: turni, r2: r2,
    key: key, parseKey: parseKey, monthLabel: monthLabel, settingsOf: settingsOf,
    sortedKeys: sortedKeys, latestReal: latestReal, statoAdesso: statoAdesso,
    prossimoAnno: prossimoAnno, controllaRecord: controllaRecord, mensili: mensili,
    anniConDati: anniConDati, perFoglio: perFoglio, datiIniziali: datiIniziali,
    pagamentoGennaio: pagamentoGennaio, annoPrec: annoPrec,
    festivita: festivita, espandiPeriodo: espandiPeriodo, previsione: previsione, etichettaPeriodo: etichettaPeriodo,
    pasqua: pasqua, dow: dow, GIORNI_SETT: GIORNI_SETT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
