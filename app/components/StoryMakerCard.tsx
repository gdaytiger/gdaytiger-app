'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dices, Download, FolderOpen, Plus, RefreshCw, RotateCcw, Tags, Trash2 } from 'lucide-react';
import { PHOTO_TAGS } from '@/app/lib/photoTags';
import { glassTileStyle, glassButtonStyle, glassButtonActiveStyle, glassButtonPrimaryStyle } from '@/app/lib/theme';

// Story Maker — TigerOS replacement for Adobe Express on the morning Instagram story.
// 1080×1920 canvas in brand type (Stolzl Bold + Bodoni PT Bold Italic — the TIGER OS header face — both from the
// Typekit kit in layout.tsx) and brand peach (--color-brand-peach). Photos come
// from the same Drive pool as the Google tile (Paul's gallery) via
// /api/story-photos, or straight from the phone. Layout numbers (cap heights,
// gaps, left edge) are measured off the existing Adobe Express stories.
// Edits are remembered per template in localStorage, so most mornings it's
// just: pick photo → Share.

const W = 1080;
const H = 1920;
const TOP = 269;           // cap-top of the headline, as in the Express stories
const BOTTOM = H - 380;    // last baseline when text sits at the bottom (clears IG's reply bar)
const SANS = '"stolzl", "Helvetica Neue", Arial, sans-serif';
const SERIF = '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif';
const STORE = 'tigeros.storyMaker.v1';
const RANDOM_TAG_KEY = 'tigeros.storyMaker.randomTag';   // where RANDOM is up to in the tag cycle (per device)
const HOURS_DEFAULT = '6.30 - 3ISH';
const SUNDAY_HOURS_DEFAULT = '6.30 - 2ISH';

type Kind = 'head' | 'sub' | 'title' | 'body' | 'price';
// key 'hours' = today's hours (Sunday hours on a Sunday); 'sundayHours' = always Sunday's.
type Block = { kind: Kind; label: string; text: string; gap?: number; key?: 'hours' | 'sundayHours' };
// sections: the template takes extra heading / details / price sections (like the Parma block).
type Template = { id: string; name: string; blocks: Block[]; blur?: number; shade?: number; anchor?: 'top' | 'bottom'; sections?: boolean };
type Section = { title: string; body: string; price: string };
const NEW_SECTION: Section = { title: '', body: '', price: '' };
const SECTION_GAP = 106; // between sections, as between Espresso and Filter

// cap = cap height in px, gap = space from previous baseline to this cap-top,
// pitch = baseline-to-baseline for wrapped lines, x = left edge.
const KIND: Record<Kind, { serif: boolean; cap: number; peach: boolean; gap: number; pitch: number; x: number; fit: boolean }> = {
  head:  { serif: false, cap: 85, peach: true,  gap: 0,   pitch: 106, x: 123, fit: true },
  sub:   { serif: true,  cap: 42, peach: false, gap: 29,  pitch: 58,  x: 129, fit: false },
  title: { serif: false, cap: 46, peach: true,  gap: 160, pitch: 62,  x: 130, fit: false },
  body:  { serif: true,  cap: 35, peach: false, gap: 35,  pitch: 59,  x: 140, fit: false },
  price: { serif: false, cap: 61, peach: true,  gap: 61,  pitch: 76,  x: 129, fit: true },
};

const HEAD: Block = { kind: 'head', label: 'Headline', text: 'OPEN TODAY' };
const HOURS: Block = { kind: 'sub', label: 'Hours', text: HOURS_DEFAULT, key: 'hours' };

// Ids 'deal' / 'event' kept from the first version so saved edits carry over.
const TEMPLATES: Template[] = [
  { id: 'open', name: 'Open Today', sections: true, blocks: [HEAD, HOURS] },
  { id: 'deal', name: 'Thursdays', blocks: [
    HEAD,
    { kind: 'sub', label: 'Tagline', text: "IT'S PARMA THURSDAY!" },
    { kind: 'title', label: 'Deal', text: 'CHICKEN PARMA SANGA' },
    { kind: 'body', label: 'Includes', text: '+ ANY SMALL COFFEE\nOR CAN OF DRINK.' },
    { kind: 'price', label: 'Price', text: '$20' },
  ] },
  { id: 'event', name: 'Saturdays', blocks: [
    HEAD, HOURS,
    { kind: 'title', label: 'Run club', text: 'RUN PHILLIP ISLAND' },
    { kind: 'body', label: 'Details', text: "7AM EVERY SATURDAY.\nKICKING OFF AT THE ESPLANADE.\n15% OFF AT G'DAY TIGER\nAFTERWARDS." },
  ] },
  { id: 'sunday', name: 'Sundays', blocks: [
    HEAD,
    { kind: 'sub', label: 'Hours', text: SUNDAY_HOURS_DEFAULT, key: 'sundayHours' },
  ] },
  { id: 'special', name: 'Special', blocks: [
    HEAD, HOURS,
    { kind: 'title', label: 'Special', text: 'PORCHETTA ROLLS!' },
    { kind: 'body', label: 'Description', text: 'ROAST PORCHETTA,\nLEMON, MAYONNAISE, ONION.\n\nFENNEL, GREEN APPLE + DILL SLAW.' },
    { kind: 'price', label: 'Price', text: '$23' }, // appended last so saved edits keep their slots
  ] },
  // Espresso / Filter sections sit 106px apart; the first title uses the standard gap like every template.
  { id: 'coffee', name: 'Seasonal Coffees', blocks: [
    HEAD, HOURS,
    { kind: 'title', label: 'Heading', text: 'SEASONAL COFFEES' },
    { kind: 'title', label: 'Espresso heading', text: 'ESPRESSO', gap: 106 },
    { kind: 'body', label: 'Espresso — roaster / origin / notes', text: 'SEVEN SEEDS\nKENYA - GICHERORI\nJUICY, APRICOT, MOLASSESS', gap: 33 },
    { kind: 'title', label: 'Filter heading', text: 'FILTER', gap: 106 },
    { kind: 'body', label: 'Filter — roaster / origin / notes', text: 'SEVEN SEEDS\nPERU- ALEJANDRO PADILLA CHINGUEL\nSPARKLING, BLOOD ORANGE', gap: 33 },
  ] },
];

