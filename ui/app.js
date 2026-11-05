"use strict";
var $ = function (id) { return document.getElementById(id); };
var addr = $("addr"), cfg = { favs: [], blockJump: true, favbar: true, twitch: true, autoPip: ["twitch.tv", "youtube.com"], last: "" };
var tabs = [], cur = null, view = null, tabSeq = 1;
var IS_MAC = /Mac/i.test(navigator.platform);
var toastT;
function toast(s, ms) { var t = $("toast"); t.textContent = s; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, ms || 2200); }

function norm(s) {
  s = s.trim(); if (!s) return "";
  if (/^(https?:\/\/|file:|data:|about:)/i.test(s)) return s;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/.test(s)) return "http://" + s;
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s)) return "https://" + s;
  return "https://www.google.com/search?q=" + encodeURIComponent(s);
}
function save() { window.bn.setCfg({ favs: cfg.favs, blockJump: cfg.blockJump, favbar: cfg.favbar, autoPip: cfg.autoPip }); drawFavBar(); }

// ---------------- schede ----------------
function tabLabel(t) {
  if (t.sleeping) return "💤 " + (t.title || hostName(t.url));
  if (t.home) return "Nuova scheda";
  if (t.title) return t.title;
  try { return new URL(t.url).hostname; } catch (e) { return t.url || "Nuova scheda"; }
}
function hostName(u) { try { return new URL(u).hostname; } catch (e) { return u || "Nuova scheda"; } }
function drawTabs() {
  var box = $("tabs"); box.innerHTML = "";
  tabs.forEach(function (t) {
    var d = document.createElement("div"); d.className = "tab" + (t === cur ? " act" : ""); d.title = tabLabel(t);
    var s = document.createElement("span"); s.textContent = tabLabel(t);
    var x = document.createElement("i"); x.textContent = "✕"; x.title = "Chiudi (Ctrl+W)";
    x.onclick = function (e) { e.stopPropagation(); closeTab(t); };
    d.onclick = function () { select(t); };
    d.onauxclick = function (e) { if (e.button === 1) { e.preventDefault(); closeTab(t); } };
    d.appendChild(s); d.appendChild(x); box.appendChild(d);
  });
  var n = document.createElement("button"); n.id = "tabnew"; n.textContent = "+"; n.title = "Nuova scheda (Ctrl+T)";
  n.onclick = function () { newTab(null, true); addr.focus(); };
  box.appendChild(n);
  if (cur) document.title = (cur.home ? "Browserino" : tabLabel(cur) + " – Browserino");
}

function newTab(url, activate) {
  var v = document.createElement("webview");
  v.setAttribute("partition", "persist:browserino");
  v.className = "bg";
  $("stage").insertBefore(v, $("home"));
  var t = { id: tabSeq++, view: v, ready: false, wcId: null, home: true, title: "", url: "", sleeping: false, last: Date.now() };
  tabs.push(t);
  wire(t);
  if (activate !== false) select(t);
  if (url) navTab(t, url);
  drawTabs();
  return t;
}
function select(t) {
  if (cur && cur !== t) { cur.last = Date.now(); autoPip(cur, true); }
  if (t.autoPipOn) autoPip(t, false);
  if (t.sleeping) wakeTab(t);
  cur = t; view = t.view; t.last = Date.now();
  tabs.forEach(function (x) { if (x.view) x.view.classList.toggle("bg", x !== t || x.home); });
  $("home").classList.toggle("hide", !t.home);
  addr.value = t.home ? "" : t.url;
  if (t.home) drawTiles();
  drawTabs(); refreshNav(); refreshFav();
  window.bn.vidActive(t.home || !t.wcId ? null : t.wcId);
  if (!t.home) try { t.view.focus(); } catch (e) {}
}
function closeTab(t) {
  var i = tabs.indexOf(t); if (i < 0) return;
  tabs.splice(i, 1);
  try { if (t.view) t.view.remove(); } catch (e) {}
  if (!tabs.length) { newTab(null, true); return; }
  if (cur === t) select(tabs[Math.min(i, tabs.length - 1)]); else drawTabs();
}
function navTab(t, u) {
  u = norm(u); if (!u) return;
  t.home = false; t.url = u;
  if (t.view.getAttribute("src") === u) t.view.reload(); else t.view.setAttribute("src", u);
  if (t === cur) {
    $("home").classList.add("hide"); t.view.classList.remove("bg"); addr.value = u;
    try { t.view.focus(); } catch (e) {}
    if (t.wcId) window.bn.vidActive(t.wcId);
  }
  drawTabs();
}
function go(u) { navTab(cur, u); }
function showHome() {
  cur.home = true; view.classList.add("bg"); $("home").classList.remove("hide"); addr.value = "";
  drawTiles(); drawTabs(); refreshFav(); window.bn.vidActive(null);
}

