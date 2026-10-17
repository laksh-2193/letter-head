import { Editor, Extension, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Typography from '@tiptap/extension-typography'
import { Placeholder, CharacterCount } from '@tiptap/extensions'

/* =========================================================================
   Constants & helpers
   ========================================================================= */
const MM = 96 / 25.4
const PAGE_W = 210 * MM
const PAGE_H = 297 * MM
const SCREEN_GAP = 24
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('lhd:' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('lhd:' + k, JSON.stringify(v)) } catch {} },
}

const FONTS = {
  'Space Grotesk': "'Space Grotesk',sans-serif", 'Archivo': "'Archivo',sans-serif", 'Inter': "'Inter',sans-serif",
  'Fraunces': "'Fraunces',serif", 'JetBrains Mono': "'JetBrains Mono',monospace", 'Georgia': 'Georgia,serif',
  'Times New Roman': "'Times New Roman',serif", 'Helvetica': 'Helvetica,Arial,sans-serif',
}

const BRAND_DEFAULTS = {
  name: 'Lakshay Kumar', title: 'Thinker & Builder — Product, AI & Data',
  contact: 'connect@lakshaykumar.com\nlakshaykumar.com\nlinkedin.com/in/lakshaykumar-tech\nBangalore, India',
  footer: 'Lakshay Kumar · Bangalore, India', footerOn: true, markOn: true, mark: 'LK', dotOn: true,
  layout: 'split', rule: 'thin', nameSize: 30, margin: 18,
  fName: 'Archivo', fBody: 'Space Grotesk', fMeta: 'JetBrains Mono', bodySize: 10.5,
  cInk: '#0A0A0B', cMute: '#6B6B6B', cAccent: '#0A0A0B', logo: '',
}
const DOC_OPTS = { letterhead: true, runHeader: true, pageNumbers: true }

/* =========================================================================
   Storage (IndexedDB, falls back to memory if unavailable)
   ========================================================================= */
const store = (() => {
  let dbp
  const mem = new Map()
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    setTimeout(() => rej(new Error('IndexedDB timed out')), 2000)
    const r = indexedDB.open('letterhead-docs', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
  const tx = async (mode, fn) => {
    try {
      const db = await open()
      return await new Promise((res, rej) => {
        const t = db.transaction('kv', mode); const req = fn(t.objectStore('kv'))
        t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error)
      })
    } catch (e) { storageBroken = true; throw e }
  }
  let storageBroken = false
  return {
    get: k => tx('readonly', s => s.get(k)).catch(() => mem.get(k)),
    set: (k, v) => tx('readwrite', s => s.put(v, k)).catch(e => { mem.set(k, v); throw e }),
    del: k => tx('readwrite', s => s.delete(k)).catch(() => mem.delete(k)),
    get broken() { return storageBroken },
  }
})()

/* =========================================================================
   Custom extensions
   ========================================================================= */
const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true, draggable: false,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'page-break' }],
  addNodeView: () => () => {
    const dom = document.createElement('div')
    dom.className = 'page-break'; dom.setAttribute('data-page-break', ''); dom.contentEditable = 'false'
    return { dom, ignoreMutation: () => true }
  },
  addCommands() { return { setPageBreak: () => ({ commands }) => commands.insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]) } },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() } },
})