const melbDay = () => new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'long' });

// Thursday → Parma, Saturday → Run club, Sunday → Sundays, otherwise Open Today.
function defaultTemplateId(): string {
  const day = melbDay();
  if (day === 'Thursday') return 'deal';
  if (day === 'Saturday') return 'event';
  if (day === 'Sunday') return 'sunday';
  return 'open';
}

type Store = { hours: string; sundayHours: string; fields: Record<string, string[]>; sections: Record<string, Section[]> };
const EMPTY_STORE: Store = { hours: HOURS_DEFAULT, sundayHours: SUNDAY_HOURS_DEFAULT, fields: {}, sections: {} };
function loadStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && typeof s === 'object') return {
      hours: typeof s.hours === 'string' ? s.hours : HOURS_DEFAULT,
      sundayHours: typeof s.sundayHours === 'string' ? s.sundayHours : SUNDAY_HOURS_DEFAULT,
      fields: s.fields && typeof s.fields === 'object' ? s.fields : {},
      sections: s.sections && typeof s.sections === 'object' ? s.sections : {},
    };
  } catch { /* storage blocked */ }
  return EMPTY_STORE;
}

// ── Canvas helpers ────────────────────────────────────────────────────────────
const fontFor = (serif: boolean, px: number) => (serif ? `italic 700 ${px.toFixed(1)}px ${SERIF}` : `700 ${px.toFixed(1)}px ${SANS}`);

const capCache = new Map<string, number>();
function capRatio(ctx: CanvasRenderingContext2D, serif: boolean, v: number): number {
  const key = `${serif}:${v}`;
  const hit = capCache.get(key);
  if (hit) return hit;
  ctx.font = fontFor(serif, 100);
  const r = (ctx.measureText('H').actualBoundingBoxAscent || 70) / 100;
  capCache.set(key, r);
  return r;
}

type Line = { text: string; font: string; peach: boolean; x: number; y: number };

function layoutText(ctx: CanvasRenderingContext2D, blocks: { kind: Kind; text: string; gap?: number }[], anchor: 'top' | 'bottom', fontsV: number): Line[] {
  const lines: Line[] = [];
  const clean = (t: string) => t.toUpperCase().replace(/\s+$/, '');

  // Pass 1 — one scale per text style. If any line of a style is too wide (fit styles),
  // or a typed line is only a little too wide (others — much wider ones word-wrap),
  // every block in that style shrinks by the same amount so they all match.
  const scaleOf: Partial<Record<Kind, number>> = {};
  for (const b of blocks) {
    const raw = clean(b.text);
    if (!raw.trim()) continue;
    const k = KIND[b.kind];
    const maxW = W - k.x - 16;
    ctx.font = fontFor(k.serif, k.cap / capRatio(ctx, k.serif, fontsV));
    const paras = k.fit ? [raw.replace(/\n+/g, ' ')] : raw.split('\n');
    let s = scaleOf[b.kind] ?? 1;
    for (const para of paras) {
      const w = ctx.measureText(para.trim()).width;
      if (w > maxW && (k.fit || w <= maxW * 1.15)) s = Math.min(s, (maxW - 2) / w); // -2: font size is rounded to 0.1px
    }
    scaleOf[b.kind] = s;
  }

  // Pass 2 — lay out.
  let y = 0;
  let first = true;
  for (const b of blocks) {
    const raw = clean(b.text);
    if (!raw.trim()) continue;
    const k = KIND[b.kind];
    const ratio = capRatio(ctx, k.serif, fontsV);
    const size = (k.cap / ratio) * (scaleOf[b.kind] ?? 1);
    const maxW = W - k.x - 16;
    ctx.font = fontFor(k.serif, size);
    let rows: string[] = [];
    if (k.fit) {
      rows = [raw.replace(/\n+/g, ' ')];
    } else {
      for (const para of raw.split('\n')) {
        if (!para.trim()) { rows.push(''); continue; }
        let cur = '';
        for (const word of para.trim().split(/\s+/)) {
          const t = cur ? `${cur} ${word}` : word;
          if (cur && ctx.measureText(t).width > maxW) { rows.push(cur); cur = word; } else cur = t;
        }
        rows.push(cur);
      }
    }
    const font = fontFor(k.serif, size);
    const cap = size * ratio;
    const pitch = k.pitch * (cap / k.cap);
    y = first ? cap : y + (b.gap ?? k.gap) + cap;
    first = false;
    rows.forEach((text, i) => {
      if (i > 0) y += pitch;
      if (text) lines.push({ text, font, peach: k.peach, x: k.x, y });
    });
  }
  const shift = anchor === 'bottom' ? BOTTOM - y : TOP;
  return lines.map(l => ({ ...l, y: l.y + shift }));
}