// ---- schede addormentate: dopo 10 minuti in background (e senza audio) la scheda libera la RAM ----
var SLEEP_MS = 10 * 60 * 1000;
function sleepTab(t) {
  if (t === cur || t.home || t.sleeping || !t.ready || !t.view) return;
  var audible = false; try { audible = t.view.isCurrentlyAudible(); } catch (e) {}
  if (audible) return;
  try { t.title = t.view.getTitle() || t.title; t.url = t.view.getURL() || t.url; } catch (e) {}
  try { t.view.remove(); } catch (e) {}
  t.view = null; t.ready = false; t.wcId = null; t.sleeping = true;
  drawTabs();
}
function wakeTab(t) {
  var v = document.createElement("webview");
  v.setAttribute("partition", "persist:browserino"); v.className = "bg";
  $("stage").insertBefore(v, $("home"));
  t.view = v; t.sleeping = false; wire(t);
  v.setAttribute("src", t.url);
}
setInterval(function () {
  var now = Date.now();
  tabs.forEach(function (t) { if (t !== cur && !t.sleeping && !t.home && !t.autoPipOn && now - t.last > SLEEP_MS) sleepTab(t); });
}, 60000);

function wire(t) {
  var v = t.view;
  v.addEventListener("dom-ready", function () {
    t.ready = true;
    try { t.wcId = v.getWebContentsId(); } catch (e) {}
    if (t === cur && !t.home && t.wcId) window.bn.vidActive(t.wcId);
    refreshNav();
  });
  v.addEventListener("did-navigate", function (e) {
    t.url = e.url; t.home = false;
    if (t === cur) { addr.value = e.url; refreshNav(); refreshFav(); }
    drawTabs();
  });
  v.addEventListener("did-navigate-in-page", function (e) { if (e.isMainFrame) { t.url = e.url; if (t === cur) addr.value = e.url; } });
  v.addEventListener("page-favicon-updated", function (e) { if (e.favicons && e.favicons[0]) t.icon = e.favicons[0]; });
  v.addEventListener("page-title-updated", function (e) { t.title = e.title; drawTabs(); });
  v.addEventListener("did-fail-load", function (e) { if (e.isMainFrame && e.errorCode !== -3 && t === cur) toast("Non riesco ad aprire la pagina (" + e.errorDescription + ")"); });
}