const BLOCKS = ['paragraph', 'heading']
const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes: () => [{
    types: BLOCKS,
    attributes: {
      lineHeight: {
        default: null,
        parseHTML: el => el.style.lineHeight || null,
        renderHTML: a => a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {},
      },
      indent: {
        default: 0,
        parseHTML: el => +(el.getAttribute('data-indent') || 0),
        renderHTML: a => a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 10}mm` } : {},
      },
    },
  }],
  addCommands() {
    const each = (state, tr, fn) => {
      const { from, to } = state.selection
      state.doc.nodesBetween(from, to, (n, pos) => { if (BLOCKS.includes(n.type.name)) tr.setNodeMarkup(pos, undefined, fn(n.attrs)) })
    }
    return {
      setBlockLineHeight: v => ({ state, tr, dispatch }) => { if (dispatch) each(state, tr, a => ({ ...a, lineHeight: v })); return true },
      changeIndent: d => ({ state, tr, dispatch }) => {
        if (dispatch) each(state, tr, a => ({ ...a, indent: Math.max(0, Math.min(8, (a.indent || 0) + d)) }))
        return true
      },
    }
  },
  addKeyboardShortcuts() {
    const e = () => this.editor
    return {
      Tab: () => {
        if (e().isActive('table')) return false
        if (e().isActive('taskItem')) return e().commands.sinkListItem('taskItem')
        if (e().isActive('listItem')) return e().commands.sinkListItem('listItem')
        return e().commands.changeIndent(1)
      },
      'Shift-Tab': () => {
        if (e().isActive('table')) return false
        if (e().isActive('taskItem')) return e().commands.liftListItem('taskItem')
        if (e().isActive('listItem')) return e().commands.liftListItem('listItem')
        return e().commands.changeIndent(-1)
      },
    }
  },
})

/* Pagination: a zero-height widget at the top of the doc holds one full-width float
   per page boundary. Text lines that would cross a boundary get pushed below the float,
   so content flows line by line onto the next sheet — like a word processor. */
const pbKey = new PluginKey('pagination')
const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins: () => [new Plugin({
    key: pbKey,
    state: { init: () => ({ n: 0, c1: 0, cN: 0, B: 0 }), apply: (tr, v) => tr.getMeta(pbKey) || v },
    props: {
      decorations(state) {
        const v = pbKey.getState(state)
        if (!v.n) return null
        const key = `pb:${v.n}:${v.c1.toFixed(2)}:${v.cN.toFixed(2)}:${v.B.toFixed(2)}`
        return DecorationSet.create(state.doc, [Decoration.widget(0, () => {
          const wrap = document.createElement('div')
          wrap.className = 'pb-wrap'; wrap.contentEditable = 'false'
          // Floats exclude lines from their whole margin box, so a zero-width float
          // stands in for each page's text area and a full-width float forms the break.
          for (let i = 1; i <= v.n; i++) {
            const s = document.createElement('div')
            s.className = 'pb-spacer'
            s.style.height = (i === 1 ? v.c1 : v.cN) + 'px'
            const f = document.createElement('div')
            f.className = 'pb-float'
            f.style.height = v.B + 'px'
            wrap.append(s, f)
          }
          return wrap
        }, { side: -1, key, ignoreSelection: true })])
      },
    },
  })],
})

const findKey = new PluginKey('find')
function searchDoc(doc, term) {
  const out = [], q = term.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''; const map = []
    node.forEach((child, off) => {
      if (child.isText) { for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + off + i); text += child.text }
      else { map.push(pos + 1 + off); text += '￼' }
    })
    const hay = text.toLowerCase()
    for (let i = hay.indexOf(q); i !== -1; i = hay.indexOf(q, i + q.length)) out.push({ from: map[i], to: map[i + q.length - 1] + 1 })
    return false
  })
  return out
}
const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins: () => [new Plugin({
    key: findKey,
    state: {
      init: () => ({ term: '', idx: 0, m: [] }),
      apply(tr, v, _o, ns) {
        const meta = tr.getMeta(findKey)
        if (!meta && !tr.docChanged) return v
        const term = meta && 'term' in meta ? meta.term : v.term
        let idx = meta && 'idx' in meta ? meta.idx : v.idx
        const m = term ? searchDoc(ns.doc, term) : []
        idx = m.length ? ((idx % m.length) + m.length) % m.length : 0
        return { term, idx, m }
      },
    },
    props: {
      decorations(state) {
        const v = findKey.getState(state)
        if (!v.m.length) return null
        return DecorationSet.create(state.doc, v.m.map((r, i) => Decoration.inline(r.from, r.to, { class: i === v.idx ? 'find-cur' : 'find-hit' })))
      },
    },
  })],
})

/* =========================================================================
   App state
   ========================================================================= */
let brand = { ...BRAND_DEFAULTS }
let index = { docs: [], current: null }       // [{id,title,updated}]
let doc = null                                  // current doc record
let editor = null
let zoom = prefs.get('zoom', 1)
let autoFit = prefs.get('autoFit', true)   // follow the window width until the user zooms by hand
let printing = false
const geom = { top1: 0, topC: 0, bottom: 0, gap: SCREEN_GAP, pages: 1, key: '' }

/* =========================================================================
   Letterhead rendering
   ========================================================================= */
function linkify(line) {
  const t = line.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `<a href="mailto:${esc(t)}">${esc(t)}</a>`
  if (/^(https?:\/\/|www\.)|^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(t)) return `<a href="${esc(/^https?:/.test(t) ? t : 'https://' + t)}">${esc(t.replace(/^https?:\/\//, ''))}</a>`
  return esc(t)
}
const headerHTML = () => `
  <div class="lh-header" title="Edit letterhead">
    <div class="lh-row ${brand.layout === 'split' ? '' : brand.layout}">
      <div>
        <div class="lh-brand">${brand.logo ? `<img class="lh-logo" src="${brand.logo}" alt="">` : ''}
          <h2 class="lh-name">${esc(brand.name)}${brand.dotOn ? '<span class="dot">.</span>' : ''}</h2></div>
        ${brand.title ? `<div class="lh-title">${esc(brand.title)}</div>` : ''}
      </div>
      <div class="lh-contact">${brand.contact.split('\n').filter(s => s.trim()).map(linkify).join('<br>')}</div>
    </div>
    <div class="lh-rule ${brand.rule === 'thin' ? '' : brand.rule}"></div>
  </div>`
const runHeaderHTML = () => `
  <div class="run-header"><span class="n">${esc(brand.name)}${brand.dotOn ? '<i>.</i>' : ''}</span><span class="t">${esc(brand.title)}</span></div>`
const footerHTML = (p, n) => {
  const num = doc?.opts.pageNumbers ? `<span>Page ${p} of ${n}</span>` : ''
  const mk = brand.markOn ? `<span class="mk">${esc(brand.mark)}<i>.</i></span>` : ''
  return `<div class="lh-footer ${brand.footerOn ? '' : 'noline'}"><span>${brand.footerOn ? esc(brand.footer) : ''}</span><span class="r">${num}${mk}</span></div>`
}
const footerVisible = () => brand.footerOn || doc?.opts.pageNumbers

function applyBrand() {
  const r = document.documentElement.style
  r.setProperty('--ink', brand.cInk); r.setProperty('--mute', brand.cMute); r.setProperty('--accent', brand.cAccent)
  r.setProperty('--f-name', FONTS[brand.fName]); r.setProperty('--f-body', FONTS[brand.fBody]); r.setProperty('--f-meta', FONTS[brand.fMeta])
  r.setProperty('--name-size', brand.nameSize + 'pt'); r.setProperty('--margin', brand.margin + 'mm')
  r.setProperty('--body-size', brand.bodySize + 'pt')
  geom.key = ''
  schedulePaginate()
}

function measureGeom() {
  const m = $('measure')
  m.innerHTML = `<div>${headerHTML()}</div><div>${runHeaderHTML()}</div><div>${footerHTML(1, 1)}</div>`
  const [h1, rh, fh] = [...m.children].map(c => c.offsetHeight)
  const M = brand.margin * MM, o = doc.opts
  geom.topC = o.runHeader ? M + rh + 7 * MM : M
  geom.top1 = o.letterhead ? M + h1 + 10 * MM : geom.topC
  geom.bottom = footerVisible() ? M + fh + 7 * MM : M
  geom.gap = printing ? 0 : SCREEN_GAP
}

function renderMasks() {
  const { pages, gap, top1, topC, bottom } = geom
  let s = '', m = ''
  for (let k = 1; k <= pages; k++) {
    const y = (k - 1) * (PAGE_H + gap)
    const top = k === 1 ? top1 : topC
    s += `<div class="sheet" style="top:${y}px;height:${PAGE_H}px"></div>`
    const head = k === 1 && doc.opts.letterhead ? headerHTML() : doc.opts.runHeader ? runHeaderHTML() : ''
    // +1px keeps the band from starting a hair before the printed page edge, which would
    // slice its top padding onto the previous page
    const nudge = k > 1 ? 1 : 0
    m += `<div class="band" style="top:${y + nudge}px;height:${top - nudge}px;padding-top:calc(${brand.margin}mm - ${nudge}px)">${head}</div>`
    m += `<div class="band" style="top:${y + PAGE_H - bottom}px;height:${bottom}px;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:${brand.margin}mm">${footerVisible() ? footerHTML(k, pages) : ''}</div>`
    if (k < pages && gap) m += `<div class="band gap" style="top:${y + PAGE_H}px;height:${gap}px"></div>`
  }
  $('sheets').innerHTML = s
  $('masks').innerHTML = m
  const h = pages * PAGE_H + (pages - 1) * gap
  $('paper').style.height = h + 'px'
  $('host').style.paddingTop = top1 + 'px'
  sizeZoom()
  $('stPage').dataset.n = pages
  updatePageIndicator()
}

/* =========================================================================
   Pagination engine
   ========================================================================= */
let pagReq = 0
function schedulePaginate() { if (!pagReq) pagReq = requestAnimationFrame(() => { pagReq = 0; paginate() }) }

function paginate() {
  if (!editor || editor.isDestroyed) return
  measureGeom()
  const { top1, topC, bottom, gap } = geom
  const c1 = PAGE_H - top1 - bottom, cN = PAGE_H - topC - bottom, B = bottom + gap + topC
  const end = k => c1 + (k - 1) * (B + cN)             // content-space y where page k's text area ends
  const start = k => k === 1 ? 0 : end(k - 1) + B
  const root = editor.view.dom
  let st = pbKey.getState(editor.state)
  const setFloats = n => {
    if (st.n === n && st.c1 === c1 && st.cN === cN && st.B === B) return
    editor.view.dispatch(editor.state.tr.setMeta(pbKey, { n, c1, cN, B }).setMeta('addToHistory', false))
    st = pbKey.getState(editor.state)
  }
  setFloats(st.n)
  let pages = 1
  for (let iter = 0; iter < 40; iter++) {
    // forced page breaks: grow each to fill the rest of its page
    const breaks = root.querySelectorAll('.page-break')
    breaks.forEach(b => { b.style.height = '0px' })
    breaks.forEach(b => {
      const y = b.offsetTop
      let k = 1; while (y >= end(k) - 0.5) k++
      b.style.height = (y < start(k) ? 0 : end(k) - y) + 'px'
    })
    let el = root.lastElementChild
    while (el && el.classList.contains('pb-wrap')) el = el.previousElementSibling
    const bottomY = el ? el.offsetTop + el.offsetHeight : 0
    pages = 1; while (bottomY > end(pages) + 0.5) pages++
    if (pages - 1 === st.n) break
    setFloats(pages - 1)
  }
  const key = [pages, top1, topC, bottom, gap, JSON.stringify(brand), JSON.stringify(doc.opts)].join('|')
  geom.pages = pages
  if (key !== geom.key) { geom.key = key; renderMasks() }
}

/* =========================================================================
   Editor
   ========================================================================= */
function makeEditor(content) {
  if (editor) editor.destroy()
  $('host').innerHTML = ''
  editor = new Editor({
    element: $('host'),
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      TextStyle, Color, FontFamily, FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ allowBase64: true, resize: { enabled: true, directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], minWidth: 40, minHeight: 20, alwaysPreserveAspectRatio: true } }),
      TableKit.configure({ table: { resizable: true, cellMinWidth: 40 } }),
      TaskList, TaskItem.configure({ nested: true }),
      Subscript, Superscript, Typography,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      CharacterCount,
      PageBreak, BlockFormat, Pagination, Find,
    ],
    content,
    editorProps: {
      attributes: { spellcheck: 'true' },
      handlePaste: (view, e) => insertImageFiles([...(e.clipboardData?.files || [])]),
      handleDrop: (view, e) => {
        const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'))
        if (!files.length) return false
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })
        if (pos) editor.commands.setTextSelection(pos.pos)
        return insertImageFiles(files)
      },
    },
    onUpdate: () => { markDirty(); schedulePaginate(); scheduleSide() },
    onTransaction: () => scheduleRibbon(),
  })
  new ResizeObserver(schedulePaginate).observe(editor.view.dom)
  editor.view.dom.addEventListener('load', schedulePaginate, true)
  geom.key = ''
  paginate()
  updateRibbon(); renderOutline(); updateWords()
}

function insertImageFiles(files) {
  const imgs = files.filter(f => f.type.startsWith('image/'))
  if (!imgs.length) return false
  imgs.forEach(f => readImage(f).then(src => editor.chain().focus().setImage({ src }).run()))
  return true
}
function readImage(file) {
  return new Promise(res => {
    const rd = new FileReader()
    rd.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const max = 1800
        if (img.width <= max || file.type === 'image/svg+xml') return res(rd.result)
        const c = document.createElement('canvas'), s = max / img.width
        c.width = max; c.height = Math.round(img.height * s)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88))
      }
      img.src = rd.result
    }
    rd.readAsDataURL(file)
  })
}

