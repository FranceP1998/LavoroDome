/* Motore di calcolo: ferie, permessi / ex festività, banca ore.
   Funziona sia nel browser (window.Engine) sia in Node (per i test). */
(function (root) {
  'use strict';

  var MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
    'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

  var DEFAULT_SETTINGS = { oreGiorno: 5.5, oreTurno: 8, rateFerie: 11.94, ratePermessi: 2.75 };

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
    if (pa && !out.years[pa.anno] && pa.pagaGennaio && pa.pagaGennaio.attivo) {
      out.years[pa.anno] = {
        ferieGod: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        permGod: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        bancaMat: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        bancaGod: { v: new Array(12).fill(null), span: new Array(12).fill(null) },
        apertura: { ferie: null, perm: null, banca: null },
        pagamentoGennaio: pa.permPagati
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

  var Engine = {
    MESI: MESI, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    parseNum: parseNum, fmt: fmt, giorni: giorni, turni: turni, r2: r2,
    key: key, parseKey: parseKey, monthLabel: monthLabel, settingsOf: settingsOf,
    sortedKeys: sortedKeys, latestReal: latestReal, statoAdesso: statoAdesso,
    prossimoAnno: prossimoAnno, controllaRecord: controllaRecord, mensili: mensili,
    anniConDati: anniConDati, perFoglio: perFoglio, datiIniziali: datiIniziali,
    pagamentoGennaio: pagamentoGennaio, annoPrec: annoPrec
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