// ---------------- barra e preferiti ----------------
// ---- preferiti: spostamento con il trascinamento + anteprima ----
var dragFrom = -1;
function moveFav(from, to) {
  if (from < 0 || to < 0 || from === to || from >= cfg.favs.length) return;
  var f = cfg.favs.splice(from, 1)[0]; cfg.favs.splice(to, 0, f);
  save(); drawTiles(); refreshFav();
}
function dragWire(el, i, cls) {
  el.draggable = true;
  el.ondragstart = function (e) { dragFrom = i; el.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch (x) {} };
  el.ondragend = function () { dragFrom = -1; el.classList.remove("drag"); document.querySelectorAll(".over").forEach(function (n) { n.classList.remove("over"); }); };
  el.ondragover = function (e) { if (dragFrom < 0) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; el.classList.add("over"); };
  el.ondragleave = function () { el.classList.remove("over"); };
  el.ondrop = function (e) { e.preventDefault(); el.classList.remove("over"); moveFav(dragFrom, i); dragFrom = -1; };
}
function makeThumb(i) {
  var f = cfg.favs[i]; if (!f) return;
  var tile = $("tiles").children[i]; if (tile) tile.classList.add("busy");
  toast("Carico l'anteprima di " + (f.title || hostName(f.url)) + "…", 4000);
  window.bn.thumb(f.url).then(function (r) {
    var g = cfg.favs.filter(function (x) { return x.url === f.url; })[0];
    if (r && r.ok && g) { g.thumb = r.data; save(); toast("Anteprima pronta"); }
    else toast("Non sono riuscito a fare l'anteprima" + (r && r.err ? " (" + r.err + ")" : ""), 4000);
    drawTiles();
  });
}
function favMenu(i) {
  var f = cfg.favs[i];
  var items = [
    ["Apri in una nuova scheda", function () { newTab(f.url, true); }],
    ["Rinomina…", function () { renameFav(i); }],
    [f.thumb ? "Aggiorna anteprima" : "Carica anteprima", function () { makeThumb(i); }]
  ];
  if (f.thumb) items.push(["Togli anteprima", function () { delete f.thumb; save(); drawTiles(); }]);
  items.push(["Copia indirizzo", function () { navigator.clipboard.writeText(f.url).then(function () { toast("Copiato"); }); }]);
  items.push(["Rimuovi dai preferiti", function () { cfg.favs.splice(i, 1); save(); drawTiles(); refreshFav(); }]);
  return items;
}
function drawTiles() {
  var t = $("tiles"); t.innerHTML = "";
  if (!cfg.favs.length) { t.innerHTML = '<p style="color:#8b94a7">Ancora nessun preferito. Apri un sito e premi ☆.</p>'; }
  cfg.favs.forEach(function (f, i) {
    var d = document.createElement("div"); d.className = "tile" + (f.thumb ? " th" : "");
    if (f.thumb) { var im = document.createElement("img"); im.className = "ti"; im.src = f.thumb; im.draggable = false; d.appendChild(im); }
    var box = document.createElement("div"); box.className = "tx";
    var b = document.createElement("b"); b.textContent = f.title || f.url;
    var s = document.createElement("span"); s.textContent = f.url;
    var x = document.createElement("i"); x.textContent = "✕";
    x.onclick = function (e) { e.stopPropagation(); cfg.favs.splice(i, 1); save(); drawTiles(); };
    d.onclick = function () { go(f.url); };
    d.onauxclick = function (e) { if (e.button === 1) { e.preventDefault(); newTab(f.url, false); toast("Aperto in una nuova scheda"); } };
    d.oncontextmenu = function (e) { e.preventDefault(); showMenu(e.clientX, e.clientY, favMenu(i)); };
    dragWire(d, i);
    box.appendChild(b); box.appendChild(s);
    if (f.thumb) { d.appendChild(box); d.appendChild(x); } else { d.appendChild(x); d.appendChild(b); d.appendChild(s); }
    t.appendChild(d);
  });
}
function drawFavBar() {
  var b = $("favbar"); b.innerHTML = "";
  b.classList.toggle("hide", cfg.favbar === false);
  if (!cfg.favs.length) { b.innerHTML = '<span class="fempty">I tuoi preferiti appariranno qui: premi ☆ su un sito (Ctrl+Maiusc+B nasconde la barra)</span>'; return; }
  cfg.favs.forEach(function (f, i) {
    var c = document.createElement("div"); c.className = "fchip"; c.title = (f.title || "") + "\n" + f.url;
    if (f.icon) { var im = document.createElement("img"); im.src = f.icon; im.onerror = function () { im.remove(); }; c.appendChild(im); }
    var s = document.createElement("span"); s.textContent = f.title || hostName(f.url); c.appendChild(s);
    c.onclick = function (e) { if (e.ctrlKey || e.metaKey) newTab(f.url, false); else go(f.url); };
    c.onauxclick = function (e) { if (e.button === 1) { e.preventDefault(); newTab(f.url, false); toast("Aperto in una nuova scheda"); } };
    c.oncontextmenu = function (e) { e.preventDefault(); showMenu(e.clientX, e.clientY, favMenu(i)); };
    dragWire(c, i);
    b.appendChild(c);
  });
}
function renameFav(i) {
  var f = cfg.favs[i]; if (!f) return;
  var m = document.createElement("div"); m.id = "cmenu"; closeMenu();
  m.style.cssText = "left:50%;top:30%;transform:translateX(-50%);padding:12px;width:min(360px,90vw)";
  var inp = document.createElement("input"); inp.value = f.title || hostName(f.url); inp.spellcheck = false;
  inp.style.cssText = "width:100%;height:34px;border-radius:8px;border:1px solid var(--line);background:#0b0e14;color:var(--tx);padding:0 10px;font:inherit";
  var hint = document.createElement("div"); hint.textContent = "Invio per salvare, Esc per annullare. Vuoto = nome originale del sito."; hint.style.cssText = "color:var(--mut);font-size:12px;padding:6px 2px 0;cursor:default";
  m.appendChild(inp); m.appendChild(hint); document.body.appendChild(m);
  function done(ok) {
    if (ok) { var v = inp.value.trim(); if (v) { f.title = v; f.custom = true; } else { delete f.custom; f.title = hostName(f.url); } save(); drawTiles(); }
    m.remove();
  }
  inp.onkeydown = function (e) { e.stopPropagation(); if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); };
  inp.onblur = function () { setTimeout(function () { if (document.body.contains(m)) done(true); }, 0); };
  inp.focus(); inp.select();
}
function showMenu(x, y, items) {
  closeMenu();
  var m = document.createElement("div"); m.id = "cmenu";
  items.forEach(function (it) { var d = document.createElement("div"); d.textContent = it[0]; d.onclick = function () { closeMenu(); it[1](); }; m.appendChild(d); });
  document.body.appendChild(m);
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 6) + "px"; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 6) + "px";
  setTimeout(function () { document.addEventListener("mousedown", function h(e) { if (e.target.closest && e.target.closest("#cmenu")) return; document.removeEventListener("mousedown", h); closeMenu(); }); }, 0);
}
function closeMenu() { var m = $("cmenu"); if (m) m.remove(); }
window.addEventListener("blur", closeMenu);
window.bn.onPasteGo(function (t) { if (document.activeElement === addr) { addr.value = t; go(t); } else go(t); });

