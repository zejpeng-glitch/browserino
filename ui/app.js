"use strict";
var $ = function (id) { return document.getElementById(id); };
var addr = $("addr"), cfg = { favs: [], blockJump: true, last: "" };
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
function save() { window.bn.setCfg({ favs: cfg.favs, blockJump: cfg.blockJump }); }

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
  if (cur && cur !== t) cur.last = Date.now();
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
  tabs.forEach(function (t) { if (t !== cur && !t.sleeping && !t.home && now - t.last > SLEEP_MS) sleepTab(t); });
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
  v.addEventListener("page-title-updated", function (e) { t.title = e.title; drawTabs(); });
  v.addEventListener("did-fail-load", function (e) { if (e.isMainFrame && e.errorCode !== -3 && t === cur) toast("Non riesco ad aprire la pagina (" + e.errorDescription + ")"); });
}

// ---------------- barra e preferiti ----------------
function drawTiles() {
  var t = $("tiles"); t.innerHTML = "";
  if (!cfg.favs.length) { t.innerHTML = '<p style="color:#8b94a7">Ancora nessun preferito. Apri un sito e premi ☆.</p>'; }
  cfg.favs.forEach(function (f, i) {
    var d = document.createElement("div"); d.className = "tile";
    var b = document.createElement("b"); b.textContent = f.title || f.url;
    var s = document.createElement("span"); s.textContent = f.url;
    var x = document.createElement("i"); x.textContent = "✕";
    x.onclick = function (e) { e.stopPropagation(); cfg.favs.splice(i, 1); save(); drawTiles(); };
    d.onclick = function () { go(f.url); };
    d.appendChild(x); d.appendChild(b); d.appendChild(s); t.appendChild(d);
  });
}
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
  else { cfg.favs.push({ url: u, title: view.getTitle() }); toast("Aggiunto ai preferiti"); }
  save(); refreshFav();
};
$("jump").onclick = function () { cfg.blockJump = !cfg.blockJump; save(); drawJump(); toast(cfg.blockJump ? "Salti di pagina bloccati" : "Salti di pagina permessi"); };
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
function activeDls() { return Object.keys(dls).filter(function (k) { var s = dls[k].state; return s === "run" || s === "paused"; }).length; }
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
  if (d.canceled) { j.state = "canceled"; j.text = "⛔ Annullato"; }
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
  cfg.favs = c.favs || []; cfg.blockJump = c.blockJump !== false;
  drawJump(); drawTiles(); refreshNav();
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