/* =========================================================================
   Documents: load / save / switch
   ========================================================================= */
const setSaveState = t => { $('saveState').textContent = t }
let dirty = false
const saveNow = async () => {
  if (!doc || !editor || !dirty) return
  dirty = false
  doc.content = editor.getJSON(); doc.updated = Date.now()
  const it = index.docs.find(d => d.id === doc.id)
  if (it) { it.title = doc.title; it.updated = doc.updated }
  try {
    await store.set('doc:' + doc.id, doc); await store.set('index', index)
    setSaveState('Saved')
  } catch { dirty = true; setSaveState('Not saved — storage unavailable') }
  renderDocList()
}
const saveSoon = debounce(saveNow, 500)
function markDirty() { dirty = true; setSaveState('Saving…'); saveSoon() }

async function openDoc(id) {
  if (doc && editor) await saveNow()
  const rec = await store.get('doc:' + id)
  if (!rec) return
  doc = rec
  doc.opts = { ...DOC_OPTS, ...doc.opts }
  index.current = id; store.set('index', index).catch(() => {})
  $('docTitle').value = doc.title
  document.title = doc.title || 'Untitled'
  makeEditor(doc.content)
  renderDocList()
  $('canvas').scrollTop = 0
}

async function createDoc(tpl) {
  const t = TEMPLATES.find(x => x.id === tpl) || TEMPLATES[0]
  const rec = { id: uid(), title: t.docTitle || 'Untitled document', content: t.html(), opts: { ...DOC_OPTS, ...t.opts }, created: Date.now(), updated: Date.now() }
  await persistNew(rec)
}
async function persistNew(rec) {
  index.docs.unshift({ id: rec.id, title: rec.title, updated: rec.updated })
  try { await store.set('doc:' + rec.id, rec); await store.set('index', index) } catch {}
  await openDoc(rec.id)
  editor.commands.focus('end')
}
async function duplicateDoc(id) {
  if (doc && id === doc.id) await saveNow()
  const src = await store.get('doc:' + id)
  if (!src) return
  await persistNew({ ...structuredClone(src), id: uid(), title: src.title + ' (copy)', created: Date.now(), updated: Date.now() })
}
async function deleteDoc(id) {
  const it = index.docs.find(d => d.id === id)
  if (!confirm(`Delete “${it?.title || 'Untitled'}”? This cannot be undone.`)) return
  index.docs = index.docs.filter(d => d.id !== id)
  await store.del('doc:' + id).catch(() => {})
  if (doc?.id === id) {
    doc = null
    if (index.docs.length) await openDoc(index.docs[0].id)
    else await createDoc('letter-blank')
  }
  await store.set('index', index).catch(() => {})
  renderDocList()
}

/* =========================================================================
   Sidebar: docs list & outline
   ========================================================================= */
function renderDocList() {
  const q = $('docSearch').value.trim().toLowerCase()
  const fmt = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  $('docList').innerHTML = index.docs
    .filter(d => !q || (d.title || '').toLowerCase().includes(q))
    .sort((a, b) => b.updated - a.updated)
    .map(d => `<li data-id="${d.id}" class="${d.id === doc?.id ? 'on' : ''}">
      <div class="t"><b>${esc(d.title || 'Untitled')}</b><span>${fmt(d.updated)}</span></div>
      <div class="acts"><button class="icon-btn" data-a="dup" title="Duplicate">${icon('copy')}</button><button class="icon-btn" data-a="del" title="Delete">${icon('trash')}</button></div></li>`).join('')
}
function renderOutline() {
  if (!editor) return
  const items = []
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading' && n.attrs.level < 4) items.push(`<li data-pos="${pos}" data-l="${n.attrs.level}">${esc(n.textContent || '(empty heading)')}</li>`)
    return !n.isTextblock
  })
  $('outline').innerHTML = items.join('')
  $('outlineEmpty').hidden = items.length > 0
}
function updateWords() {
  if (!editor) return
  const w = editor.storage.characterCount.words()
  $('stWords').textContent = `${w.toLocaleString()} word${w === 1 ? '' : 's'} · ${editor.storage.characterCount.characters().toLocaleString()} characters`
}
const scheduleSide = debounce(() => { renderOutline(); updateWords() }, 250)

/* =========================================================================
   Icons
   ========================================================================= */
const P = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  alignLeft: 'M3 6h18M3 12h12M3 18h16', alignCenter: 'M3 6h18M6 12h12M4 18h16', alignRight: 'M3 6h18M9 12h12M5 18h16', alignJustify: 'M3 6h18M3 12h18M3 18h18',
  bullets: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01', numbers: 'M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M6 19H4c0-1.2 2-1.8 2-3 0-.6-.5-1-1-1s-1 .3-1 .8',
  tasks: 'M3 7l2 2 4-4M13 7h8M3 17l2 2 4-4M13 17h8', indent: 'M3 5h18M11 12h10M11 19h10M3 9l4 3-4 3', outdent: 'M3 5h18M11 12h10M11 19h10M7 9l-4 3 4 3',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  image: 'M3 5h18v14H3zM8.5 9.5h.01M21 15l-5-5L5 19', table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  pagebreak: 'M5 3v5h14V3M5 21v-5h14v5M3 12h2M8 12h3M13 12h3M19 12h2', hr: 'M3 12h18',
  quote: 'M6 8h4v4c0 2.5-1.5 4-4 4M14 8h4v4c0 2.5-1.5 4-4 4', code: 'm8 7-5 5 5 5M16 7l5 5-5 5',
  clear: 'M4 7V5h12v2M10 5 7.5 19M5 19h5M15 14l6 6M21 14l-6 6',
  sidebar: 'M3 4h18v16H3zM9 4v16', copy: 'M8 8h12v12H8zM16 8V4H4v12h4', trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
}
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n]}"/></svg>`

/* =========================================================================
   Ribbon
   ========================================================================= */
const b = (cmd, inner, title, cls = '') => `<button class="rb ${cls}" data-cmd="${cmd}" title="${esc(title)}" aria-label="${esc(title)}">${inner}</button>`
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]
const LHS = ['1', '1.15', '1.3', '1.5', '1.6', '1.8', '2']