function curUrl() { return cur && cur.ready && !cur.home ? view.getURL() : ""; }
function isFav() { var u = curUrl(); return !!u && cfg.favs.some(function (f) { return f.url === u; }); }
function refreshFav() { $("fav").textContent = isFav() ? "★" : "☆"; }
function refreshNav() {
  try { $("back").disabled = !(cur && cur.ready && !cur.home && view.canGoBack()); $("fwd").disabled = !(cur && cur.ready && !cur.home && view.canGoForward()); }
  catch (e) {}
}

$("back").onclick = function () { view.goBack(); };
$("fwd").onclick = function () { view.goForward(); };
$("reload").onclick = function () { if (!cur.home) view.reload(); };
$("homeBtn").onclick = showHome;
addr.onkeydown = function (e) { if (e.key === "Enter") go(addr.value); };
$("fav").onclick = function () {
  if (cur.home || !cur.ready) return;
  var u = view.getURL();
  var i = cfg.favs.findIndex(function (f) { return f.url === u; });
  if (i >= 0) { cfg.favs.splice(i, 1); toast("Tolto dai preferiti"); }
  else { cfg.favs.push({ url: u, title: view.getTitle(), icon: cur.icon || "" }); toast("Aggiunto ai preferiti"); }
  save(); refreshFav();
};
$("jump").onclick = function () { cfg.blockJump = !cfg.blockJump; save(); drawJump(); toast(cfg.blockJump ? "Salti di pagina bloccati" : "Salti di pagina permessi"); };
// PiP automatico per sito: quando lasci la scheda (o minimizzi) con un video che sta andando
function pipSite(u) { var h = hostName(u).replace(/^(www|m)\./, ""); return h; }
function pipOnFor(u) {
  var h = hostName(u);
  return cfg.autoPip.some(function (e) { return h === e || h.endsWith("." + e); });
}
function autoPip(t, enter) {
  if (!t || t.home || !t.wcId || !t.url) return;
  if (enter) {
    if (!pipOnFor(t.url)) return;
    window.bn.pip(t.wcId, "enter").then(function (r) { if (r === "on") t.autoPipOn = true; });
  } else if (t.autoPipOn) {
    t.autoPipOn = false;
    window.bn.pip(t.wcId, "exit");
  }
}
document.addEventListener("visibilitychange", function () { autoPip(cur, document.hidden); });
$("pip").oncontextmenu = function (e) {
  e.preventDefault();
  var u = cur && !cur.home ? cur.url : "";
  var items = [];
  if (u) {
    var site = pipSite(u), on = pipOnFor(u);
    items.push([(on ? "✓ " : "") + "PiP automatico su " + site, function () {
      if (on) cfg.autoPip = cfg.autoPip.filter(function (x) { var h = hostName(u); return !(h === x || h.endsWith("." + x)); });
      else cfg.autoPip.push(site);
      save(); toast(on ? "PiP automatico spento per " + site : "PiP automatico acceso per " + site + ": parte quando lasci la scheda o minimizzi");
    }]);
  }
  items.push(["Siti con PiP automatico: " + (cfg.autoPip.join(", ") || "nessuno"), function () {}]);
  var r = $("pip").getBoundingClientRect(); showMenu(Math.max(6, r.left - 120), r.bottom + 4, items);
};
function doPip() {
  if (!cur || cur.home || !cur.wcId) { toast("Apri prima una pagina con un video"); return; }
  window.bn.pip(cur.wcId).then(function (r) {
    if (r === "on") toast("Video in finestrina. Premi di nuovo per rimetterlo qui");
    else if (r === "off") toast("Video rimesso nella pagina");
    else if (r === "none") toast("Non trovo un video in questa pagina (fallo partire prima)");
    else toast("Il sito non lo permette (" + String(r).replace(/^err:/, "") + ")", 4000);
  });
}
$("pip").onclick = doPip;
function drawTw() { $("tw").classList.toggle("on", cfg.twitch !== false); }
$("tw").onclick = function () {
  cfg.twitch = cfg.twitch === false; drawTw(); window.bn.twitchSet(cfg.twitch);
  toast(cfg.twitch ? "Blocco pubblicità Twitch acceso: ricarica la pagina di Twitch" : "Blocco pubblicità Twitch spento");
};
function drawJump() { $("jump").classList.toggle("on", !!cfg.blockJump); }

