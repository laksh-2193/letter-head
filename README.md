# letter-head

Letterhead Docs — a Word-style document editor with a personal letterhead, real A4 pagination and PDF export. Runs entirely in the browser; documents are stored locally (IndexedDB).

- Open `index.html` (works from `file://` or any static host).
- PIN gate: the app checks that `k/<pbkdf2(PIN)>` exists next to it. Set it with `npm run set-pin`.
- Develop: `npm install`, edit `src/app.js`, then `npm run build`.
- `npm run deploy` copies the built app into `../lakshaykumar.com/letterhead/`.
- `classic.html` is the original single-page letterhead editor.