function buildRibbon() {
  $('ribbon').innerHTML = `
  <div class="grp">${b('undo', icon('undo'), 'Undo (⌘Z)')}${b('redo', icon('redo'), 'Redo (⇧⌘Z)')}</div>
  <div class="grp">
    <select class="sel style" id="selStyle" title="Paragraph style">
      <option value="p">Normal text</option><option value="h1">Title / H1</option><option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option><option value="h4">Label (H4)</option><option value="quote">Quote</option><option value="code">Code block</option>
    </select>
    <select class="sel font" id="selFont" title="Font"><option value="">Default font</option>${Object.keys(FONTS).map(f => `<option style="font-family:${FONTS[f]}">${f}</option>`).join('')}</select>
    <select class="sel size" id="selSize" title="Font size (pt)"><option value="">Auto</option>${SIZES.map(s => `<option>${s}</option>`).join('')}</select>
  </div>
  <div class="grp">
    ${b('bold', '<b style="font-size:14px">B</b>', 'Bold (⌘B)')}${b('italic', '<i style="font-size:14px;font-family:Georgia">I</i>', 'Italic (⌘I)')}
    ${b('underline', '<u style="font-size:14px">U</u>', 'Underline (⌘U)')}${b('strike', '<s style="font-size:14px">S</s>', 'Strikethrough')}
    ${b('superscript', 'x<sup style="font-size:9px">2</sup>', 'Superscript')}${b('subscript', 'x<sub style="font-size:9px">2</sub>', 'Subscript')}
    ${b('code', icon('code'), 'Inline code')}
    ${b('color', '<b style="font-size:14px;margin-top:-4px">A</b><span class="bar" id="barColor" style="background:#0A0A0B"></span>', 'Text colour')}
    ${b('highlight', '<b style="font-size:13px;margin-top:-4px;padding:0 2px">ab</b><span class="bar" id="barHl" style="background:#FFE58A"></span>', 'Highlight')}
    ${b('clear', icon('clear'), 'Clear formatting')}
  </div>
  <div class="grp">
    ${b('alignLeft', icon('alignLeft'), 'Align left')}${b('alignCenter', icon('alignCenter'), 'Centre')}${b('alignRight', icon('alignRight'), 'Align right')}${b('alignJustify', icon('alignJustify'), 'Justify')}
    <select class="sel lh" id="selLh" title="Line spacing"><option value="">↕ Auto</option>${LHS.map(v => `<option value="${v}">↕ ${v}</option>`).join('')}</select>
  </div>
  <div class="grp">
    ${b('bullets', icon('bullets'), 'Bulleted list')}${b('numbers', icon('numbers'), 'Numbered list')}${b('tasks', icon('tasks'), 'Checklist')}
    ${b('outdent', icon('outdent'), 'Decrease indent (⇧Tab)')}${b('indent', icon('indent'), 'Increase indent (Tab)')}${b('quote', icon('quote'), 'Quote')}
  </div>
  <div class="grp"><span class="lbl">Insert</span>
    ${b('link', icon('link'), 'Link (⌘K)')}${b('image', icon('image'), 'Image')}${b('table', icon('table'), 'Table')}
    ${b('hr', icon('hr'), 'Divider line')}${b('pagebreak', icon('pagebreak'), 'Page break (⌘Enter)')}
  </div>
  <div class="grp"><span class="lbl">Page</span>
    ${b('optLetterhead', 'Letterhead', 'Full letterhead on page 1', 'txt')}${b('optRunHeader', 'Header', 'Slim header on following pages', 'txt')}${b('optPageNumbers', 'Page #', 'Page numbers in footer', 'txt')}
  </div>
  <div class="grp ctx" id="tableCtx" hidden><span class="lbl">Table</span>
    ${b('rowBefore', '+Row↑', 'Insert row above', 'txt')}${b('rowAfter', '+Row↓', 'Insert row below', 'txt')}
    ${b('colBefore', '+Col←', 'Insert column left', 'txt')}${b('colAfter', '+Col→', 'Insert column right', 'txt')}
    ${b('delRow', '−Row', 'Delete row', 'txt')}${b('delCol', '−Col', 'Delete column', 'txt')}
    ${b('merge', 'Merge', 'Merge cells', 'txt')}${b('split', 'Split', 'Split cell', 'txt')}
    ${b('headerRow', 'Header', 'Toggle header row', 'txt')}${b('delTable', 'Delete', 'Delete table', 'txt')}
  </div>`
}

let lastColor = '#0A0A0B', lastHl = '#FFE58A'
const C = () => editor.chain().focus()
const ACTIONS = {
  undo: () => C().undo().run(), redo: () => C().redo().run(),
  bold: () => C().toggleBold().run(), italic: () => C().toggleItalic().run(), underline: () => C().toggleUnderline().run(),
  strike: () => C().toggleStrike().run(), superscript: () => C().toggleSuperscript().run(), subscript: () => C().toggleSubscript().run(),
  code: () => C().toggleCode().run(),
  clear: () => C().unsetAllMarks().unsetTextAlign().setBlockLineHeight(null).run(),
  alignLeft: () => C().setTextAlign('left').run(), alignCenter: () => C().setTextAlign('center').run(),
  alignRight: () => C().setTextAlign('right').run(), alignJustify: () => C().setTextAlign('justify').run(),
  bullets: () => C().toggleBulletList().run(), numbers: () => C().toggleOrderedList().run(), tasks: () => C().toggleTaskList().run(),
  indent: () => editor.isActive('taskItem') ? C().sinkListItem('taskItem').run() : editor.isActive('listItem') ? C().sinkListItem('listItem').run() : C().changeIndent(1).run(),
  outdent: () => editor.isActive('taskItem') ? C().liftListItem('taskItem').run() : editor.isActive('listItem') ? C().liftListItem('listItem').run() : C().changeIndent(-1).run(),
  quote: () => C().toggleBlockquote().run(),
  link: () => linkDialog(),
  image: () => pickFile('image/*', f => insertImageFiles([f])),
  table: el => tablePicker(el),
  hr: () => C().setHorizontalRule().run(),
  pagebreak: () => C().setPageBreak().run(),
  color: el => colorPop(el, 'color'), highlight: el => colorPop(el, 'hl'),
  optLetterhead: () => toggleOpt('letterhead'), optRunHeader: () => toggleOpt('runHeader'), optPageNumbers: () => toggleOpt('pageNumbers'),
  rowBefore: () => C().addRowBefore().run(), rowAfter: () => C().addRowAfter().run(),
  colBefore: () => C().addColumnBefore().run(), colAfter: () => C().addColumnAfter().run(),
  delRow: () => C().deleteRow().run(), delCol: () => C().deleteColumn().run(),
  merge: () => C().mergeCells().run(), split: () => C().splitCell().run(),
  headerRow: () => C().toggleHeaderRow().run(), delTable: () => C().deleteTable().run(),
}
function toggleOpt(k) { doc.opts[k] = !doc.opts[k]; geom.key = ''; paginate(); updateRibbon(); markDirty() }

