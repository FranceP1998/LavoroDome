(function () {
  'use strict';
  var E = window.Engine, CFG = window.CONFIG || {};
  var LS_DATA = 'fp_data_v1', LS_DIRTY = 'fp_dirty_v1';
  var data, tab = 'oggi', editKey = null, syncState = 'locale';

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
    if (st.arretratiRimasti > 0) {
      h += '<div class="row"><span>Arretrati dell’anno scorso ancora da usare</span><b>' + f(st.arretratiRimasti) + ' ore (' + E.giorni(st.arretratiRimasti, set.oreGiorno) + ' gg)</b></div>';
    } else {
      h += '<div class="row"><span>Arretrati dell’anno scorso</span><b>' + (st.arretratiUsati > 0 ? 'già usati' : 'nessuno') + '</b></div>';
    }
    h += '<div class="row"><span>Maturati quest’anno</span><b>' + f(st.mat) + ' ore</b></div>';
    h += '<div class="row"><span>Goduti quest’anno</span><b>' + f(st.god) + ' ore (' + E.giorni(st.god, set.oreGiorno) + ' gg)</b></div>';
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
    h += '</div><button class="primary" id="salvaImp">Salva regole</button>';
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
      data.settings = vals; commit('Regole salvate');
    });
    $('#risinc').addEventListener('click', function () { remotePush().then(function (ok) { toast(ok ? 'Salvato su Google' : 'Non riesco a salvare ora'); render(); }); });
  }

  /* ---------- struttura ---------- */
  var ICONS = {
    oggi: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    inserisci: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    storico: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    altro: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>'
  };
  var NAMES = { oggi: 'Oggi', inserisci: 'Inserisci', storico: 'Storico', altro: 'Altro' };

  function render() {
    var nav = '';
    Object.keys(NAMES).forEach(function (t) {
      nav += '<button data-t="' + t + '" class="' + (t === tab ? 'on' : '') + '">' + ICONS[t] + NAMES[t] + '</button>';
    });
    $('#nav').innerHTML = nav;
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-t'); if (tab !== 'inserisci') editKey = null; render(); window.scrollTo(0, 0); });
    });
    var main = $('#main');
    if (tab === 'oggi') { main.innerHTML = viewOggi(); bindOggi(); }
    else if (tab === 'inserisci') { main.innerHTML = viewInserisci(); bindInserisci(); }
    else if (tab === 'storico') { main.innerHTML = viewStorico(); bindStorico(); }
    else { main.innerHTML = viewAltro(); bindAltro(); }
    if (tab !== 'oggi') { var st = E.statoAdesso(data); $('#aggiornato').textContent = st ? 'Aggiornato alla busta paga di ' + st.label : ''; }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* ignora */ }); });
  }
  init();
})();
