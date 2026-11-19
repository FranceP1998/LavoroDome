(function () {
  'use strict';
  var E = window.Engine, CFG = window.CONFIG || {};
  var LS_DATA = 'fp_data_v1', LS_DIRTY = 'fp_dirty_v1';
  var data, tab = 'oggi', editKey = null, syncState = 'locale', planYear = null, editPlan = null;

  /* ---------- utilità ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f(n) { return E.fmt(n); }
  function fp(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
  function plural(n, s, p) { return n === 1 ? s : p; }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast on';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } }

  /* ---------- dati e sincronizzazione ---------- */
  function loadLocal() {
    var raw = lsGet(LS_DATA);
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* ripiega sui dati iniziali */ } }
    return null;
  }
  function saveLocal() { lsSet(LS_DATA, JSON.stringify(data)); }

  function setSync(s) {
    syncState = s;
    var el = $('#sync'), t = {
      ok: 'Salvato su Google ✓', invio: 'Salvataggio in corso…', offline: 'Da salvare su Google (manca internet)',
      errore: 'Non riesco a salvare su Google', locale: 'Solo su questo telefono', carico: 'Controllo i dati…'
    };
    el.textContent = t[s] || s;
  }

  function endpoint() { return (CFG.SCRIPT_URL || '').trim(); }

  function remoteGet() {
    return fetch(endpoint() + '?action=get', { method: 'GET', redirect: 'follow' })
      .then(function (r) { return r.json(); });
  }

  function remotePush() {
    if (!endpoint()) { setSync('locale'); return Promise.resolve(false); }
    setSync('invio');
    var body = JSON.stringify({ action: 'save', data: data, sheet: E.perFoglio(data) });
    return fetch(endpoint(), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'errore');
        lsSet(LS_DIRTY, '0');
        setSync('ok');
        if (j.sheetOk === false) toast('Dati salvati, ma il Google Fogli non si è aggiornato: ' + (j.sheetError || ''));
        return true;
      })
      .catch(function () {
        lsSet(LS_DIRTY, '1');
        setSync(navigator.onLine ? 'errore' : 'offline');
        return false;
      });
  }

  function commit(msg) {
    data.updatedAt = new Date().toISOString();
    saveLocal(); lsSet(LS_DIRTY, '1');
    render();
    return remotePush().then(function (ok) { if (msg) toast(ok || !endpoint() ? msg : msg + ' (salvato sul telefono)'); });
  }

  function init() {
    data = loadLocal();
    var first = !data;
    if (!data) data = E.datiIniziali();
    if (!endpoint()) { setSync('locale'); saveLocal(); render(); return; }
    setSync('carico'); render();
    remoteGet().then(function (j) {
      var dirty = lsGet(LS_DIRTY) === '1';
      if (j && j.ok && j.data && j.data.records) {
        var rem = j.data;
        if (dirty && data.updatedAt && data.updatedAt > rem.updatedAt) { saveLocal(); return remotePush(); }
        data = rem; saveLocal(); lsSet(LS_DIRTY, '0'); setSync('ok');
      } else { // il file su Drive non esiste ancora: lo creo con i dati che ho
        saveLocal(); return remotePush();
      }
    }).catch(function () {
      setSync(navigator.onLine ? 'errore' : 'offline');
    }).then(render);
    void first;
  }
  window.addEventListener('online', function () { if (lsGet(LS_DIRTY) === '1' && endpoint()) remotePush(); });

  /* ---------- schermata OGGI ---------- */
  function cardRisorsa(titolo, st, kind, set) {
    var gi = E.giorni(st.res, set.oreGiorno), gf = E.giorni(st.fineAnno, set.oreGiorno);
    var h = '<div class="card"><h2>' + titolo + '</h2>';
    h += '<div class="big">' + gi + ' <small>' + plural(gi, 'giorno', 'giorni') + '</small></div>';
    h += '<p class="sub">' + f(st.res) + ' ore in tutto · 1 giorno = ' + fp(set.oreGiorno) + ' ore</p>';
    h += '<div class="rows">';
    h += '<div class="row"><span>Maturati quest’anno</span><b>' + f(st.mat) + ' ore</b></div>';
    var godGg = E.giorni(st.god, set.oreGiorno);
    h += '<div class="row"><span>Goduti quest’anno</span><b>' + godGg + ' gg · ' + f(st.god) + ' ore</b></div>';
    if (st.prec > 0) {
      var arrGg = Math.min(E.giorni(st.arretratiUsati, set.oreGiorno), godGg);
      var annoOre = Math.max(0, E.r2(st.god - st.arretratiUsati));
      h += '<div class="row sub2"><span>di cui dell’anno scorso</span><b>' + arrGg + ' gg · ' + f(st.arretratiUsati) + ' ore</b></div>';
      h += '<div class="row sub2"><span>di cui di quest’anno</span><b>' + (godGg - arrGg) + ' gg · ' + f(annoOre) + ' ore</b></div>';
    }
    if (st.arretratiRimasti > 0) {
      h += '<div class="row"><span>Arretrati ancora da usare</span><b>' + f(st.arretratiRimasti) + ' ore (' + E.giorni(st.arretratiRimasti, set.oreGiorno) + ' gg)</b></div>';
    }
    h += '<div class="row"><span>A dicembre, se non usi altro</span><b>' + gf + ' gg · ' + f(st.fineAnno) + ' ore</b></div>';
    h += '</div>';
    if (Math.abs(st.diff) > 0.01) h += '<div class="note bad">Attenzione: i numeri di questa busta paga non tornano tra loro (differenza ' + f(st.diff) + ' ore). Controlla in “Inserisci”.</div>';
    return h + '</div>';
  }

  function cardBanca(st, set) {
    var t = E.turni(st.res, set.oreTurno), tf = E.turni(st.fineAnno, set.oreTurno);
    var h = '<div class="card"><h2>Banca ore</h2>';
    h += '<div class="big">' + f(st.res) + ' <small>ore</small></div>';
    if (st.res < -0.004) {
      h += '<p class="sub">Sei in debito di ' + f(-st.res) + ' ore: sono ' + (-t) + ' ' + plural(-t, 'turno intero', 'turni interi') + ' da ' + fp(set.oreTurno) + ' ore da recuperare.</p>';
    } else {
      h += '<p class="sub">Equivalgono a ' + t + ' ' + plural(t, 'turno intero', 'turni interi') + ' da ' + fp(set.oreTurno) + ' ore.</p>';
    }
    h += '<div class="rows">';
    h += '<div class="row"><span>Anni precedenti</span><b>' + f(st.prec) + ' ore</b></div>';
    h += '<div class="row"><span>Maturate da gennaio</span><b>' + f(st.mat) + ' ore</b></div>';
    h += '<div class="row"><span>Godute da gennaio</span><b>' + f(st.god) + ' ore</b></div>';
    h += '</div>';
    if (Math.abs(st.diff) > 0.01) h += '<div class="note bad">Attenzione: i numeri della banca ore non tornano tra loro (differenza ' + f(st.diff) + ' ore).</div>';
    void tf;
    return h + '</div>';
  }

  function cardProssimoAnno(pa, set) {
    var pg = pa.pagaGennaio || {};
    var h = '<div class="card"><h2>A gennaio ' + pa.anno + '</h2>';
    h += '<p class="sub" style="margin:0 0 8px">Se da qui a dicembre non usi altre ore, i residui di fine anno diventano arretrati, da usare entro il ' + pa.scadenza + '.</p>';
    h += '<div class="rows">';
    h += '<div class="row"><span>Ferie arretrate</span><b>' + f(pa.ferieArretrati) + ' ore (' + E.giorni(pa.ferieArretrati, set.oreGiorno) + ' gg)</b></div>';
    h += '<div class="row"><span>Permessi arretrati</span><b>' + f(pa.permArretratiTot) + ' ore (' + E.giorni(pa.permArretratiTot, set.oreGiorno) + ' gg)</b></div>';
    h += '</div>';
    h += '<div class="sect">Permessi: pagamento in busta paga</div>';
    h += '<label class="switch" style="margin:0;color:var(--ink);font-size:15px"><span>Voglio farmi pagare a gennaio i permessi arretrati</span><input type="checkbox" id="pgOn"' + (pg.attivo ? ' checked' : '') + '></label>';
    if (pg.attivo) {
      var tutti = !(typeof pg.ore === 'number');
      h += '<div class="opt"><input type="radio" name="pgTipo" id="pgTutti" value="tutti"' + (tutti ? ' checked' : '') + '><label for="pgTutti" style="margin:0;color:var(--ink);font-size:15px">Tutti (' + f(pa.permArretratiTot) + ' ore)</label></div>';
      h += '<div class="opt"><input type="radio" name="pgTipo" id="pgAlcuni" value="alcuni"' + (!tutti ? ' checked' : '') + '><label for="pgAlcuni" style="margin:0;color:var(--ink);font-size:15px">Solo alcune ore</label></div>';
      if (!tutti) h += '<div class="fld"><input type="text" inputmode="decimal" id="pgOre" value="' + (typeof pg.ore === 'number' ? String(pg.ore).replace('.', ',') : '') + '" placeholder="Quante ore?"></div>';
      h += '<div class="note info">Ti verranno pagate <b>' + f(pa.permPagati) + ' ore</b>. Ti restano <b>' + f(pa.permArretratiRimasti) + ' ore</b> (' + E.giorni(pa.permArretratiRimasti, set.oreGiorno) + ' gg) di permessi da usare entro il ' + pa.scadenza + '.</div>';
    } else {
      h += '<p class="hint">Non attivo: i permessi arretrati restano da usare entro il ' + pa.scadenza + '.</p>';
    }
    h += '<button class="secondary" id="vaiPiano" style="width:100%;margin-top:14px">Pianifica le ferie del ' + pa.anno + '</button>';
    return h + '</div>';
  }

  function viewOggi() {
    var st = E.statoAdesso(data);
    if (!st) return '<div class="card"><h2>Nessun dato</h2><p class="sub">Inserisci la prima busta paga nella scheda “Inserisci”.</p></div>';
    $('#aggiornato').textContent = 'Aggiornato alla busta paga di ' + st.label;
    var set = st.set, h = '';
    h += cardRisorsa('Ferie', st.ferie, 'ferie', set);
    h += cardRisorsa('Permessi / ex festività', st.perm, 'perm', set);
    h += cardBanca(st.banca, set);
    var pa = E.prossimoAnno(data);
    if (pa) h += cardProssimoAnno(pa, set);
    return h;
  }

  function bindOggi() {
    var vp = $('#vaiPiano');
    if (vp) vp.addEventListener('click', function () { planYear = E.prossimoAnno(data).anno; editPlan = null; tab = 'pianifica'; render(); window.scrollTo(0, 0); });
    var on = $('#pgOn');
    if (!on) return;
    var anno = E.prossimoAnno(data).anno;
    function setPg(p) { data.pagaGennaio = data.pagaGennaio || {}; data.pagaGennaio[String(anno)] = p; commit('Salvato'); }
    on.addEventListener('change', function () { setPg({ attivo: on.checked, ore: null }); });
    var t = $('#pgTutti'), a = $('#pgAlcuni');
    if (t) t.addEventListener('change', function () { setPg({ attivo: true, ore: null }); });
    if (a) a.addEventListener('change', function () { setPg({ attivo: true, ore: 0 }); });
    var ore = $('#pgOre');
    if (ore) ore.addEventListener('change', function () {
      var n = E.parseNum(ore.value);
      if (n === null || n < 0) { toast('Scrivi un numero di ore'); return; }
      setPg({ attivo: true, ore: n });
    });
  }

  /* ---------- schermata INSERISCI ---------- */
  function monthOptions(selKey) {
    var latest = E.latestReal(data), now = new Date(), y0 = 2026, h = '';
    var yEnd = Math.max(now.getFullYear(), latest ? E.parseKey(latest).y : y0) + 1;
    for (var y = y0; y <= yEnd; y++) for (var m = 1; m <= 12; m++) {
      var k = E.key(y, m), rec = data.records[k];
      var tag = rec && !rec.seed ? ' ✓' : '';
      h += '<option value="' + k + '"' + (k === selKey ? ' selected' : '') + '>' + E.monthLabel(k) + tag + '</option>';
    }
    return h;
  }

  function defaultKey() {
    var l = E.latestReal(data);
    if (!l) { var n = new Date(); return E.key(n.getFullYear(), n.getMonth() + 1); }
    var p = E.parseKey(l);
    return p.m === 12 ? E.key(p.y + 1, 1) : E.key(p.y, p.m + 1);
  }

  /* valori da mostrare nel modulo: quelli già inseriti, altrimenti gli "anni precedenti" del mese prima */
  function prefill(k) {
    var rec = data.records[k], out = { ferie: {}, perm: {}, banca: {} };
    if (rec && !rec.seed) { ['ferie', 'perm', 'banca'].forEach(function (n) { out[n] = Object.assign({}, rec[n] || {}); }); return out; }
    var ks = E.sortedKeys(data).filter(function (x) { return !data.records[x].seed && x < k; });
    var prev = ks.length ? data.records[ks[ks.length - 1]] : null;
    if (prev) {
      var pk = E.parseKey(ks[ks.length - 1]), cur = E.parseKey(k);
      ['ferie', 'perm', 'banca'].forEach(function (n) {
        if (pk.y === cur.y && prev[n] && typeof prev[n].prec === 'number') out[n].prec = prev[n].prec;
        else if (pk.y !== cur.y && prev[n] && typeof prev[n].res === 'number') out[n].prec = prev[n].res;
      });
    }
    return out;
  }

  function campo(id, label, val) {
    return '<div><label for="' + id + '">' + label + '</label><div class="fld"><input type="text" inputmode="decimal" autocomplete="off" id="' + id + '" value="' +
      (typeof val === 'number' ? esc(String(val).replace('.', ',')) : '') + '"><button type="button" class="pm" data-pm="' + id + '" aria-label="Cambia segno">±</button></div></div>';
  }

  function bloccoForm(pref, titolo, v, extra) {
    var h = '<div class="card"><h2>' + titolo + '</h2><div class="grid">';
    h += campo(pref + '_prec', 'Anni precedenti', v.prec);
    h += campo(pref + '_mat', 'Maturati', v.mat);
    h += campo(pref + '_god', 'Goduti', v.god);
    h += campo(pref + '_res', 'Residui', v.res);
    h += '</div>';
    if (extra) h += extra;
    return h + '<div id="chk_' + pref + '"></div></div>';
  }

  function viewInserisci() {
    var k = editKey || defaultKey();
    var v = prefill(k), p = E.parseKey(k);
    var pg = data.pagaGennaio && data.pagaGennaio[String(p.y)];
    var mostraPag = p.m === 1 || (pg && pg.attivo) || (v.perm && typeof v.perm.pag === 'number');
    var h = '<div class="card"><h2>Busta paga</h2>';
    h += '<label for="mese">Di quale mese è?</label><select id="mese">' + monthOptions(k) + '</select>';
    h += '<p class="hint">Copia i numeri dalla tabella dei <b>ratei</b> della busta paga, così come sono scritti (sono i totali da gennaio). Il segno ± serve per i numeri negativi.</p></div>';
    h += bloccoForm('ferie', 'Ferie', v.ferie);
    h += bloccoForm('perm', 'Permessi / ex festività', v.perm,
      mostraPag ? '<div class="grid">' + campo('perm_pag', 'Pagati in busta (se ci sono)', v.perm.pag) + '</div><p class="hint">Solo se in questa busta paga ti hanno pagato dei permessi arretrati.</p>' : '');
    h += bloccoForm('banca', 'Banca ore', v.banca);
    h += '<div id="chk_all"></div>';
    h += '<button class="primary" id="salva">Salva busta paga</button>';
    var esiste = data.records[k] && !data.records[k].seed;
    if (esiste) h += '<button class="secondary danger" id="elimina" style="width:100%;margin-top:10px">Elimina questa busta paga</button>';
    return h;
  }

  function leggiForm() {
    var rec = {}, mancanti = [];
    [['ferie', 'Ferie'], ['perm', 'Permessi'], ['banca', 'Banca ore']].forEach(function (b) {
      var o = {};
      [['prec', 'anni precedenti'], ['mat', 'maturati'], ['god', 'goduti'], ['res', 'residui']].forEach(function (c) {
        var el = $('#' + b[0] + '_' + c[0]), n = E.parseNum(el ? el.value : '');
        if (n === null) mancanti.push(b[1] + ': ' + c[1]); else o[c[0]] = n;
      });
      rec[b[0]] = o;
    });
    var pg = $('#perm_pag');
    if (pg) { var n = E.parseNum(pg.value); if (n !== null && n !== 0) rec.perm.pag = n; }
    return { rec: rec, mancanti: mancanti };
  }

  function aggiornaControlli() {
    var r = leggiForm(), rec = r.rec;
    ['ferie', 'perm', 'banca'].forEach(function (n) { var c = $('#chk_' + n); if (c) c.innerHTML = ''; });
    var pr = E.controllaRecord(rec);
    pr.forEach(function (p) { var c = $('#chk_' + p.blocco); if (c) c.innerHTML = '<div class="note bad">' + esc(p.testo) + '</div>'; });
    ['ferie', 'perm', 'banca'].forEach(function (n) {
      var b = rec[n];
      if (b && ['prec', 'mat', 'god', 'res'].every(function (x) { return typeof b[x] === 'number'; }) && !pr.some(function (p) { return p.blocco === n; })) {
        var c = $('#chk_' + n); if (c) c.innerHTML = '<div class="note good">I numeri tornano ✓</div>';
      }
    });
  }

  function bindInserisci() {
    var sel = $('#mese');
    sel.addEventListener('change', function () { editKey = sel.value; render(); });
    document.querySelectorAll('.fld input').forEach(function (i) { i.addEventListener('input', aggiornaControlli); });
    document.querySelectorAll('button.pm').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = $('#' + b.getAttribute('data-pm')), v = i.value.trim();
        i.value = v.charAt(0) === '-' ? v.slice(1) : '-' + v;
        aggiornaControlli(); i.focus();
      });
    });
    aggiornaControlli();
    $('#salva').addEventListener('click', function () {
      var r = leggiForm();
      if (r.mancanti.length) { toast('Manca: ' + r.mancanti[0] + (r.mancanti.length > 1 ? ' (e altri ' + (r.mancanti.length - 1) + ')' : '')); return; }
      var pr = E.controllaRecord(r.rec);
      if (pr.length && !confirm('Alcuni numeri non tornano tra loro:\n\n' + pr.map(function (p) { return '• ' + p.testo; }).join('\n') + '\n\nSalvo lo stesso?')) return;
      var k = sel.value;
      data.records[k] = r.rec;
      editKey = null; tab = 'oggi';
      commit('Busta paga di ' + E.monthLabel(k) + ' salvata');
    });
    var del = $('#elimina');
    if (del) del.addEventListener('click', function () {
      var k = sel.value;
      if (!confirm('Eliminare la busta paga di ' + E.monthLabel(k) + '?')) return;
      delete data.records[k]; editKey = null; tab = 'storico';
      commit('Busta paga eliminata');
    });
  }


  /* ---------- schermata PIANIFICA ---------- */
  var GS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  function ggS(h, set) { return h < 0 ? -E.giorni(-h, set.oreGiorno) : E.giorni(h, set.oreGiorno); }
  function dataBreve(s) { var p = s.split('-'); return GS[E.dow(s)] + ' ' + (+p[2]) + ' ' + E.MESI[+p[1] - 1].slice(0, 3).toLowerCase(); }
  function annoPiano() {
    var st = E.statoAdesso(data); if (!st) return null;
    if (planYear === null || planYear < st.anno) planYear = st.anno + 1;
    return planYear;
  }
  function descrPeriodo(p, e) {
    if (p.tipo === 'permOre') return 'Permesso a ore · ' + f(e.permOre) + ' ore';
    var parts = [];
    if (p.tipo === 'ferie') {
      parts.push('Ferie · ' + e.ferieGg + ' ' + plural(e.ferieGg, 'giorno', 'giorni') + ' (' + f(e.ferieOre) + ' ore)');
      if (e.festivitaGg) parts.push(e.festivitaGg + ' ' + plural(e.festivitaGg, 'festività conta', 'festività contano') + ' come permesso (' + f(e.permOre) + ' ore)');
    } else {
      parts.push('Permesso · ' + e.permGg + ' ' + plural(e.permGg, 'giorno', 'giorni') + ' (' + f(e.permOre) + ' ore)');
    }
    if (e.domenicheGratis) parts.push(e.domenicheGratis + ' ' + plural(e.domenicheGratis, 'domenica non conta', 'domeniche non contano'));
    return parts.join(' · ');
  }
  function speciali(e) {
    return e.giorni.filter(function (g) { return g.tipo !== 'ferie' && g.tipo !== 'permesso' && g.tipo !== 'permesso a ore'; })
      .map(function (g) { return dataBreve(g.data) + ': ' + g.tipo; });
  }

  function cardPrevisione(titolo, pv, kind, set, st, pa) {
    var fine = pv.fineAnno[kind], isF = kind === 'ferie';
    var pianOre = isF ? pv.pianificato.ferieOre : pv.pianificato.permOre, pianGg = isF ? pv.pianificato.ferieGg : pv.pianificato.permGg;
    var g = ggS(fine, set);
    function riga(l, ore, cls) { return '<div class="row' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b>' + ggS(ore, set) + ' gg · ' + f(ore) + ' ore</b></div>'; }
    var h = '<div class="card"><h2>' + titolo + ' · a dicembre ' + pv.anno + '</h2>';
    h += '<div class="big' + (fine < -0.004 ? ' neg' : '') + '">' + g + ' <small>' + plural(Math.abs(g), 'giorno che ti resta', 'giorni che ti restano') + '</small></div>';
    h += '<p class="sub">' + f(fine) + ' ore in tutto</p><div class="rows">';
    if (pv.apertura) {
      h += riga('Arretrati a gennaio', pv.apertura[kind + 'Arretrati']);
      h += riga('Maturano durante l’anno', pv.maturano[kind]);
    } else {
      h += riga('Hai adesso', st[kind].res);
      h += riga('Maturano fino a dicembre', pv.maturano[kind]);
    }
    if (!isF && pv.pagamento > 0) h += '<div class="row"><span>Pagati a gennaio in busta</span><b>− ' + f(pv.pagamento) + ' ore</b></div>';
    h += '<div class="row"><span>Pianificati</span><b>' + pianGg + ' gg · ' + f(pianOre) + ' ore</b></div>';
    if (!isF && pv.pianificato.festivitaGg) h += '<div class="row sub2"><span>di cui festività nelle ferie</span><b>' + pv.pianificato.festivitaGg + ' gg</b></div>';
    h += riga('Ti restano a dicembre', fine);
    h += '</div>';
    if (fine < -0.004) {
      h += '<div class="note bad">Con questo piano non bastano: mancano ' + f(-fine) + ' ore (' + (-g) + ' gg).</div>';
    } else {
      var neg = pv.mesi.filter(function (m) { return m[kind] < -0.004; });
      if (neg.length) h += '<div class="note">In ' + (neg.length === 1 ? E.MESI[neg[0].m - 1].toLowerCase() : 'alcuni mesi, da ' + E.MESI[neg[0].m - 1].toLowerCase() + ' a ' + E.MESI[neg[neg.length - 1].m - 1].toLowerCase()) +
        ' il saldo scende sotto zero: le ore maturano mese per mese, quindi quei giorni potrebbero non essere ancora disponibili.</div>';
    }
    if (pv.apertura && pv.marzo && pv.marzo[kind] > 0.004) {
      h += '<div class="note info">Promemoria: entro il ' + (pa ? pa.scadenza : '31 marzo') + ' risultano ancora da usare ' + f(pv.marzo[kind]) + ' ore (' + ggS(pv.marzo[kind], set) + ' gg) di ' + (isF ? 'ferie' : 'permessi') + ' arretrati.</div>';
    }
    return h + '</div>';
  }

  function formPeriodo(p, anno) {
    var tipo = p.tipo || 'ferie', da = p.da || (anno + '-01-02'), a = p.a || da;
    var isNew = !p.id;
    var h = '<div class="card"><h2>' + (isNew ? 'Nuovo periodo' : 'Modifica periodo') + '</h2>';
    h += '<label for="pTipo">Cosa vuoi pianificare?</label><select id="pTipo">' +
      '<option value="ferie"' + (tipo === 'ferie' ? ' selected' : '') + '>Ferie</option>' +
      '<option value="perm"' + (tipo === 'perm' ? ' selected' : '') + '>Permesso a giorni</option>' +
      '<option value="permOre"' + (tipo === 'permOre' ? ' selected' : '') + '>Permesso a ore</option></select>';
    h += '<div class="grid"><div><label for="pDa" id="lDa">' + (tipo === 'permOre' ? 'Giorno' : 'Dal') + '</label><input type="date" id="pDa" value="' + da + '"></div>';
    h += '<div id="boxA"' + (tipo === 'permOre' ? ' style="display:none"' : '') + '><label for="pA">Al (compreso)</label><input type="date" id="pA" value="' + a + '"></div>';
    h += '<div id="boxOre"' + (tipo === 'permOre' ? '' : ' style="display:none"') + '><label for="pOre">Quante ore?</label><input type="text" inputmode="decimal" id="pOre" value="' + (typeof p.ore === 'number' ? String(p.ore).replace('.', ',') : '') + '" placeholder="es. 3"></div></div>';
    h += '<label for="pNota">Nota (facoltativa)</label><input type="text" id="pNota" value="' + esc(p.nota || '') + '" placeholder="es. mare, matrimonio…">';
    h += '<div id="pPrev"></div>';
    h += '<button class="primary" id="pSalva">Salva</button>';
    h += '<div class="grid" style="margin-top:10px"><button class="secondary" id="pAnnulla">Annulla</button>' +
      (isNew ? '<span></span>' : '<button class="secondary danger" id="pElimina">Elimina</button>') + '</div>';
    return h + '</div>';
  }

  function viewPianifica() {
    var st = E.statoAdesso(data);
    if (!st) return '<div class="card"><h2>Nessun dato</h2><p class="sub">Inserisci prima una busta paga.</p></div>';
    var set = st.set, anno = annoPiano(), pv = E.previsione(data, anno), pa = E.prossimoAnno(data);
    if (pa && pa.anno !== anno) pa = null;
    var h = '<div class="card"><h2>Previsione</h2><label for="pAnno" style="margin-top:0">Anno</label><select id="pAnno">';
    [st.anno, st.anno + 1, st.anno + 2].forEach(function (y) { h += '<option value="' + y + '"' + (y === anno ? ' selected' : '') + '>' + y + (y === st.anno ? ' (fino a dicembre)' : '') + '</option>'; });
    h += '</select><p class="hint">Aggiungi i periodi già prenotati: qui sotto vedi quante ferie e permessi ti restano. ' +
      (set.domenicaGratis ? 'Le domeniche dentro un periodo non vengono contate. ' : '') +
      (set.festivitaComePermessi ? 'Le festività dentro le ferie contano come ore di permesso.' : '') + '</p></div>';
    h += cardPrevisione('Ferie', pv, 'ferie', set, st, pa);
    h += cardPrevisione('Permessi', pv, 'perm', set, st, pa);

    // elenco periodi
    var piano = (data.piano || []).slice().sort(function (x, y) { return x.da < y.da ? -1 : x.da > y.da ? 1 : 0; });
    var lastK = E.latestReal(data), lastP = E.parseKey(lastK), lastYM = lastP.y + '-' + (lastP.m < 10 ? '0' : '') + lastP.m;
    h += '<div class="card"><h2>Periodi pianificati</h2><div class="list">';
    if (!piano.length) h += '<p class="sub">Ancora nessun periodo.</p>';
    piano.forEach(function (p) {
      var e = E.espandiPeriodo(p, set, data.festivitaExtra || []);
      var fineP = (p.a || p.da), passato = fineP.slice(0, 7) <= lastYM;
      h += '<button class="item" data-id="' + esc(p.id) + '"><div class="t">' + E.etichettaPeriodo(p) + '</div><div class="d">' + descrPeriodo(p, e) +
        (p.nota ? ' · ' + esc(p.nota) : '') + (passato ? ' · già nelle buste paga, non conteggiato' : '') + '</div></button>';
    });
    h += '</div>';
    if (editPlan === null) h += '<button class="primary" id="pNuovo">+ Aggiungi periodo</button>';
    h += '</div>';
    if (editPlan !== null) {
      var cur = editPlan === 'new' ? {} : (data.piano || []).filter(function (p) { return p.id === editPlan; })[0] || {};
      h += formPeriodo(cur, anno);
    }

    // saldo mese per mese
    h += '<div class="card"><h2>Saldo a fine mese · ' + anno + '</h2><div class="scroll"><table><tr><th>Mese</th><th>Ferie<br>giorni</th><th>Ferie<br>ore</th><th>Permessi<br>giorni</th><th>Permessi<br>ore</th></tr>';
    pv.mesi.forEach(function (m) {
      function neg(v) { return v < -0.004 ? ' style="color:var(--bad)"' : ''; }
      h += '<tr><td>' + E.MESI[m.m - 1] + '</td><td' + neg(m.ferie) + '>' + ggS(m.ferie, set) + '</td><td' + neg(m.ferie) + '>' + f(m.ferie) + '</td><td' + neg(m.perm) + '>' + ggS(m.perm, set) + '</td><td' + neg(m.perm) + '>' + f(m.perm) + '</td></tr>';
    });
    h += '</table></div><p class="hint">Quanto ti resterebbe alla fine di ogni mese, se prendi i periodi pianificati e non altro.</p></div>';

    // festività locali
    var extra = data.festivitaExtra || [];
    var nazionali = E.festivita(anno, []), kk = Object.keys(nazionali).sort();
    h += '<div class="card"><h2>Festività del ' + anno + '</h2>';
    h += '<p class="hint" style="margin-top:0">Già considerate: ' + kk.map(function (d) { return dataBreve(d).replace(/^\S+ /, '') + ' ' + nazionali[d].toLowerCase(); }).join(', ') + '.</p>';
    extra.slice().sort(function (x, y) { return x.data < y.data ? -1 : 1; }).forEach(function (x, i) {
      h += '<div class="row"><span>' + dataBreve(x.data) + ' ' + x.data.slice(0, 4) + ' · ' + esc(x.nome || 'Festività locale') + '</span><button class="secondary danger" data-delfest="' + esc(x.data) + '" style="padding:4px 10px">Togli</button></div>';
    });
    h += '<div class="sect">Aggiungi una festività locale (es. patrono)</div><div class="grid"><div><input type="date" id="fData" value="' + anno + '-01-01"></div><div><input type="text" id="fNome" placeholder="Nome"></div></div>';
    h += '<button class="secondary" id="fAgg" style="width:100%;margin-top:10px">Aggiungi festività</button></div>';
    return h;
  }

  function bindPianifica() {
    var anno = annoPiano();
    var sel = $('#pAnno');
    if (sel) sel.addEventListener('change', function () { planYear = +sel.value; editPlan = null; render(); });
    document.querySelectorAll('#main .item').forEach(function (b) {
      b.addEventListener('click', function () { editPlan = b.getAttribute('data-id'); render(); var fm = $('#pTipo'); if (fm) fm.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    });
    var nuovo = $('#pNuovo');
    if (nuovo) nuovo.addEventListener('click', function () { editPlan = 'new'; render(); var fm = $('#pTipo'); if (fm) fm.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    var tipoEl = $('#pTipo');
    if (tipoEl) {
      var set = E.settingsOf(data);
      var leggi = function () {
        var t = tipoEl.value, p = { tipo: t, da: $('#pDa').value, nota: $('#pNota').value.trim() };
        if (t === 'permOre') { var o = E.parseNum($('#pOre').value); p.ore = o === null ? 0 : o; p.a = p.da; } else p.a = $('#pA').value;
        return p;
      };
      var aggiorna = function () {
        var t = tipoEl.value;
        $('#boxA').style.display = t === 'permOre' ? 'none' : '';
        $('#boxOre').style.display = t === 'permOre' ? '' : 'none';
        $('#lDa').textContent = t === 'permOre' ? 'Giorno' : 'Dal';
        var p = leggi(), box = $('#pPrev');
        if (!p.da || (t !== 'permOre' && (!p.a || p.a < p.da))) { box.innerHTML = t !== 'permOre' && p.da && p.a && p.a < p.da ? '<div class="note bad">La data finale è prima di quella iniziale.</div>' : ''; return; }
        var e = E.espandiPeriodo(p, set, data.festivitaExtra || []), sp = speciali(e);
        box.innerHTML = '<div class="note info">' + descrPeriodo(p, e) + (sp.length ? '<br>' + sp.map(esc).join('<br>') : '') + '</div>';
      };
      ['pTipo', 'pDa', 'pA', 'pOre', 'pNota'].forEach(function (id) { var el = $('#' + id); if (el) { el.addEventListener('input', aggiorna); el.addEventListener('change', aggiorna); } });
      // se si cambia la data iniziale e quella finale era uguale/precedente, la allineo
      $('#pDa').addEventListener('change', function () { var a = $('#pA'); if (a && (!a.value || a.value < this.value)) { a.value = this.value; aggiorna(); } });
      aggiorna();
      $('#pAnnulla').addEventListener('click', function () { editPlan = null; render(); });
      $('#pSalva').addEventListener('click', function () {
        var p = leggi();
        if (!p.da) { toast('Scegli la data'); return; }
        if (p.tipo === 'permOre') { if (!(p.ore > 0)) { toast('Scrivi quante ore di permesso'); return; } }
        else if (!p.a || p.a < p.da) { toast('Controlla le date'); return; }
        if (p.nota === '') delete p.nota;
        if (p.tipo !== 'permOre') delete p.ore;
        data.piano = data.piano || [];
        if (editPlan === 'new') { p.id = 'p' + Date.now().toString(36); data.piano.push(p); }
        else { var i = data.piano.findIndex(function (x) { return x.id === editPlan; }); p.id = editPlan; if (i >= 0) data.piano[i] = p; else data.piano.push(p); }
        editPlan = null;
        commit('Periodo salvato');
      });
      var del = $('#pElimina');
      if (del) del.addEventListener('click', function () {
        if (!confirm('Eliminare questo periodo?')) return;
        data.piano = (data.piano || []).filter(function (x) { return x.id !== editPlan; });
        editPlan = null; commit('Periodo eliminato');
      });
    }
    document.querySelectorAll('[data-delfest]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.getAttribute('data-delfest');
        data.festivitaExtra = (data.festivitaExtra || []).filter(function (x) { return x.data !== d; });
        commit('Festività tolta');
      });
    });
    var fa = $('#fAgg');
    if (fa) fa.addEventListener('click', function () {
      var d = $('#fData').value, n = $('#fNome').value.trim();
      if (!d) { toast('Scegli la data'); return; }
      data.festivitaExtra = (data.festivitaExtra || []).filter(function (x) { return x.data !== d; });
      data.festivitaExtra.push({ data: d, nome: n || 'Festività locale' });
      commit('Festività aggiunta');
    });
    void anno;
  }

  /* ---------- schermata STORICO ---------- */
  function viewStorico() {
    var ks = E.sortedKeys(data).filter(function (k) { return !data.records[k].seed; }).reverse();
    var set = E.settingsOf(data), h = '';
    h += '<div class="card"><h2>Buste paga inserite</h2><div class="list">';
    if (!ks.length) h += '<p class="sub">Ancora nessuna.</p>';
    ks.forEach(function (k) {
      var r = data.records[k];
      function res(n) { return r[n] && typeof r[n].res === 'number' ? f(r[n].res) : '–'; }
      h += '<button class="item" data-k="' + k + '"><div class="t">' + E.monthLabel(k) + '</div><div class="d">Ferie ' + res('ferie') + ' h · Permessi ' + res('perm') + ' h · Banca ore ' + res('banca') + ' h</div></button>';
    });
    h += '</div></div>';
    E.anniConDati(data).slice().reverse().forEach(function (y) {
      var md = E.mensili(data, y);
      h += '<div class="card"><h2>Mese per mese · ' + y + '</h2><div class="scroll"><table><tr><th>Mese</th><th>Ferie<br>godute</th><th>Permessi<br>goduti</th><th>Banca<br>maturate</th><th>Banca<br>godute</th></tr>';
      for (var m = 1; m <= 12; m++) {
        var any = md.ferieGod[m] || md.permGod[m] || md.bancaMat[m] || md.bancaGod[m];
        if (!any) continue;
        function c(d) { return d[m] ? f(d[m].val) + (d[m].span > 1 ? '*' : '') : '–'; }
        h += '<tr><td>' + E.MESI[m - 1] + '</td><td>' + c(md.ferieGod) + '</td><td>' + c(md.permGod) + '</td><td>' + c(md.bancaMat) + '</td><td>' + c(md.bancaGod) + '</td></tr>';
      }
      h += '</table></div><p class="hint">Ore del singolo mese, ricavate dalla differenza tra due buste paga. * = totale di più mesi, perché manca la busta paga dei mesi prima. Gennaio–settembre 2026 delle ferie e dei permessi vengono dal prospetto della cooperativa.</p></div>';
    });
    void set;
    return h;
  }

  function bindStorico() {
    document.querySelectorAll('.item').forEach(function (b) {
      b.addEventListener('click', function () { editKey = b.getAttribute('data-k'); tab = 'inserisci'; render(); window.scrollTo(0, 0); });
    });
  }

  /* ---------- schermata ALTRO ---------- */
  function viewAltro() {
    var s = E.settingsOf(data), h = '';
    h += '<div class="card"><h2>Regole di calcolo</h2>';
    h += '<div class="grid">';
    h += campoImp('i_giorno', 'Ore di un giorno di ferie/permesso', s.oreGiorno);
    h += campoImp('i_turno', 'Ore di un turno intero', s.oreTurno);
    h += campoImp('i_ferie', 'Ferie che maturano al mese (ore)', s.rateFerie);
    h += campoImp('i_perm', 'Permessi che maturano al mese (ore)', s.ratePermessi);
    h += '</div>';
    h += '<div class="sect">Regole per le ferie pianificate</div>';
    h += '<label class="opt" style="margin:0;color:var(--ink);font-size:15px"><input type="checkbox" id="i_dom"' + (s.domenicaGratis ? ' checked' : '') + '><span>Le domeniche dentro un periodo di ferie non si contano</span></label>';
    h += '<label class="opt" style="margin:0;color:var(--ink);font-size:15px"><input type="checkbox" id="i_fest"' + (s.festivitaComePermessi ? ' checked' : '') + '><span>Le festività dentro le ferie contano come ore di permesso</span></label>';
    h += '<button class="primary" id="salvaImp">Salva regole</button>';
    h += '<p class="hint">Servono per trasformare le ore in giorni e per calcolare la situazione a dicembre. Le cambiamo quando arriva il regolamento ufficiale.</p></div>';
    h += '<div class="card"><h2>Copie dei dati</h2>';
    if (CFG.FOGLIO_URL) h += '<p><a href="' + esc(CFG.FOGLIO_URL) + '" target="_blank" rel="noopener">Apri il Google Fogli</a> (si aggiorna da solo a ogni salvataggio)</p>';
    if (CFG.CARTELLA_URL) h += '<p><a href="' + esc(CFG.CARTELLA_URL) + '" target="_blank" rel="noopener">Apri la cartella su Google Drive</a></p>';
    h += '<p class="hint">Stato: ' + esc($('#sync').textContent) + '</p>';
    h += '<button class="secondary" id="risinc" style="width:100%">Salva di nuovo su Google</button>';
    h += '</div>';
    return h;
  }
  function campoImp(id, label, v) {
    return '<div><label for="' + id + '">' + label + '</label><div class="fld"><input type="text" inputmode="decimal" id="' + id + '" value="' + String(v).replace('.', ',') + '" style="background:var(--card);padding-right:12px"></div></div>';
  }
  function bindAltro() {
    $('#salvaImp').addEventListener('click', function () {
      var vals = { oreGiorno: E.parseNum($('#i_giorno').value), oreTurno: E.parseNum($('#i_turno').value), rateFerie: E.parseNum($('#i_ferie').value), ratePermessi: E.parseNum($('#i_perm').value) };
      for (var k in vals) if (vals[k] === null || vals[k] <= 0) { toast('Controlla i numeri'); return; }
      data.settings = Object.assign({}, data.settings || {}, vals, { domenicaGratis: $('#i_dom').checked, festivitaComePermessi: $('#i_fest').checked });
      commit('Regole salvate');
    });
    $('#risinc').addEventListener('click', function () { remotePush().then(function (ok) { toast(ok ? 'Salvato su Google' : 'Non riesco a salvare ora'); render(); }); });
  }

  /* ---------- struttura ---------- */
  var ICONS = {
    oggi: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    inserisci: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    storico: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    pianifica: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
    altro: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>'
  };
  var NAMES = { oggi: 'Oggi', pianifica: 'Pianifica', inserisci: 'Inserisci', storico: 'Storico', altro: 'Altro' };

  function render() {
    var nav = '';
    Object.keys(NAMES).forEach(function (t) {
      nav += '<button data-t="' + t + '" class="' + (t === tab ? 'on' : '') + '">' + ICONS[t] + NAMES[t] + '</button>';
    });
    $('#nav').innerHTML = nav;
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-t'); if (tab !== 'inserisci') editKey = null; if (tab !== 'pianifica') editPlan = null; render(); window.scrollTo(0, 0); });
    });
    var main = $('#main');
    if (tab === 'oggi') { main.innerHTML = viewOggi(); bindOggi(); }
    else if (tab === 'inserisci') { main.innerHTML = viewInserisci(); bindInserisci(); }
    else if (tab === 'pianifica') { main.innerHTML = viewPianifica(); bindPianifica(); }
    else if (tab === 'storico') { main.innerHTML = viewStorico(); bindStorico(); }
    else { main.innerHTML = viewAltro(); bindAltro(); }
    if (tab !== 'oggi') { var st = E.statoAdesso(data); $('#aggiornato').textContent = st ? 'Aggiornato alla busta paga di ' + st.label : ''; }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* ignora */ }); });
  }
  init();
})();