window.bn.onBlocked(function (d) {
  $("shield").textContent = "🛡 " + d.n;
  if (d.kind !== "pubblicità") toast("Bloccato: " + d.kind);
});
window.bn.onNewTab(function (url, fg) { newTab(url, !!fg); if (!fg) toast("Aperto in una nuova scheda"); });

// ---------------- video: elenco, player pulito, download ----------------
var vlist = [];
function fmtSize(n) { return n ? (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + " MB") : ""; }
function renderVideos() {
  var box = $("vlist"); box.innerHTML = "";
  if (!vlist.length) {
    var e = document.createElement("div"); e.id = "vempty";
    e.textContent = "Nessun video ancora in questa scheda. Fai partire il video nella pagina (anche solo un attimo) oppure premi Scansiona.";
    box.appendChild(e); return;
  }
  vlist.forEach(function (v) {
    var r = document.createElement("div"); r.className = "vrow";
    if (v.kind === "mse") {
      var ci = document.createElement("div"); ci.className = "vi";
      var cl = document.createElement("div"); cl.className = "vl"; cl.textContent = v.label;
      var ch = document.createElement("div"); ch.className = "vh"; ch.textContent = v.host + " · per quando non c'è un link: registra il video mentre scorre (anche accelerato)";
      ci.appendChild(cl); ci.appendChild(ch);
      var cb = document.createElement("button"); cb.textContent = "⏺ Cattura"; cb.title = "Copia il video mentre il player lo riproduce";
      cb.onclick = function () { window.bn.vidCapture(v.id).then(function (x) { if (x && x.error) toast(x.error, 6000); else toast("Cattura partita: fai andare il video. Quando vuoi premi ⏹ Salva nel pannello.", 5000); }); };
      r.appendChild(ci); r.appendChild(cb); box.appendChild(r); return;
    }
    var i = document.createElement("div"); i.className = "vi";
    var l = document.createElement("div"); l.className = "vl"; l.textContent = v.label;
    var h = document.createElement("div"); h.className = "vh"; h.textContent = v.host + (v.src === "pagina" ? " · trovato nella pagina" : "");
    i.appendChild(l); i.appendChild(h);
    var p = document.createElement("button"); p.textContent = "▶ Guarda"; p.title = "Apri in un player pulito, senza pubblicità";
    p.onclick = function () { window.bn.vidPlay(v.id); $("vpanel").classList.add("hide"); };
    var d = document.createElement("button"); d.textContent = "⬇"; d.title = "Scarica il file";
    var m = document.createElement("button"); m.textContent = "🎵 MP3"; m.title = "Ricava solo l'audio in mp3";
    if (v.drm || v.live) { d.disabled = m.disabled = true; d.title = m.title = v.drm ? "Protetto da DRM" : "Diretta: non scaricabile"; }
    function dl(mode) { return function () { window.bn.vidDownload(v.id, mode).then(function (x) { if (x && x.error) toast(x.error); }); }; }
    d.onclick = dl("video"); m.onclick = dl("mp3");
    r.appendChild(i); if (v.kind !== "audio") r.appendChild(p); r.appendChild(d); if (!v.isMp3) r.appendChild(m); box.appendChild(r);
  });
}
window.bn.onVideos(function (l) {
  var more = l.length > vlist.length; vlist = l;
  updateVidBtn(); $("vid").classList.toggle("on", l.length > 0);
  if (more) toast("🎬 Video trovato! Premi il pulsante 🎬");
  renderVideos();
});
$("vid").onclick = function () { $("vpanel").classList.toggle("hide"); renderVideos(); };
$("vclose").onclick = function () { $("vpanel").classList.add("hide"); };
$("vscan").onclick = function () {
  if (cur.home || !cur.ready) return;
  try { view.executeJavaScript("window.__bnScan&&window.__bnScan()"); } catch (e) {}
  toast("Scansione della pagina…");
};
// ---- download: una riga per ciascuno, con pausa / riprendi / annulla ----
var dls = {}; // id -> { id, name, pct, text, state: run|paused|done|err|canceled }
function activeDls() { return Object.keys(dls).filter(function (k) { var s = dls[k].state; return s === "run" || s === "paused" || s === "capture" || s === "saving"; }).length; }
function updateVidBtn() {
  var n = activeDls();
  $("vid").textContent = "🎬 " + vlist.length + (n ? " ⬇" + n : "");
}
function renderDls() {
  var box = $("dlist"); box.innerHTML = "";
  var ids = Object.keys(dls).map(Number).sort(function (a, b) { return b - a; });
  if (ids.length) { var hd = document.createElement("div"); hd.className = "dh"; hd.textContent = "⬇ Download"; box.appendChild(hd); }
  ids.forEach(function (id) {
    var j = dls[id], r = document.createElement("div"); r.className = "drow " + j.state;
    var top = document.createElement("div"); top.className = "dtop";
    var nm = document.createElement("div"); nm.className = "dname"; nm.textContent = j.name; nm.title = j.name; top.appendChild(nm);
    function btn(label, title, fn) { var b = document.createElement("button"); b.textContent = label; b.title = title; b.onclick = fn; top.appendChild(b); }
    if (j.state === "capture") {
      var rates = [1, 2, 4, 8];
      btn("⏩ ×" + (j.rate || 1), "Velocità di riproduzione della pagina (più veloce = cattura più in fretta, senza audio)", function () {
        var n = rates[(rates.indexOf(j.rate || 1) + 1) % rates.length]; j.rate = n; window.bn.vidCtl(id, "speed:" + n); renderDls();
      });
      btn("⏹ Salva", "Ferma la cattura e salva il file", function () { j.state = "saving"; j.text = "Salvo il file…"; window.bn.vidCtl(id, "save"); renderDls(); updateVidBtn(); });
      btn("✕", "Annulla la cattura", function () { window.bn.vidCtl(id, "cancel"); });
    }
    if (j.boostable && (j.state === "run" || j.state === "paused")) {
      btn(j.boost ? "⚡ ON" : "⚡", "Boost: più richieste in parallelo per scaricare più in fretta (se il server rifiuta scende da solo)", function () {
        j.boost = !j.boost; window.bn.vidCtl(id, "boost:" + (j.boost ? 1 : 0)); renderDls();
      });
    }
    if (j.state === "run") btn("⏸", "Metti in pausa", function () { j.state = "paused"; window.bn.vidCtl(id, "pause"); renderDls(); updateVidBtn(); });
    if (j.state === "paused") btn("▶", "Riprendi", function () { j.state = "run"; window.bn.vidCtl(id, "resume"); renderDls(); updateVidBtn(); });
    if (j.state === "run" || j.state === "paused") btn("✕", "Annulla e cancella il file parziale", function () { window.bn.vidCtl(id, "cancel"); });
    if (j.state === "done") btn("📂", "Mostra nella cartella", function () { window.bn.vidCtl(id, "show"); });
    if (j.state === "done" || j.state === "err" || j.state === "canceled") btn("✕", "Togli dall'elenco", function () { window.bn.vidCtl(id, "remove"); delete dls[id]; renderDls(); });
    r.appendChild(top);
    var bar = document.createElement("div"); bar.className = "dbar"; var fill = document.createElement("i");
    fill.style.width = (j.state === "done" ? 100 : Math.max(j.pct, 0)) + "%"; bar.appendChild(fill); r.appendChild(bar);
    var tx = document.createElement("div"); tx.className = "dtxt";
    tx.textContent = j.state === "paused" ? "⏸ In pausa" + (j.pct >= 0 ? " · " + j.pct + "%" : "") : j.text;
    r.appendChild(tx); box.appendChild(r);
  });
}
window.bn.onDl(function (d) {
  var j = dls[d.id] || (dls[d.id] = { id: d.id, name: d.name || "download", pct: 0, text: "parto", state: "run" });
  if (d.name) j.name = d.name;
  if (d.boostable) j.boostable = true;
  if (d.canceled) { j.state = "canceled"; j.text = "⛔ Annullato"; }
  else if (d.capture) { if (j.state !== "saving") j.state = "capture"; j.text = d.text; if (d.rate) j.rate = d.rate; }
  else if (d.saving) { j.state = "saving"; j.text = d.text; }
  else if (d.error) { j.state = "err"; j.text = "⚠ " + d.error; toast("Download non riuscito: " + d.error); }
  else if (d.done) { j.state = "done"; j.pct = 100; j.text = "✅ Salvato" + (d.note ? " — " + d.note : ""); toast("Scaricato: " + j.name + (d.note ? " — " + d.note : ""), d.note ? 7000 : 2200); }
  else {
    if (j.state === "paused") { if (d.pct >= 0) j.pct = d.pct; renderDls(); return; }
    if (d.pct >= 0) j.pct = d.pct;
    j.text = (d.pct >= 0 ? d.pct + "% · " : "") + d.text;
  }
  renderDls(); updateVidBtn();
});

