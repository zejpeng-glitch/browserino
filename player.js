"use strict";
(function () {
  var $ = function (i) { return document.getElementById(i); };
  var q = new URLSearchParams(location.search);
  var src = q.get("u"), kind = q.get("k"), title = q.get("t") || "";
  var v = $("v"), wrap = $("wrap"), hls = null, idleT, msgT, netRetry = 0;
  $("top").textContent = title;
  if (title) document.title = title + " · Player";

  function msg(s, ms) {
    var m = $("msg"); clearTimeout(msgT);
    if (!s) { m.style.display = "none"; return; }
    m.textContent = s; m.style.display = "block";
    if (ms) msgT = setTimeout(function () { m.style.display = "none"; }, ms);
  }
  function fmt(t) {
    if (!isFinite(t)) return "0:00";
    t = Math.floor(t); var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function lvlUrl(l) { return l ? (l.uri || (Array.isArray(l.url) ? l.url[0] : l.url) || null) : null; }

  // ---- sorgente ----
  function fail(t) { $("spin").style.display = "none"; msg(t); }
  if (kind === "hls") {
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, maxBufferLength: 60, startLevel: -1 });
      hls.loadSource(src); hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        var sel = $("lvl");
        if (hls.levels.length > 1) {
          sel.style.display = "";
          sel.innerHTML = '<option value="-1">Auto</option>';
          hls.levels.forEach(function (l, i) {
            var o = document.createElement("option"); o.value = i;
            o.textContent = l.height ? l.height + "p" : Math.round(l.bitrate / 1000) + " kbps"; sel.appendChild(o);
          });
        }
        v.play().catch(function () {});
      });
      hls.on(Hls.Events.ERROR, function (_e, d) {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netRetry++ < 3) { hls.startLoad(); return; }
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        fail("Non riesco a riprodurlo (" + (d.details || d.type) + "). Il link potrebbe essere scaduto: torna alla pagina e fai ripartire il video.");
      });
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = src; v.play().catch(function () {}); }
    else fail("Questo flusso HLS non è supportato.");
  } else { v.src = src; v.play().catch(function () {}); }
  v.addEventListener("error", function () { if (kind !== "hls") fail("Non riesco a riprodurlo: il link potrebbe essere scaduto o protetto."); });

  // ---- controlli ----
  function toggle() { v.paused ? v.play().catch(function () {}) : v.pause(); }
  function seekBy(d) { if (isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + d)); }
  function setVol(x) { v.volume = Math.max(0, Math.min(1, x)); v.muted = v.volume === 0; msg(Math.round(v.volume * 100) + "%", 700); }
  function fs() { document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen(); }

  $("play").onclick = toggle; $("back").onclick = function () { seekBy(-10); }; $("fwd").onclick = function () { seekBy(10); };
  $("mute").onclick = function () { v.muted = !v.muted; }; $("fs").onclick = fs;
  $("vol").oninput = function () { v.volume = this.value / 100; v.muted = v.volume === 0; };
  $("spd").onchange = function () { v.playbackRate = +this.value; };
  $("lvl").onchange = function () { hls.currentLevel = +this.value; };
  $("seek").oninput = function () { if (isFinite(v.duration)) v.currentTime = v.duration * this.value / 1000; };
  v.addEventListener("click", toggle);
  v.addEventListener("dblclick", fs);

  v.addEventListener("play", function () { $("play").textContent = "⏸"; });
  v.addEventListener("pause", function () { $("play").textContent = "▶"; });
  v.addEventListener("waiting", function () { $("spin").style.display = "block"; });
  v.addEventListener("playing", function () { $("spin").style.display = "none"; msg(""); });
  v.addEventListener("canplay", function () { $("spin").style.display = "none"; });
  v.addEventListener("volumechange", function () { $("mute").textContent = v.muted || v.volume === 0 ? "🔇" : "🔊"; $("vol").value = v.muted ? 0 : v.volume * 100; });
  v.addEventListener("timeupdate", function () {
    if (isFinite(v.duration) && v.duration > 0) $("seek").value = v.currentTime / v.duration * 1000;
    $("time").textContent = fmt(v.currentTime) + " / " + fmt(v.duration);
  });

  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.tagName === "SELECT") return;
    var k = e.key;
    if (k === " ") { toggle(); e.preventDefault(); }
    else if (k === "ArrowRight") { seekBy(e.shiftKey ? 30 : 10); e.preventDefault(); }
    else if (k === "ArrowLeft") { seekBy(e.shiftKey ? -30 : -10); e.preventDefault(); }
    else if (k === "ArrowUp") { setVol(v.volume + 0.1); e.preventDefault(); }
    else if (k === "ArrowDown") { setVol(v.volume - 0.1); e.preventDefault(); }
    else if (k === "f" || k === "F") fs();
    else if (k === "m" || k === "M") v.muted = !v.muted;
    else if (k === "Escape" && document.fullscreenElement) document.exitFullscreen();
  });

  // barra che si nasconde
  function wake() { wrap.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(function () { if (!v.paused) wrap.classList.add("idle"); }, 2600); }
  ["mousemove", "mousedown", "keydown"].forEach(function (t) { document.addEventListener(t, wake); });
  v.addEventListener("pause", wake); wake();

  // ---- download ----
  var dlT;
  function save(mode) {
    return function () {
      var sel = $("lvl").style.display === "none" ? "-1" : $("lvl").value;
      var level = hls && sel !== "-1" ? lvlUrl(hls.levels[+sel]) : null;
      window.pl.download(level, mode).then(function (r) {
        if (r && r.error) msg(r.error, 5000);
      });
    };
  }
  $("save").onclick = save("video"); $("mp3").onclick = save("mp3");
  window.pl.onDl(function (d) {
    var b = $("dl"); clearTimeout(dlT); b.style.display = "block";
    if (d.error) { b.textContent = "⚠ " + d.error; dlT = setTimeout(function () { b.style.display = "none"; }, 7000); return; }
    if (d.done) { b.textContent = "✅ Salvato: " + d.name + (d.note ? " — " + d.note : ""); dlT = setTimeout(function () { b.style.display = "none"; }, 8000); return; }
    b.textContent = "⬇ " + (d.pct >= 0 ? d.pct + "% · " : "") + d.text + " · " + d.name;
  });
})();
