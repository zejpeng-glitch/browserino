// Intercettazione del player (MSE): vive DENTRO la pagina. Non tocca la rete: guarda i pezzi di video che il player
// della pagina passa al tag <video> e, solo quando premi "Cattura", ne tiene una copia per Browserino.
// Si può iniettare più volte: la seconda volta non fa niente.
(function () {
  if (window.__bnMse) return;
  var MS = window.MediaSource, SB = window.SourceBuffer;
  if (!MS || !SB || !MS.prototype || !SB.prototype) return;
  var recs = new WeakMap(), all = [], armed = false, queue = [], nextId = 1, announced = false;

  function bytesOf(d) {
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return null;
  }
  // un "init segment" è l'intestazione del flusso (mp4: ftyp/moov, webm: EBML)
  function isInit(u) {
    if (!u || u.length < 8) return false;
    if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return true;
    var t = String.fromCharCode(u[4], u[5], u[6], u[7]);
    return t === "ftyp" || t === "moov";
  }

  var origAdd = MS.prototype.addSourceBuffer;
  MS.prototype.addSourceBuffer = function (mime) {
    var sb = origAdd.apply(this, arguments);
    try {
      var r = { id: nextId++, mime: String(mime || ""), bytes: 0, init: null, n: 0 };
      recs.set(sb, r); all.push(r);
      if (!announced) { announced = true; console.log("__BN__:mse:" + r.mime); }
    } catch (_) {}
    return sb;
  };
  var origAppend = SB.prototype.appendBuffer;
  SB.prototype.appendBuffer = function (data) {
    try {
      var r = recs.get(this), u = bytesOf(data);
      if (r && u) {
        r.bytes += u.length; r.n++;
        var init = isInit(u);
        if (init || armed) {
          var c = u.slice(); // copia: il player può riusare il suo buffer subito dopo
          if (init) r.init = c;
          if (armed) queue.push({ b: r.id, m: r.mime, u: c });
        }
      }
    } catch (_) {}
    return origAppend.apply(this, arguments);
  };

  function toB64(parts) {
    return new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); res(s.slice(s.indexOf(",") + 1)); };
      fr.onerror = function () { res(""); };
      fr.readAsDataURL(new Blob(parts));
    });
  }

  window.__bnMse = {
    status: function () { return { armed: armed, bufs: all.map(function (r) { return { id: r.id, mime: r.mime, bytes: r.bytes, n: r.n }; }) }; },
    arm: function () {
      var withInit = 0;
      queue = [];
      all.forEach(function (r) { if (r.init) { queue.push({ b: r.id, m: r.mime, u: r.init }); withInit++; } });
      armed = true;
      return { bufs: all.length, withInit: withInit };
    },
    disarm: function () { armed = false; },
    // restituisce i pezzi accumulati (in ordine), raggruppati per buffer, in base64
    drain: function () {
      var q = queue; queue = [];
      var groups = [];
      q.forEach(function (x) {
        var g = groups[groups.length - 1];
        if (g && g.b === x.b) g.parts.push(x.u); else groups.push({ b: x.b, m: x.m, parts: [x.u] });
      });
      return Promise.all(groups.map(function (g) { return toB64(g.parts).then(function (s) { return { b: g.b, m: g.m, s: s }; }); }));
    },
    speed: function (rate) {
      [].forEach.call(document.querySelectorAll("video"), function (v) {
        try {
          if (rate > 1) { if (v.__bnMuted === undefined) v.__bnMuted = v.muted; v.muted = true; }
          else if (v.__bnMuted !== undefined) { v.muted = v.__bnMuted; v.__bnMuted = undefined; }
          v.playbackRate = rate;
        } catch (_) {}
      });
      return rate;
    }
  };
})();