let filterOK: boolean | null = null;
function canvasFilterWorks(): boolean {
  if (filterOK !== null) return filterOK;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 9;
    const g = c.getContext('2d')!;
    g.filter = 'blur(2px)';
    g.fillStyle = 'white';
    g.fillRect(4, 4, 1, 1);
    filterOK = g.getImageData(1, 4, 1, 1).data[3] > 0;
  } catch {
    filterOK = false;
  }
  return filterOK;
}

// The photo scaled to cover 1080×1920 at `zoom`, blurred if asked. Pan just offsets this.
function buildBackground(img: HTMLImageElement, zoom: number, blur: number): HTMLCanvasElement {
  const c = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
  const w = Math.round(img.naturalWidth * c);
  const h = Math.round(img.naturalHeight * c);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  if (blur <= 0) { g.drawImage(img, 0, 0, w, h); return out; }
  if (canvasFilterWorks()) {
    // Draw an oversized copy so the blur never pulls dark edges in from outside the photo.
    const m = Math.ceil(blur * 3);
    const big = document.createElement('canvas');
    big.width = w + 2 * m; big.height = h + 2 * m;
    const bg = big.getContext('2d')!;
    bg.imageSmoothingQuality = 'high';
    bg.drawImage(img, 0, 0, big.width, big.height);
    g.filter = `blur(${blur}px)`;
    g.drawImage(big, -m, -m);
    g.filter = 'none';
    return out;
  }
  // Older Safari: no canvas filter — downscale then upscale for a soft blur.
  const k = Math.max(2, blur / 3);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / k)); small.height = Math.max(1, Math.round(h / k));
  const sg = small.getContext('2d')!;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(img, 0, 0, small.width, small.height);
  g.drawImage(small, 0, 0, w, h);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

// ── Saving ───────────────────────────────────────────────────────────────────
// Phone/tablet: share sheet (Instagram, Save Image, Save to Files).
// Desktop Chrome: write into a folder picked once (handle kept in IndexedDB) and
// clear story files there older than KEEP_DAYS. Anything else: plain download.
const KEEP_DAYS = 7;
// Copied to the clipboard on every SAVE, ready to paste into an Instagram link sticker.
const PICKUP_LINK = 'https://www.meandu.app/gdaytiger/pickup/pick-up';
const FILE_PREFIX = 'gdaytiger-story-';
type SaveMode = 'share' | 'folder' | 'download';

// File System Access bits that aren't in TypeScript's DOM lib yet.
type PermState = 'granted' | 'denied' | 'prompt';
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite' }) => Promise<DirHandle> };

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest, mode: IDBTransactionMode = 'readonly'): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('tigeros-story', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    };
  });
}
const getFolder = () => idb<DirHandle>(st => st.get('folder')).catch(() => undefined);
const putFolder = (h: DirHandle) => idb(st => st.put(h, 'folder'), 'readwrite');

async function pickFolder(): Promise<DirHandle> {
  const h = await (window as PickerWindow).showDirectoryPicker!({ id: 'daily-story', mode: 'readwrite' });
  await putFolder(h);
  return h;
}

// Delete our own story files older than KEEP_DAYS. Leaves anything else in the folder alone.
async function clearOld(dir: DirHandle): Promise<number> {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  let n = 0;
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || !name.startsWith(FILE_PREFIX)) continue;
    const f = await (h as FileSystemFileHandle).getFile();
    if (f.lastModified < cutoff) { await dir.removeEntry(name); n++; }
  }
  return n;
}

// ── Library types ─────────────────────────────────────────────────────────────
type LibPhoto = { id: string; name: string; set: string; thumb: string | null; tag?: string | null };
type LibData = { ok: boolean; photos?: LibPhoto[]; total?: number; fallback?: boolean; error?: string; untagged?: number };
type QueueData = { ok: boolean; photos?: LibPhoto[]; remaining?: number; error?: string };

// Our photo tags (each maps to a Google category — see app/lib/photoTags.ts).
const PHOTO_CATS: [string, string][] = PHOTO_TAGS.map(t => [t.key, t.label]);
const postStory = async <T,>(body: object): Promise<T> => {
  const r = await fetch('/api/story-photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(d.error || 'failed');
  return d as T;
};

const label: React.CSSProperties = { fontFamily: '"stolzl", sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-ink-label)' };
const box: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '12px 14px' };
const btn: React.CSSProperties = { ...glassButtonStyle, ...glassButtonPrimaryStyle };
const ghost: React.CSSProperties = glassButtonStyle;
const chip = (on: boolean): React.CSSProperties => (on ? { ...glassButtonStyle, ...glassButtonActiveStyle } : glassButtonStyle);
const field: React.CSSProperties = { background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)' };