let ribReq = 0
function scheduleRibbon() { if (!ribReq) ribReq = requestAnimationFrame(() => { ribReq = 0; updateRibbon() }) }
function updateRibbon() {
  if (!editor) return
  const e = editor, on = (cmd, v) => { const el = $('ribbon').querySelector(`[data-cmd="${cmd}"]`); if (el) el.classList.toggle('on', !!v) }
  ;['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'code'].forEach(m => on(m, e.isActive(m)))
  ;['left', 'center', 'right', 'justify'].forEach(a => on('align' + a[0].toUpperCase() + a.slice(1), e.isActive({ textAlign: a })))
  on('bullets', e.isActive('bulletList')); on('numbers', e.isActive('orderedList')); on('tasks', e.isActive('taskList'))
  on('quote', e.isActive('blockquote')); on('link', e.isActive('link'))
  on('optLetterhead', doc.opts.letterhead); on('optRunHeader', doc.opts.runHeader); on('optPageNumbers', doc.opts.pageNumbers)
  const dis = (cmd, v) => { const el = $('ribbon').querySelector(`[data-cmd="${cmd}"]`); if (el) el.disabled = !v }
  dis('undo', e.can().undo()); dis('redo', e.can().redo())
  let style = 'p'
  for (let l = 1; l <= 4; l++) if (e.isActive('heading', { level: l })) style = 'h' + l
  if (e.isActive('codeBlock')) style = 'code'
  else if (e.isActive('blockquote') && style === 'p') style = 'quote'
  $('selStyle').value = style
  const ts = e.getAttributes('textStyle')
  const first = (ts.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim()
  const fam = Object.keys(FONTS).find(k => k === first) || ''
  $('selFont').value = fam
  $('selSize').value = ts.fontSize ? String(parseFloat(ts.fontSize)) : ''
  const blk = e.getAttributes('paragraph').lineHeight || e.getAttributes('heading').lineHeight || ''
  $('selLh').value = LHS.includes(blk) ? blk : ''
  $('tableCtx').hidden = !e.isActive('table')
}

function bindRibbon() {
  const rb = $('ribbon')
  rb.addEventListener('mousedown', e => { if (e.target.closest('.rb')) e.preventDefault() })
  rb.addEventListener('click', e => {
    const btn = e.target.closest('.rb'); if (!btn || btn.disabled) return
    ACTIONS[btn.dataset.cmd]?.(btn)
  })
  $('selStyle').addEventListener('change', e => {
    const v = e.target.value, c = C()
    if (v === 'p') c.setParagraph()
    else if (v === 'quote') { c.setParagraph(); if (!editor.isActive('blockquote')) c.toggleBlockquote() }
    else if (v === 'code') c.toggleCodeBlock()
    else c.setHeading({ level: +v[1] })
    c.run()
  })
  $('selFont').addEventListener('change', e => e.target.value ? C().setFontFamily(FONTS[e.target.value]).run() : C().unsetFontFamily().run())
  $('selSize').addEventListener('change', e => e.target.value ? C().setFontSize(e.target.value + 'pt').run() : C().unsetFontSize().run())
  $('selLh').addEventListener('change', e => C().setBlockLineHeight(e.target.value || null).run())
}

/* =========================================================================
   Popovers & dialogs
   ========================================================================= */
let popAnchor = null
function openPop(anchor, html, onReady) {
  const pop = $('pop')
  pop.innerHTML = html; pop.hidden = false; popAnchor = anchor
  const r = anchor.getBoundingClientRect()
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px'
  pop.style.top = r.bottom + 6 + 'px'
  onReady?.(pop)
}
function closePop() { $('pop').hidden = true; popAnchor = null }
document.addEventListener('mousedown', e => {
  if (!$('pop').hidden && !$('pop').contains(e.target) && !popAnchor?.contains(e.target)) closePop()
  if (!$('fileMenu').hidden && !e.target.closest('.menu-wrap')) $('fileMenu').hidden = true
})

const TEXT_COLORS = ['#0A0A0B', '#3A3A3C', '#6B6B6B', '#9A9A9A', '#C8C8C8', '#FFFFFF', '#FF4A1C', '#C2410C', '#B91C1C', '#15803D', '#1D4ED8', '#6D28D9']
const HL_COLORS = ['#FFF3A3', '#FFE58A', '#FFE0B2', '#FFD6D6', '#D9F2DD', '#D6E6FF', '#ECE0FF', '#EDEDED', '#FFC9A8', '#C8F0E8', '#F5D0FE', '#E2E8F0']
function colorPop(anchor, kind) {
  const list = kind === 'color' ? TEXT_COLORS : HL_COLORS
  openPop(anchor, `<div class="swatches"><button class="none" data-c="" title="None"></button>${list.map(c => `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
    <div class="row">Custom <input type="color" id="popCustom" value="${kind === 'color' ? lastColor : lastHl}"></div>`, pop => {
    const apply = c => {
      if (kind === 'color') { c ? C().setColor(c).run() : C().unsetColor().run(); if (c) { lastColor = c; $('barColor').style.background = c } }
      else { c ? C().setHighlight({ color: c }).run() : C().unsetHighlight().run(); if (c) { lastHl = c; $('barHl').style.background = c } }
    }
    pop.querySelector('.swatches').addEventListener('mousedown', e => e.preventDefault())
    pop.querySelector('.swatches').addEventListener('click', e => { const s = e.target.closest('[data-c]'); if (s) { apply(s.dataset.c); closePop() } })
    pop.querySelector('#popCustom').addEventListener('change', e => { apply(e.target.value); closePop() })
  })
}
function tablePicker(anchor) {
  openPop(anchor, `<div class="grid-pick">${Array.from({ length: 64 }, (_, i) => `<span data-r="${(i / 8 | 0) + 1}" data-c="${i % 8 + 1}"></span>`).join('')}</div><div class="grid-label" id="gl">Insert table</div>`, pop => {
    const g = pop.querySelector('.grid-pick')
    g.addEventListener('mouseover', e => {
      const s = e.target.closest('span'); if (!s) return
      const r = +s.dataset.r, c = +s.dataset.c
      g.querySelectorAll('span').forEach(x => x.classList.toggle('on', +x.dataset.r <= r && +x.dataset.c <= c))
      pop.querySelector('#gl').textContent = `${r} × ${c}`
    })
    g.addEventListener('mousedown', e => e.preventDefault())
    g.addEventListener('click', e => {
      const s = e.target.closest('span'); if (!s) return
      C().insertTable({ rows: +s.dataset.r, cols: +s.dataset.c, withHeaderRow: true }).run(); closePop()
    })
  })
}

function modal(html, bind) {
  $('modalBody').innerHTML = html; $('modal').hidden = false
  const close = () => { $('modal').hidden = true; $('modalBody').innerHTML = '' }
  $('modal').onmousedown = e => { if (e.target === $('modal')) close() }
  bind?.($('modalBody'), close)
  return close
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('modal').hidden) { $('modal').hidden = true; editor?.commands.focus() } closePop() } })

function linkDialog() {
  const cur = editor.getAttributes('link').href || ''
  const { from, to } = editor.state.selection
  const hasText = from !== to
  modal(`<h2>${cur ? 'Edit link' : 'Insert link'}</h2>
    <label class="field">URL<input id="lkUrl" value="${esc(cur)}" placeholder="https://"></label>
    ${!hasText && !cur ? '<label class="field">Text to display<input id="lkText" placeholder="Optional"></label>' : ''}
    <div class="btn-row">${cur ? '<button class="tb-btn" id="lkRemove">Remove link</button>' : ''}<button class="tb-btn" id="lkCancel">Cancel</button><button class="tb-btn primary" id="lkOk">Apply</button></div>`,
  (m, close) => {
    const url = m.querySelector('#lkUrl'); url.focus(); url.select()
    const ok = () => {
      let href = url.value.trim(); close()
      if (!href) return C().run()
      if (!/^(https?:|mailto:|tel:|#)/.test(href)) href = (href.includes('@') && !href.includes('/') ? 'mailto:' : 'https://') + href
      const text = m.querySelector('#lkText')?.value.trim()
      if (!hasText && !cur) C().insertContent({ type: 'text', text: text || href.replace(/^(https?:\/\/|mailto:)/, ''), marks: [{ type: 'link', attrs: { href } }] }).run()
      else C().extendMarkRange('link').setLink({ href }).run()
    }
    m.querySelector('#lkOk').onclick = ok
    m.querySelector('#lkCancel').onclick = () => { close(); C().run() }
    m.querySelector('#lkRemove')?.addEventListener('click', () => { close(); C().extendMarkRange('link').unsetLink().run() })
    m.addEventListener('keydown', e => { if (e.key === 'Enter') ok() })
  })
}

function pickFile(accept, cb) {
  const f = $('fileIn'); f.accept = accept; f.value = ''
  f.onchange = () => f.files[0] && cb(f.files[0])
  f.click()
}

/* =========================================================================
   Templates
   ========================================================================= */
const sig = () => `<p>Kind regards,</p><p><strong>${esc(brand.name)}</strong></p>`
const dateLine = () => `<h4>${today()}</h4>`
const TEMPLATES = [
  { id: 'letter-blank', name: 'Blank letterhead', desc: 'Your letterhead, empty page.', docTitle: 'Untitled document', html: () => '<p></p>' },
  {
    id: 'letter', name: 'Letter', desc: 'Date, recipient, subject, body, sign-off.', docTitle: 'Letter',
    html: () => `${dateLine()}<p>Recipient Name<br>Organisation<br>City, Country</p><p><strong>Subject: Write the subject here</strong></p><p>Dear Recipient,</p><p>Opening paragraph — state why you are writing in one or two sentences.</p><p>Body — the details. Keep paragraphs short and let the whitespace do the work.</p><p>Closing — what you would like to happen next.</p>${sig()}`,
  },
  {
    id: 'shortlist', name: 'Counsellor shortlist', desc: 'University shortlist, priorities and links.', docTitle: 'Programme shortlist',
    html: () => {
      const row = (u, c, d, l) => `<tr><td><p><strong>${u}</strong></p><p>${c}</p><p><a href="${l}">${l.replace('https://', '')}</a></p></td><td><p>${d}</p></td></tr>`
      const tbl = rows => `<table><tbody><tr><th><p>University &amp; programme</p></th><th><p>Duration</p></th></tr>${rows}</tbody></table>`
      return `${dateLine()}<p>Dear Counsellor,</p><p>Please find below my shortlist of programmes for application, in order of priority. I would be grateful for your guidance on next steps.</p>
      <h3>Priority 1</h3>${tbl(
        row('University of Otago', 'Master of Business – Business Analytics', '180 pts · 12 months', 'https://www.otago.ac.nz/degree-requirements/master-of-business-mbus-business-analytics') +
        row('University of Canterbury', 'Master of Artificial Intelligence', '180 pts · 18 months', 'https://www.canterbury.ac.nz/study/academic-study/qualifications/master-of-artificial-intelligence') +
        row('University of Auckland', 'Master of Artificial Intelligence (120-pt)', '120 pts · ~1 year', 'https://www.auckland.ac.nz/mai'))}
      <h3>Priority 2</h3>${tbl(
        row('University of Otago', 'MSc (Thesis) – Cognitive Science (120-pt)', '120 pts · 1 year', 'https://www.otago.ac.nz/study/subjects/cognitive-science') +
        row('Victoria University of Wellington', 'MSc by coursework and thesis – CS / Cognitive Science', '120 pts (to be verified)', 'https://www.wgtn.ac.nz/explore/postgraduate-programmes/master-of-science-by-coursework-and-thesis/about'))}
      ${sig()}`
    },
  },
  {
    id: 'proposal', name: 'Proposal / report', desc: 'Title, summary, sections, table, next steps.', docTitle: 'Proposal',
    html: () => `<h1>Proposal title</h1><h4>${today()} · Prepared by ${esc(brand.name)}</h4>
      <h2>Summary</h2><p>One paragraph that a busy reader can stop after. What is the problem, what do you propose, what will it change?</p>
      <h2>Context</h2><p>What is true today, with numbers where you have them.</p>
      <h2>Approach</h2><ol><li><p><strong>Discover</strong> — understand the data and the decision it feeds.</p></li><li><p><strong>Build</strong> — ship the smallest useful version.</p></li><li><p><strong>Measure</strong> — agree on the metric before launch.</p></li></ol>
      <h2>Timeline</h2><table><tbody><tr><th><p>Phase</p></th><th><p>Weeks</p></th><th><p>Outcome</p></th></tr><tr><td><p>Discover</p></td><td><p>1–2</p></td><td><p>Problem brief</p></td></tr><tr><td><p>Build</p></td><td><p>3–6</p></td><td><p>Working pilot</p></td></tr><tr><td><p>Measure</p></td><td><p>7–8</p></td><td><p>Impact report</p></td></tr></tbody></table>
      <h2>Next steps</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Confirm scope</p></li><li data-type="taskItem" data-checked="false"><p>Share data access</p></li></ul>`,
  },
  {
    id: 'notes', name: 'Meeting notes', desc: 'Attendees, agenda, decisions, actions.', docTitle: 'Meeting notes',
    html: () => `<h1>Meeting notes</h1><h4>${today()}</h4><h3>Attendees</h3><p>Names</p><h3>Agenda</h3><ol><li><p>Item one</p></li><li><p>Item two</p></li></ol><h3>Decisions</h3><ul><li><p>Decision</p></li></ul><h3>Actions</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Owner — action — date</p></li></ul>`,
    opts: { letterhead: false },
  },
  {
    id: 'plain', name: 'Plain document', desc: 'No letterhead or header — just pages.', docTitle: 'Untitled document',
    html: () => '<p></p>', opts: { letterhead: false, runHeader: false, pageNumbers: true },
  },
]
function newDocDialog() {
  modal(`<h2>New document</h2><div class="tpl-grid">${TEMPLATES.map(t => `<button class="tpl" data-t="${t.id}"><b>${t.name}</b><span>${t.desc}</span></button>`).join('')}</div>`,
    (m, close) => m.querySelector('.tpl-grid').addEventListener('click', e => { const t = e.target.closest('.tpl'); if (t) { close(); createDoc(t.dataset.t) } }))
}

/* =========================================================================
   Letterhead panel
   ========================================================================= */
function buildBrandPanel() {
  const fontOpts = (sel, list) => list.map(f => `<option ${f === sel ? 'selected' : ''}>${f}</option>`).join('')
  const seg = (k, opts) => `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${brand[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`
  $('brandBody').innerHTML = `
  <section class="sec"><div class="sec-h">Identity</div>
    <label><span>Name</span><input type="text" data-k="name" value="${esc(brand.name)}"></label>
    <label><span>Title / tagline</span><input type="text" data-k="title" value="${esc(brand.title)}"></label>
    <label class="chk"><input type="checkbox" data-k="dotOn" ${brand.dotOn ? 'checked' : ''}> Accent dot after name</label>
    <label style="margin-top:9px"><span>Logo</span><input type="file" id="logoFile" accept="image/*" style="font-size:11px"></label>
    ${brand.logo ? '<button class="tb-btn" id="logoClear">Remove logo</button>' : ''}
  </section>
  <section class="sec"><div class="sec-h">Contact (one per line)</div><label><textarea data-k="contact">${esc(brand.contact)}</textarea></label></section>
  <section class="sec"><div class="sec-h">Footer</div>
    <label class="chk"><input type="checkbox" data-k="footerOn" ${brand.footerOn ? 'checked' : ''}> Footer line &amp; text</label>
    <label style="margin-top:8px"><input type="text" data-k="footer" value="${esc(brand.footer)}"></label>
    <label class="chk"><input type="checkbox" data-k="markOn" ${brand.markOn ? 'checked' : ''}> Monogram</label>
    <label style="margin-top:8px"><input type="text" data-k="mark" value="${esc(brand.mark)}"></label>
  </section>
  <section class="sec"><div class="sec-h">Layout</div>
    ${seg('layout', [['split', 'Split'], ['center', 'Center'], ['stack', 'Stack']])}
    ${seg('rule', [['none', 'No rule'], ['thin', 'Thin'], ['thick', 'Thick']])}
    <label><span>Name size <b>${brand.nameSize}pt</b></span><input type="range" data-k="nameSize" min="16" max="56" step="1" value="${brand.nameSize}"></label>
    <label><span>Page margin <b>${brand.margin}mm</b></span><input type="range" data-k="margin" min="10" max="30" step="1" value="${brand.margin}"></label>
  </section>
  <section class="sec"><div class="sec-h">Type</div>
    <label><span>Name font</span><select data-k="fName">${fontOpts(brand.fName, ['Archivo', 'Space Grotesk', 'Inter', 'Fraunces', 'JetBrains Mono'])}</select></label>
    <label><span>Body font (default)</span><select data-k="fBody">${fontOpts(brand.fBody, Object.keys(FONTS))}</select></label>
    <label><span>Body size <b>${brand.bodySize}pt</b></span><input type="range" data-k="bodySize" min="9" max="13" step="0.5" value="${brand.bodySize}"></label>
    <label><span>Meta font</span><select data-k="fMeta">${fontOpts(brand.fMeta, ['JetBrains Mono', 'Space Grotesk', 'Inter'])}</select></label>
  </section>
  <section class="sec"><div class="sec-h">Colour</div>
    <div class="colors">
      <label>Ink<input type="color" data-k="cInk" value="${brand.cInk}"></label>
      <label>Muted<input type="color" data-k="cMute" value="${brand.cMute}"></label>
      <label>Accent<input type="color" data-k="cAccent" value="${brand.cAccent}"></label>
    </div>
  </section>
  <section class="sec"><button class="tb-btn" id="brandReset">Reset letterhead to default</button></section>`
}
const saveBrand = debounce(() => store.set('brand', brand).catch(() => {}), 300)
function bindBrandPanel() {
  const body = $('brandBody')
  const upd = (k, v, rebuild) => { brand[k] = v; applyBrand(); saveBrand(); if (rebuild) buildBrandPanel() }
  body.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value
    if (e.target.type === 'range') e.target.previousElementSibling.querySelector('b').textContent = v + (k === 'margin' ? 'mm' : 'pt')
    upd(k, v)
  })
  body.addEventListener('change', e => {
    if (e.target.id === 'logoFile' && e.target.files[0]) readImage(e.target.files[0]).then(src => upd('logo', src, true))
  })
  body.addEventListener('click', e => {
    const s = e.target.closest('.seg button')
    if (s) return upd(s.parentElement.dataset.seg, s.dataset.v, true)
    if (e.target.id === 'logoClear') upd('logo', '', true)
    if (e.target.id === 'brandReset' && confirm('Reset the letterhead to its default settings?')) { brand = { ...BRAND_DEFAULTS }; applyBrand(); saveBrand(); buildBrandPanel() }
  })
}
function toggleBrand(show = $('brandPanel').hidden) {
  $('brandPanel').hidden = !show; if (show) buildBrandPanel()
  if (show && narrow()) $('left').classList.add('hidden')
  syncScrim(); if (!narrow()) fitIfNeeded()
}

/* =========================================================================
   Find & replace
   ========================================================================= */
const findState = () => findKey.getState(editor.state)
function openFind() { $('findbar').hidden = false; const i = $('findInput'); const { from, to } = editor.state.selection; if (to > from && to - from < 80) i.value = editor.state.doc.textBetween(from, to); i.focus(); i.select(); runFind() }
function closeFind() { $('findbar').hidden = true; editor.view.dispatch(editor.state.tr.setMeta(findKey, { term: '' })); editor.commands.focus() }
function runFind(idx = 0) { editor.view.dispatch(editor.state.tr.setMeta(findKey, { term: $('findInput').value, idx })); showFind(false) }
function showFind(select = true) {
  const v = findState()
  $('findCount').textContent = v.term ? (v.m.length ? `${v.idx + 1} of ${v.m.length}` : 'No results') : ''
  if (select && v.m.length) {
    const r = v.m[v.idx]
    editor.chain().setTextSelection(r).scrollIntoView().run()
  }
}
function stepFind(d) { const v = findState(); if (!v.m.length) return; editor.view.dispatch(editor.state.tr.setMeta(findKey, { idx: v.idx + d })); showFind() }
function replaceOne() {
  const v = findState(); if (!v.m.length) return
  const r = v.m[v.idx], t = $('replInput').value
  const tr = editor.state.tr
  t ? tr.insertText(t, r.from, r.to) : tr.delete(r.from, r.to)
  editor.view.dispatch(tr); showFind()
}
function replaceAll() {
  const v = findState(); if (!v.m.length) return
  const t = $('replInput').value, tr = editor.state.tr
  ;[...v.m].reverse().forEach(r => t ? tr.insertText(t, r.from, r.to) : tr.delete(r.from, r.to))
  editor.view.dispatch(tr); showFind(false)
}

/* =========================================================================
   Import / export
   ========================================================================= */
function download(name, data, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
const fileBase = () => (doc.title || 'document').replace(/[\\/:*?"<>|]+/g, '').trim() || 'document'
function docCSS() {
  return `body{font-family:${FONTS[brand.fBody]};font-size:${brand.bodySize}pt;line-height:1.6;color:${brand.cInk}}
  h1,h2,h3{font-family:${FONTS[brand.fName]};letter-spacing:-.02em;line-height:1.2}
  h1{font-size:22pt}h2{font-size:15pt}h3{font-size:12pt}h4{font-family:${FONTS[brand.fMeta]};font-size:8pt;font-weight:500;text-transform:uppercase;letter-spacing:.14em;color:${brand.cMute}}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #BDBBB5;padding:6px 8px;vertical-align:top;text-align:left}th{background:#F4F3F0}
  blockquote{border-left:2px solid ${brand.cInk};margin:0 0 1em;padding-left:1em;font-style:italic}
  img{max-width:100%}a{color:inherit}
  .lh-name{font-family:${FONTS[brand.fName]};font-weight:800;font-size:${brand.nameSize}pt;letter-spacing:-.04em;margin:0;line-height:1}
  .lh-meta{font-family:${FONTS[brand.fMeta]};font-size:7.5pt;color:${brand.cMute};letter-spacing:.1em}`
}
function exportHeaderTable() {
  return `<table style="border:0;width:100%;border-bottom:1.5pt solid ${brand.cInk};margin-bottom:18pt"><tr>
    <td style="border:0;padding:0 0 12pt;vertical-align:bottom"><p class="lh-name">${esc(brand.name)}${brand.dotOn ? '.' : ''}</p><p class="lh-meta" style="text-transform:uppercase;margin:4pt 0 0">${esc(brand.title)}</p></td>
    <td style="border:0;padding:0 0 12pt;text-align:right;vertical-align:bottom" class="lh-meta">${brand.contact.split('\n').filter(Boolean).map(esc).join('<br>')}</td></tr></table>`
}
function exportBody() {
  return editor.getHTML().replace(/<div data-page-break="" class="page-break"><\/div>/g, '<br clear="all" style="page-break-before:always">')
}
function exportWord() {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page WordSection1{size:595.3pt 841.9pt;margin:${brand.margin * 2.835}pt}div.WordSection1{page:WordSection1}p{margin:0 0 8pt}${docCSS()}</style></head>
<body><div class="WordSection1">${doc.opts.letterhead ? exportHeaderTable() : ''}${exportBody()}</div></body></html>`
  download(fileBase() + '.doc', '﻿' + html, 'application/msword')
}
function exportHTML() {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.title)}</title>
<style>body{max-width:720px;margin:48px auto;padding:0 20px}${docCSS()}</style></head><body>${doc.opts.letterhead ? exportHeaderTable() : ''}${exportBody()}</body></html>`
  download(fileBase() + '.html', html, 'text/html')
}
async function backupAll() {
  await saveNow()
  const docs = (await Promise.all(index.docs.map(d => store.get('doc:' + d.id)))).filter(Boolean)
  download(`letterhead-docs-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'letterhead-docs', version: 1, brand, docs }, null, 1), 'application/json')
}
async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text())
    if (!Array.isArray(data.docs)) throw new Error('No documents in file')
    if (!confirm(`Restore ${data.docs.length} document(s)${data.brand ? ' and letterhead settings' : ''}? Documents with the same ID will be overwritten.`)) return
    if (data.brand) { brand = { ...BRAND_DEFAULTS, ...data.brand }; await store.set('brand', brand).catch(() => {}); applyBrand() }
    for (const d of data.docs) {
      await store.set('doc:' + d.id, d).catch(() => {})
      index.docs = index.docs.filter(x => x.id !== d.id)
      index.docs.push({ id: d.id, title: d.title, updated: d.updated || Date.now() })
    }
    await store.set('index', index).catch(() => {})
    await openDoc(data.docs[0].id)
  } catch (e) { alert('Could not restore backup: ' + e.message) }
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s) }) }
async function importDocx(file) {
  try {
    if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js')
    const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    await persistNew({ id: uid(), title: file.name.replace(/\.docx$/i, ''), content: r.value || '<p></p>', opts: { ...DOC_OPTS }, created: Date.now(), updated: Date.now() })
  } catch (e) { alert('Could not open this .docx: ' + e.message) }
}
async function importHTML(file) {
  const html = await file.text()
  const body = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
  await persistNew({ id: uid(), title: file.name.replace(/\.html?$/i, ''), content: body, opts: { ...DOC_OPTS }, created: Date.now(), updated: Date.now() })
}
const FILE_ACTS = {
  new: newDocDialog, duplicate: () => duplicateDoc(doc.id),
  'open-docx': () => pickFile('.docx', importDocx), 'open-html': () => pickFile('.html,.htm', importHTML),
  restore: () => pickFile('application/json,.json', restoreBackup),
  find: () => openFind(), brand: () => toggleBrand(true), lock: () => lockNow(),
  pdf: () => window.print(), doc: exportWord, html: exportHTML, backup: backupAll,
}

