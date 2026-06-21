'use client';

import { useEffect, useState, useRef, useMemo, useSyncExternalStore } from 'react';
import AddProductModal from './components/AddProductModal';
import AddIngredientModal from './components/AddIngredientModal';
import LabourCardBody, { type StaffCostData } from './components/LabourCardBody';
import { VERSION, UPDATED, COMMITS } from './lib/version';

// Blended "True Payment Cost" — Square processing fees as a % of total revenue,
// from Sales Summary (12mo to 15 Jun 2026): $12,916.54 fees / $1,262,991.94 collected.
// Update periodically by re-pulling the same report. Cash sales carry no fee, so this
// is a business-wide blended rate — applied to margin %, not baked into per-item costs.
const MERCHANT_FEE_PCT = 1.02;

interface Todo {
  id: string;
  text: string;
  checked: boolean;
  isHeader?: boolean;
  isRecurring?: boolean;
  // Persistent task injected by /api/dashboard — stays every day until ticked off,
  // with no expiry. Ticking it writes to the permanent "_sticky_done" checked-state
  // key instead of today's date.
  isSticky?: boolean;
  // Shopping list item — checked state comes from Notion to_do.checked (via
  // /api/check-shopping), NOT from the date-keyed server state. applyServerChecked
  // must skip these so it doesn't reset them to unchecked on every refresh.
  isShopping?: boolean;
}

interface Project {
  id: string;
  name: string;
  status: string;
  todos: Todo[];
}

// Editable draft produced from a brain-dump (by AI or manually) before it's
// committed either as a new project or as actions on an existing one.
interface ProjectDraft {
  mode: 'new' | 'existing';
  projectName: string;
  matchProjectId: string;
  matchProjectName: string;
  actions: string[];
}

// TIGER OS Backlog — manual to-do tasks (Update widget). Subtasks reuse Todo.
interface BacklogTask {
  id: string;
  name: string;
  done: boolean;
  order: number | null;
  subtasks: Todo[];
}

interface Shift {
  date: string;
  label: string;
  working: boolean;
  start: string;
  end: string;
  area: string;
  comment: string;
}

interface DashboardData {
  dateStr: string;
  weather: string;
  todayStr: string;
  dailyTasks: Todo[];
  projects: Project[];
  personalTodos: Todo[];
}

interface WeekDay {
  count: number;
  tasks: Todo[];
}


interface CostingProduct {
  id: string;
  name: string;
  category: string;
  cost: number | null;
  sellPrice: number | null;
  profitPct: number | null;
  margin: number | null;
  marginDollar: number | null;
  lastReviewedStr: string | null;
  daysSinceReview: number | null;
  needsReview: boolean;
  notes: string;
}

const CATEGORY_ORDER = ['ORDER', 'ADMIN', 'MAINTENANCE', 'STAFF', 'COSTING', 'MERCHANDISE', 'PERSONAL'];

// Shared "tile" look used by action items, the brain-dump capture box, and the
// collapsible project headers so they all read as the same component.
const TILE_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.45)',
  backdropFilter: 'blur(16px) saturate(180%)',
  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.7)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
};

// ── Widget icons (emoji) ─────────────────────────────────────────────────────
// One place mapping each widget to its emoji, rendered at a size derived from
// the caller's chip value. Kept as a component so the set can be swapped later.
type WidgetIconName = 'daily' | 'week' | 'projects' | 'coffee' | 'food' | 'supplier' | 'updates' | 'shopping' | 'labour';

const WIDGET_ICON_EMOJI: Record<WidgetIconName, string> = {
  daily: '⚡', week: '📅', projects: '🎯', coffee: '☕', food: '🥪', supplier: '📦', updates: '🚀', shopping: '🛒', labour: '📊',
};

function WidgetIcon({ name, chip = 28 }: { name: WidgetIconName; chip?: number; glyph?: number }) {
  return <span style={{ fontSize: Math.round(chip * 0.56), lineHeight: 1, filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))' }}>{WIDGET_ICON_EMOJI[name]}</span>;
}

const SUPPLIER_LINKS: Record<string, string> = {
  'dench': 'https://denchbakers.cybakeshop.com.au/home',
  'seven seeds': 'https://sevenseedswholesale.com.au/account/',
  'noisette': 'https://connect.noisette.com.au/',
  'redimilk': 'tel:0397024262',
  'candied': `mailto:hello@candiedbakery.com.au?subject=${encodeURIComponent("G'DAY TIGER Order")}&body=${encodeURIComponent("Hey Guys,\n\nCan we please get\nx Paninis\nx Marshmallow Cookies\nx Candied Pies\nx Brownie Slab\nx Maple Pecan\n\nThanks,\nJono")}`,
  'little bertha': 'https://app.ordermentum.com/retailer/be811b6f-26ab-4115-9cd7-91d26dec6e44/supplier/2bcab476-f259-4c27-985c-3155f4e62d97',
};

const applyServerChecked = (todos: Todo[], date: string, state: Record<string, string[]>): Todo[] => {
  const checkedIds = new Set(state[date] || []);
  // Recurring tasks moved away from this date are stored under `date:moved` and filtered out entirely.
  const movedIds = new Set(state[`${date}:moved`] || []);
  return todos
    .filter(t => t.isHeader || !movedIds.has(t.id))
    // Shopping items: checked state is owned by Notion to_do.checked (written by
    // /api/check-shopping). Skip them here — the date-keyed state doesn't track them
    // and would reset them to unchecked on every refresh.
    .map(t => (t.isHeader || t.isShopping) ? t : { ...t, checked: checkedIds.has(t.id) });
};

// `bare` renders the card chromeless and auto-height for use inside the bottom
// sheet: no nested white panel, no fixed 575px height, no ▲ collapse (the sheet
// supplies its own close ✕ and grab handle). Content flows naturally and the
// sheet itself scrolls.
// `bare` renders the card chromeless (no nested white panel, no fixed height, no
// ▲ collapse) for use inside the bottom sheet — the sheet supplies the fixed
// height, the close ✕ and the single scroll. Content flows naturally.
function Card({ emoji, icon, title, children, onEmojiClick, headerRight, onCollapse, bare }: {
  emoji?: string; icon?: React.ReactNode; title: string; children: React.ReactNode; onEmojiClick?: () => void; headerRight?: React.ReactNode;
  onCollapse?: () => void;
  bare?: boolean;
}) {
  return (
    <div
      style={bare ? undefined : { background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)', height: '575px', overflow: 'hidden' }}
      className={bare ? 'flex flex-col gap-4' : 'rounded-3xl p-5 flex flex-col gap-4'}
    >
      <div className="flex items-center gap-2 shrink-0">
        {icon ? icon : <span className={`text-base transition-all ${onEmojiClick ? 'cursor-pointer select-none' : ''}`} style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))' }} onClick={onEmojiClick}>{emoji}</span>}
        <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: '#6b7280' }}>{title}</span>
        {(headerRight || (onCollapse && !bare)) && (
          <div className="ml-auto flex items-center gap-2">
            {headerRight}
            {onCollapse && !bare && (
              <button onClick={onCollapse} aria-label="Collapse" title="Collapse" className="text-gray-300 hover:text-gray-500 transition-colors leading-none" style={{ fontSize: '11px' }}>▲</button>
            )}
          </div>
        )}
      </div>
      <div className={bare ? '' : 'no-scrollbar flex-1 overflow-y-auto min-h-0'}>{children}</div>
    </div>
  );
}

// Square launcher tile — uniform size, opens its full widget on tap. `active`
// gives the open tile a highlighted ring so the dock reads as a set.
function LauncherTile({ emoji, icon, title, subtitle, badgeText, alert, active, onClick }: {
  emoji?: string; icon?: React.ReactNode; title: string; subtitle?: string; badgeText?: string | number; alert?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      className="rounded-3xl cursor-pointer flex flex-col items-center justify-center gap-1.5 p-3 text-center transition-all"
      style={{
        ...TILE_STYLE,
        aspectRatio: '1 / 1',
        ...(active ? { border: '1.5px solid #fbcdad', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8), 0 0 0 3px rgba(251,205,173,0.35)' } : {}),
      }}
    >
      {icon ? icon : <span style={{ fontSize: '26px', lineHeight: 1, filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))' }}>{emoji}</span>}
      <span className="text-[10px] font-bold tracking-widest uppercase leading-tight" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: '#6b7280' }}>{title}</span>
      {subtitle && <span className="text-[9px] tabular-nums" style={{ color: '#9ca3af', marginTop: '-2px' }}>{subtitle}</span>}
      <div className="flex items-center gap-1.5" style={{ minHeight: '22px' }}>
        {alert && (
          <span title="Needs attention" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626', flexShrink: 0, boxShadow: '0 0 0 3px rgba(220,38,38,0.15)' }} />
        )}
        {badgeText !== undefined && badgeText !== '' && (
          <span className="flex items-center justify-center rounded-full font-bold tabular-nums" style={{ minWidth: '22px', height: '22px', padding: '0 7px', background: '#fbcdad', color: '#333', fontSize: '11px', flexShrink: 0 }}>{badgeText}</span>
        )}
      </div>
    </div>
  );
}

