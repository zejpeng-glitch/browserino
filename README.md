# Browserino

Un piccolo browser per PC (Windows e Mac, basato su Electron) pensato per guardare e salvare video senza pubblicità e popup, con poca RAM.
*A small Electron browser (Windows/Mac) that blocks ads and popups, finds the videos in a page and lets you watch or save them.*

> Progetto personale, nato per risolvere un problema mio: i downloader che trovavo si bloccavano per i timeout o non riuscivano a trovare la sorgente del video. Funziona bene sui siti che uso, ma **non è mai stato provato su un Mac vero** e non ha garanzie.

## Cosa fa

- **Anti-pubblicità e popup**: blocca elenchi di domini pubblicitari, popup e salti di pagina verso altri siti.
- **Schede**, preferiti, e schede ferme da 10 minuti che si addormentano per liberare RAM.
- **Rileva i video** della pagina (🎬, Ctrl+J): `.m3u8` (HLS), `.mp4`, file audio.
  - **▶ Guarda**: apre il video in un player pulito.
  - **⬇ Scarica**: salva il file; gli HLS vengono uniti in mp4. Gestisce link che scadono (li rinnova guardando la pagina), riprova se la rete balbetta, scarica in parallelo.
  - **🎵 MP3**: ricava solo l'audio.
  - **⏺ Cattura**: se un sito non mostra nessun link scaricabile, copia il video mentre il player della pagina lo riproduce (anche accelerato ×2, ×4, ×8) e lo salva in un file. Non funziona con i DRM.
  - **⚡ Boost**: sui download HLS, il pulsante ⚡ porta le richieste in parallelo da 6 a 16 (se il sito rifiuta, torna da solo a un ritmo più basso).
  - **Barra dei preferiti** sotto l'indirizzo (Ctrl+Maiusc+B la nasconde); clic centrale o Ctrl+clic = nuova scheda, clic destro = menu.
  - **Clic destro** ovunque: incolla, copia, apri link in nuova scheda, "Incolla e vai" nella barra indirizzi.
  - Ogni download ha la sua riga con **pausa, riprendi e annulla**.
- **⏺ REC** (Ctrl+Maiusc+R): registra l'audio che esce dalle casse.
- **🐞 Log**: mostra cosa succede durante un download, utile quando qualcosa va storto.

## Cosa NON fa

- **Non aggira i DRM.** Netflix, Prime, Disney+ e simili restano protetti e vengono rifiutati con un messaggio chiaro.
- Non scarica dirette (live). La cattura registra solo quello che il player riproduce mentre è attiva.
- Non scarica link scaduti che la pagina non rinnova.

Usalo solo su contenuti che hai il diritto di scaricare o registrare. Chi lo usa è responsabile di come lo usa.

## Provarlo

Serve [Node.js](https://nodejs.org).

```bash
npm install
npm start
```

Per `.mp3` e per unire video e audio separati serve **ffmpeg** (nel PATH, accanto all'app, oppure in `Downloads\YT-DLP`).

## Creare l'installer

```bash
npm run dist          # Windows, versione completa  -> dist/Browserino-Setup-x.y.z.exe
npm run dist:demo     # Windows, versione demo
npm run dist:mac      # Mac (da eseguire su un Mac)
```

Su Windows, se electron-builder si lamenta di "Cannot create symbolic link", lancia PowerShell come amministratore o attiva la Modalità sviluppatore di Windows.
Senza un Mac, la build Mac si può fare su GitHub: scheda **Actions → Build Mac → Run workflow**.

Più dettagli in `LEGGIMI-VIDEO.txt`, `LEGGIMI-MAC.txt` e `LEGGIMI-DEMO.txt`.

## Stato

Windows: usato ogni giorno dall'autore. Mac: build previste ma non provate su hardware reale. Segnala i problemi aprendo una issue e allegando il log (🐞 Log → Copia).