/* =========================================================================
   Zoom, status, print
   ========================================================================= */
function sizeZoom() {
  const h = parseFloat($('paper').style.height) || PAGE_H
  const z = printing ? 1 : zoom
  $('paper').style.transform = `scale(${z})`
  $('zoomwrap').style.width = PAGE_W * z + 'px'
  $('zoomwrap').style.height = h * z + 'px'
}
function setZoom(z) {
  zoom = Math.max(0.3, Math.min(2, Math.round(z * 100) / 100))
  prefs.set('zoom', zoom)
  $('zoom').value = Math.round(zoom * 100); $('zoomVal').textContent = Math.round(zoom * 100) + '%'
  sizeZoom(); updatePageIndicator()
}
const narrow = () => matchMedia('(max-width: 900px)').matches
const canvasRoom = () => $('canvas').clientWidth - (narrow() ? 24 : 48)
function fitWidth() { setZoom(Math.min(1.5, canvasRoom() / PAGE_W)) }
function setAuto(v) { autoFit = v; prefs.set('autoFit', v) }
function fitIfNeeded() {
  requestAnimationFrame(() => {
    if (autoFit) setZoom(Math.min(1, canvasRoom() / PAGE_W))
    else if (PAGE_W * zoom > canvasRoom()) fitWidth()
  })
}
// on small screens the side panels float over the page; a scrim closes them
function syncScrim() { $('scrim').hidden = !(narrow() && (!$('left').classList.contains('hidden') || !$('brandPanel').hidden)) }
function updatePageIndicator() {
  const c = $('canvas'), n = geom.pages
  const step = (PAGE_H + geom.gap) * zoom
  const p = Math.min(n, Math.max(1, Math.floor((c.scrollTop + c.clientHeight * 0.35 - 28) / step) + 1))
  $('stPage').textContent = `Page ${p} of ${n}`
}
window.addEventListener('beforeprint', () => {
  printing = true; document.title = doc?.title || 'Document'
  geom.key = ''; paginate()
})
window.addEventListener('afterprint', () => { printing = false; geom.key = ''; paginate() })

