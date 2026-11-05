"use strict";
// Costruisce le voci del menu "clic destro". Niente Electron qui dentro: solo dati,
// così si può provare con node. main.js trasforma le voci in un menu vero.
// Voce: { label, act, arg?, enabled? }  oppure { sep: true }

function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function pageMenu(p, st) {
  // p = parametri del context-menu di Electron; st = { canBack, canFwd }
  const f = p.editFlags || {}, out = [];
  const sel = (p.selectionText || "").trim();
  const sep = () => { if (out.length && !out[out.length - 1].sep) out.push({ sep: true }); };

  if (p.linkURL) {
    out.push({ label: "Apri link in una nuova scheda", act: "newtab", arg: p.linkURL });
    out.push({ label: "Copia indirizzo del link", act: "copytext", arg: p.linkURL });
    sep();
  }
  if (p.mediaType === "image" && p.srcURL) {
    out.push({ label: "Apri immagine in una nuova scheda", act: "newtab", arg: p.srcURL });
    out.push({ label: "Copia indirizzo immagine", act: "copytext", arg: p.srcURL });
    sep();
  }
  if ((p.mediaType === "video" || p.mediaType === "audio") && p.srcURL && /^https?:/i.test(p.srcURL)) {
    out.push({ label: "Copia indirizzo " + (p.mediaType === "video" ? "video" : "audio"), act: "copytext", arg: p.srcURL });
    sep();
  }
  if (p.isEditable) {
    out.push({ label: "Taglia", act: "cut", enabled: !!f.canCut });
    out.push({ label: "Copia", act: "copy", enabled: !!f.canCopy });
    out.push({ label: "Incolla", act: "paste", enabled: !!f.canPaste });
    out.push({ label: "Seleziona tutto", act: "selectAll", enabled: !!f.canSelectAll });
  } else if (sel) {
    out.push({ label: "Copia", act: "copy", enabled: true });
    out.push({ label: "Cerca “" + clip(sel, 28) + "” su Google", act: "newtab", arg: "https://www.google.com/search?q=" + encodeURIComponent(sel) });
  } else if (!p.linkURL && p.mediaType !== "image") {
    out.push({ label: "Indietro", act: "back", enabled: !!st.canBack });
    out.push({ label: "Avanti", act: "fwd", enabled: !!st.canFwd });
    out.push({ label: "Ricarica", act: "reload" });
    sep();
    out.push({ label: "Seleziona tutto", act: "selectAll" });
  }
  sep();
  out.push({ label: "Ispeziona", act: "inspect" });
  while (out.length && out[out.length - 1].sep) out.pop();
  return out;
}

function addrMenu(p) {
  const f = p.editFlags || {};
  return [
    { label: "Taglia", act: "cut", enabled: !!f.canCut },
    { label: "Copia", act: "copy", enabled: !!f.canCopy },
    { label: "Incolla", act: "paste", enabled: !!f.canPaste },
    { label: "Incolla e vai", act: "pastego", enabled: !!f.canPaste },
    { sep: true },
    { label: "Seleziona tutto", act: "selectAll", enabled: !!f.canSelectAll }
  ];
}

module.exports = { pageMenu, addrMenu };
