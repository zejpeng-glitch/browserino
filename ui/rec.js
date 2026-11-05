"use strict";
// Pulsante REC: registra tutto l'audio che esce dalle casse (loopback di sistema).
(function () {
  var btn = document.getElementById("rec");
  var stream = null, ctx = null, proc = null, src = null, t0 = 0, written = 0, tick = null, busy = false, on = false;

  function say(s, ms) { if (typeof toast === "function") toast(s, ms); }
  function mmss(sec) { sec = Math.floor(sec); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

  function send(i16) { window.bn.recChunk(i16.buffer); }

  function cleanup() {
    clearInterval(tick); tick = null;
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (e) {}
    try { if (src) src.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    proc = src = stream = ctx = null;
  }

  async function start() {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach(function (t) { t.stop(); }); // mi serve solo l'audio
    var at = stream.getAudioTracks();
    if (!at.length) { cleanup(); throw new Error("il sistema non fornisce l'audio (serve Windows)"); }
    ctx = new AudioContext();
    var sr = ctx.sampleRate;
    await window.bn.recStart(sr, 2);
    src = ctx.createMediaStreamSource(new MediaStream(at));
    proc = ctx.createScriptProcessor(4096, 2, 2); // l'uscita resta muta: non si sente doppio
    written = 0; t0 = performance.now();
    proc.onaudioprocess = function (e) {
      var n = e.inputBuffer.length, L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : L;
      // se il sistema non manda dati mentre c'è silenzio, riempio il buco per tenere i tempi giusti
      var gap = Math.floor((performance.now() - t0) / 1000 * sr) - written - n;
      while (gap > sr * 0.5) {
        var g = Math.min(gap, sr);
        send(new Int16Array(g * 2)); written += g; gap -= g;
      }
      var out = new Int16Array(n * 2);
      for (var i = 0; i < n; i++) {
        var l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
        out[2 * i] = l < 0 ? l * 32768 : l * 32767; out[2 * i + 1] = r < 0 ? r * 32768 : r * 32767;
      }
      send(out); written += n;
    };
    src.connect(proc); proc.connect(ctx.destination);
    on = true; btn.classList.add("rec"); btn.textContent = "⏹ 0:00";
    var lim = window.EDITION && window.EDITION.demo ? window.EDITION.recSecs : 0;
    tick = setInterval(function () {
      btn.textContent = "⏹ " + mmss(written / sr) + (lim ? " / " + mmss(lim) : "");
      if (lim && written / sr >= lim && !busy) toggle(); // demo: si ferma da sola e salva
    }, 500);
    say("🔴 Registro tutto l'audio del PC. Premi ⏹ per salvare.");
  }

  async function stop() {
    cleanup(); on = false; btn.classList.remove("rec"); btn.textContent = "⏺ REC";
    var r = await window.bn.recStop();
    if (r.error) { say(r.error); return; }
    say("✅ Salvato in Download: " + r.name + " (" + mmss(r.secs) + ")" + (r.note ? " — " + r.note : ""), r.note ? 7000 : undefined);
  }

  async function toggle() {
    if (busy) return; busy = true;
    try { if (on) await stop(); else await start(); }
    catch (e) { cleanup(); on = false; btn.classList.remove("rec"); btn.textContent = "⏺ REC"; say("Registrazione non riuscita: " + (e && e.message || e)); }
    busy = false;
  }
  btn.onclick = toggle;
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || (/Mac/i.test(navigator.platform) && e.metaKey)) && e.shiftKey && e.key.toLowerCase() === "r") { e.preventDefault(); toggle(); }
  });
})();