/* =========================================================================
   Wiring
   ========================================================================= */
function bindUI() {
  $('toggleLeft').innerHTML = icon('sidebar')
  $('toggleLeft').onclick = () => {
    $('left').classList.toggle('hidden')
    if (narrow()) { if (!$('left').classList.contains('hidden')) $('brandPanel').hidden = true }
    else { prefs.set('left', !$('left').classList.contains('hidden')); fitIfNeeded() }
    syncScrim()
  }
  if (narrow() || !prefs.get('left', true)) $('left').classList.add('hidden')
  $('scrim').onclick = () => { $('left').classList.add('hidden'); $('brandPanel').hidden = true; syncScrim() }

  $('docTitle').addEventListener('input', e => { doc.title = e.target.value; document.title = doc.title || 'Untitled'; markDirty() })
  $('docTitle').addEventListener('keydown', e => { if (e.key === 'Enter') editor.commands.focus() })

  document.querySelector('.tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t))
    $('paneDocs').hidden = t.dataset.tab !== 'docs'; $('paneOutline').hidden = t.dataset.tab !== 'outline'
  })
  $('docSearch').addEventListener('input', renderDocList)
  $('btnNew').onclick = newDocDialog
  $('docList').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return
    const a = e.target.closest('[data-a]')?.dataset.a
    if (a === 'dup') duplicateDoc(li.dataset.id)
    else if (a === 'del') deleteDoc(li.dataset.id)
    else {
      if (li.dataset.id !== doc?.id) openDoc(li.dataset.id)
      if (narrow()) { $('left').classList.add('hidden'); syncScrim() }
    }
  })
  $('outline').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return
    editor.chain().focus().setTextSelection(+li.dataset.pos + 1).scrollIntoView().run()
    if (narrow()) { $('left').classList.add('hidden'); syncScrim() }
  })

  $('btnBrand').onclick = () => toggleBrand()
  $('brandClose').onclick = () => toggleBrand(false)
  $('masks').addEventListener('click', e => { if (e.target.closest('.lh-header')) toggleBrand(true) })
  $('btnPdf').onclick = () => window.print()
  $('btnFile').onclick = () => { $('fileMenu').hidden = !$('fileMenu').hidden }
  $('fileMenu').addEventListener('click', e => { const bt = e.target.closest('[data-act]'); if (!bt) return; $('fileMenu').hidden = true; FILE_ACTS[bt.dataset.act]?.() })

  $('btnFind').onclick = openFind
  $('findInput').addEventListener('input', () => runFind())
  $('findInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1) } if (e.key === 'Escape') closeFind() })
  $('replInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne() } if (e.key === 'Escape') closeFind() })
  $('findNext').onclick = () => stepFind(1); $('findPrev').onclick = () => stepFind(-1)
  $('replOne').onclick = replaceOne; $('replAll').onclick = replaceAll; $('findClose').onclick = closeFind

  $('zoom').addEventListener('input', e => { setAuto(false); setZoom(e.target.value / 100) })
  $('zoomIn').onclick = () => { setAuto(false); setZoom(zoom + 0.1) }
  $('zoomOut').onclick = () => { setAuto(false); setZoom(zoom - 0.1) }
  $('zoomFit').onclick = () => { setAuto(true); fitIfNeeded() }
  $('canvas').addEventListener('scroll', updatePageIndicator, { passive: true })
  $('canvas').addEventListener('mousedown', e => {
    if (e.target === $('canvas') || e.target === $('host') || e.target === $('zoomwrap')) { e.preventDefault(); editor.commands.focus('end') }
  })
  window.addEventListener('resize', debounce(() => { syncScrim(); fitIfNeeded(); updatePageIndicator() }, 120))

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind() }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow() }
    else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); linkDialog() }
    else if (mod && e.key === '\\') { e.preventDefault(); $('toggleLeft').click() }
    else if (e.altKey && e.code === 'KeyN') { e.preventDefault(); newDocDialog() }
  })
  window.addEventListener('beforeunload', () => { saveNow() })
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow() })
}

