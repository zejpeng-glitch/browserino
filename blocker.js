(function () {
  if (window.__bnBlocker) return; window.__bnBlocker = true;
  var last = -1e9;
  function g(e) { if (e.isTrusted) last = performance.now(); }
  ["click", "keydown", "touchend", "mousedown"].forEach(function (t) { document.addEventListener(t, g, true); });

  // 1) window.open: solo dopo un tuo gesto recente, mai verso un altro sito
  var realOpen = window.open;
  window.open = function (u) {
    try { if (performance.now() - last < 1200 && u && new URL(u, location.href).hostname === location.hostname) { location.href = u; } } catch (e) {}
    return null;
  };

  // 2) link che si aprono altrove / trappole: togli target=_blank se verso altro sito
  document.addEventListener("click", function (e) {
    if (!e.isTrusted) return;
    var a = e.target && e.target.closest && e.target.closest("a[target]");
    if (a && a.target === "_blank") a.target = "_self";
  }, true);

  // 3) overlay trasparenti a tutto schermo (click-trap)
  function sweep() {
    var els = document.querySelectorAll("div,a,span");
    for (var i = 0; i < els.length; i++) {
      var el = els[i], s = getComputedStyle(el);
      if ((s.position === "fixed" || s.position === "absolute") && parseInt(s.zIndex || 0, 10) > 1000 &&
          el.offsetWidth >= innerWidth * 0.9 && el.offsetHeight >= innerHeight * 0.9 &&
          parseFloat(s.opacity) < 0.05 && !el.querySelector("video")) { el.remove(); }
    }
  }
  setInterval(sweep, 2500);

  // 4) video grande
  window.__bnBig = function () {
    var best = null, ba = 0, vs = document.querySelectorAll("video");
    for (var i = 0; i < vs.length; i++) { var r = vs[i].getBoundingClientRect(), a = r.width * r.height; if (a > ba) { ba = a; best = vs[i]; } }
    return best && ba >= innerWidth * innerHeight * 0.3 ? best : null;
  };
  document.addEventListener("playing", function (e) {
    var v = e.target; if (!v || v.tagName !== "VIDEO") return;
    if (performance.now() - last > 12000) return;
    if (v === window.__bnBig()) console.log("__BN__:playing");
  }, true);

  // 6) scraper: cerca link .m3u8/.mp4 nei tag video e nel codice della pagina (anche negli script)
  var seen = {};
  function scan() {
    var found = [];
    function add(u) {
      if (!u || typeof u !== "string") return;
      try { u = new URL(u.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&"), location.href).href; } catch (e) { return; }
      if (!/^https?:/i.test(u) || seen[u] || !/\.(m3u8|mp4|webm|m4v)(\?|#|$)/i.test(u)) return;
      seen[u] = 1; found.push(u);
    }
    try {
      var vs = document.querySelectorAll("video,source");
      for (var i = 0; i < vs.length; i++) { add(vs[i].currentSrc); add(vs[i].getAttribute("src")); }
      var html = document.documentElement.innerHTML, re = /(?:https?:)?(?:\\?\/){2}[^\s"'<>()]+?\.(?:m3u8|mp4|webm|m4v)(?:\?[^\s"'<>\\]*)?/gi, m;
      while ((m = re.exec(html)) && found.length < 30) add(m[0]);
    } catch (e) {}
    if (found.length) console.log("__BN__:found:" + JSON.stringify(found));
  }
  window.__bnScan = function () { seen = {}; scan(); };
  var scans = 0;
  var scanT = setInterval(function () { scan(); if (++scans >= 8) clearInterval(scanT); }, 2500);
  document.addEventListener("playing", function () { setTimeout(scan, 400); }, true);

  // 5) tastiera sul video grande (quando il sito non la gestisce)
  document.addEventListener("keydown", function (e) {
    var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var v = window.__bnBig(); if (!v) return;
    setTimeout(function () {
      if (e.defaultPrevented) return;
      if (e.key === "ArrowRight") v.currentTime += 10;
      else if (e.key === "ArrowLeft") v.currentTime -= 10;
      else if (e.key === "ArrowUp") v.volume = Math.min(1, v.volume + 0.1);
      else if (e.key === "ArrowDown") v.volume = Math.max(0, v.volume - 0.1);
      else if (e.key === " ") { v.paused ? v.play() : v.pause(); e.preventDefault(); }
      else if (e.key === "f" || e.key === "F") { document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen(); }
    }, 0);
  }, false);
})();