// Bottom sheet — secondary widgets open as a sheet that slides up over the
// dashboard. The two pinned widgets (Daily To Do, Week Ahead) and the launcher
// dock stay put underneath behind a scrim. Close by: swiping the handle down,
// tapping the scrim, the ✕, or the card's ▲. Content scrolls inside the sheet so
// the dashboard never reflows. One sheet at a time (toggleWidget is single-open).
function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const draggingRef = useRef(false);
  const isMobile = useSyncExternalStore(
    (cb) => { const mq = window.matchMedia('(hover: none) and (pointer: coarse)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); },
    () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    () => false,
  );

  // Lock background scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape (desktop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onTouchStart = (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; draggingRef.current = true; setDragging(true); };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!draggingRef.current) return;
    const dy = e.touches[0].clientY - startY.current;
    setDragY(dy > 0 ? dy : 0); // only allow dragging downward
  };
  const onTouchEnd = () => {
    draggingRef.current = false;
    setDragging(false);
    if (dragY > 120) onClose();
    setDragY(0);
  };

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(20,20,25,0.35)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.3s ease',
        }}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
          // Full-width on mobile; capped to the widget width and centred on desktop.
          maxWidth: '760px', marginLeft: 'auto', marginRight: 'auto',
          // Fixed height so every widget opens to the same size (content scrolls
          // inside); short widgets just leave clean space below.
          height: '85vh',
          display: 'flex', flexDirection: 'column',
          transform: open ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : 'transform 0.38s cubic-bezier(0.32,0.72,0,1)',
          pointerEvents: open ? 'auto' : 'none',
          background: 'rgba(245,243,239,0.94)',
          backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          borderTopLeftRadius: '28px', borderTopRightRadius: '28px',
          boxShadow: '0 0 40px rgba(0,0,0,0.18)',
          border: '1px solid rgba(255,255,255,0.7)', borderBottom: 'none',
        }}
      >
        {/* Grab handle — swipe down to dismiss */}
        <div
          onTouchStart={isMobile ? onTouchStart : undefined}
          onTouchMove={isMobile ? onTouchMove : undefined}
          onTouchEnd={isMobile ? onTouchEnd : undefined}
          style={{ flexShrink: 0, padding: '10px 0 6px', display: 'flex', justifyContent: 'center', cursor: 'grab', touchAction: 'none' }}
        >
          <div style={{ width: '40px', height: '5px', borderRadius: '999px', background: 'rgba(0,0,0,0.18)' }} />
        </div>
        {/* Close button */}
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: '12px', right: '14px', zIndex: 2, width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', lineHeight: 1, color: '#6b7280', background: 'rgba(0,0,0,0.06)', borderRadius: '999px', border: 'none', cursor: 'pointer', padding: 0 }}>✕</button>
        {/* Content fills the fixed-height sheet; the widget inside owns its scroll.
            Capped + centred for desktop; top space clears the ✕ chip. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
          <div style={{ maxWidth: '720px', margin: '0 auto', width: '100%' }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

// Claude logomark — radial burst in Claude orange. Hand-built approximation;
// drop in the official SVG asset here if a brand file is available.
function ClaudeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      <g transform="translate(12,12)" fill="#D97757">
        {Array.from({ length: 12 }).map((_, i) => (
          <rect key={i} x={-1} y={-11} width={2} height={7.5} rx={1} transform={`rotate(${i * 30})`} />
        ))}
      </g>
    </svg>
  );
}

// Left-swipe-to-delete wrapper (mobile), matching the task tile gesture. Used
// for project tiles so projects are removed the same way tasks are — no button.
// On non-touch devices it just renders children (tasks have no desktop delete).
function SwipeToDelete({ children, onDelete, onClick }: { children: React.ReactNode; onDelete: () => void; onClick?: () => void; }) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontal = useRef(false);
  const didSwipeRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [committed, setCommitted] = useState(false);
  const THRESHOLD = 90;
  const isMobile = useSyncExternalStore(
    (cb) => { const mq = window.matchMedia('(hover: none) and (pointer: coarse)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); },
    () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    () => false,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isMobile) return;
    const preventScroll = (e: TouchEvent) => { if (isHorizontal.current) e.preventDefault(); };
    el.addEventListener('touchmove', preventScroll, { passive: false });
    return () => el.removeEventListener('touchmove', preventScroll);
  }, [isMobile]);

  const onTouchStart = (e: React.TouchEvent) => { if (!isMobile) return; touchStartX.current = e.touches[0].clientX; touchStartY.current = e.touches[0].clientY; isHorizontal.current = false; setSwiping(true); };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || !swiping) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isHorizontal.current && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) isHorizontal.current = true;
    if (isHorizontal.current) { didSwipeRef.current = true; setOffset(Math.min(0, dx)); }
  };
  const onTouchEnd = () => {
    if (!isMobile) return;
    setSwiping(false);
    if (offset <= -THRESHOLD) { setCommitted(true); setOffset(-window.innerWidth); setTimeout(onDelete, 200); }
    else setOffset(0);
  };

  const absOffset = Math.abs(Math.min(0, offset));
  const eased = Math.min(absOffset / THRESHOLD, 1);

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl" style={{ ...TILE_STYLE, minHeight: '62px' }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="absolute inset-0 flex items-center justify-end pr-4 rounded-2xl pointer-events-none"
        style={{ background: committed ? 'linear-gradient(270deg, #ef4444 0%, #fca5a5 100%)' : `linear-gradient(270deg, rgba(239,68,68,${eased * 0.9}) 0%, rgba(252,165,165,${eased * 0.7}) 100%)`, opacity: offset < 0 ? 1 : 0, transition: swiping ? 'none' : 'background 0.2s ease' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: '#7f1d1d', opacity: eased }}>DELETE ←</span>
      </div>
      <div
        style={{ transform: `translateX(${offset}px)`, transition: swiping ? 'none' : 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)', willChange: 'transform' }}
        onClick={() => { if (!didSwipeRef.current) onClick?.(); didSwipeRef.current = false; }}
      >
        {children}
      </div>
    </div>
  );
}

function CheckItem({ id, text, checked, onChange, onDelete, onDelegate, onSwipeRight, onDragStart, onPin, label, context, onContextSave, isSticky }: {
  id: string; text: string; checked: boolean;
  onChange: (id: string, checked: boolean) => void;
  onDelete?: (id: string) => void;
  onDelegate?: () => void;
  onSwipeRight?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  // Tapping the 📌 button converts this task to a [STICKY:date] persistent task
  // via /api/pin-task. Only offered when !isSticky (already-persistent tasks skip it).
  onPin?: () => void;
  label?: string;
  context?: string;
  onContextSave?: (id: string, text: string) => void;
  // True when task is a [STICKY] block or auto-pinned (e.g. "Review pricing" text).
  // Shows a static 📌 badge instead of the tappable pin button.
  isSticky?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const swipeOffsetRef = useRef(0);
  const isHorizontal = useRef(false);
  const didSwipeRef = useRef(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [localContext, setLocalContext] = useState(context ?? '');
  const THRESHOLD = 90;

  // Reset the local draft when the incoming context prop changes. Done during
  // render (React's "adjust state when a prop changes" pattern) instead of in an
  // effect, which avoids an extra cascading render.
  const [ctxSnapshot, setCtxSnapshot] = useState(context);
  if (context !== ctxSnapshot) {
    setCtxSnapshot(context);
    setLocalContext(context ?? '');
  }

  const mouseDownRef = useRef(false);
  // Detect touch/mobile vs mouse/desktop. useSyncExternalStore is the SSR-safe
  // way to read a media query: server snapshot is false, the client reads the
  // real value on hydration, and it re-renders if the device capability changes.
  const isMobile = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    () => false,
  );
  // Right swipe (→ tomorrow) and drag-and-drop are split by device:
  //   mobile  → right swipe ✓, drag ✗
  //   desktop → right swipe ✗, drag ✓
  const canSwipeRight = !!onSwipeRight && isMobile;
  const canSwipeLeft = !!onDelete && isMobile;
  const canSwipe = canSwipeRight || canSwipeLeft;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canSwipe) return;
    const preventScroll = (e: TouchEvent) => { if (isHorizontal.current) e.preventDefault(); };
    el.addEventListener('touchmove', preventScroll, { passive: false });
    return () => el.removeEventListener('touchmove', preventScroll);
  }, [canSwipe]);

  // Mouse handlers (desktop)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canSwipe) return;
    touchStartX.current = e.clientX;
    touchStartY.current = e.clientY;
    swipeOffsetRef.current = 0;
    mouseDownRef.current = true;
    isHorizontal.current = false;
    didSwipeRef.current = false;
    setSwiping(false);
  };

  useEffect(() => {
    if (!canSwipe) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseDownRef.current) return;
      const dx = e.clientX - touchStartX.current;
      const dy = e.clientY - touchStartY.current;
      if (!isHorizontal.current && Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 2 && canSwipeRight) {
        isHorizontal.current = true;
        setSwiping(true);
        const clamped = Math.min(dx, 160);
        swipeOffsetRef.current = clamped;
        setSwipeOffset(clamped);
        setCommitted(clamped >= THRESHOLD);
      } else if (dx < -2 && canSwipeLeft) {
        isHorizontal.current = true;
        setSwiping(true);
        const clamped = Math.max(dx, -160);
        swipeOffsetRef.current = clamped;
        setSwipeOffset(clamped);
        setCommitted(clamped <= -THRESHOLD);
      }
    };
    const handleMouseUp = () => {
      if (!mouseDownRef.current) return;
      mouseDownRef.current = false;
      isHorizontal.current = false;
      setSwiping(false);
      if (swipeOffsetRef.current >= THRESHOLD && canSwipeRight) {
        didSwipeRef.current = true;
        setDismissed(true);
        setTimeout(() => onSwipeRight!(), 360);
      } else if (swipeOffsetRef.current <= -THRESHOLD && canSwipeLeft) {
        didSwipeRef.current = true;
        setDismissed(true);
        setTimeout(() => onDelete!(id), 360);
      } else {
        if (Math.abs(swipeOffsetRef.current) > 5) didSwipeRef.current = true;
        setSwipeOffset(0);
        setCommitted(false);
      }
      swipeOffsetRef.current = 0;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [canSwipe, canSwipeRight, canSwipeLeft, onSwipeRight, onDelete, id]);

  // Touch handlers (mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canSwipe) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeOffsetRef.current = 0;
    isHorizontal.current = false;
    didSwipeRef.current = false;
    setSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canSwipe) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isHorizontal.current && Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 2 && canSwipeRight) {
      isHorizontal.current = true;
      setSwiping(true);
      const clamped = Math.min(dx, 160);
      swipeOffsetRef.current = clamped;
      setSwipeOffset(clamped);
      if (clamped >= THRESHOLD && !committed) setCommitted(true);
      if (clamped < THRESHOLD && committed) setCommitted(false);
    } else if (dx < -2 && canSwipeLeft) {
      isHorizontal.current = true;
      setSwiping(true);
      const clamped = Math.max(dx, -160);
      swipeOffsetRef.current = clamped;
      setSwipeOffset(clamped);
      if (clamped <= -THRESHOLD && !committed) setCommitted(true);
      if (clamped > -THRESHOLD && committed) setCommitted(false);
    }
  };

  const handleTouchEnd = () => {
    if (!canSwipe) return;
    isHorizontal.current = false;
    setSwiping(false);
    if (swipeOffsetRef.current >= THRESHOLD && canSwipeRight) {
      didSwipeRef.current = true;
      setDismissed(true);
      setTimeout(() => onSwipeRight!(), 360);
    } else if (swipeOffsetRef.current <= -THRESHOLD && canSwipeLeft) {
      didSwipeRef.current = true;
      setDismissed(true);
      setTimeout(() => onDelete!(id), 360);
    } else {
      if (Math.abs(swipeOffsetRef.current) > 5) didSwipeRef.current = true;
      setSwipeOffset(0);
      setCommitted(false);
    }
    swipeOffsetRef.current = 0;
  };

  if (dismissed) return null;

  const absOffset = Math.abs(swipeOffset);
  const swipeProgress = Math.min(absOffset / THRESHOLD, 1);
  const eased = swipeProgress < 0.5 ? 2 * swipeProgress * swipeProgress : 1 - Math.pow(-2 * swipeProgress + 2, 2) / 2;
  const isRightSwipe = swipeOffset > 0;
  const isLeftSwipe = swipeOffset < 0;

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl"
      draggable={!!onDragStart && !isMobile}
      onDragStart={!isMobile ? onDragStart : undefined}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ userSelect: 'none', minHeight: '62px', background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' }}
    >
      {/* Right swipe reveal — tomorrow */}
      {canSwipeRight && (
        <div className="absolute inset-0 flex items-center pl-4 rounded-xl pointer-events-none"
          style={{
            background: committed && isRightSwipe
              ? 'linear-gradient(90deg, #fbcdad 0%, #f9b48a 100%)'
              : `linear-gradient(90deg, rgba(251,205,173,${eased * 0.9}) 0%, rgba(249,180,138,${eased * 0.7}) 100%)`,
            opacity: isRightSwipe ? 1 : 0,
            transition: swiping ? 'none' : 'background 0.2s ease',
          }}>
          <span style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: '#7c4a2d',
            opacity: isRightSwipe ? eased : 0,
            transform: `translateX(${(1 - eased) * -8}px)`,
            transition: swiping ? 'none' : 'all 0.2s ease',
          }}>
            → TOMORROW
          </span>
        </div>
      )}
      {/* Left swipe reveal — delete */}
      {canSwipeLeft && (
        <div className="absolute inset-0 flex items-center justify-end pr-4 rounded-xl pointer-events-none"
          style={{
            background: committed && isLeftSwipe
              ? 'linear-gradient(270deg, #ef4444 0%, #fca5a5 100%)'
              : `linear-gradient(270deg, rgba(239,68,68,${eased * 0.9}) 0%, rgba(252,165,165,${eased * 0.7}) 100%)`,
            opacity: isLeftSwipe ? 1 : 0,
            transition: swiping ? 'none' : 'background 0.2s ease',
          }}>
          <span style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: '#7f1d1d',
            opacity: isLeftSwipe ? eased : 0,
            transform: `translateX(${(1 - eased) * 8}px)`,
            transition: swiping ? 'none' : 'all 0.2s ease',
          }}>
            DELETE ←
          </span>
        </div>
      )}
      <div
        className="flex items-start gap-3 group px-3 py-2.5"
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: swiping ? 'none' : 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          willChange: 'transform',
        }}
        onClick={() => { if (!didSwipeRef.current) setExpanded(e => !e); didSwipeRef.current = false; }}
      >
        <div onClick={e => { e.stopPropagation(); onChange(id, !checked); }} className="shrink-0 w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer" style={{ background: checked ? '#fbcdad' : 'rgba(255,255,255,0.6)', border: checked ? '1.5px solid #fbcdad' : '1.5px solid rgba(0,0,0,0.15)', marginTop: '2px' }}>
          {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm leading-snug">
            {(() => {
              const supplierUrl = SUPPLIER_LINKS[text.toLowerCase()];
              if (supplierUrl && !checked) {
                return <a href={supplierUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2" style={{ color: '#c8926a' }} onClick={e => e.stopPropagation()}>{text.toUpperCase()}</a>;
              }
              return <span className={`transition-colors font-semibold ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>{text.toUpperCase()}</span>;
            })()}
          </div>
          {label && <p className="text-xs text-gray-400 mt-0.5 uppercase">{label}</p>}
        </div>
        {isSticky && <span className="shrink-0 text-xs mt-0.5 leading-none" title="Persistent — stays until ticked off">📌</span>}
        {!isSticky && !checked && onPin && <button onClick={e => { e.stopPropagation(); onPin(); }} className="shrink-0 leading-none transition-opacity opacity-0 group-hover:opacity-60 hover:!opacity-100 mt-0.5" aria-label="Pin task" title="Make persistent — stays until ticked off" style={{ fontSize: '13px' }}>📌</button>}
        {context && !expanded && <div className="shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: '#fbcdad' }} title="Has context" />}
        {onDelegate && <button onClick={e => { e.stopPropagation(); onDelegate!(); }} className="shrink-0 transition-opacity leading-none opacity-50 hover:opacity-100 mt-0.5" aria-label="Ask Claude" title="Ask Claude"><ClaudeLogo size={15} /></button>}
        {!isMobile && onDelete && <button onClick={e => { e.stopPropagation(); onDelete(id); }} className="shrink-0 leading-none text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 mt-0.5" aria-label="Delete" title="Delete">✕</button>}
      </div>
      {expanded && (
        <div className="px-4 pb-3" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          <textarea
            value={localContext}
            onChange={e => setLocalContext(e.target.value)}
            onBlur={() => onContextSave?.(id, localContext)}
            placeholder="Add context…"
            autoFocus
            rows={3}
            className="w-full text-xs text-gray-600 bg-transparent resize-none focus:outline-none placeholder-gray-300 mt-2 leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}

// Shopping quantities are encoded in the item text as a trailing "×N" (or "xN"),
// e.g. "basil ×2". Quantity of 1 is stored as just the name with no suffix.
function parseShoppingQty(raw: string): { name: string; qty: number } {
  const m = raw.match(/\s*[×x]\s*(\d+)\s*$/i);
  if (m && m.index !== undefined) {
    const qty = parseInt(m[1], 10);
    return { name: raw.slice(0, m.index).trim(), qty: qty > 0 ? qty : 1 };
  }
  return { name: raw.trim(), qty: 1 };
}
function buildShoppingText(name: string, qty: number): string {
  const n = name.trim();
  return qty > 1 ? `${n} ×${qty}` : n;
}

// Schedule type options for the add-task recurrence picker.
// Persistent tasks are created by pinning (📌) in the Daily To Do — see handlePinTask.
const RECURRENCE_OPTIONS = [
  { value: 'once', label: 'Once Off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

function RosterRow({ shift, isToday, isHighlighted, taskCount, onAdd, onSelectDay, onDrop, onDragOver, onDragLeave, isDragOver }: {
  shift: Shift; isToday: boolean; isHighlighted: boolean; taskCount: number;
  onAdd: (date: string, text: string, recurrence: string) => void;
  onSelectDay: (date: string) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: () => void;
  isDragOver?: boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [recurrence, setRecurrence] = useState<string>('once');
  const [saving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openInput = (e: React.MouseEvent) => { e.stopPropagation(); setIsAdding(true); setTimeout(() => inputRef.current?.focus(), 320); };
  const close = () => { setIsAdding(false); setTaskText(''); setRecurrence('once'); };
  const submit = () => {
    if (!taskText.trim()) return;
    onAdd(shift.date, taskText.trim().toUpperCase(), recurrence);
    close();
  };

  const baseStyle = isDragOver
    ? { background: 'rgba(22,163,74,0.10)', borderColor: 'rgba(22,163,74,0.25)', boxShadow: '0 0 0 2px rgba(22,163,74,0.15)' }
    : isHighlighted
      ? { background: 'rgba(251,205,173,0.12)', borderColor: '#fbcdad', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' }
      : { background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl transition-all ${isDragOver ? 'border' : isHighlighted ? 'border' : ''}`}
      style={{ minHeight: isAdding ? '104px' : '62px', ...baseStyle }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="absolute inset-0 flex items-center justify-between py-2 px-3 transition-transform duration-300 ease-in-out cursor-pointer" style={{ transform: isAdding ? 'translateX(-100%)' : 'translateX(0)' }} onClick={() => onSelectDay(shift.date)}>
        <div>
          <span className={`text-sm font-semibold uppercase ${shift.working ? 'text-gray-800' : 'text-gray-400'}`}>{shift.label}{isToday && <span className="ml-2 text-xs font-medium text-gray-400">TODAY</span>}</span>
          {shift.working && shift.area && <p className="text-xs text-gray-400 mt-0.5 uppercase">{shift.area}</p>}
          {shift.working && shift.comment && <p className="text-xs text-gray-400 mt-0.5">{shift.comment}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium uppercase ${shift.working ? 'text-gray-500' : 'text-gray-300'}`}>{shift.working ? `${shift.start} – ${shift.end}` : 'Not working'}</span>
          <button onClick={() => onSelectDay(shift.date)} className="flex items-center justify-center rounded-full font-bold transition-all hover:scale-110" style={{ width: '22px', height: '22px', background: taskCount > 0 ? '#fbcdad' : 'rgba(0,0,0,0.06)', color: taskCount > 0 ? '#333' : '#aaa', flexShrink: 0, fontSize: '11px' }} title={`${taskCount} task${taskCount !== 1 ? 's' : ''}`}>{taskCount}</button>
          <button onClick={openInput} className="transition-colors text-xl leading-none font-light text-gray-300 hover:text-gray-400" aria-label="Add task">+</button>
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col justify-center gap-2 py-2 px-3 transition-transform duration-300 ease-in-out" style={{ transform: isAdding ? 'translateX(0)' : 'translateX(100%)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold shrink-0 text-gray-500 uppercase">{shift.label.split(' ')[0]}</span>
          <input ref={inputRef} value={taskText} onChange={e => setTaskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); }} placeholder="ADD TASK..." className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
          <button onClick={submit} disabled={saving || !taskText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>{saving ? '...' : 'ADD'}</button>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">✕</button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pl-7" style={{ scrollbarWidth: 'none' }}>
          {RECURRENCE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRecurrence(opt.value)}
              className="text-[10px] uppercase font-semibold px-2 py-1 rounded-full transition-colors shrink-0 tracking-wide"
              style={{ background: recurrence === opt.value ? '#fbcdad' : 'rgba(0,0,0,0.05)', color: recurrence === opt.value ? '#333' : '#999' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const HIST_KEY     = 'gdt_costings_history_v1';
const ING_HIST_KEY = 'gdt_ingredient_history_v1';

type SnapEntry = { date: string; d: Record<string, { p: number; s: number }> };
type IngSnap   = { date: string; d: Record<string, number> };

type IngredientPrice = { key: string; name: string; price: number; unit: string; supplier: string };
type IngredientPricesData = { type: string; updated: string | null; ingredients: IngredientPrice[] };

type DriftSeverity = 'yellow' | 'amber' | 'red';
type DriftWarning = {
  cell: string;
  label: string;
  daysStale: number | null;
  refreshDays: number;
  severity: DriftSeverity;
  ingredientKey: string | null;
  neverSeen: boolean;
};
type PackChange = {
  cell: string;
  label: string;
  oldPack: number;
  newPack: number;
  cartonPrice: number;
  oldUnitCost: number | null;
  newUnitCost: number;
  unitCostPct: number | null;
  date: string;
};
type UnmappedSku = { sig: string; supplier: string; description: string; price: number; date: string };
type PriceDriftData = {
  type: string;
  updated: string | null;
  warnings: DriftWarning[];
  packChanges?: PackChange[];
  unmappedSkus?: UnmappedSku[];
};

type MarginReviewItem = {
  name: string;
  category: string;
  margin: number;
  sell: number;
  weeklyQty: number;
  weeklyGross: number;
  shortfall: number;
  severity: 'red' | 'amber';
};
type MarginReviewData = {
  type: string;
  updated: string | null;
  weekStart?: string;
  weekEnd?: string;
  targetMargin?: number;
  items: MarginReviewItem[];
  totalShortfall?: number;
  coffeeShortfall?: number;
  foodShortfall?: number;
  coffeeShortfallPct?: number;
  foodShortfallPct?: number;
  coffeeRevenue?: number;
  foodRevenue?: number;
  coffeeFlagged?: number;
  foodFlagged?: number;
  greenCount?: number;
  unmatchedCoffeeCount?: number;
  unmatchedCoffeeQty?: number;
  sales?: { name: string; weeklyQty: number }[];
  unmatched?: { name: string; weeklyQty: number; weeklyGross: number }[];
};

// "Review pricing – <Item> (NN.N%)" to-dos are a frozen text snapshot from
// whenever the task was created (see isReviewPricingTask in dayTasks.ts) — the
// percentage drifts out of sync with Notion/Costings/TigerOS as new invoices
// land. Swap the trailing (NN.N%) for the current live margin from
// marginReview.items at render time so the Daily To Do always matches the
// live figure. The underlying Notion block text (task.text) is left
// untouched — only the on-screen label is rewritten.
const REVIEW_PRICING_PCT_RE = /^(review pricing\b[\s\-–—:]*)(.+?)\s*\([\d.]+%\)\s*$/i;
// reviewMap is keyed by product name (ALL CAPS) → current gross margin %.
// Built from `costings` (30-min Notion sync, covers every product) NOT from
// marginReview.items (weekly run, only flagged items — too sparse for this).
function withLiveReviewMargin(text: string, reviewMap: Map<string, number>): string {
  const m = text.match(REVIEW_PRICING_PCT_RE);
  if (!m) return text;
  const [, prefix, itemName] = m;
  const margin = reviewMap.get(itemName.trim().toUpperCase());
  if (margin === undefined) return text;
  return `${prefix}${itemName.trim()} (${margin.toFixed(1)}%)`;
}

// Rolling "True Payment Cost" — Square fees as a % of total revenue, computed
// by apps-script/PaymentFeeTracker.js. Until enough days have backfilled,
// the dashboard falls back to MERCHANT_FEE_PCT.
type PaymentFeesData = {
  type: string;
  updated: string | null;
  daysCovered: number;
  totalCollected: number;
  totalFees: number;
  feePct: number | null;
};

// Minimum days of live data before trusting the live rate over the static fallback.
const PAYMENT_FEES_MIN_DAYS = 30;

type RecipeMapProduct = {
  id?: string;
  section: string;
  source: 'food' | 'coffee';
  direct: string[];
  expanded: string[];
};
type RecipeMapData = {
  type: string;
  updated: string | null;
  products: Record<string, RecipeMapProduct>;
  ingredient_to_products: Record<string, string[]>;
  sub_recipes: Record<string, string[]>;
};

type IngredientChange = {
  key: string; name: string; unit: string; supplier: string; currentPrice: number;
  oldPrice?: number; delta?: number; pct?: number; daysAgo?: number;
  affectedProducts: MarginChange[];
  drift?: DriftWarning;
};

type MarginChange = {
  name: string;
  category: string;
  oldPct: number;
  newPct: number;
  dp: number;
  dc: number;
  sellPrice: number | null;
  daysAgo: number;
  via?: string; // set when the ingredient reaches the product through a made-in-house mix
};

const FADE_MASK = 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)';

function productMatchesIngredient(productName: string, ingredientKey: string): boolean {
  const n = productName.toUpperCase();
  type Rule = { inc: string[]; exc?: string[] };
  const MAP: Record<string, Rule> = {
    // ── Coffee ────────────────────────────────────────────────────────────────
    fc_milk_12l:         { inc: ['FC MILK', 'ICED LATTE', 'HOT CHOCOLATE', 'CHAI', 'MOCHA', 'FLAT WHITE', 'LATTE', 'CAPPUCCINO'], exc: ['SOY', 'OAT', 'ALMOND'] },
    soy_milk_6l:         { inc: ['SOY'] },
    oat_milk_2l:         { inc: ['OAT', 'ALMOND'] },
    coffee_beans:        { inc: ['COFFEE', 'LATTE', 'MOCHA', 'ESPRESSO', 'LONG BLACK', 'FLAT WHITE', 'CAPPUCCINO'], exc: ['HOT CHOCOLATE', 'DECAF'] },
    decaf_beans:         { inc: ['DECAF'] },
    chai:                { inc: ['CHAI'] },
    chocolate:           { inc: ['HOT CHOCOLATE', 'MOCHA'] },
    straw:               { inc: ['ICED LATTE'] },
    cup_large:           { inc: ['TAKEAWAY'], exc: ['SOY', 'OAT', 'ALMOND', 'DECAF', 'FILTER', 'BATCH'] },
    cup_medium:          { inc: ['TAKEAWAY SOY', 'TAKEAWAY OAT', 'TAKEAWAY ALMOND', 'TAKEAWAY DECAF'] },
    lid_standard:        { inc: ['TAKEAWAY'] },
    // ── Bread ─────────────────────────────────────────────────────────────────
    sourdough:           { inc: ['H+C SANDWICH', 'BEEF SANDWICH', 'TUNA SANDWICH', 'CAPONATA', 'MUSHROOM'] },
    ciabatta:            { inc: ['SALAMI PANINI', 'AUTOGRILL'] },
    potato_bun:          { inc: ['CHICKEN SCHNITTA'] },
    croissant:           { inc: ['CROISSANT'] },
    // ── Meats ─────────────────────────────────────────────────────────────────
    ham:                 { inc: ['H+C SANDWICH', 'CROISSANT'], exc: ['TIGER STYLE'] },
    beef_pastrami:       { inc: ['BEEF SANDWICH'] },
    salami:              { inc: ['SALAMI', 'AUTOGRILL'] },
    tuna:                { inc: ['TUNA'] },
    chicken:             { inc: ['CHICKEN', 'SCHNITTA'] },
    // ── Cheese ────────────────────────────────────────────────────────────────
    mozzarella:          { inc: ['H+C SANDWICH', 'SALAMI PANINI', 'AUTOGRILL', 'MUSHROOM', 'CAPONATA'] },
    swiss_cheese:        { inc: ['BEEF SANDWICH', 'CROISSANT', 'CHICKEN SCHNITTA'] },
    taleggio:            { inc: ['MUSHROOM'] },
    american_cheese:     { inc: ['TUNA SANDWICH'] },
    parmesan_grated:     { inc: ['MUSHROOM'] },
    parmesan_block:      { inc: ['MUSHROOM'] },
    // ── Vegetables ────────────────────────────────────────────────────────────
    tomato:              { inc: ['SALAMI PANINI', 'AUTOGRILL', 'TIGER STYLE'] },
    sauerkraut:          { inc: ['BEEF SANDWICH'] },
    pickles:             { inc: ['BEEF SANDWICH', 'TIGER STYLE', 'TUNA'] },
    mushrooms_raw:       { inc: ['MUSHROOM'] },
    red_onion:           { inc: ['SALAMI PANINI', 'AUTOGRILL', 'TUNA'] },
    fennel:              { inc: ['CHICKEN SCHNITTA'] },
    red_chilli:          { inc: ['TUNA'] },
    jalapeno:            { inc: ['CHICKEN SCHNITTA'] },
    parsley:             { inc: ['TUNA', 'MUSHROOM'] },
    dill:                { inc: ['CHICKEN SCHNITTA'] },
    bananas:             { inc: ['BANANA BREAD'] },
    eggplant:            { inc: ['CAPONATA'] },
    lemon:               { inc: ['CAPONATA', 'MUSHROOM'] },
    carrot:              { inc: [] },
    cucumber:            { inc: [] },
    leni_peppers:        { inc: ['CAPONATA'] },
    // ── Sauces ────────────────────────────────────────────────────────────────
    dijon_mustard:       { inc: ['CHICKEN SCHNITTA'] },
    mayo:                { inc: ['TUNA', 'CHICKEN SCHNITTA', 'BEEF SANDWICH'] },
    ketchup:             { inc: ['TIGER STYLE'] },
    // ── Made In House ─────────────────────────────────────────────────────────
    tuna_mix:            { inc: ['TUNA SANDWICH'] },
    caponata:            { inc: ['CAPONATA'] },
    mushroom_mix:        { inc: ['MUSHROOM'] },
    schnittas:           { inc: ['CHICKEN SCHNITTA'] },
    tiger_sauce:         { inc: ['TIGER STYLE', 'BEEF SANDWICH'] },
    honey_mustard_mayo:  { inc: ['CHICKEN SCHNITTA'] },
    // ── Extras ────────────────────────────────────────────────────────────────
    butter:              { inc: ['H+C SANDWICH', 'BEEF SANDWICH', 'MUSHROOM', 'TUNA SANDWICH', 'TIGER STYLE'] },
    olive_oil:           { inc: ['CAPONATA', 'SALAMI PANINI', 'AUTOGRILL', 'MUSHROOM'] },
    salt:                { inc: ['H+C SANDWICH', 'BEEF SANDWICH', 'TUNA', 'CAPONATA', 'MUSHROOM', 'AUTOGRILL', 'CHICKEN SCHNITTA'] },
    pepper:              { inc: ['H+C SANDWICH', 'BEEF SANDWICH', 'MUSHROOM', 'CROISSANT', 'CHICKEN SCHNITTA'] },
    eggs:                { inc: ['BANANA BREAD', 'CHICKEN SCHNITTA'] },
    // ── Packaging ─────────────────────────────────────────────────────────────
    napkins:             { inc: ['H+C SANDWICH', 'BEEF SANDWICH', 'TUNA SANDWICH', 'CAPONATA', 'MUSHROOM', 'AUTOGRILL', 'CHICKEN SCHNITTA', 'BANANA BREAD', 'CROISSANT'] },
    tray:                { inc: ['BANANA BREAD'] },
    // ── Pantry ────────────────────────────────────────────────────────────────
    plain_flour:         { inc: ['BANANA BREAD', 'CHICKEN SCHNITTA'] },
    sr_flour:            { inc: ['BANANA BREAD'] },
    caster_sugar:        { inc: ['BANANA BREAD'] },
    brown_sugar:         { inc: ['BANANA BREAD'] },
    bicarb_soda:         { inc: ['BANANA BREAD'] },
    cinnamon:            { inc: ['BANANA BREAD'] },
    vegetable_oil:       { inc: ['BANANA BREAD'] },
    breadcrumbs:         { inc: ['CHICKEN SCHNITTA'] },
    honey:               { inc: ['CHICKEN SCHNITTA'] },
    sungold_milk:        { inc: ['BANANA BREAD', 'CHICKEN SCHNITTA'] },
  };
  const rule = MAP[ingredientKey];
  if (!rule) return false;
  const included = rule.inc.some(p => n.includes(p));
  if (!included) return false;
  return !(rule.exc || []).some(p => n.includes(p));
}

// Visual styling per drift severity. Used by the chip on each ingredient card.
const DRIFT_STYLES: Record<DriftSeverity, { bg: string; fg: string }> = {
  yellow: { bg: '#fef3c7', fg: '#78350f' },
  amber:  { bg: '#fed7aa', fg: '#7c2d12' },
  red:    { bg: '#fecaca', fg: '#7f1d1d' },
};

function DriftChip({ drift }: { drift: DriftWarning }) {
  const s = DRIFT_STYLES[drift.severity];
  const label = drift.neverSeen
    ? 'never seen'
    : `stale ${drift.daysStale}d`;
  const title = drift.neverSeen
    ? `${drift.cell} [${drift.label}] — never updated by scanner. Likely manual-entry only or supplier renamed the SKU.`
    : `${drift.cell} [${drift.label}] — ${drift.daysStale}d since last invoice (expected within ${drift.refreshDays}d). Supplier may have renamed the SKU.`;
  return (
    <span
      title={title}
      className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 leading-none whitespace-nowrap"
      style={{ background: s.bg, color: s.fg, fontVariantNumeric: 'tabular-nums' }}
    >
      ⚠ {label}
    </span>
  );
}

// ── Pack-size change banner (Supplier Prices card) ───────────────────────────
// Rendered when the invoice scanner detects a supplier changed units-per-carton.
// The headline case: carton price drops but pack shrinks more — unit cost rises
// while the invoice looks cheaper. Cleared via clearPackChange() in Apps Script
// or auto-expires after 30 days.
function PackChangeBanner({ packChanges, unmappedSkus, onAddSku }: { packChanges: PackChange[]; unmappedSkus: UnmappedSku[]; onAddSku: (sku: UnmappedSku) => void }) {
  if (packChanges.length === 0 && unmappedSkus.length === 0) return null;
  return (
    <div className="mb-2 space-y-2 shrink-0">
      {packChanges.map(pc => {
        const up = (pc.unitCostPct ?? 0) > 0;
        return (
          <div key={pc.cell + pc.date} className="rounded-2xl px-3 py-2.5"
            style={{ background: 'rgba(254,202,202,0.55)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.6)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#7f1d1d', fontFamily: '"stolzl", sans-serif' }}>
                ⚠ Pack size changed
              </span>
              {pc.unitCostPct !== null && (
                <span className="text-xs font-black ml-auto shrink-0" style={{ color: up ? '#dc2626' : '#16a34a', fontVariantNumeric: 'tabular-nums' }}>
                  unit cost {up ? '+' : ''}{pc.unitCostPct.toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-xs leading-snug" style={{ color: '#7f1d1d' }}>
              {pc.label}: /{pc.oldPack} → /{pc.newPack} per carton (${pc.cartonPrice.toFixed(2)}).
              {pc.oldUnitCost !== null && (
                <> True unit cost ${pc.oldUnitCost.toFixed(3)} → ${pc.newUnitCost.toFixed(3)}.</>
              )}
              {' '}Sheet price normalised to per-1000 — recipes stay correct.
            </p>
          </div>
        );
      })}
      {unmappedSkus.map(sku => (
        <div key={sku.sig} className="rounded-2xl px-3 py-2 flex items-center gap-2"
          style={{ background: 'rgba(254,215,170,0.5)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.6)' }}>
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0" style={{ background: '#fed7aa', color: '#7c2d12' }}>
            new sku
          </span>
          <span className="text-xs flex-1 min-w-0 truncate" style={{ color: '#7c2d12' }} title={`${sku.supplier}: ${sku.description} — $${sku.price} (not mapped to any ingredient cell)`}>
            {sku.supplier}: {sku.description}
          </span>
          <span className="text-xs font-bold shrink-0" style={{ color: '#7c2d12', fontVariantNumeric: 'tabular-nums' }}>${sku.price.toFixed(2)}</span>
          <button
            onClick={() => onAddSku(sku)}
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg shrink-0 transition-colors"
            style={{ background: '#fed7aa', color: '#7c2d12', border: '1px solid rgba(124,45,18,0.2)' }}
            title={`Add "${sku.description}" as a tracked ingredient`}
          >+ ADD</button>
        </div>
      ))}
    </div>
  );
}

function IngredientChangeCard({ ing }: { ing: IngredientChange }) {
  const [open, setOpen] = useState(false);
  const hasPriceDelta = ing.delta !== undefined;
  const isUp = hasPriceDelta && ing.delta! > 0;
  const deltaCol = isUp ? '#dc2626' : '#16a34a';

  return (
    <div className="rounded-2xl px-3 py-2.5 mb-2 shrink-0 cursor-pointer select-none"
      onClick={() => setOpen(o => !o)}
      style={{ background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' }}>

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-normal text-gray-800 leading-snug flex-1 min-w-0 truncate"
          style={{ fontFamily: '"stolzl", sans-serif', textTransform: 'uppercase' }}>
          {ing.name}
        </p>
        {ing.drift && <DriftChip drift={ing.drift} />}
        {hasPriceDelta ? (
          <span className="text-base font-black shrink-0 leading-none" style={{ color: deltaCol, fontVariantNumeric: 'tabular-nums' }}>
            {isUp ? '+' : ''}{ing.pct!.toFixed(1)}%
          </span>
        ) : (
          <span className="text-sm font-black shrink-0 leading-none" style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
            {ing.affectedProducts.length}
          </span>
        )}
      </div>

      {/* Supplier + price row */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400" style={{ fontVariantNumeric: 'tabular-nums', textTransform: 'uppercase' }}>
          {ing.supplier}
        </span>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
          {hasPriceDelta ? (
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.abs(ing.pct!))}%`, background: deltaCol, transition: 'width 0.6s ease' }} />
          ) : (
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, ing.affectedProducts.length * 10)}%`, background: 'rgba(0,0,0,0.12)', transition: 'width 0.6s ease' }} />
          )}
        </div>
        <span className="text-xs text-gray-400" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {hasPriceDelta
            ? `$${ing.oldPrice!.toFixed(2)} → $${ing.currentPrice.toFixed(2)}`
            : `$${ing.currentPrice.toFixed(2)} / ${ing.unit.toUpperCase()}`}
        </span>
      </div>

      {/* Affected products — expanded */}
      {open && ing.affectedProducts.length > 0 && (
        <div className="mt-2 pt-2 space-y-1.5" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          {ing.affectedProducts.map((p, i) => {
            const hasShift = Math.abs(p.dp) >= 0.15;
            const col = hasShift ? (p.dp < 0 ? '#dc2626' : '#16a34a') : '#9ca3af';
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 flex-1 min-w-0 truncate" style={{ textTransform: 'uppercase' }}>
                  {p.name}
                  {p.via && (
                    <span className="inline-block ml-1.5 px-1.5 py-0.5 rounded-md align-middle"
                      style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em', background: 'rgba(217,119,6,0.12)', color: '#92400e', textTransform: 'uppercase' }}
                    >via {p.via}</span>
                  )}
                </span>
                <span style={{ color: col, fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {hasShift
                    ? `${p.oldPct.toFixed(1)}%→${p.newPct.toFixed(1)}% (${p.dp > 0 ? '+' : ''}${p.dp.toFixed(1)}pp)`
                    : `${p.newPct.toFixed(1)}%`}
                </span>
              </div>
            );
          })}
          <p className="text-xs text-right" style={{ color: '#9ca3af' }}>▲ collapse</p>
        </div>
      )}

      {!open && ing.affectedProducts.length > 0 && (
        <p className="text-xs text-right mt-0.5" style={{ color: '#9ca3af' }}>▼ {ing.affectedProducts.length} AFFECTED</p>
      )}
    </div>
  );
}

function ChangeCard({ c }: { c: MarginChange }) {
  const [open, setOpen] = useState(false);
  const isNeg = c.dp < 0;
  const arrowCol = isNeg ? '#dc2626' : '#16a34a';
  const newMc = c.newPct >= 70 ? '#16a34a' : c.newPct >= 60 ? '#d97706' : '#dc2626';
  const oldBar = Math.min(100, Math.max(0, c.oldPct));
  const newBar = Math.min(100, Math.max(0, c.newPct));
  return (
    <div
      className="rounded-2xl px-3 py-2.5 mb-2 shrink-0 cursor-pointer select-none"
      onClick={() => setOpen(o => !o)}
      style={{
        background: isNeg ? 'rgba(254,242,242,0.65)' : 'rgba(240,253,244,0.65)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        border: `1px solid ${isNeg ? 'rgba(220,38,38,0.18)' : 'rgba(22,163,74,0.18)'}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
        transition: 'box-shadow 0.15s',
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-normal text-gray-800 leading-snug flex-1 min-w-0 truncate uppercase"
          style={{ fontFamily: '"stolzl", sans-serif' }}>
          {c.name}
        </p>
        <span className="text-base font-black shrink-0 leading-none" style={{ color: arrowCol, fontVariantNumeric: 'tabular-nums' }}>
          {c.dp > 0 ? '+' : ''}{c.dp.toFixed(1)}pp
        </span>
      </div>
      {/* Margin transition row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs shrink-0" style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
          {c.oldPct.toFixed(1)}%
          <span className="mx-1 text-gray-300">→</span>
          <span style={{ color: newMc, fontWeight: 700 }}>{c.newPct.toFixed(1)}%</span>
        </span>
        {/* Dual bar: ghost = old, solid = new */}
        <div className="flex-1 h-1.5 rounded-full overflow-hidden relative" style={{ background: 'rgba(0,0,0,0.07)' }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${oldBar}%`, background: 'rgba(0,0,0,0.13)' }} />
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${newBar}%`, background: newMc, opacity: 0.75, transition: 'width 0.5s ease' }} />
        </div>
      </div>
      {/* Expanded detail */}
      {open && (
        <div className="mt-1.5 pt-2 flex flex-col gap-1.5" style={{ borderTop: `1px solid ${isNeg ? 'rgba(220,38,38,0.12)' : 'rgba(22,163,74,0.12)'}` }}>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Sell price</span>
            <span className="font-semibold text-gray-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {c.sellPrice !== null ? `$${c.sellPrice.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Margin shift</span>
            <span className="font-semibold" style={{ color: arrowCol, fontVariantNumeric: 'tabular-nums' }}>
              {c.oldPct.toFixed(1)}% → {c.newPct.toFixed(1)}% ({c.dp > 0 ? '+' : ''}{c.dp.toFixed(1)}pp)
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Cost impact</span>
            <span className="font-semibold" style={{ color: arrowCol, fontVariantNumeric: 'tabular-nums' }}>
              {c.dc < 0 ? '+' : '−'}${Math.abs(c.dc).toFixed(3)} per serve
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Compared to</span>
            <span className="text-gray-500">{c.daysAgo <= 0 ? 'earlier today' : `${c.daysAgo}d ago`}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-supplier emoji. Matched case-insensitively by substring so name variants
// (e.g. "Redi Milk" / "RediMilk") resolve. Falls back to a box.
const SUPPLIER_ICONS: { match: string; icon: string }[] = [
  { match: '5ways', icon: '🍖' },
  { match: 'candied', icon: '🍪' },
  { match: 'dench', icon: '🍞' },
  { match: "g'day tiger", icon: '🐯' },
  { match: 'gday tiger', icon: '🐯' },
  { match: 'matsu', icon: '🍵' },
  { match: 'mörk', icon: '🍫' },
  { match: 'mork', icon: '🍫' },
  { match: 'noisette', icon: '🥐' },
  { match: 'pfd', icon: '🍗' },
  { match: 'planetware', icon: '🥤' },
  { match: 'product distribution', icon: '🥒' },
  { match: 'redi milk', icon: '🥛' },
  { match: 'redimilk', icon: '🥛' },
  { match: 'sciclunas', icon: '🥬' },
  { match: 'seven seeds', icon: '☕' },
  { match: 'trio', icon: '📦' },
  { match: 'uncle', icon: '🥩' },
  { match: 'woolworths', icon: '🛍️' },
];
function supplierIcon(name: string): string {
  const n = (name || '').toLowerCase();
  const hit = SUPPLIER_ICONS.find(s => n.includes(s.match));
  return hit ? hit.icon : '📦';
}

function ProductItem({ p, review, weeklyQty, feePct }: { p: CostingProduct; review?: MarginReviewItem; weeklyQty?: number; feePct?: number }) {
  const mc = p.margin! >= 70 ? '#16a34a' : p.margin! >= 60 ? '#d97706' : '#dc2626';
  const bar = Math.min(100, Math.max(0, p.margin!));
  const netMargin = feePct !== undefined ? p.margin! - feePct : null;
  const netColor  = netMargin !== null ? (netMargin >= 70 ? '#16a34a' : netMargin >= 60 ? '#d97706' : '#dc2626') : mc;
  return (
    <div className="rounded-2xl px-3 py-2.5 mb-2 shrink-0" style={{
      background: 'rgba(255,255,255,0.45)',
      backdropFilter: 'blur(16px) saturate(180%)',
      WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.7)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
    }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-normal text-gray-800 leading-snug flex-1 min-w-0 truncate"
          style={{ fontFamily: '"stolzl", sans-serif', textTransform: 'uppercase' }}>
          {p.name.toUpperCase()}
        </p>
        {netMargin !== null ? (
          <div className="flex flex-col items-end shrink-0 gap-px">
            <span className="text-xs text-gray-400 leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}
              title="Gross margin (before card fees)">
              {p.margin!.toFixed(1)}%
            </span>
            <span className="text-base font-black leading-tight" style={{ color: netColor, fontVariantNumeric: 'tabular-nums' }}
              title="Net margin after Square card processing fees">
              {netMargin.toFixed(1)}%
            </span>
            <span style={{ fontSize: '8px', color: '#9ca3af', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1 }}>net</span>
          </div>
        ) : (
          <span className="text-base font-black shrink-0 leading-none" style={{ color: mc, fontVariantNumeric: 'tabular-nums' }}>
            {p.margin!.toFixed(1)}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {p.sellPrice !== null && (
          <span className="text-xs text-gray-400" style={{ fontVariantNumeric: 'tabular-nums' }}>${p.sellPrice.toFixed(2)}</span>
        )}
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
          <div className="h-full rounded-full" style={{ width: `${bar}%`, background: mc, transition: 'width 0.6s ease' }} />
        </div>
        {weeklyQty !== undefined && (
          <span className="text-xs text-gray-400 shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}
            title={`Sold ${weeklyQty} in the last 7 days (Square)`}>
            {weeklyQty}/wk
          </span>
        )}
        {review && (
          <span className="text-xs font-black shrink-0" style={{ color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}
            title={`Earning ~$${Math.round(review.shortfall)}/wk less than at the 70% target margin`}>
            −${Math.round(review.shortfall)}/wk
          </span>
        )}
      </div>
    </div>
  );
}

// Compact product search for the Coffee / Food costings widgets. Filters the
// visible list; a clear (✕) appears once there's a query.
function ProductSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative pt-2 pb-1">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Search…'}
        className="w-full text-sm pl-3 pr-8 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-200"
        style={{ background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(0,0,0,0.08)', color: '#374151' }}
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          style={{ fontSize: '13px', lineHeight: 1 }}>✕</button>
      )}
    </div>
  );
}

function ProductColumn({ items, height = 272, fill, reviews, sales, feePct }: { items: CostingProduct[]; height?: number; fill?: boolean; reviews?: Map<string, MarginReviewItem>; sales?: Map<string, number>; feePct?: number }) {
  const list = items.map(p => {
    const key = p.name.toUpperCase().trim();
    return <ProductItem key={p.id} p={p} review={reviews?.get(key)} weeklyQty={sales?.get(key)} feePct={feePct} />;
  });
  return (
    <div className="flex-1 min-w-0">
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No matches</p>
      ) : fill ? (
        // In the bottom sheet the sheet itself scrolls, so render the list inline.
        <div className="pr-1" style={{ paddingTop: '6px' }}>{list}</div>
      ) : (
        <div className="relative" style={{ height: `${height}px` }}>
          <div className="absolute inset-0 pointer-events-none z-10" style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK, background: 'transparent' }} />
          <div className="no-scrollbar h-full overflow-y-scroll pr-1" style={{ paddingTop: '10px', paddingBottom: '10px' }}>{list}</div>
        </div>
      )}
    </div>
  );
}

function MarginBadges({ items, atRisk, atRiskPct, uncosted, week, paymentFees, onAdd }: { items: CostingProduct[]; atRisk?: number; atRiskPct?: number; uncosted?: number; week?: string; paymentFees?: PaymentFeesData | null; onAdd?: () => void }) {
  const avg    = items.length > 0 ? items.reduce((s, p) => s + p.margin!, 0) / items.length : null;
  // Prefer the live rolling rate once enough days have backfilled; otherwise
  // fall back to the static constant (see MERCHANT_FEE_PCT comment for source).
  const liveFee = paymentFees && paymentFees.feePct !== null && paymentFees.daysCovered >= PAYMENT_FEES_MIN_DAYS
    ? paymentFees.feePct : null;
  const feePct  = liveFee ?? MERCHANT_FEE_PCT;
  const net     = avg !== null ? avg - feePct : null;
  const red    = items.filter(p => p.margin! < 60).length;
  const yellow = items.filter(p => p.margin! >= 60 && p.margin! < 70).length;
  const green  = items.filter(p => p.margin! >= 70).length;
  const netColor = net !== null ? (net >= 70 ? '#16a34a' : net >= 60 ? '#d97706' : '#dc2626') : '#6b7280';
  return (
    <div className="flex items-center gap-2 flex-wrap pb-3 mb-1 shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      {avg !== null && (
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-500">Avg <span className="font-bold text-gray-700">{avg.toFixed(1)}%</span></span>
          {net !== null && (
            <>
              <span className="text-gray-300" aria-hidden>→</span>
              <span className="font-bold" style={{ color: netColor, fontVariantNumeric: 'tabular-nums' }}
                title={liveFee !== null
                  ? `Net of ${feePct.toFixed(2)}% blended Square processing fee (rolling ${paymentFees!.daysCovered}-day Square fees ÷ revenue, updated ${paymentFees!.updated ? new Date(paymentFees!.updated).toLocaleDateString('en-AU') : '—'})`
                  : `Net of ~${feePct}% blended Square processing fee (static estimate — live tracker still backfilling)`}>
                {net.toFixed(1)}%
              </span>
              <span className="px-1.5 py-0.5 rounded-md"
                style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  background: liveFee !== null ? 'rgba(22,163,74,0.10)' : 'rgba(0,0,0,0.06)',
                  color: liveFee !== null ? '#15803d' : '#9ca3af',
                }}>
                after {feePct.toFixed(2)}% card
              </span>
            </>
          )}
        </span>
      )}
      {[
        { count: red,    label: 'under 60%', bg: 'rgba(220,38,38,0.10)',   border: 'rgba(220,38,38,0.25)',   color: '#991b1b' },
        { count: yellow, label: '60–70%',    bg: 'rgba(217,119,6,0.10)',   border: 'rgba(217,119,6,0.25)',   color: '#78350f' },
        { count: green,  label: 'over 70%',  bg: 'rgba(22,163,74,0.10)',   border: 'rgba(22,163,74,0.25)',   color: '#14532d' },
      ].map(({ count, label, bg, border, color }) => (
        <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold"
          style={{ background: bg, border: `1px solid ${border}`, color }}>
          <span className="font-black">{count}</span>
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8 }}>{label}</span>
        </span>
      ))}
      {atRisk !== undefined && atRisk > 0 && (
        <span className="text-xs font-bold px-2 py-0.5 rounded-lg uppercase"
          style={{ background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.25)', color: '#991b1b', fontVariantNumeric: 'tabular-nums' }}
          title={`Weekly profit below the 70% target margin, summed across every under-target product in this category${week ? ` — sales week ${week}` : ''}`}>
          ~${Math.round(atRisk)}/wk at risk{atRiskPct !== undefined && atRiskPct > 0 ? ` · ${atRiskPct.toFixed(1)}% of sales` : ''}
        </span>
      )}
      {uncosted !== undefined && uncosted > 0 && (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-lg uppercase"
          style={{ background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.25)', color: '#78350f' }}
          title="Drinks selling on Square with no costing match yet — their margin isn't counted in the at-risk figure above. Add a costing to bring them in.">
          +{uncosted} not costed
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-gray-400 uppercase">{items.length} products</span>
        {onAdd && (
          <button
            onClick={onAdd}
            className="text-xs font-semibold px-2 py-1 rounded-lg transition-colors"
            style={{ background: 'rgba(0,0,0,0.06)', color: '#374151', fontFamily: '"stolzl", sans-serif', letterSpacing: '0.04em' }}
            title="Add a new product"
          >+ ADD</button>
        )}
      </span>
    </div>
  );
}

function CostingsCard({ costings, ingredientPrices, priceDrift, marginReview, paymentFees, recipeMap, onIngredientsChanged, open, onCollapse }: { costings: CostingProduct[]; ingredientPrices: IngredientPricesData | null; priceDrift: PriceDriftData | null; marginReview: MarginReviewData | null; paymentFees: PaymentFeesData | null; recipeMap: RecipeMapData | null; onIngredientsChanged?: () => void; open: { coffee: boolean; food: boolean; supplier: boolean }; onCollapse: (key: 'coffee' | 'food' | 'supplier') => void }) {
  // Made-in-house components (sub-recipes like Fennel Slaw, Pickled Onions) are
  // tracked in the Supplier Prices widget, NOT as sellable products. Exclude any
  // costing row whose Notes flag it as a component so it never renders as a tile.
  const isComponent = (p: CostingProduct) => /made in house|component of/i.test(p.notes || '');
  const withMargin  = costings.filter(p => p.margin !== null && !isComponent(p));
  const coffeeItems = [...withMargin].filter(p => p.category === 'Coffee').sort((a, b) => a.margin! - b.margin!);
  const foodItems   = [...withMargin].filter(p => p.category !== 'Coffee').sort((a, b) => a.margin! - b.margin!);

  // Margin review lookup (Notion names match costing names — both come from
  // the same DB). Rendered inline on each product tile as qty/wk + −$/wk.
  const reviewItems  = marginReview?.items ?? [];
  const reviewMap    = new Map<string, MarginReviewItem>(reviewItems.map(i => [i.name.toUpperCase().trim(), i]));
  const salesMap     = new Map<string, number>((marginReview?.sales ?? []).map(s => [s.name.toUpperCase().trim(), s.weeklyQty]));
  // At-risk $ = category-complete total from the payload (summed over ALL
  // underperformers before the display cap). Fall back to summing the visible
  // items only for older payloads that predate coffee/foodShortfall — those
  // under-report because the list is capped (see MarginReview.js).
  const coffeeAtRisk = marginReview?.coffeeShortfall
    ?? reviewItems.filter(i => i.category === 'Coffee').reduce((s, i) => s + i.shortfall, 0);
  const foodAtRisk   = marginReview?.foodShortfall
    ?? reviewItems.filter(i => i.category !== 'Coffee').reduce((s, i) => s + i.shortfall, 0);
  const coffeeAtRiskPct  = marginReview?.coffeeShortfallPct;
  const foodAtRiskPct    = marginReview?.foodShortfallPct;
  const coffeeUncosted   = marginReview?.unmatchedCoffeeCount ?? 0;
  const reviewWeek   = marginReview?.weekStart && marginReview?.weekEnd
    ? `${marginReview.weekStart.slice(5)} – ${marginReview.weekEnd.slice(5)}` : undefined;

  const [firstLoad, setFirstLoad] = useState(false);
  const [ingredientChanges, setIngredientChanges] = useState<IngredientChange[]>([]);

  useEffect(() => {
    if (withMargin.length === 0) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);

    // ── Product margin history (for ingredient impact mapping) ────────────────
    let hist: SnapEntry[] = [];
    try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { /* ignore */ }
    const prev = hist.filter(e => e.date !== todayStr && new Date(e.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    // This derivation reads localStorage (client-only), so it must run in an
    // effect rather than during SSR render — storing the result in state here
    // is intentional and not a cascading-render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFirstLoad(!prev && hist.length === 0);
    const detectedChanges: MarginChange[] = [];
    if (prev) {
      const daysAgo = Math.round((new Date(todayStr).getTime() - new Date(prev.date).getTime()) / 86400000);
      withMargin.forEach(item => {
        const old = prev.d[item.name];
        if (!old) return;
        const dp = item.margin! - old.p;
        if (Math.abs(dp) < 0.15) return;
        const dc = item.sellPrice ? item.sellPrice * (1 - item.margin! / 100) - item.sellPrice * (1 - old.p / 100) : 0;
        detectedChanges.push({ name: item.name, category: item.category, oldPct: old.p, newPct: item.margin!, dp, dc, sellPrice: item.sellPrice, daysAgo });
      });
    }
    const snap: SnapEntry = { date: todayStr, d: {} };
    withMargin.forEach(item => { snap.d[item.name] = { p: item.margin!, s: item.sellPrice ?? 0 }; });
    const updated = [...hist.filter(e => e.date !== todayStr), snap].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(updated)); } catch { /* ignore */ }

    // ── Ingredient price history ──────────────────────────────────────────────
    const ings = ingredientPrices?.ingredients ?? [];
    if (ings.length > 0) {
      let ingHist: IngSnap[] = [];
      try { ingHist = JSON.parse(localStorage.getItem(ING_HIST_KEY) || '[]'); } catch { /* ignore */ }
      const ingPrev = ingHist.filter(e => e.date !== todayStr && new Date(e.date) >= cutoff).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

      // Build a fast lookup of which product names contain which ingredient,
      // using recipe_map if it's loaded (correct attribution via made-in-house
      // mixes), falling back to the legacy hardcoded productMatchesIngredient
      // rules for any ingredient key recipe_map doesn't cover.
      const recipeIngToProducts: Record<string, Set<string>> = {};
      const recipeProductDirect: Record<string, Set<string>> = {};
      if (recipeMap) {
        for (const [ingKey, names] of Object.entries(recipeMap.ingredient_to_products || {})) {
          recipeIngToProducts[ingKey] = new Set((names || []).map(n => n.toUpperCase()));
        }
        for (const [pName, prod] of Object.entries(recipeMap.products || {})) {
          recipeProductDirect[pName.toUpperCase()] = new Set((prod.direct || []));
        }
      }
      const subRecipes = recipeMap?.sub_recipes || {};
      const resolveVia = (ingKey: string, productNameUpper: string): string | undefined => {
        const direct = recipeProductDirect[productNameUpper];
        if (!direct) return undefined;
        if (direct.has(ingKey)) return undefined; // direct ingredient — no via
        for (const k of direct) {
          if ((subRecipes[k] || []).indexOf(ingKey) !== -1) return k.replace(/_/g, ' ');
        }
        return undefined;
      };
      const productHasIngredient = (productName: string, ingKey: string): { match: boolean; via?: string } => {
        const upper = productName.toUpperCase();
        // Prefer recipe_map if we have an entry for this ingredient
        if (recipeMap && recipeIngToProducts[ingKey]) {
          if (recipeIngToProducts[ingKey].has(upper)) {
            return { match: true, via: resolveVia(ingKey, upper) };
          }
          return { match: false };
        }
        // Fallback: legacy hardcoded rule map (for any ingredient recipe_map
        // doesn't yet know about, e.g. drift-only keys without recipes)
        return { match: productMatchesIngredient(productName, ingKey) };
      };

      const ingResults: IngredientChange[] = ings.map(ing => {
        const affected = withMargin
          .map(c => {
            const r = productHasIngredient(c.name, ing.key);
            if (!r.match) return null;
            const detected = detectedChanges.find(d => d.name === c.name);
            const base: MarginChange = detected
              ? { ...detected }
              : { name: c.name, category: c.category, oldPct: c.margin!, newPct: c.margin!, dp: 0, dc: 0, sellPrice: c.sellPrice, daysAgo: 0 };
            if (r.via) base.via = r.via;
            return base;
          })
          .filter((x): x is MarginChange => x !== null);
        const result: IngredientChange = { key: ing.key, name: ing.name, unit: ing.unit, supplier: ing.supplier, currentPrice: ing.price, affectedProducts: affected };
        if (ingPrev?.d[ing.key] !== undefined) {
          const oldPrice = ingPrev.d[ing.key];
          if (Math.abs(ing.price - oldPrice) > 0.005) {
            result.oldPrice = oldPrice;
            result.delta = ing.price - oldPrice;
            result.pct = ((ing.price - oldPrice) / oldPrice) * 100;
            result.daysAgo = Math.round((new Date(todayStr).getTime() - new Date(ingPrev.date).getTime()) / 86400000);
          }
        }
        return result;
      })
      // Show ALL ingredients (previously filtered to delta || affected > 0,
      // which hid newly-added ingredient keys whose recipes haven't been wired
      // yet — F.Bomb, Matcha, Sipper Lids, Pinenuts etc. get 0 affected by
      // default until referenced). They still need to render so drift chips
      // can attach and Jonathan can see them.
      .sort((a, b) => {
        if ((a.delta !== undefined) !== (b.delta !== undefined)) return a.delta !== undefined ? -1 : 1;
        return b.affectedProducts.length - a.affectedProducts.length;
      });

      // ── Attach drift warnings ───────────────────────────────────────────────
      // Multiple sheet cells can map to the same ingredient key (e.g. B5 + B8
      // → coffee_beans). Pick the worst severity, or the largest daysStale if
      // severities tie. Cells whose ingredientKey is null get no badge.
      const driftWarnings = priceDrift?.warnings ?? [];
      if (driftWarnings.length > 0) {
        const severityRank: Record<DriftSeverity, number> = { red: 3, amber: 2, yellow: 1 };
        const byKey = new Map<string, DriftWarning>();
        for (const w of driftWarnings) {
          if (!w.ingredientKey) continue;
          const existing = byKey.get(w.ingredientKey);
          if (
            !existing ||
            severityRank[w.severity] > severityRank[existing.severity] ||
            (severityRank[w.severity] === severityRank[existing.severity] &&
              (w.daysStale ?? Infinity) > (existing.daysStale ?? -Infinity))
          ) {
            byKey.set(w.ingredientKey, w);
          }
        }
        ingResults.forEach(r => {
          const d = byKey.get(r.key);
          if (d) r.drift = d;
        });
      }

      setIngredientChanges(ingResults);

      const ingSnap: IngSnap = { date: todayStr, d: {} };
      ings.forEach(ing => { ingSnap.d[ing.key] = ing.price; });
      const updatedIng = [...ingHist.filter(e => e.date !== todayStr), ingSnap].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
      try { localStorage.setItem(ING_HIST_KEY, JSON.stringify(updatedIng)); } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withMargin.length, ingredientPrices, priceDrift, recipeMap]);

  const changedCount = ingredientChanges.filter(i => i.delta !== undefined).length;
  const [addProductOpen, setAddProductOpen] = useState<null | 'food' | 'coffee'>(null);

  // Per-widget product search (Coffee / Food). Filters the visible list only;
  // the summary badges keep showing the full-category figures.
  const [coffeeQuery, setCoffeeQuery] = useState('');
  const [foodQuery, setFoodQuery] = useState('');
  const matchName = (p: CostingProduct, q: string) => p.name.toLowerCase().includes(q.trim().toLowerCase());
  const coffeeShown = coffeeQuery.trim() ? coffeeItems.filter(p => matchName(p, coffeeQuery)) : coffeeItems;
  const foodShown   = foodQuery.trim()   ? foodItems.filter(p => matchName(p, foodQuery))     : foodItems;

  // Supplier Prices: search + group-by-supplier
  const [priceQuery, setPriceQuery] = useState('');
  const supplierGroups = useMemo(() => {
    const q = priceQuery.trim().toLowerCase();
    const filtered = q
      ? ingredientChanges.filter(i =>
          i.name.toLowerCase().includes(q) || (i.supplier || '').toLowerCase().includes(q))
      : ingredientChanges;
    const map = new Map<string, IngredientChange[]>();
    filtered.forEach(i => {
      const s = (i.supplier || 'Other').trim() || 'Other';
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(i);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([supplier, items]) => ({ supplier, items }));
  }, [ingredientChanges, priceQuery]);
  const filteredCount = supplierGroups.reduce((n, g) => n + g.items.length, 0);

  const [addIngredientOpen, setAddIngredientOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState<{ query?: string; supplier?: string; price?: number } | undefined>(undefined);
  // Open the Add-Ingredient modal pre-filled from a "NEW SKU" invoice line.
  const handleAddSku = (sku: UnmappedSku) => {
    setAddPrefill({ query: sku.description, supplier: sku.supplier, price: sku.price });
    setAddIngredientOpen(true);
  };

  // Collapsible supplier tiles (Shopping List pattern). Searching auto-expands.
  const isSearching = priceQuery.trim().length > 0;
  const [openSuppliers, setOpenSuppliers] = useState<Set<string>>(new Set());
  const toggleSupplier = (s: string) => setOpenSuppliers(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  // Same fee logic as MarginBadges — prefer live rolling rate, fall back to static.
  const liveFeeCard = paymentFees && paymentFees.feePct !== null && paymentFees.daysCovered >= PAYMENT_FEES_MIN_DAYS
    ? paymentFees.feePct : null;
  const feePct = liveFeeCard ?? MERCHANT_FEE_PCT;

  return (
    <>
      {/* ── Coffee Costings — always in DOM ── */}
      <div style={{ display: open.coffee ? 'block' : 'none' }}>
        <Card bare icon={<WidgetIcon name="coffee" chip={28} glyph={17} />} title="Coffee Costings" onCollapse={() => onCollapse('coffee')}>
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,243,239,0.97)' }}>
            <MarginBadges items={coffeeItems} atRisk={coffeeAtRisk} atRiskPct={coffeeAtRiskPct} uncosted={coffeeUncosted} week={reviewWeek} paymentFees={paymentFees} onAdd={() => setAddProductOpen('coffee')} />
            <ProductSearch value={coffeeQuery} onChange={setCoffeeQuery} placeholder="Search coffee products…" />
          </div>
          <ProductColumn items={coffeeShown} fill reviews={reviewMap} sales={salesMap} feePct={feePct} />
        </Card>
      </div>

      {/* ── Food Costings — always in DOM ── */}
      <div style={{ display: open.food ? 'block' : 'none' }}>
        <Card bare icon={<WidgetIcon name="food" chip={28} glyph={17} />} title="Food Costings" onCollapse={() => onCollapse('food')}>
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(245,243,239,0.97)' }}>
            <MarginBadges items={foodItems} atRisk={foodAtRisk} atRiskPct={foodAtRiskPct} week={reviewWeek} paymentFees={paymentFees} onAdd={() => setAddProductOpen('food')} />
            <ProductSearch value={foodQuery} onChange={setFoodQuery} placeholder="Search food products…" />
          </div>
          <ProductColumn items={foodShown} fill reviews={reviewMap} sales={salesMap} feePct={feePct} />
        </Card>
      </div>

      <AddProductModal
        open={addProductOpen !== null}
        category={addProductOpen || 'food'}
        onClose={() => setAddProductOpen(null)}
        ingredients={ingredientPrices?.ingredients ?? []}
      />

      {addIngredientOpen && (
        <AddIngredientModal
          open
          prefill={addPrefill}
          onClose={() => { setAddIngredientOpen(false); setAddPrefill(undefined); }}
          onSuccess={() => onIngredientsChanged?.()}
        />
      )}

      {/* ── Ingredient Prices — always in DOM ── */}
      <div style={{ display: open.supplier ? 'block' : 'none' }}>
        <Card bare icon={<WidgetIcon name="supplier" chip={28} glyph={17} />} title="Supplier Prices"
          onCollapse={() => onCollapse('supplier')}>
          <PackChangeBanner packChanges={priceDrift?.packChanges ?? []} unmappedSkus={priceDrift?.unmappedSkus ?? []} onAddSku={handleAddSku} />
          {firstLoad ? (
            <p className="text-xs text-gray-400 italic">Baseline saved — ingredient changes appear from tomorrow.</p>
          ) : ingredientChanges.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No ingredient data yet — sync will populate this shortly.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2 shrink-0">
                {changedCount > 0 && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 uppercase" style={{ background: '#fbcdad', color: '#7c4a2d' }}>
                    {changedCount} price {changedCount === 1 ? 'change' : 'changes'}
                  </span>
                )}
                <input
                  value={priceQuery}
                  onChange={e => setPriceQuery(e.target.value)}
                  placeholder="SEARCH INGREDIENT OR SUPPLIER..."
                  className="flex-1 min-w-0 text-xs px-3 py-1.5 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all"
                  style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }}
                />
                <span className="text-xs text-gray-400 whitespace-nowrap shrink-0 uppercase">
                  {priceQuery.trim() ? `${filteredCount} of ${ingredientChanges.length}` : `${ingredientChanges.length} tracked`}
                </span>
              </div>
              <div className="flex-1 min-h-0 relative">
                <div className="absolute inset-0 pointer-events-none z-10" style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK, background: 'transparent' }} />
                <div className="no-scrollbar h-full overflow-y-scroll pr-1" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
                  {filteredCount === 0 ? (
                    <p className="text-xs text-gray-400 italic">No matches for &ldquo;{priceQuery.trim()}&rdquo;.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 content-start">
                      {supplierGroups.map(group => {
                        const changeCount = group.items.filter(i => i.delta !== undefined).length;
                        const open = isSearching || openSuppliers.has(group.supplier);
                        const tileStyle = { minHeight: '60px', background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' };
                        return (
                          <div key={group.supplier} className={open ? 'md:col-span-2' : ''}>
                            <div onClick={() => toggleSupplier(group.supplier)} role="button" className="rounded-2xl cursor-pointer flex items-center gap-3 px-3 py-2.5" style={tileStyle}>
                              <span className="text-base">{supplierIcon(group.supplier)}</span>
                              <span className="flex-1 min-w-0 text-sm font-normal uppercase truncate text-gray-800" style={{ fontFamily: '"stolzl", sans-serif' }}>{group.supplier}</span>
                              {changeCount > 0 && (
                                <span className="flex items-center justify-center rounded-full font-bold" style={{ minWidth: '22px', height: '22px', padding: '0 6px', background: '#fbcdad', color: '#333', fontSize: '11px', flexShrink: 0 }}>{changeCount}</span>
                              )}
                              <span className="text-xs text-gray-400" style={{ flexShrink: 0 }}>{group.items.length}</span>
                              <span className="text-gray-400" style={{ fontSize: '10px', width: '10px', flexShrink: 0 }}>{open ? '▼' : '▶'}</span>
                            </div>
                            {open && (
                              <div className="mt-2 pl-3" style={{ borderLeft: '2px solid rgba(251,205,173,0.4)' }}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                  {group.items.map(ing => <IngredientChangeCard key={ing.key} ing={ing} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

const getNextDateStr = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
};

// "Today" in Melbourne, computed identically to the server (/api/dashboard):
// UTC + 10h, then YYYY-MM-DD from UTC components. Matching the server exactly
// is what stops the day-rollover check from ever false-triggering a reload.
const melbourneToday = (): string => {
  const d = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// 🚀 TIGER OS Update widget — current version + "What's New" (from git commits)
// on top, then a manual to-do list (tasks + subtasks) that mirrors the Projects
// widget: swipe a task to delete, tap to expand its subtasks, hand any task or
// subtask to Claude with the 🤖 button.
function UpdateWidget({ tasks, onAddTask, onAddSubtask, onToggleSubtask, onToggleDone, onDeleteTask, onDelegate }: {
  tasks: BacklogTask[];
  onAddTask: (name: string) => void;
  onAddSubtask: (taskId: string, text: string) => void;
  onToggleSubtask: (taskId: string, blockId: string, checked: boolean) => void;
  onToggleDone: (taskId: string, done: boolean) => void;
  onDeleteTask: (taskId: string) => void;
  onDelegate: (taskName: string, subtaskText?: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSubText, setNewSubText] = useState('');
  const [showAllLog, setShowAllLog] = useState(false);
  const [showVer, setShowVer] = useState(false); // version details hidden until the version badge is tapped

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submitTask = () => { if (newTaskText.trim()) { onAddTask(newTaskText.trim().toUpperCase()); setNewTaskText(''); setAddingTask(false); } };
  const submitSub = (taskId: string) => { if (newSubText.trim()) { onAddSubtask(taskId, newSubText.trim().toUpperCase()); setNewSubText(''); setAddingSubFor(null); } };

  const openCount = tasks.filter(t => !t.done).length;
  const builtDate = UPDATED ? new Date(UPDATED + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const visibleLog = showAllLog ? COMMITS : COMMITS.slice(0, 5);

  return (
    <div>
      {/* ── Version + What's New (details revealed by tapping the version) ── */}
      <div className="rounded-2xl p-3 mb-4" style={{ ...TILE_STYLE }}>
        <div className="flex items-center gap-2">
          <span className="text-base" style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))' }}>🐯</span>
          <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', color: '#6b7280' }}>TIGER OS</span>
          <button onClick={() => setShowVer(v => !v)} className="ml-auto flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full tabular-nums transition-colors cursor-pointer" style={{ background: '#fbcdad', color: '#333' }} title="Tap for what's new">
            {VERSION}
            <span style={{ fontSize: '8px', opacity: 0.7 }}>{showVer ? '▲' : '▼'}</span>
          </button>
        </div>
        {showVer && (
          <>
            {builtDate && <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-1.5">Updated {builtDate}</p>}
            <div className="mt-2.5 pt-2.5 space-y-1.5" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">What&rsquo;s New</p>
              {visibleLog.map(c => (
                <div key={c.hash} className="flex gap-2 text-xs leading-snug">
                  <span className="tabular-nums text-gray-300 shrink-0" style={{ width: '38px' }}>{c.date.slice(5)}</span>
                  <span className="text-gray-600 flex-1 min-w-0">{c.subject}</span>
                </div>
              ))}
              {COMMITS.length > 5 && (
                <button onClick={() => setShowAllLog(v => !v)} className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-colors pt-0.5">
                  {showAllLog ? '▲ Less' : `▼ ${COMMITS.length - 5} more`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Manual to-do list ── */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">To Do</span>
        <span className="text-xs text-gray-400">{openCount} open</span>
        <button onClick={() => { setAddingTask(true); setNewTaskText(''); }} className="ml-auto text-xs font-semibold px-2 py-1 rounded-lg transition-colors" style={{ background: 'rgba(0,0,0,0.06)', color: '#374151', fontFamily: '"stolzl", sans-serif', letterSpacing: '0.04em' }}>+ TASK</button>
      </div>

      {addingTask && (
        <div className="flex gap-2 mb-2">
          <input value={newTaskText} onChange={e => setNewTaskText(e.target.value.toUpperCase())} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') submitTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTaskText(''); } }}
            placeholder="NEW TASK..." className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
          <button onClick={submitTask} disabled={!newTaskText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold uppercase transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Add</button>
          <button onClick={() => { setAddingTask(false); setNewTaskText(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">&times;</button>
        </div>
      )}

      <div className="space-y-2">
        {tasks.length === 0 ? <p className="text-sm text-gray-400 italic">No tasks yet — add one above.</p> : (
          tasks.map(task => {
            const isOpen = expanded.has(task.id);
            const subDone = task.subtasks.filter(s => s.checked).length;
            return (
              <div key={task.id} className="space-y-2">
                <SwipeToDelete onDelete={() => onDeleteTask(task.id)} onClick={() => toggleExpand(task.id)}>
                  <div className="px-4 flex items-center gap-2.5 cursor-pointer" style={{ minHeight: '62px' }}>
                    <div onClick={e => { e.stopPropagation(); onToggleDone(task.id, !task.done); }} className="shrink-0 w-4 h-4 rounded flex items-center justify-center cursor-pointer" style={{ background: task.done ? '#fbcdad' : 'rgba(255,255,255,0.6)', border: task.done ? '1.5px solid #fbcdad' : '1.5px solid rgba(0,0,0,0.15)' }}>
                      {task.done && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <span className={`flex-1 min-w-0 text-sm font-semibold transition-colors uppercase ${task.done ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.name}</span>
                    {task.subtasks.length > 0 && <span className="text-xs text-gray-400 shrink-0">{subDone}/{task.subtasks.length}</span>}
                    <button onClick={e => { e.stopPropagation(); onDelegate(task.name); }} className="shrink-0 transition-opacity leading-none opacity-50 hover:opacity-100" aria-label="Ask Claude" title="Ask Claude"><ClaudeLogo size={15} /></button>
                    <span className="text-gray-400" style={{ fontSize: '10px', width: '10px', flexShrink: 0 }}>{isOpen ? '▼' : '▶'}</span>
                  </div>
                </SwipeToDelete>
                {isOpen && (
                  <div className="space-y-2">
                    {task.subtasks.map(s => (
                      <CheckItem key={s.id} id={s.id} text={s.text} checked={s.checked} onChange={(id, checked) => onToggleSubtask(task.id, id, checked)} onDelegate={() => onDelegate(task.name, s.text)} />
                    ))}
                    {addingSubFor === task.id ? (
                      <div className="flex gap-2 mt-1">
                        <input value={newSubText} onChange={e => setNewSubText(e.target.value.toUpperCase())} autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') submitSub(task.id); if (e.key === 'Escape') { setAddingSubFor(null); setNewSubText(''); } }}
                          placeholder="NEW SUBTASK..." className="flex-1 min-w-0 text-xs px-3 py-1.5 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
                        <button onClick={() => submitSub(task.id)} disabled={!newSubText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold uppercase transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Add</button>
                        <button onClick={() => { setAddingSubFor(null); setNewSubText(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">&times;</button>
                      </div>
                    ) : (
                      <button onClick={() => { setAddingSubFor(task.id); setNewSubText(''); }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors uppercase">+ Add subtask</button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [braindump, setBraindump] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffCost, setStaffCost] = useState<StaffCostData>(null);
  const [weekTasks, setWeekTasks] = useState<Record<string, WeekDay>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [addingActionFor, setAddingActionFor] = useState<string | null>(null);
  const [newActionText, setNewActionText] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  // Which of the four launcher widgets are expanded to full cards. Empty = all
  // collapsed to square tiles (resets every load by design).
  const [openWidgets, setOpenWidgets] = useState<Set<string>>(new Set());
  const shoppingWidgetRef = useRef<HTMLDivElement>(null);
  // Single-open: tapping a tile opens that widget in the bottom sheet and closes
  // any other. Tapping the same tile (or the sheet's close/▲) closes it. The
  // sheet overlays the dashboard, so no scroll juggling is needed.
  const toggleWidget = (key: string) => {
    setOpenWidgets(prev => prev.has(key) ? new Set() : new Set([key]));
  };
  const closeWidgets = () => setOpenWidgets(new Set());
  // Used by the Daily To Do shopping link row — opens the Shopping sheet.
  const openShoppingWidget = () => {
    setOpenWidgets(prev => prev.has('shopping') ? new Set() : new Set(['shopping']));
  };
  const [tigerTasks, setTigerTasks] = useState<BacklogTask[]>([]);
  const [serverState, setServerState] = useState<Record<string, string[]>>({});
  // Recent local check/uncheck toggles, keyed by `${date}|${blockId}`. Notion has
  // read-after-write latency on the checked-state code block, so the 30s poll can
  // read a stale value and regress a just-ticked task. We hold local intent for a
  // short window and override the fetched state with it so the poll can't clobber.
  const pendingWrites = useRef<Map<string, { checked: boolean; ts: number }>>(new Map());
  const PENDING_TTL = 15000;

  // Apply still-fresh local toggles on top of a freshly-fetched server state so a
  // stale poll read can't undo a recent check (or re-add a recent uncheck).
  const reconcilePending = (state: Record<string, string[]>): Record<string, string[]> => {
    const now = Date.now();
    const next: Record<string, string[]> = { ...state };
    for (const [key, { checked, ts }] of pendingWrites.current.entries()) {
      if (now - ts > PENDING_TTL) { pendingWrites.current.delete(key); continue; }
      const [date, blockId] = key.split('|');
      const ids = new Set(next[date] || []);
      if (checked) ids.add(blockId); else ids.delete(blockId);
      if (ids.size) next[date] = [...ids]; else delete next[date];
    }
    return next;
  };
  const [delegateToast, setDelegateToast] = useState<string | null>(null);
  const [costings, setCostings] = useState<CostingProduct[]>([]);
  const [ingredientPrices, setIngredientPrices] = useState<IngredientPricesData | null>(null);
  const [recipeMap, setRecipeMap] = useState<RecipeMapData | null>(null);
  const [priceDrift, setPriceDrift] = useState<PriceDriftData | null>(null);
  const [marginReview, setMarginReview] = useState<MarginReviewData | null>(null);
  const [paymentFees, setPaymentFees] = useState<PaymentFeesData | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  // Recurring task IDs moved away from today — suppressed in UI until next refresh/session.
  const [movedRecurringIds, setMovedRecurringIds] = useState<Set<string>>(new Set());
  const [taskContext, setTaskContext] = useState<Record<string, string>>({});

  const [addingShopping, setAddingShopping] = useState(false);
  const [newShoppingText, setNewShoppingText] = useState('');
  const [newShoppingQty, setNewShoppingQty] = useState(1);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState('1');

  const todayStr = data?.todayStr ?? '';

  const fetchTaskContext = async () => {
    try {
      const d = await fetch('/api/task-context').then(r => r.json());
      setTaskContext(d.context || {});
    } catch {}
  };

  const handleContextSave = async (blockId: string, text: string) => {
    setTaskContext(prev => text.trim() ? { ...prev, [blockId]: text.trim() } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== blockId)));
    await fetch('/api/task-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, text }) });
  };

  const fetchServerState = async (): Promise<Record<string, string[]>> => {
    try {
      const d = await fetch('/api/checked-state').then(r => r.json());
      // Override stale Notion reads with still-fresh local toggles (read-after-write gap).
      const state = reconcilePending(d.state || {});
      setServerState(state);
      return state;
    } catch { return {}; }
  };

  // Update Notion's to_do.checked directly so items stay checked between dashboard
  // loads. getShoppingTasks() in /api/dashboard filters !block.to_do?.checked, so
  // a Notion-level check is the only way to prevent reappearance the next day.
  // Local state update is optimistic; Notion call is fire-and-forget.
  const toggleShopping = (blockId: string, checked: boolean) => {
    setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
    fetch('/api/check-shopping', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, checked }) }).catch(() => {});
  };

  const deleteShopping = (blockId: string) => {
    setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(t => t.id !== blockId) } : prev);
    fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) }).catch(() => {});
  };

  const addShopping = async (name: string, qty: number = 1) => {
    const n = name.trim();
    if (!n) return;
    const text = buildShoppingText(n, qty);
    setNewShoppingText('');
    setNewShoppingQty(1);
    setAddingShopping(false);
    try {
      const res = await fetch('/api/add-shopping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const d = await res.json();
      if (d.blockId) {
        setData(prev => {
          if (!prev) return prev;
          const hasHeader = prev.dailyTasks.some(t2 => t2.isHeader && t2.text.toUpperCase().includes('SHOPPING'));
          const newItem = { id: d.blockId, text, checked: false, isRecurring: false };
          const additions = hasHeader
            ? [newItem]
            : [{ id: 'header-shopping', text: '🛒 SHOPPING LIST', checked: false, isHeader: true }, newItem];
          return { ...prev, dailyTasks: [...prev.dailyTasks, ...additions] };
        });
      }
    } catch { /* ignore */ }
  };

  // Adjust the quantity of an existing shopping item (writes "name ×N" back to Notion).
  const saveShoppingQty = (blockId: string, name: string) => {
    const qty = Math.max(1, parseInt(editingQtyVal, 10) || 1);
    setEditingQtyId(null);
    const newText = buildShoppingText(name, qty);
    setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, text: newText } : t) } : prev);
    fetch('/api/update-shopping', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, text: newText }) }).catch(() => {});
  };

  const fetchDashboard = async (state: Record<string, string[]>, bustCache = false) => {
    const url = bustCache ? `/api/dashboard?t=${Date.now()}` : '/api/dashboard';
    const res = await fetch(url);
    if (res.status === 401) { window.location.assign('/login'); return; }
    const d = await res.json();
    const freshTasks = applyServerChecked(d.dailyTasks, d.todayStr, state);
    setData(prev => {
      // getShoppingTasks() only returns unchecked items from Notion — re-inject any
      // shopping items that were checked in this session so they stay visible in the
      // widget with strikethrough across soft refreshes (tab focus, mutation refetches).
      const prevChecked = prev?.dailyTasks.filter(t => t.isShopping && t.checked) ?? [];
      if (prevChecked.length === 0) return { ...d, dailyTasks: freshTasks };
      const freshIds = new Set(freshTasks.map(t => t.id));
      const toInject = prevChecked.filter(t => !freshIds.has(t.id));
      if (toInject.length === 0) return { ...d, dailyTasks: freshTasks };
      const headerIdx = freshTasks.findIndex(t => t.isHeader && t.text.toUpperCase().includes('SHOPPING'));
      if (headerIdx === -1) return { ...d, dailyTasks: freshTasks };
      return { ...d, dailyTasks: [...freshTasks.slice(0, headerIdx + 1), ...toInject, ...freshTasks.slice(headerIdx + 1)] };
    });
  };

  const fetchWeekTasks = async (state: Record<string, string[]>, bustCache = false) => {
    const url = bustCache ? `/api/week-tasks?t=${Date.now()}` : '/api/week-tasks';
    const d = await fetch(url).then(r => r.json());
    const enriched: Record<string, WeekDay> = {};
    for (const [date, day] of Object.entries(d.days as Record<string, WeekDay>)) {
      enriched[date] = { ...day, tasks: applyServerChecked(day.tasks, date, state) };
    }
    setWeekTasks(enriched);
  };

  // After a mutation (add/move/delete), fetch fresh data bypassing the Vercel edge cache
  // and run state + week-tasks concurrently (they're independent).
  const refreshAfterMutation = async (opts: { dashboard?: boolean } = {}) => {
    const [state, weekRaw] = await Promise.all([
      fetchServerState(),
      fetch(`/api/week-tasks?t=${Date.now()}`).then(r => r.json()),
    ]);
    const enriched: Record<string, WeekDay> = {};
    for (const [date, day] of Object.entries(weekRaw.days as Record<string, WeekDay>)) {
      enriched[date] = { ...day, tasks: applyServerChecked(day.tasks, date, state) };
    }
    setWeekTasks(enriched);
    if (opts.dashboard) await fetchDashboard(state, true);
    return state;
  };

  // Pull every data source. Reused on first load and on tab refocus.
  const refreshData = async () => {
    const state = await fetchServerState();
    await fetchDashboard(state).catch(() => {});
    fetch('/api/roster').then(r => r.json()).then(d => setShifts(d.shifts || [])).catch(() => {});
    fetchWeekTasks(state).catch(() => {});
    fetch('/api/costings').then(r => r.json()).then(d => setCostings(d.products || [])).catch(() => {});
    fetch('/api/ingredient-prices').then(r => r.json()).then(d => setIngredientPrices(d)).catch(() => {});
    fetch('/api/price-drift').then(r => r.json()).then(d => setPriceDrift(d)).catch(() => {});
    fetch('/api/margin-review').then(r => r.json()).then(d => setMarginReview(d)).catch(() => {});
    fetch('/api/payment-fees').then(r => r.json()).then(d => setPaymentFees(d)).catch(() => {});
    fetch('/api/recipe-map').then(r => r.json()).then(d => setRecipeMap(d)).catch(() => {});
    fetch('/api/tigeros-tasks').then(r => r.json()).then(d => setTigerTasks(d.tasks || [])).catch(() => {});
    fetch('/api/staff-cost').then(r => r.json()).then(d => setStaffCost(d)).catch(() => {});
    fetchTaskContext().catch(() => {});
  };

  useEffect(() => {
    // Safety net: never let a slow or stalled request freeze the app on the loading screen.
    const safety = setTimeout(() => setLoading(false), 12000);
    const init = async () => {
      try {
        await refreshData();
      } finally {
        clearTimeout(safety);
        setLoading(false);
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh: the app usually lives in one always-open tab, so detect the
  // overnight day rollover and reload (exactly what a manual refresh does) so
  // every morning shows the current day without intervention. A minute timer
  // catches it if the machine stays awake; visibilitychange catches the common
  // case where the device slept and is woken in the morning. Same-day refocus
  // just soft-refreshes the data so returning to the tab shows fresh numbers.
  useEffect(() => {
    if (loading || !data?.todayStr) return;
    const loadedDay = data.todayStr;
    const rolledOver = () => {
      if (melbourneToday() !== loadedDay) { window.location.reload(); return true; }
      return false;
    };
    const interval = setInterval(rolledOver, 60000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!rolledOver()) refreshData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data?.todayStr]);

  useEffect(() => {
    if (loading) return;
    const interval = setInterval(async () => {
      const state = await fetchServerState();
      setData(prev => prev ? { ...prev, dailyTasks: applyServerChecked(prev.dailyTasks, prev.todayStr, state) } : prev);
      setWeekTasks(prev => {
        const updated: Record<string, WeekDay> = {};
        for (const [date, day] of Object.entries(prev)) updated[date] = { ...day, tasks: applyServerChecked(day.tasks, date, state) };
        return updated;
      });
    }, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);


  const syncCheckedState = (blockId: string, date: string, checked: boolean) => {
    pendingWrites.current.set(`${date}|${blockId}`, { checked, ts: Date.now() });
    setServerState(prev => {
      const next = { ...prev };
      if (checked) { next[date] = [...new Set([...(next[date] || []), blockId])]; }
      else { next[date] = (next[date] || []).filter(id => id !== blockId); if (!next[date].length) delete next[date]; }
      return next;
    });
    fetch('/api/checked-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, date, checked }) }).catch(() => {});
  };

  const handleSelectDay = (date: string) => setSelectedDate(prev => prev === date ? null : date);

  const handleDeleteTask = async (blockId: string, section: 'daily' | 'week', date?: string, isRecurring?: boolean) => {
    if (section === 'daily') setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(t => t.id !== blockId) } : prev);
    else if (section === 'week' && date) setWeekTasks(prev => ({ ...prev, [date]: { ...prev[date], count: prev[date].count - 1, tasks: prev[date].tasks.filter(t => t.id !== blockId) } }));
    await fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) });
    // Recurring tasks — especially daily/monthly, which are mirrored across all 7 day
    // pages — need a full refresh so every copy clears from the UI, not just this view.
    if (isRecurring) {
      await refreshAfterMutation({ dashboard: true });
    }
  };

  const handleAddTask = (date: string, text: string, recurrence: string = 'once') => {
    // Optimistic update: increment the roster count immediately so the UI feels instant.
    setWeekTasks(prev => {
      if (!prev[date]) return prev;
      return { ...prev, [date]: { ...prev[date], count: prev[date].count + 1 } };
    });
    // Fire-and-forget: API + refresh run in background so the modal closes instantly.
    const needsDashboard = date === todayStr || recurrence === 'monthly';
    fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, text, recurrence }) })
      .then(() => refreshAfterMutation({ dashboard: needsDashboard }))
      .catch(() => {});
  };

  // Convert an existing task to a persistent [STICKY:today] task by rewriting its
  // Notion block. The dashboard's cross-page scan will surface it every day from
  // today onward until ticked off. Optimistic update shows the 📌 badge immediately.
  const handlePinTask = (blockId: string, text: string) => {
    setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, isSticky: true } : t) } : prev);
    fetch('/api/pin-task', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, text }) })
      .then(() => refreshAfterMutation({ dashboard: true }))
      .catch(() => {});
  };

  const handleMoveToDay = async (blockId: string, text: string, targetDate: string, isRecurring?: boolean, fromDate?: string, category?: string, isSticky?: boolean) => {
    const sourceDate = fromDate ?? todayStr;
    if (sourceDate === todayStr) {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(task => task.id !== blockId) } : prev);
    } else {
      setWeekTasks(prev => ({ ...prev, [sourceDate]: { ...prev[sourceDate], count: prev[sourceDate].count - 1, tasks: prev[sourceDate].tasks.filter(t => t.id !== blockId) } }));
    }

    // Persistent ([STICKY]) tasks already show every day, so "move to <day>" just
    // hides today's instance — no duplicate one-off task, and the [STICKY] block
    // is never touched. It resurfaces on its own tomorrow via the dashboard's
    // sticky scan (still unchecked, not yet in "_sticky_done").
    if (isSticky) {
      setMovedRecurringIds(prev => new Set(prev).add(blockId));
      fetch('/api/checked-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, date: `${sourceDate}:moved`, checked: true }) }).catch(() => {});
      return;
    }

    const ops: Promise<Response>[] = [
      fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: targetDate, text, category }) }),
    ];
    if (!isRecurring) {
      ops.push(fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) }));
    } else if (sourceDate === todayStr) {
      // Recurring task moved away from today — suppress it in the UI after server re-fetch
      // so it doesn't reappear (the block stays in Notion so it recurs next week).
      setMovedRecurringIds(prev => new Set(prev).add(blockId));
      // Persist suppression so it survives a hard refresh (stored under `date:moved` key,
      // auto-cleaned after 8 days by the checked-state cleanup routine).
      fetch('/api/checked-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, date: `${sourceDate}:moved`, checked: true }) }).catch(() => {});
    }
    await Promise.all(ops);
    await refreshAfterMutation({ dashboard: sourceDate === todayStr || targetDate === todayStr });
  };

  const handleDeferToTomorrow = async (blockId: string, text: string, isRecurring?: boolean) => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const t = new Date(y, m - 1, d + 1);
    const tomorrowStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(task => task.id !== blockId) } : prev);
    if (isRecurring) {
      // Suppress recurring task for the rest of this session and persist so it survives a reload.
      setMovedRecurringIds(prev => new Set(prev).add(blockId));
      fetch('/api/checked-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, date: `${todayStr}:moved`, checked: true }) }).catch(() => {});
    }
    const ops: Promise<Response>[] = [
      fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: tomorrowStr, text }) }),
    ];
    // Only delete the Notion block for one-time (date-prefixed) tasks.
    // Recurring tasks (no prefix, [F], [M]) must stay in Notion so they reappear next cycle.
    if (!isRecurring) {
      ops.push(fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) }));
    }
    await Promise.all(ops);
    await refreshAfterMutation();
  };

  // Hand the action item off to full Claude. Desktop opens a Cowork session
  // (claude:// scheme) with the TIGER OS repo attached and the task prefilled —
  // full tools + memory + native persistence, unlike the old in-app box.
  // Mobile has no chat/Cowork deep link (claude:// is Code-only on phones), so
  // we copy the task to the clipboard and open Claude to paste.
  const REPO_FOLDER = '/Users/gdaytiger/gdaytiger-app';
  const delegateToClaude = (project: Project, todo: Todo) => {
    const prompt = `I'm working on my café's project "${project.name}" in TIGER OS. Help me with this action item:\n\n"${todo.text}"`;
    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      navigator.clipboard?.writeText(prompt).catch(() => {});
      setDelegateToast('Task copied — paste it into Claude');
      setTimeout(() => setDelegateToast(null), 4000);
      window.location.assign('https://claude.ai/new');
      return;
    }
    const url = `claude://cowork/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(REPO_FOLDER)}`;
    window.location.assign(url);
  };

  // ── TIGER OS Backlog (Update widget) handlers ──
  const fetchTigerTasks = async () => {
    const d = await fetch('/api/tigeros-tasks').then(r => r.json()).catch(() => null);
    if (d) setTigerTasks(d.tasks || []);
  };
  const addTigerTask = async (name: string) => {
    await fetch('/api/tigeros-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, order: Date.now() }) });
    await fetchTigerTasks();
  };
  const addTigerSubtask = async (taskId: string, text: string) => {
    // Subtasks are child to_do blocks — reuse the project-action endpoint.
    await fetch('/api/add-project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: taskId, text }) });
    await fetchTigerTasks();
  };
  const toggleTigerSubtask = async (taskId: string, blockId: string, checked: boolean) => {
    setTigerTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks: t.subtasks.map(s => s.id === blockId ? { ...s, checked } : s) } : t));
    await fetch('/api/todos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, checked }) });
  };
  const toggleTigerDone = async (taskId: string, done: boolean) => {
    setTigerTasks(prev => prev.map(t => t.id === taskId ? { ...t, done } : t));
    await fetch('/api/tigeros-tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, done }) });
  };
  const deleteTigerTask = async (taskId: string) => {
    setTigerTasks(prev => prev.filter(t => t.id !== taskId));
    await fetch('/api/archive-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: taskId }) });
  };
  const delegateTigerTask = (taskName: string, subtaskText?: string) => {
    const focus = subtaskText ? `this subtask:\n\n"${subtaskText}"\n\n(part of the task "${taskName}")` : `this task:\n\n"${taskName}"`;
    const prompt = `I'm working on TIGER OS (my café dashboard, repo at ~/gdaytiger-app). Help me with ${focus}`;
    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      navigator.clipboard?.writeText(prompt).catch(() => {});
      setDelegateToast('Task copied — paste it into Claude');
      setTimeout(() => setDelegateToast(null), 4000);
      window.location.assign('https://claude.ai/new');
      return;
    }
    window.location.assign(`claude://cowork/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(REPO_FOLDER)}`);
  };

  const STATUS_CYCLE = ['In Progress', 'Blocked', 'On Hold', 'Done'];
  const handleStatusChange = async (projectId: string, currentStatus: string) => {
    const idx = STATUS_CYCLE.indexOf(currentStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setData(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === projectId ? { ...p, status: next } : p) } : prev);
    if (next === 'Done') setTimeout(() => setData(prev => prev ? { ...prev, projects: prev.projects.filter(p => p.id !== projectId) } : prev), 600);
    await fetch('/api/project-status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, status: next }) });
  };

  // Archive (move to Notion trash). Triggered by swiping the project tile left —
  // the swipe past threshold is the confirm, same as deleting a task.
  const handleArchiveProject = async (projectId: string) => {
    setData(prev => prev ? { ...prev, projects: prev.projects.filter(p => p.id !== projectId) } : prev);
    await fetch('/api/archive-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
  };

  const handleAddProjectAction = async (projectId: string, text: string) => {
    if (!text.trim()) return;
    await fetch('/api/add-project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, text: text.trim() }) });
    await refreshAfterMutation({ dashboard: true });
    setAddingActionFor(null);
    setNewActionText('');
  };

  const toggleTodo = async (blockId: string, checked: boolean, section: 'daily' | 'project' | 'personal' | 'week', projectId?: string, date?: string, isSticky?: boolean) => {
    if (blockId.startsWith('header-')) return;
    if (section === 'daily') {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
      // Persistent tasks: record completion permanently under "_sticky_done" instead
      // of today's date, so it never resurfaces (no 8-day expiry, unlike a normal tick).
      syncCheckedState(blockId, isSticky ? '_sticky_done' : todayStr, checked);
    } else if (section === 'week' && date) {
      setWeekTasks(prev => ({ ...prev, [date]: { ...prev[date], tasks: prev[date].tasks.map(t => t.id === blockId ? { ...t, checked } : t) } }));
      syncCheckedState(blockId, date, checked);
    } else if (section === 'project' && projectId) {
      setData(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === projectId ? { ...p, todos: p.todos.map(t => t.id === blockId ? { ...t, checked } : t) } : p) } : prev);
      await fetch('/api/todos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, checked }) });
    } else if (section === 'personal') {
      setData(prev => prev ? { ...prev, personalTodos: prev.personalTodos.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
      await fetch('/api/todos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, checked }) });
    }
  };

  // ── Brain-dump capture ──────────────────────────────────────────────
  // Ask the AI to turn the raw dump into an editable draft (name + actions,
  // new-vs-existing routing). Falls back to a manual new-project draft on error.
  const handleAnalyze = async () => {
    const idea = braindump.trim();
    if (!idea || !data) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/braindump-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ideaText: idea, existingProjects: data.projects.map(p => ({ id: p.id, name: p.name })) }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'analyze failed');
      setDraft({
        mode: d.mode === 'existing' ? 'existing' : 'new',
        projectName: d.projectName || idea,
        matchProjectId: d.matchProjectId || '',
        matchProjectName: d.matchProjectName || '',
        actions: (d.actions?.length ? d.actions : ['']),
      });
    } catch {
      // AI unavailable — drop into a manual draft rather than blocking capture.
      setDraft({ mode: 'new', projectName: idea, matchProjectId: '', matchProjectName: '', actions: [''] });
    }
    setAnalyzing(false);
  };

  // Skip AI, edit by hand.
  const handleManualDraft = () => {
    const idea = braindump.trim();
    if (!idea) return;
    setDraft({ mode: 'new', projectName: idea, matchProjectId: '', matchProjectName: '', actions: ['', '', ''] });
  };

  const updateDraft = (patch: Partial<ProjectDraft>) => setDraft(prev => prev ? { ...prev, ...patch } : prev);
  const setDraftAction = (i: number, val: string) => setDraft(prev => prev ? { ...prev, actions: prev.actions.map((a, idx) => idx === i ? val : a) } : prev);
  const addDraftAction = () => setDraft(prev => prev ? { ...prev, actions: [...prev.actions, ''] } : prev);
  const removeDraftAction = (i: number) => setDraft(prev => prev ? { ...prev, actions: prev.actions.filter((_, idx) => idx !== i) } : prev);
  const cancelDraft = () => { setDraft(null); };

  // Commit the draft: append to an existing project, or create a new one.
  const handleCreateProject = async () => {
    if (!draft) return;
    const actions = draft.actions.map(a => a.trim()).filter(Boolean);
    if (draft.mode === 'existing') {
      if (!draft.matchProjectId || actions.length === 0) return;
      setPromoting(true);
      await fetch('/api/add-project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: draft.matchProjectId, texts: actions }) });
    } else {
      if (!draft.projectName.trim()) return;
      setPromoting(true);
      await fetch('/api/braindump', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName: draft.projectName.trim(), nextActions: actions, ideaText: braindump }) });
    }
    await refreshAfterMutation({ dashboard: true });
    setBraindump(''); setDraft(null); setPromoting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #fef9f0 50%, #f0fff4 100%)' }}>
      <p className="text-gray-400 text-xs tracking-widest uppercase animate-pulse">Loading...</p>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #fef9f0 50%, #f0fff4 100%)' }}>
      <p className="text-gray-500 text-sm">Couldn&apos;t load — check your connection.</p>
      <button onClick={() => window.location.reload()} className="text-xs uppercase tracking-widest px-5 py-2 rounded-full font-semibold" style={{ background: '#fbcdad', color: '#333' }}>Reload</button>
    </div>
  );

  const isViewingOtherDay = selectedDate !== null && selectedDate !== todayStr;
  const displayedTasks = isViewingOtherDay
    ? (weekTasks[selectedDate!]?.tasks ?? [])
    : data.dailyTasks.filter(t => !movedRecurringIds.has(t.id));
  const selectedShift = selectedDate ? shifts.find(s => s.date === selectedDate) : null;
  const displayDayLabel = isViewingOtherDay && selectedShift ? selectedShift.label : null;
  // Day tasks only (exclude the 🛒 Shopping List group — it has its own tile + count)
  const dailyTasks: typeof displayedTasks = [];
  let inShoppingSection = false;
  for (const t of displayedTasks) {
    if (t.isHeader) { inShoppingSection = t.text.toUpperCase().includes('SHOPPING'); continue; }
    if (!inShoppingSection) dailyTasks.push(t);
  }
  const dailyDone = dailyTasks.filter(t => t.checked).length;
  const projectsDone = data.projects.flatMap(p => p.todos).filter(t => t.checked).length;
  const projectsTotal = data.projects.flatMap(p => p.todos).length;

  // Live margin lookup for "Review pricing" to-dos — see withLiveReviewMargin.
  // Use costings (30-min Notion sync, all products) rather than marginReview.items
  // (weekly, flagged items only) so the lookup always resolves.
  const reviewMarginMap = new Map<string, number>(
    costings.filter(p => p.margin !== null).map(p => [p.name.toUpperCase().trim(), p.margin!])
  );

  // ── Launcher tile metadata (counts + attention dots) ──
  const costMargin   = costings.filter(p => p.margin !== null);
  const coffeeCount  = costMargin.filter(p => p.category === 'Coffee').length;
  const coffeeAlert  = costMargin.some(p => p.category === 'Coffee' && p.margin! < 60);
  const foodCount    = costMargin.filter(p => p.category !== 'Coffee').length;
  const foodAlert    = costMargin.some(p => p.category !== 'Coffee' && p.margin! < 60);
  const supplierCount = ingredientPrices?.ingredients?.length ?? 0;
  const supplierAlert = (priceDrift?.warnings?.length ?? 0) > 0;
  const tigerOpenCount = tigerTasks.filter(t => !t.done).length;

  // Shopping items — always derived from today's tasks (not the selected day)
  const _shopAll: typeof data.dailyTasks = [];
  { let _inShop = false; for (const t of data.dailyTasks) { if (t.isHeader) { _inShop = t.text.toUpperCase().includes('SHOPPING'); continue; } if (_inShop) _shopAll.push(t); } }
  const shoppingAllUnchecked = _shopAll.filter(t => !t.checked);
  const shoppingAllChecked = _shopAll.filter(t => t.checked);
  const shoppingBadge = shoppingAllUnchecked.length;

  const CATEGORIES = ['Coffee', 'Food', 'Retail', 'Vending', 'Uncategorised'];

  return (
    <div className="min-h-screen text-gray-900 dashboard-unbold" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
      <div style={{ position: 'fixed', top: '-10%', right: '-5%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-10%', left: '-5%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: '40%', left: '30%', width: '300px', height: '300px', background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      <div className="max-w-5xl mx-auto px-5 pt-8 pb-4 flex items-center justify-between relative">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontWeight: 700, fontStyle: 'italic', fontVariationSettings: "'opsz' 18, 'wght' 700" }}>
            TIGER <span style={{ color: '#fbcdad' }}>OS</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }}>{data.dateStr}</p>
          <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }}>{data.weather}</p>
        </div>
        <img src="/logo.png" alt="G'Day Tiger" style={{ width: '56px', height: '56px', objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0px 4px 12px rgba(0,0,0,0.3))' }} />
      </div>

      <div className="max-w-5xl mx-auto px-5 pb-10 relative">
        {/* ── Stable top section — grid never reflows when widgets open below ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* DAILY TO DO */}
        <Card icon={<WidgetIcon name="daily" chip={28} glyph={17} />} title={displayDayLabel ? `Tasks — ${displayDayLabel}` : 'Daily To Do'}
          headerRight={
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 uppercase tracking-widest">{dailyDone}/{dailyTasks.length} Done</span>
              {isViewingOtherDay && <button onClick={() => setSelectedDate(null)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← BACK</button>}
            </div>
          }>
          <div className="space-y-2">
            {(() => {
              // Group tasks by category
              const groups: { category: string; tasks: typeof displayedTasks }[] = [];
              let currentGroup: { category: string; tasks: typeof displayedTasks } | null = null;
              for (const task of displayedTasks) {
                if (task.isHeader) {
                  currentGroup = { category: task.text.toUpperCase(), tasks: [] };
                  groups.push(currentGroup);
                } else {
                  if (!currentGroup) { currentGroup = { category: '', tasks: [] }; groups.push(currentGroup); }
                  currentGroup.tasks.push(task);
                }
              }
              // Pull the Shopping List out so it renders as its own section at the bottom
              const SHOPPING_CAT = '🛒 SHOPPING LIST';
              const shoppingGroup = groups.find(g => g.category === SHOPPING_CAT) || null;
              const normalGroups = groups.filter(g => g.category !== SHOPPING_CAT);
              // Sort groups by priority, uncategorised last
              normalGroups.sort((a, b) => {
                const ai = CATEGORY_ORDER.indexOf(a.category);
                const bi = CATEGORY_ORDER.indexOf(b.category);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
              });
              // Checked tasks sink to the absolute bottom of the list (across all categories)
              const checkedBucket: { task: typeof displayedTasks[0]; category: string }[] = [];
              const uncheckedGroups = normalGroups.map(g => ({
                ...g,
                tasks: g.tasks.filter(t => { if (t.checked) { checkedBucket.push({ task: t, category: g.category }); return false; } return true; }),
              })).filter(g => g.tasks.length > 0);
              const renderTask = (task: typeof displayedTasks[0], category: string) => (
                <CheckItem key={task.id} id={task.id} text={withLiveReviewMargin(task.text, reviewMarginMap)} checked={task.checked} label={category || undefined} context={taskContext[task.id]} onContextSave={handleContextSave} isSticky={task.isSticky}
                  onChange={(id, checked) => toggleTodo(id, checked, isViewingOtherDay ? 'week' : 'daily', undefined, isViewingOtherDay ? selectedDate! : undefined, task.isSticky)}
                  onDelete={(id) => handleDeleteTask(id, isViewingOtherDay ? 'week' : 'daily', isViewingOtherDay ? selectedDate! : undefined, task.isRecurring)}
                  onSwipeRight={() => handleMoveToDay(task.id, task.text, getNextDateStr(isViewingOtherDay ? selectedDate! : todayStr), task.isRecurring, isViewingOtherDay ? selectedDate! : todayStr, category || undefined, task.isSticky)}
                  onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ id: task.id, text: task.text, isRecurring: task.isRecurring, fromDate: isViewingOtherDay ? selectedDate! : todayStr, category: category || undefined, isSticky: task.isSticky })); e.dataTransfer.effectAllowed = 'move'; }}
                  onPin={!isViewingOtherDay && !task.isSticky ? () => handlePinTask(task.id, task.text) : undefined} />
              );
              const elements = [
                ...uncheckedGroups.flatMap(group => group.tasks.map(task => renderTask(task, group.category))),
              ];
              // 🛒 Shopping List — one collapsible tile with a count badge (like the week-ahead rows).
              // Tap to expand into one tile per item; tick = bought (writes to Notion, won't return).
              const shoppingItems = shoppingGroup ? shoppingGroup.tasks : [];
              const shoppingUnchecked = shoppingItems.filter(t => !t.checked);
              const shoppingChecked = shoppingItems.filter(t => t.checked);
              const shoppingCount = shoppingUnchecked.length;
              const tileStyle = { minHeight: '62px', background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' };
              // Shopping link row — only shown when there are unchecked items; opens the shopping widget.
              // Placed above the checked-tasks bucket so it stays visible while there's still shopping to do.
              if (!isViewingOtherDay && shoppingBadge > 0) elements.push(
                <div key="shopping" onClick={openShoppingWidget} role="button"
                  className="rounded-2xl cursor-pointer flex items-center gap-3 px-3"
                  style={{ ...tileStyle, minHeight: '62px', ...(openWidgets.has('shopping') ? { border: '1.5px solid #fbcdad', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8), 0 0 0 3px rgba(251,205,173,0.35)' } : {}) }}>
                  <WidgetIcon name="shopping" chip={28} glyph={17} />
                  <span className="flex-1 text-sm font-semibold text-gray-800 uppercase">Shopping List</span>
                  <span className="flex items-center justify-center rounded-full font-bold" style={{ width: '22px', height: '22px', background: '#fbcdad', color: '#333', fontSize: '11px', flexShrink: 0 }}>{shoppingBadge}</span>
                  <span className="text-gray-400" style={{ fontSize: '10px', flexShrink: 0 }}>{openWidgets.has('shopping') ? '▼' : '▶'}</span>
                </div>
              );
              elements.push(...checkedBucket.map(({ task, category }) => renderTask(task, category)));
              return elements;
            })()}
          </div>
        </Card>

        {/* THE WEEK AHEAD */}
        <Card icon={<WidgetIcon name="week" chip={28} glyph={17} />} title="The Week Ahead">
          <div className="space-y-2">
            {shifts.length === 0 ? <p className="text-sm text-gray-400 italic">No shifts found</p> : (
              shifts.map(shift => (
                <RosterRow key={shift.date} shift={shift} isToday={shift.date === todayStr} isHighlighted={selectedDate ? shift.date === selectedDate : shift.date === todayStr} taskCount={weekTasks[shift.date]?.count ?? 0} onAdd={handleAddTask} onSelectDay={handleSelectDay}
                  isDragOver={dragOverDate === shift.date}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDate(shift.date); }}
                  onDragLeave={() => setDragOverDate(null)}
                  onDrop={(e) => { e.preventDefault(); setDragOverDate(null); try { const d = JSON.parse(e.dataTransfer.getData('application/json')); handleMoveToDay(d.id, d.text, shift.date, d.isRecurring, d.fromDate, d.category, d.isSticky); } catch { /* ignore */ } }}
                />
              ))
            )}
          </div>
        </Card>

        {/* LAUNCHER — uniform square tiles; tap opens the full widget below */}
        <div className="md:col-span-2 grid grid-cols-3 md:grid-cols-6 gap-3">
          <LauncherTile icon={<WidgetIcon name="shopping" chip={48} glyph={26} />} title="Shopping List" badgeText={shoppingBadge || undefined} active={openWidgets.has('shopping')} onClick={() => toggleWidget('shopping')} />
          <LauncherTile icon={<WidgetIcon name="projects" chip={48} glyph={26} />} title="Projects" badgeText={`${projectsDone}/${projectsTotal}`} alert={data.projects.some(p => p.status === 'Blocked')} active={openWidgets.has('projects')} onClick={() => toggleWidget('projects')} />
          <LauncherTile icon={<WidgetIcon name="supplier" chip={48} glyph={26} />} title="Supplier Prices" badgeText={supplierCount || undefined} alert={supplierAlert} active={openWidgets.has('supplier')} onClick={() => toggleWidget('supplier')} />
          <LauncherTile icon={<WidgetIcon name="coffee" chip={48} glyph={26} />} title="Coffee Costings" badgeText={coffeeCount || undefined} alert={coffeeAlert} active={openWidgets.has('coffee')} onClick={() => toggleWidget('coffee')} />
          <LauncherTile icon={<WidgetIcon name="food" chip={48} glyph={26} />} title="Food Costings" badgeText={foodCount || undefined} alert={foodAlert} active={openWidgets.has('food')} onClick={() => toggleWidget('food')} />
          <LauncherTile icon={<WidgetIcon name="updates" chip={48} glyph={26} />} title="Tiger OS Updates" badgeText={tigerOpenCount || undefined} active={openWidgets.has('updates')} onClick={() => toggleWidget('updates')} />
          <LauncherTile icon={<WidgetIcon name="labour" chip={48} glyph={26} />} title="Labour" badgeText={staffCost?.thisWeek?.staffPct != null ? `${Math.round(staffCost.thisWeek.staffPct)}%` : undefined} alert={staffCost?.thisWeek?.staffPct != null && staffCost.thisWeek.staffPct > staffCost.target} active={openWidgets.has('labour')} onClick={() => toggleWidget('labour')} />
        </div>

        </div>{/* end stable grid */}

        {/* ── Widget panels — open one at a time in a bottom sheet over the dashboard ── */}
        <BottomSheet open={openWidgets.size > 0} onClose={closeWidgets}>
        <div className="flex flex-col gap-4">

        {/* SHOPPING LIST widget — always in DOM, shown/hidden via CSS to avoid scroll-jump */}
        <div ref={shoppingWidgetRef} style={{ display: openWidgets.has('shopping') ? 'block' : 'none' }}>
          <Card bare icon={<WidgetIcon name="shopping" chip={28} />} title="Shopping List" onCollapse={() => toggleWidget('shopping')}>
            <div className="space-y-2">
              {[...shoppingAllUnchecked, ...shoppingAllChecked].map(item => {
                  const { name, qty } = parseShoppingQty(item.text);
                  const editing = editingQtyId === item.id;
                  return (
                    <SwipeToDelete key={item.id} onDelete={() => deleteShopping(item.id)}>
                    <div className="group flex items-center gap-3 px-3 py-2.5" style={{ minHeight: '54px' }}>
                      <div onClick={() => toggleShopping(item.id, !item.checked)} className="shrink-0 w-4 h-4 rounded flex items-center justify-center cursor-pointer" style={{ background: item.checked ? '#fbcdad' : 'rgba(255,255,255,0.6)', border: item.checked ? '1.5px solid #fbcdad' : '1.5px solid rgba(0,0,0,0.15)' }}>
                        {item.checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <span onClick={() => toggleShopping(item.id, !item.checked)} className={`flex-1 text-sm leading-snug font-semibold cursor-pointer transition-colors ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>{name}</span>
                      {editing ? (
                        <input type="number" min={1} value={editingQtyVal} autoFocus
                          onChange={e => setEditingQtyVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveShoppingQty(item.id, name); if (e.key === 'Escape') setEditingQtyId(null); }}
                          onBlur={() => saveShoppingQty(item.id, name)}
                          aria-label="Quantity"
                          className="w-14 text-sm text-center px-1 py-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 shrink-0" style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.12)' }} />
                      ) : (
                        <button onClick={() => { setEditingQtyId(item.id); setEditingQtyVal(String(qty)); }} className={`shrink-0 text-sm font-semibold tabular-nums px-2 py-1 rounded-lg transition-colors ${item.checked ? 'text-gray-300' : 'text-gray-400 hover:text-gray-600'}`} title="Change quantity" style={{ background: 'rgba(0,0,0,0.04)' }}>×{qty}</button>
                      )}
                      <button onClick={e => { e.stopPropagation(); deleteShopping(item.id); }} className="shrink-0 leading-none text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100" aria-label="Delete" title="Delete">✕</button>
                    </div>
                    </SwipeToDelete>
                  );
              })}
              {addingShopping ? (
                <div className="flex items-center gap-2 pt-1">
                  <input value={newShoppingText} onChange={e => setNewShoppingText(e.target.value.toUpperCase())} autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') addShopping(newShoppingText, newShoppingQty); if (e.key === 'Escape') { setAddingShopping(false); setNewShoppingText(''); setNewShoppingQty(1); } }}
                    placeholder="ADD ITEM..." className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
                  <input type="number" min={1} value={newShoppingQty} onChange={e => setNewShoppingQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    onKeyDown={e => { if (e.key === 'Enter') addShopping(newShoppingText, newShoppingQty); }}
                    aria-label="Quantity" title="Quantity" className="w-12 text-sm text-center px-1 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 shrink-0" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
                  <button onClick={() => addShopping(newShoppingText, newShoppingQty)} disabled={!newShoppingText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>ADD</button>
                  <button onClick={() => { setAddingShopping(false); setNewShoppingText(''); setNewShoppingQty(1); }} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">✕</button>
                </div>
              ) : (
                <textarea
                  onClick={() => { setAddingShopping(true); }}
                  readOnly
                  placeholder="ADD ITEM..."
                  rows={1}
                  className="w-full rounded-2xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 uppercase resize-none focus:outline-none cursor-text"
                  style={{ ...TILE_STYLE, minHeight: '62px' }}
                />
              )}
            </div>
          </Card>
        </div>

        {/* PROJECTS — always in DOM */}
        <div style={{ display: openWidgets.has('projects') ? 'block' : 'none' }}>
        <Card bare icon={<WidgetIcon name="projects" chip={28} glyph={17} />} title="Projects" onCollapse={() => toggleWidget('projects')}>
         <div className="uppercase">
          {/* ── Capture zone ── */}
          {!draft ? (
            <div className="space-y-2 mb-3">
              <textarea value={braindump} onChange={e => setBraindump(e.target.value)} placeholder="Drop an idea" style={{ ...TILE_STYLE, minHeight: '62px' }} className="w-full rounded-2xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 uppercase resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" rows={1} />
              {braindump.trim() && (
                <div className="flex gap-2 items-center">
                  <button onClick={handleAnalyze} disabled={analyzing} className="text-xs disabled:opacity-50 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors shadow-sm" style={{ background: '#fbcdad', color: '#333' }}>{analyzing ? 'Drafting…' : '✨ Draft with AI'}</button>
                  <button onClick={handleManualDraft} disabled={analyzing} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2 uppercase transition-colors">Skip → manual</button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 mb-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
              <p className="text-xs text-gray-400 italic">&ldquo;{braindump}&rdquo;</p>
              {/* new vs existing toggle */}
              <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.04)' }}>
                <button onClick={() => updateDraft({ mode: 'new' })} className={`flex-1 text-xs py-1.5 rounded-md font-semibold uppercase transition-colors ${draft.mode === 'new' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>New project</button>
                <button onClick={() => updateDraft({ mode: 'existing', matchProjectId: draft.matchProjectId || data.projects[0]?.id || '' })} disabled={data.projects.length === 0} className={`flex-1 text-xs py-1.5 rounded-md font-semibold uppercase transition-colors disabled:opacity-40 ${draft.mode === 'existing' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>Add to existing</button>
              </div>
              {draft.mode === 'new' ? (
                <input value={draft.projectName} onChange={e => updateDraft({ projectName: e.target.value })} placeholder="Project name" style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)' }} className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              ) : (
                <select value={draft.matchProjectId} onChange={e => updateDraft({ matchProjectId: e.target.value })} style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)' }} className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all">
                  {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {draft.actions.map((action, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={action} onChange={e => setDraftAction(i, e.target.value)} placeholder={`Next action ${i + 1}`} style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.9)' }} className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
                  <button onClick={() => removeDraftAction(i)} className="text-gray-300 hover:text-gray-500 transition-colors text-lg leading-none shrink-0">&times;</button>
                </div>
              ))}
              <button onClick={addDraftAction} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">+ Add action</button>
              <div className="flex gap-2 pt-1">
                <button onClick={handleCreateProject} disabled={promoting || (draft.mode === 'new' ? !draft.projectName.trim() : (!draft.matchProjectId || draft.actions.every(a => !a.trim())))} className="text-xs disabled:opacity-40 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors shadow-sm" style={{ background: '#fbcdad', color: '#333' }}>{promoting ? (draft.mode === 'existing' ? 'Adding…' : 'Creating…') : (draft.mode === 'existing' ? 'Add Actions' : 'Create Project')}</button>
                <button onClick={cancelDraft} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 transition-colors font-bold uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">Ongoing</span>
            <span className="text-xs text-gray-400">{projectsDone}/{projectsTotal} actions done</span>
          </div>
          <div className="space-y-2">
            {data.projects.length === 0 ? <p className="text-sm text-gray-400 italic">No active projects</p> : (
              data.projects.map(project => {
                const isOpen = expandedProjects.has(project.id);
                const toggleOpen = () => setExpandedProjects(prev => { const n = new Set(prev); if (n.has(project.id)) n.delete(project.id); else n.add(project.id); return n; });
                const pDone = project.todos.filter(t => t.checked).length;
                return (
                <div key={project.id} className="space-y-2">
                  {/* PROJECT TILE — swipe left to archive, tap to drop down its actions */}
                  <SwipeToDelete onDelete={() => handleArchiveProject(project.id)} onClick={toggleOpen}>
                    <div className="px-4 flex items-center gap-2 cursor-pointer" style={{ minHeight: '62px' }}>
                      <span className="text-sm font-semibold text-gray-900 flex-1 min-w-0">{project.name}</span>
                      <span className="text-xs text-gray-400 shrink-0">{pDone}/{project.todos.length}</span>
                      <button onClick={e => { e.stopPropagation(); handleStatusChange(project.id, project.status); }} title="Click to cycle status" className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase transition-colors cursor-pointer shrink-0 ${project.status === 'In Progress' ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : project.status === 'Blocked' ? 'bg-red-100 text-red-600 hover:bg-red-200' : project.status === 'On Hold' ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>{project.status}</button>
                      <span className="text-gray-400" style={{ fontSize: '10px', width: '10px', flexShrink: 0 }}>{isOpen ? '▼' : '▶'}</span>
                    </div>
                  </SwipeToDelete>
                  {/* DROPDOWN — action tiles (full width, same size as task tiles) */}
                  {isOpen && (
                    <div className="space-y-2">
                      {project.todos.length === 0 ? <p className="text-xs text-gray-400 italic ml-1">No actions set</p> : (
                        project.todos.map(todo => (
                          <CheckItem key={todo.id} id={todo.id} text={todo.text} checked={todo.checked} onChange={(id, checked) => toggleTodo(id, checked, 'project', project.id)} onDelegate={() => delegateToClaude(project, todo)} />
                        ))
                      )}
                      {addingActionFor === project.id ? (
                        <div className="flex gap-2 mt-1">
                          <input value={newActionText} onChange={e => setNewActionText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddProjectAction(project.id, newActionText); if (e.key === 'Escape') { setAddingActionFor(null); setNewActionText(''); } }} placeholder="New action..." autoFocus className="flex-1 min-w-0 text-xs px-3 py-1.5 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
                          <button onClick={() => handleAddProjectAction(project.id, newActionText)} disabled={!newActionText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold uppercase transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Add</button>
                          <button onClick={() => { setAddingActionFor(null); setNewActionText(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">&times;</button>
                        </div>
                      ) : (
                        <button onClick={() => { setAddingActionFor(project.id); setNewActionText(''); }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors uppercase">+ Add action</button>
                      )}
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>
         </div>
        </Card>
        </div>

        {/* TIGER OS UPDATES — always in DOM */}
        <div style={{ display: openWidgets.has('updates') ? 'block' : 'none' }}>
          <Card bare icon={<WidgetIcon name="updates" chip={28} glyph={17} />} title="TIGER OS Updates" onCollapse={() => toggleWidget('updates')}>
            <UpdateWidget
              tasks={tigerTasks}
              onAddTask={addTigerTask}
              onAddSubtask={addTigerSubtask}
              onToggleSubtask={toggleTigerSubtask}
              onToggleDone={toggleTigerDone}
              onDeleteTask={deleteTigerTask}
              onDelegate={delegateTigerTask}
            />
          </Card>
        </div>

        {/* LABOUR — Staff cost % (Deputy hours ÷ Square sales), last-14-day trend, roster shape */}
        <div style={{ display: openWidgets.has('labour') ? 'block' : 'none' }}>
          <Card bare icon={<WidgetIcon name="labour" chip={28} glyph={17} />} title="Labour" onCollapse={() => toggleWidget('labour')}>
            <LabourCardBody data={staffCost} />
          </Card>
        </div>

        {/* COSTINGS — Coffee, Food, Ingredient Prices (each renders only when its tile is open) */}
        <CostingsCard costings={costings} ingredientPrices={ingredientPrices} priceDrift={priceDrift} marginReview={marginReview} paymentFees={paymentFees} recipeMap={recipeMap}
          open={{ coffee: openWidgets.has('coffee'), food: openWidgets.has('food'), supplier: openWidgets.has('supplier') }}
          onCollapse={(k) => toggleWidget(k)}
          onIngredientsChanged={() => fetch('/api/ingredient-prices').then(r => r.json()).then(d => setIngredientPrices(d)).catch(() => {})} />

        </div>{/* end widget panels */}
        </BottomSheet>
      </div>

      {/* DELEGATE TOAST (mobile clipboard handoff) */}
      {delegateToast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-6 pointer-events-none">
          <div className="text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg" style={{ background: 'rgba(30,30,30,0.92)', color: '#fff' }}>{delegateToast}</div>
        </div>
      )}
    </div>
  );
}