type Photo = { img: HTMLImageElement; id: string | null; name: string; hiRes: boolean };

export default function StoryMakerCard({ active }: { active: boolean }) {
  const [tplId, setTplId] = useState<string>('open');
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [isSunday, setIsSunday] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const tpl0 = TEMPLATES.find(t => t.id === tplId) ?? TEMPLATES[0];
  const [blur, setBlur] = useState(tpl0.blur ?? 0);
  const [shade, setShade] = useState(tpl0.shade ?? 0);
  const [anchor, setAnchor] = useState<'top' | 'bottom'>(tpl0.anchor ?? 'top');
  const [fontsV, setFontsV] = useState(0);
  const [bg, setBg] = useState<HTMLCanvasElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<SaveMode>('download');
  const [folderName, setFolderName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [lib, setLib] = useState<LibData | null>(null);
  const [libCat, setLibCat] = useState('');
  const [libBusy, setLibBusy] = useState(false);
  // Hand tagging: one photo at a time. Taps collect in `pending` and go up in batches
  // (one request in flight); anything unsent goes with a keepalive request if the page closes.
  const [tagging, setTagging] = useState(false);
  const [queue, setQueue] = useState<LibPhoto[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [tagLeft, setTagLeft] = useState(0);
  const [unsaved, setUnsaved] = useState(0);
  const pending = useRef<Record<string, string>>({});
  const inFlight = useRef<Promise<void> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());   // retry timer → latest flushTags
  const tagged = useRef<string[]>([]);
  const pickedRef = useRef<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const tpl = TEMPLATES.find(t => t.id === tplId) ?? TEMPLATES[0];

  // Restore saved edits and pick today's template (client only — Melbourne day).
  useEffect(() => {
    const t = setTimeout(() => {
      setStore(loadStore());
      setLoaded(true);
      setIsSunday(melbDay() === 'Sunday');
      const d = TEMPLATES.find(x => x.id === defaultTemplateId());
      if (d) { setTplId(d.id); setBlur(d.blur ?? 0); setShade(d.shade ?? 0); setAnchor(d.anchor ?? 'top'); }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* storage blocked */ }
  }, [store, loaded]);

  // Make sure the Typekit faces are loaded before measuring/drawing.
  useEffect(() => {
    let alive = true;
    const bump = () => { if (alive) { capCache.clear(); setFontsV(v => v + 1); } };
    Promise.all([document.fonts.load(fontFor(false, 85)), document.fonts.load(fontFor(true, 42))]).then(bump, bump);
    document.fonts.addEventListener('loadingdone', bump);
    return () => { alive = false; document.fonts.removeEventListener('loadingdone', bump); };
  }, []);

  // How SAVE works on this device (see Saving above).
  useEffect(() => {
    let mode: SaveMode = 'download';
    try {
      const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
      const touch = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
      if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })) mode = 'share';
      else if (typeof (window as PickerWindow).showDirectoryPicker === 'function') mode = 'folder';
    } catch { /* fall back to download */ }
    const t = setTimeout(() => setSaveMode(mode), 0);
    if (mode === 'folder') getFolder().then(h => { if (h) setFolderName(h.name); });
    return () => clearTimeout(t);
  }, []);

  const textFor = (t: Template, i: number) => {
    const b = t.blocks[i];
    const hk = hoursKey(b);
    if (hk) return store[hk];
    return store.fields[t.id]?.[i] ?? b.text;
  };
  // Which shared hours a block reads/writes: Sunday's on a Sunday, else the usual.
  function hoursKey(b: Block): 'hours' | 'sundayHours' | null {
    if (b.key === 'sundayHours' || (b.key === 'hours' && isSunday)) return 'sundayHours';
    return b.key === 'hours' ? 'hours' : null;
  }
  const setText = (i: number, value: string) => {
    const b = tpl.blocks[i];
    const hk = hoursKey(b);
    setStore(prev => {
      if (hk) return { ...prev, [hk]: value };
      const arr = tpl.blocks.map((_, j) => prev.fields[tpl.id]?.[j] ?? tpl.blocks[j].text);
      arr[i] = value;
      return { ...prev, fields: { ...prev.fields, [tpl.id]: arr } };
    });
  };
  const resetTemplate = () => setStore(prev => {
    const fields = { ...prev.fields };
    const sections = { ...prev.sections };
    delete fields[tpl.id];
    delete sections[tpl.id];
    return { ...prev, fields, sections };
  });

  // ── Extra sections (heading / details / price) ──
  const sections = tpl.sections ? (store.sections[tpl.id] ?? []) : [];
  const setSections = (fn: (s: Section[]) => Section[]) =>
    setStore(prev => ({ ...prev, sections: { ...prev.sections, [tpl.id]: fn(prev.sections[tpl.id] ?? []) } }));
  const addSection = () => setSections(s => [...s, { ...NEW_SECTION }]);
  const removeSection = (i: number) => setSections(s => s.filter((_, j) => j !== i));
  const editSection = (i: number, key: keyof Section, value: string) =>
    setSections(s => s.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  const chooseTemplate = (t: Template) => {
    setTplId(t.id);
    setBlur(t.blur ?? 0);
    setShade(t.shade ?? 0);
    setAnchor(t.anchor ?? 'top');
  };

  // Background cache — rebuilt when the photo, zoom or blur changes.
  useEffect(() => {
    if (!photo) { const t = setTimeout(() => setBg(null), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => setBg(buildBackground(photo.img, zoom, blur)), 0);
    return () => clearTimeout(t);
  }, [photo, zoom, blur]);

  const clampPan = useCallback((p: { x: number; y: number }, b: HTMLCanvasElement | null) => {
    if (!b) return p;
    const mx = Math.max(0, (b.width - W) / 2), my = Math.max(0, (b.height - H) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  }, []);

  // Draw.
  const blocksNow: { kind: Kind; gap?: number; text: string }[] = tpl.blocks.map((b, i) => ({ kind: b.kind, gap: b.gap, text: textFor(tpl, i) }));
  sections.forEach((sec, i) => {
    // First section sits the standard distance below the header; later ones SECTION_GAP apart.
    blocksNow.push({ kind: 'title', gap: i === 0 ? undefined : SECTION_GAP, text: sec.title });
    blocksNow.push({ kind: 'body', text: sec.body });
    blocksNow.push({ kind: 'price', text: sec.price });
  });
  const blocksKey = JSON.stringify(blocksNow);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const raf = requestAnimationFrame(() => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgb(40, 32, 28)';
      ctx.fillRect(0, 0, W, H);
      if (bg) {
        const p = clampPan(pan, bg);
        ctx.drawImage(bg, (W - bg.width) / 2 + p.x, (H - bg.height) / 2 + p.y);
      }
      if (shade > 0) {
        const g = anchor === 'top' ? ctx.createLinearGradient(0, 0, 0, H * 0.62) : ctx.createLinearGradient(0, H, 0, H * 0.38);
        g.addColorStop(0, `rgba(0,0,0,${shade})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      const peach = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-peach').trim() || 'rgb(251, 205, 173)';
      const lines = layoutText(ctx, JSON.parse(blocksKey), anchor, fontsV);
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0,0,0,0.38)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 3;
      for (const l of lines) {
        ctx.font = l.font;
        ctx.fillStyle = l.peach ? peach : 'white';
        ctx.fillText(l.text, l.x, l.y);
      }
      ctx.shadowColor = 'transparent';
    });
    return () => cancelAnimationFrame(raf);
  }, [bg, pan, shade, anchor, blocksKey, fontsV, clampPan]);

  // ── Photo library — 5 random photos at a time, like the Google tab ──
  const loadLib = useCallback(async (cat: string) => {
    setLibBusy(true);
    try {
      setLib(await postStory<LibData>({ action: 'browse', cat, random: true }));
    } catch (e) {
      setLib({ ok: false, error: e instanceof Error ? e.message : 'error' });
    } finally {
      setLibBusy(false);
    }
  }, []);

  // Load the library the first time the tile is opened (not on every TigerOS load).
  useEffect(() => {
    if (!active || lib || libBusy) return;
    const t = setTimeout(() => { loadLib(''); }, 0);
    return () => clearTimeout(t);
  }, [active, lib, libBusy, loadLib]);

  async function pickPhoto(p: LibPhoto) {
    pickedRef.current = p.id;
    setMsg(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    if (p.thumb) {
      try { const img = await loadImage(p.thumb); if (pickedRef.current === p.id) setPhoto({ img, id: p.id, name: p.name, hiRes: false }); } catch { /* ignore */ }
    }
    if (lib?.fallback) return; // GBP script without GbpStoryPhotos.js — preview size only
    setBusy('photo');
    try {
      const r = await fetch('/api/story-photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'image', id: p.id }) });
      const d = await r.json();
      if (!r.ok || d.ok === false || !d.dataUri) throw new Error(d.error || 'failed');
      const img = await loadImage(d.dataUri);
      if (pickedRef.current === p.id) setPhoto({ img, id: p.id, name: p.name, hiRes: true });
    } catch (e) {
      if (pickedRef.current === p.id) setMsg(`Full-size photo didn’t load (${e instanceof Error ? e.message : 'error'}) — preview size only.`);
    } finally {
      if (pickedRef.current === p.id) setBusy(null);
    }
  }

  // RANDOM steps through the tags in order (Coffee → Food → Parma → Inside → Outside → Team → …),
  // picking a random rested photo from the next tag; tags with nothing available are skipped.
  async function randomPhoto() {
    if (lib?.fallback) {                       // no tags without the GBP story script — random from the 5 shown
      if (lib.photos?.length) pickPhoto(lib.photos[Math.floor(Math.random() * lib.photos.length)]);
      return;
    }
    let start = 0;
    try { start = Number(localStorage.getItem(RANDOM_TAG_KEY)) || 0; } catch { /* storage blocked */ }
    setLibBusy(true);
    try {
      for (let i = 0; i < PHOTO_TAGS.length; i++) {
        const idx = (start + i) % PHOTO_TAGS.length;
        const cat = PHOTO_TAGS[idx].key;
        const d = await postStory<LibData>({ action: 'browse', cat, random: true });
        if (!d.photos?.length) continue;
        try { localStorage.setItem(RANDOM_TAG_KEY, String((idx + 1) % PHOTO_TAGS.length)); } catch { /* storage blocked */ }
        setLibCat(cat);
        setLib(d);
        pickPhoto(d.photos[Math.floor(Math.random() * d.photos.length)]);
        return;
      }
      setMsg('No tagged photos available — tag some, or they’re all resting after recent stories.');
    } catch (e) {
      setMsg(`Couldn’t pick a photo: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setLibBusy(false);
    }
  }
  const shuffle = () => loadLib(libCat);
  const chooseCat = (cat: string) => { setLibCat(cat); loadLib(cat); };

  // ── Category tagging ──
  const fetchQueue = useCallback(async () => {
    setQueueBusy(true);
    try {
      const d = await postStory<QueueData>({ action: 'queue', exclude: tagged.current });
      setQueue(d.photos ?? []);
      setTagLeft(d.remaining ?? 0);
      if (!d.photos?.length) setTagging(false); // nothing left to tag
    } catch (e) {
      setMsg(`Couldn’t load photos to tag: ${e instanceof Error ? e.message : 'error'}`);
      setTagging(false);
    } finally {
      setQueueBusy(false);
    }
  }, []);

  function startTagging() { setTagging(true); setQueue([]); fetchQueue(); }

  const countUnsaved = useCallback((sending = 0) => setUnsaved(Object.keys(pending.current).length + sending), []);

  // keepalive lets the request finish even if the page is closed or the phone locks.
  const sendTags = (tags: Record<string, string>) =>
    fetch('/api/story-photos', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tag', tags }) })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok || d.ok === false) throw new Error(d.error || 'failed'); });

  const flushTags = useCallback((): Promise<void> => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    if (inFlight.current) return inFlight.current;
    const batch = pending.current;
    if (!Object.keys(batch).length) return Promise.resolve();
    pending.current = {};
    countUnsaved(Object.keys(batch).length);
    inFlight.current = sendTags(batch)
      .catch(() => {
        // Put them back (unless re-tagged since) and try again shortly.
        pending.current = { ...batch, ...pending.current };
        setMsg('Tags didn’t save — retrying…');
      })
      .finally(() => {
        inFlight.current = null;
        countUnsaved();
        if (Object.keys(pending.current).length) flushTimer.current = setTimeout(() => { flushRef.current(); }, 1500);
      });
    return inFlight.current;
  }, [countUnsaved]);
  useEffect(() => { flushRef.current = flushTags; }, [flushTags]);

  // Wait until every tap is on the server (in-flight batch, then whatever queued behind it).
  const drainTags = useCallback(async () => {
    for (let i = 0; i < 20 && (inFlight.current || Object.keys(pending.current).length); i++) await flushTags();
  }, [flushTags]);

  // Page closing / app switched away: send what's left straight away.
  useEffect(() => {
    const away = (e: Event) => {
      if (e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
      const batch = pending.current;
      if (!Object.keys(batch).length) return;
      pending.current = {};
      sendTags(batch).catch(() => { pending.current = { ...batch, ...pending.current }; });
    };
    document.addEventListener('visibilitychange', away);
    window.addEventListener('pagehide', away);
    return () => { document.removeEventListener('visibilitychange', away); window.removeEventListener('pagehide', away); };
  }, []);

  function finishTagging() {
    setTagging(false);
    drainTags().then(() => loadLib(libCat));
  }

  function tagPhoto(cat: string) {
    const p = queue[0];
    if (!p) return;
    tagged.current.push(p.id);
    pending.current[p.id] = cat;
    countUnsaved(inFlight.current ? 1 : 0);
    if (Object.keys(pending.current).length >= 6) flushTags();
    else if (!flushTimer.current) flushTimer.current = setTimeout(() => { flushTimer.current = null; flushTags(); }, 1500);
    const left = tagLeft - 1;
    setTagLeft(left);
    setQueue(q => q.slice(1));
    if (left <= 0) {
      setMsg('All photos tagged ✓ — new photos from Paul will show up here to tag.');
      finishTagging();
    } else if (queue.length === 1) {
      fetchQueue();   // batch used up — next 6 (the ones just tagged are excluded)
    }
  }


  // ── Drag to reposition ──
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bg) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !bg) return;
    const s = W / e.currentTarget.getBoundingClientRect().width;
    setPan(clampPan({ x: drag.current.px + (e.clientX - drag.current.x) * s, y: drag.current.py + (e.clientY - drag.current.y) * s }, bg));
  };
  const onPointerUp = () => { drag.current = null; };

  // ── Export ──
  async function changeFolder() {
    try { const h = await pickFolder(); setFolderName(h.name); setMsg(`Stories will save to “${h.name}” ✓`); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setMsg('Couldn’t use that folder.'); }
  }

  async function exportStory() {
    const cv = canvasRef.current;
    if (!cv) return;
    setBusy('save');
    // Start the copy straight away, inside the tap — Safari only allows clipboard writes during a user gesture.
    const copied = navigator.clipboard?.writeText(PICKUP_LINK).then(() => true, () => false) ?? Promise.resolve(false);
    const linkNote = async () => ((await copied) ? ' · pick-up link copied' : '');
    try {
      const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('could not render');
      const now = new Date();
      const date = now.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
      const time = now.toLocaleTimeString('en-GB', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit' }).replace(':', '');
      const name = `${FILE_PREFIX}${date}-${time}.jpg`;
      const file = new File([blob], name, { type: 'image/jpeg' });
      if (saveMode === 'share' && navigator.canShare?.({ files: [file] })) {
        // Don't await anything between the tap and share() — Safari needs share() promptly.
        copied.then(ok => setMsg(ok ? 'Pick-up link copied — paste it into a link sticker' : 'Pick-up link couldn’t be copied'));
        await navigator.share({ files: [file] });
      } else if (saveMode === 'folder') {
        let dir = await getFolder();
        if (dir && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted'
          && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = undefined;
        if (!dir) dir = await pickFolder();
        setFolderName(dir.name);
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(blob);
        await w.close();
        const cleared = await clearOld(dir);
        setMsg(`Saved to “${dir.name}” ✓${cleared ? ` · cleared ${cleared} older than ${KEEP_DAYS} days` : ''}${await linkNote()}`);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setMsg(`Saved ${name} ✓${await linkNote()}`);
      }
      // Rest this album photo for 30 days so the daily story doesn't repeat it (any device).
      if (photo?.id) postStory({ action: 'used', id: photo.id }).catch(() => {});
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setMsg(`Export didn’t work: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Templates */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
        {TEMPLATES.map(t => (
          <button key={t.id} onClick={() => chooseTemplate(t)} style={chip(t.id === tplId)}>{t.name}</button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        {/* Preview */}
        <div className="flex flex-col items-center gap-2 shrink-0 sm:w-[260px]">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="rounded-2xl w-[220px] sm:w-[260px]"
            style={{ aspectRatio: '9 / 16', height: 'auto', touchAction: 'none', cursor: bg ? 'grab' : 'default', boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}
            aria-label="Story preview — drag to reposition the photo"
          />
          <div className="text-[11px] text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {photo ? `${photo.name}${photo.hiRes ? '' : ' · preview size'}${busy === 'photo' ? ' · loading full size…' : ''} · drag to move` : ''}
          </div>
          <div className="flex gap-2 flex-wrap justify-start self-stretch">
            <button style={btn} disabled={!!busy && busy !== 'photo'} onClick={exportStory}
              title={saveMode === 'share' ? 'Opens the share sheet — Instagram, Save Image or Save to Files' : saveMode === 'folder' ? `Saves into ${folderName ? `“${folderName}”` : 'a folder you pick'} and clears stories older than ${KEEP_DAYS} days` : 'Downloads the JPG'}>
              <Download size={13} strokeWidth={2.25} aria-hidden />{busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {saveMode === 'folder' && folderName && (
              <button style={ghost} onClick={changeFolder} title={`Saving to “${folderName}” — tap to pick another folder`}>
                <FolderOpen size={13} strokeWidth={2.25} aria-hidden />Folder
              </button>
            )}
          </div>
        </div>

        {/* Text + look */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div style={box} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div style={label}>Text</div>
              <button onClick={resetTemplate} style={ghost} title="Back to the template's default text">
                <RotateCcw size={13} strokeWidth={2.25} aria-hidden />Reset
              </button>
            </div>
            {tpl.blocks.map((b, i) => (
              <label key={`${tpl.id}-${i}`} className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-ink-label)' }}>
                  {b.label}
                </span>
                {b.kind === 'body' ? (
                  <textarea value={textFor(tpl, i)} onChange={e => setText(i, e.target.value)} rows={Math.max(2, textFor(tpl, i).split('\n').length)}
                    className="w-full text-sm rounded-xl px-3 py-2 uppercase focus:outline-none focus:ring-2 focus:ring-orange-300" style={field} />
                ) : (
                  <input value={textFor(tpl, i)} onChange={e => setText(i, e.target.value)}
                    className="w-full text-sm rounded-xl px-3 py-2 uppercase focus:outline-none focus:ring-2 focus:ring-orange-300" style={field} />
                )}
              </label>
            ))}

            {sections.map((sec, i) => (
              <div key={`sec-${i}`} className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <div className="flex items-center justify-between">
                  <span style={label}>Section {i + 1}</span>
                  <button onClick={() => removeSection(i)} style={ghost} title="Remove this section">
                    <Trash2 size={13} strokeWidth={2.25} aria-hidden />Remove
                  </button>
                </div>
                {([['title', 'Heading'], ['body', 'Details'], ['price', 'Price']] as const).map(([key, name]) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-ink-label)' }}>{name}</span>
                    {key === 'body' ? (
                      <textarea value={sec.body} onChange={e => editSection(i, 'body', e.target.value)} rows={Math.max(2, sec.body.split('\n').length)}
                        className="w-full text-sm rounded-xl px-3 py-2 uppercase focus:outline-none focus:ring-2 focus:ring-orange-300" style={field} />
                    ) : (
                      <input value={sec[key]} onChange={e => editSection(i, key, e.target.value)}
                        className="w-full text-sm rounded-xl px-3 py-2 uppercase focus:outline-none focus:ring-2 focus:ring-orange-300" style={field} />
                    )}
                  </label>
                ))}
              </div>
            ))}

            {tpl.sections && (
              <button onClick={addSection} style={ghost} className="self-start mt-1">
                <Plus size={13} strokeWidth={2.25} aria-hidden />Add section
              </button>
            )}
          </div>

          <div style={box} className="flex flex-col gap-2">
            <div style={label}>Look</div>
            <div className="flex gap-2">
              {(['top', 'bottom'] as const).map(a => (
                <button key={a} onClick={() => setAnchor(a)} style={chip(anchor === a)}>{a === 'top' ? 'Text top' : 'Text bottom'}</button>
              ))}
            </div>
            <Slider name="Blur" value={blur} min={0} max={60} step={2} onChange={setBlur} />
            <Slider name="Shade" value={Math.round(shade * 100)} min={0} max={70} step={5} onChange={v => setShade(v / 100)} />
            <Slider name="Zoom" value={Math.round(zoom * 100)} min={100} max={200} step={5} onChange={v => setZoom(v / 100)} />
          </div>
        </div>
      </div>

      {msg && <div className="text-sm font-semibold px-1">{msg}</div>}

      {/* Photo library */}
      <div style={box} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div style={label}>Photos from G’Day Tigers album</div>
          <div className="flex gap-2">
            <button style={ghost} onClick={randomPhoto} disabled={libBusy || !lib || lib.ok === false} title="Next tag in the cycle, random photo from it"><Dices size={13} strokeWidth={2.25} aria-hidden />Random</button>
            <button style={ghost} onClick={shuffle} disabled={libBusy} title="Show 5 different photos"><RefreshCw size={13} strokeWidth={2.25} aria-hidden />{libBusy ? 'Loading…' : 'Shuffle'}</button>
          </div>
        </div>

        {tagging && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-[240px] aspect-square rounded-3xl overflow-hidden shrink-0" style={{ ...glassTileStyle, padding: 0 }}>
              {queue[0]?.thumb
                // eslint-disable-next-line @next/next/no-img-element -- data-URI thumbnail from Apps Script
                ? <img src={queue[0].thumb} alt={queue[0].name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--color-ink-muted)' }}>{queueBusy ? 'Loading…' : queue[0]?.name ?? ''}</div>}
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <div style={label}>Which category? · {tagLeft} left{unsaved ? ` · saving ${unsaved}…` : ''}</div>
              <div className="grid grid-cols-2 gap-2">
                {PHOTO_CATS.map(([k, v]) => (
                  <button key={k} style={ghost} disabled={!queue[0] || queueBusy} onClick={() => tagPhoto(k)}>{v}</button>
                ))}
              </div>
              <button style={ghost} className="self-start mt-1" onClick={finishTagging}>Done for now</button>
            </div>
          </div>
        )}

        {!tagging && lib && !lib.fallback && (lib.untagged ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm" style={{ color: 'var(--color-ink-label)' }}>{lib.untagged} photos need a category</span>
            <button style={btn} onClick={startTagging}><Tags size={13} strokeWidth={2.25} aria-hidden />Tag photos</button>
          </div>
        )}

        {lib?.ok === false && <div className="text-sm" style={{ color: 'var(--color-danger-deep)' }}>Couldn’t load photos: {lib.error}</div>}
        {!lib && libBusy && <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>Picking 5 photos…</div>}

        {!tagging && lib?.ok !== false && libCat && lib?.photos?.length === 0 && (
          <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>No photos tagged {PHOTO_CATS.find(([k]) => k === libCat)?.[1]} yet.</div>
        )}

        {!tagging && lib?.photos && lib.photos.length > 0 && (
          <div className="grid grid-cols-5 gap-2" style={{ opacity: libBusy ? 0.5 : 1 }}>
            {lib.photos.map(p => {
              const on = photo?.id === p.id;
              return (
                <button key={p.id} onClick={() => pickPhoto(p)} className="block w-full aspect-square rounded-3xl overflow-hidden"
                  style={{ ...glassTileStyle, padding: 0, ...(on ? { border: '1.5px solid var(--color-brand-peach)', boxShadow: 'var(--glass-shadow), var(--glass-ring)' } : {}) }}
                  aria-pressed={on} aria-label={`Use ${p.name}`}>
                  {p.thumb
                    // eslint-disable-next-line @next/next/no-img-element -- data-URI thumbnail from Apps Script
                    ? <img src={p.thumb} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                    : <span className="text-[10px] p-1 block">{p.name}</span>}
                </button>
              );
            })}
          </div>
        )}

        {!tagging && lib && !lib.fallback && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
            <button onClick={() => chooseCat('')} style={chip(libCat === '')}>All</button>
            {PHOTO_CATS.map(([k, v]) => (
              <button key={k} onClick={() => chooseCat(k)} style={chip(libCat === k)}>{v}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Slider({ name, value, min, max, step, onChange }: { name: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider w-14 shrink-0" style={{ color: 'var(--color-ink-label)' }}>{name}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="flex-1 accent-orange-300" />
      <span className="text-[11px] tabular-nums w-8 text-right" style={{ color: 'var(--color-ink-muted)' }}>{value}</span>
    </label>
  );
}