function makeResizable(panel, side, key, min, max) {
  const h = document.createElement('div')
  h.className = 'resizer ' + side; h.title = 'Drag to resize'
  panel.appendChild(h)
  const w = prefs.get(key, 0)
  if (w) panel.style.width = w + 'px'
  h.addEventListener('pointerdown', e => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); document.body.classList.add('resizing')
    const x0 = e.clientX, w0 = panel.offsetWidth
    const move = ev => { panel.style.width = Math.max(min, Math.min(max, w0 + (side === 'left' ? x0 - ev.clientX : ev.clientX - x0))) + 'px' }
    const up = () => {
      h.removeEventListener('pointermove', move); document.body.classList.remove('resizing')
      prefs.set(key, panel.offsetWidth); fitIfNeeded(); updatePageIndicator()
    }
    h.addEventListener('pointermove', move)
    h.addEventListener('pointerup', up, { once: true })
  })
  h.addEventListener('dblclick', () => { panel.style.width = ''; prefs.set(key, 0) })
}

/* =========================================================================
   PIN lock
   The PIN is never stored. Its PBKDF2 hash names a file published next to the app
   (k/<hash>); a HEAD request that returns 200 means the PIN is right.
   GitHub Pages answers every POST with 405, so HEAD is used instead.
   ========================================================================= */
const PIN_SALT = 'lakshaykumar.com/letterhead:v1'
const PIN_ITER = 310000
const PIN_BASE = location.protocol === 'file:' ? 'https://lakshaykumar.com/letterhead/' : new URL('.', location.href).href
async function pinHash(pin) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(PIN_SALT), iterations: PIN_ITER }, key, 256)
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('')
}
const isUnlocked = () => { try { return sessionStorage.getItem('lhd:unlocked') === '1' } catch { return false } }
function unlockFlow() {
  if (isUnlocked()) { document.body.classList.remove('locked'); return Promise.resolve() }
  $('lock').hidden = false
  $('pinIn').focus()
  let fails = 0, waitUntil = 0
  return new Promise(resolve => {
    $('lockForm').addEventListener('submit', async e => {
      e.preventDefault()
      const msg = $('lockMsg'), btn = $('pinBtn'), pin = $('pinIn').value
      if (Date.now() < waitUntil) { msg.textContent = `Too many tries — wait ${Math.ceil((waitUntil - Date.now()) / 1000)}s`; return }
      btn.disabled = true; msg.textContent = ''; btn.textContent = 'Checking…'
      try {
        const r = await fetch(PIN_BASE + 'k/' + await pinHash(pin), { method: 'HEAD', cache: 'no-store' })
        if (r.ok) {
          try { sessionStorage.setItem('lhd:unlocked', '1') } catch {}
          $('lock').hidden = true; document.body.classList.remove('locked'); $('pinIn').value = ''
          return resolve()
        }
        if (r.status === 404) {
          fails++
          if (fails >= 3) waitUntil = Date.now() + Math.min(60, 2 ** (fails - 2)) * 1000
          msg.textContent = 'Wrong PIN'
        } else msg.textContent = `Could not check PIN (HTTP ${r.status})`
      } catch { msg.textContent = 'Could not check PIN — are you online?' }
      finally { btn.disabled = false; btn.textContent = 'Unlock'; $('pinIn').select() }
    })
  })
}
async function lockNow() {
  await saveNow()
  try { sessionStorage.removeItem('lhd:unlocked') } catch {}
  location.reload()
}

async function init() {
  makeResizable($('left'), 'right', 'leftW', 180, 480)
  makeResizable($('brandPanel'), 'left', 'brandW', 260, 640)
  await unlockFlow()
  buildRibbon(); bindRibbon(); bindUI(); bindBrandPanel()
  $('btnLock').onclick = lockNow
  brand = { ...BRAND_DEFAULTS, ...(await store.get('brand')) }
  index = (await store.get('index')) || { docs: [], current: null }
  applyBrand()
  setZoom(zoom)
  if (document.fonts) await document.fonts.ready
  if (!index.docs.length) {
    await createDoc('letter')
    await persistNewSilently('shortlist')
  } else {
    await openDoc(index.docs.some(d => d.id === index.current) ? index.current : index.docs[0].id)
  }
  fitIfNeeded()
  if (store.broken) setSaveState('Storage unavailable — use File › Backup')
  document.fonts?.addEventListener?.('loadingdone', () => { geom.key = ''; schedulePaginate() })
}
// seed a second document without switching to it
async function persistNewSilently(tpl) {
  const t = TEMPLATES.find(x => x.id === tpl)
  const tmp = new Editor({ extensions: [StarterKit, TableKit, TaskList, TaskItem, PageBreak], content: t.html() })
  const rec = { id: uid(), title: t.docTitle, content: tmp.getJSON(), opts: { ...DOC_OPTS, ...t.opts }, created: Date.now(), updated: Date.now() - 1000 }
  tmp.destroy()
  index.docs.push({ id: rec.id, title: rec.title, updated: rec.updated })
  try { await store.set('doc:' + rec.id, rec); await store.set('index', index) } catch {}
  renderDocList()
}

init()
window.lhd = { get editor() { return editor }, paginate, geom }