// ---- log di debug ----
var logOn = false, logTa = $("vlog");
function logScroll() { logTa.scrollTop = logTa.scrollHeight; }
$("vlogbtn").onclick = function () {
  logOn = !logOn; $("vlogbox").classList.toggle("hide", !logOn);
  if (logOn) window.bn.dbgGet().then(function (t) { logTa.value = t; logScroll(); });
};
window.bn.onDbg(function (l) {
  if (!logOn) return;
  var atEnd = logTa.scrollTop + logTa.clientHeight >= logTa.scrollHeight - 30;
  logTa.value += (logTa.value ? "\n" : "") + l;
  if (atEnd) logScroll();
});
$("vcopy").onclick = function () { logTa.select(); try { document.execCommand("copy"); toast("Log copiato"); } catch (e) { toast("Selezionato: premi Ctrl+C"); } };
$("vlogfile").onclick = function () { window.bn.dbgOpen(); };

window.bn.onPlayer(function (on) { document.body.classList.toggle("player", on); window.bn.fullscreen(on); });

// ---------------- scorciatoie (anche quando il focus è dentro la pagina) ----------------
function shortcut(c) {
  var m = /^ctrl\+(\d)$/.exec(c);
  if (m) { var t = +m[1] === 9 ? tabs[tabs.length - 1] : tabs[+m[1] - 1]; if (t) select(t); return true; }
  switch (c) {
    case "ctrl+t": newTab(null, true); addr.focus(); return true;
    case "ctrl+w": closeTab(cur); return true;
    case "ctrl+tab": select(tabs[(tabs.indexOf(cur) + 1) % tabs.length]); return true;
    case "ctrl+shift+tab": select(tabs[(tabs.indexOf(cur) - 1 + tabs.length) % tabs.length]); return true;
    case "ctrl+l": addr.focus(); addr.select(); return true;
    case "ctrl+d": $("fav").click(); return true;
    case "ctrl+shift+p": doPip(); return true;
    case "ctrl+shift+b": cfg.favbar = cfg.favbar === false; save(); return true;
    case "ctrl+j": $("vid").click(); return true;
    case "ctrl+shift+r": $("rec").click(); return true;
    case "f5": if (!cur.home) view.reload(); return true;
    case "alt+arrowleft": if (!cur.home) view.goBack(); return true;
    case "alt+arrowright": if (!cur.home) view.goForward(); return true;
  }
  return false;
}
window.bn.onShortcut(shortcut);
document.addEventListener("keydown", function (e) {
  var c = (e.ctrlKey || (IS_MAC && e.metaKey) ? "ctrl+" : "") + (e.shiftKey ? "shift+" : "") + (e.altKey ? "alt+" : "") + e.key.toLowerCase();
  if (c === "ctrl+shift+r") return; // lo gestisce rec.js
  if (shortcut(c)) e.preventDefault();
});

newTab(null, true);
window.bn.getCfg().then(function (c) {
  cfg.favs = c.favs || []; cfg.blockJump = c.blockJump !== false; cfg.favbar = c.favbar !== false; cfg.twitch = c.twitchAdblock !== false; if (Array.isArray(c.autoPip)) cfg.autoPip = c.autoPip;
  drawJump(); drawTw(); drawTiles(); drawFavBar(); refreshNav();
});

// edizione demo: badge sempre visibile + avviso chiaro nel pannello video
(window.bn.edition ? window.bn.edition() : Promise.resolve(null)).then(function (e) {
  if (!e || !e.demo) return;
  window.EDITION = e;
  document.title = "Browserino Demo";
  var b = $("demo"); b.classList.remove("hide");
  b.onclick = function () { window.bn.buy().then(function (ok) { if (!ok) toast("La versione completa sarà disponibile a breve.", 4000); }); };
  var v = $("vdemo"); v.classList.remove("hide");
  v.textContent = "Versione demo: i download salvano l'" + Math.round(e.fraction * 100) + "% del video (senza il finale) e REC registra al massimo " + (e.recSecs / 60) + " minuti. La versione completa non ha limiti.";
});
