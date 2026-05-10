'use client';

import { useEffect, useState, useRef } from 'react';

interface Todo {
  id: string;
  text: string;
  checked: boolean;
  isHeader?: boolean;
  isRecurring?: boolean;
}

interface Project {
  id: string;
  name: string;
  status: string;
  todos: Todo[];
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

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudePanelState {
  projectId: string;
  projectName: string;
  actionText: string;
  messages: ClaudeMessage[];
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
  return todos.map(t => t.isHeader ? t : { ...t, checked: checkedIds.has(t.id) });
};

function Card({ emoji, title, children, onEmojiClick, headerRight }: {
  emoji: string; title: string; children: React.ReactNode; onEmojiClick?: () => void; headerRight?: React.ReactNode;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)', height: '575px', overflow: 'hidden' }} className="rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-base transition-all ${onEmojiClick ? 'cursor-pointer select-none' : ''}`} style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))' }} onClick={onEmojiClick}>{emoji}</span>
        <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: '#6b7280' }}>{title}</span>
        {headerRight && <div className="ml-auto">{headerRight}</div>}
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto min-h-0">{children}</div>
    </div>
  );
}

function CheckItem({ id, text, checked, onChange, onDelete, onDelegate, onSwipeRight, onDragStart, label, context, onContextSave }: {
  id: string; text: string; checked: boolean;
  onChange: (id: string, checked: boolean) => void;
  onDelete?: (id: string) => void;
  onDelegate?: () => void;
  onSwipeRight?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  label?: string;
  context?: string;
  onContextSave?: (id: string, text: string) => void;
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

  useEffect(() => { setLocalContext(context ?? ''); }, [context]);

  const mouseDownRef = useRef(false);
  // Detect touch/mobile vs mouse/desktop once on mount
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  }, []);
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
                return <a href={supplierUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2" style={{ color: '#c8926a' }} onClick={e => e.stopPropagation()}>{text}</a>;
              }
              return <span className={`transition-colors font-semibold ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>{text}</span>;
            })()}
          </div>
          {label && <p className="text-xs text-gray-400 mt-0.5 uppercase">{label}</p>}
        </div>
        {context && !expanded && <div className="shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: '#fbcdad' }} title="Has context" />}
        {onDelegate && <button onClick={e => { e.stopPropagation(); onDelegate!(); }} className="shrink-0 transition-opacity leading-none opacity-40 hover:opacity-100" style={{ fontSize: '13px', lineHeight: 1 }} aria-label="Ask Claude" title="Ask Claude">🤖</button>}
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

function RosterRow({ shift, isToday, isHighlighted, taskCount, onAdd, onSelectDay, onDrop, onDragOver, onDragLeave, isDragOver }: {
  shift: Shift; isToday: boolean; isHighlighted: boolean; taskCount: number;
  onAdd: (date: string, text: string) => Promise<void>;
  onSelectDay: (date: string) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: () => void;
  isDragOver?: boolean;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openInput = (e: React.MouseEvent) => { e.stopPropagation(); setIsAdding(true); setTimeout(() => inputRef.current?.focus(), 320); };
  const close = () => { setIsAdding(false); setTaskText(''); };
  const submit = async () => { if (!taskText.trim()) return; setSaving(true); await onAdd(shift.date, taskText); setSaving(false); close(); };
  return (
    <div
      className={`relative overflow-hidden rounded-2xl transition-all ${isDragOver ? 'border' : isHighlighted ? 'border' : ''}`}
      style={isDragOver ? { minHeight: '62px', background: 'rgba(22,163,74,0.10)', borderColor: 'rgba(22,163,74,0.25)', boxShadow: '0 0 0 2px rgba(22,163,74,0.15)' } : isHighlighted ? { minHeight: '62px', background: 'rgba(251,205,173,0.12)', borderColor: '#fbcdad', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' } : { minHeight: '62px', background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)' }}
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
      <div className="absolute inset-0 flex items-center gap-2 py-2 px-3 transition-transform duration-300 ease-in-out" style={{ transform: isAdding ? 'translateX(0)' : 'translateX(100%)' }}>
        <span className="text-xs font-semibold shrink-0 text-gray-500">{shift.label.split(' ')[0]}</span>
        <input ref={inputRef} value={taskText} onChange={e => setTaskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); }} placeholder="ADD A TASK..." className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
        <button onClick={submit} disabled={saving || !taskText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>{saving ? '...' : 'ADD'}</button>
        <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">✕</button>
      </div>
    </div>
  );
}

const HIST_KEY = 'gdt_costings_history_v1';

type SnapEntry = { date: string; d: Record<string, { p: number; s: number }> };

type MarginChange = {
  name: string;
  category: string;
  oldPct: number;
  newPct: number;
  dp: number;
  dc: number;
  sellPrice: number | null;
  daysAgo: number;
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: '"stolzl", sans-serif',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#aaa',
};

const FADE_MASK = 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)';

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
        <p className="text-sm font-semibold text-gray-800 leading-snug flex-1 min-w-0 truncate"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
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

function ProductItem({ p }: { p: CostingProduct }) {
  const mc = p.margin! >= 70 ? '#16a34a' : p.margin! >= 60 ? '#d97706' : '#dc2626';
  const bar = Math.min(100, Math.max(0, p.margin!));
  return (
    <div className="rounded-2xl px-3 py-2.5 mb-2 shrink-0" style={{
      background: 'rgba(255,255,255,0.45)',
      backdropFilter: 'blur(16px) saturate(180%)',
      WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.7)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
    }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-semibold text-gray-800 leading-snug flex-1 min-w-0 truncate"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
          {p.name}
        </p>
        <span className="text-base font-black shrink-0 leading-none" style={{ color: mc, fontVariantNumeric: 'tabular-nums' }}>
          {p.margin!.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        {p.sellPrice !== null && (
          <span className="text-xs text-gray-400" style={{ fontVariantNumeric: 'tabular-nums' }}>${p.sellPrice.toFixed(2)}</span>
        )}
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
          <div className="h-full rounded-full" style={{ width: `${bar}%`, background: mc, transition: 'width 0.6s ease' }} />
        </div>
      </div>
    </div>
  );
}

function ProductColumn({ label, items }: { label: string; items: CostingProduct[] }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-2">
      <span style={LABEL_STYLE}>{label}</span>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No data</p>
      ) : (
        <div className="relative" style={{ height: '272px' }}>
          {/* Fade mask overlay — pointer-events: none so scrolling still works */}
          <div className="absolute inset-0 pointer-events-none z-10" style={{
            maskImage: FADE_MASK,
            WebkitMaskImage: FADE_MASK,
            background: 'transparent',
          }} />
          <div className="no-scrollbar h-full overflow-y-scroll pr-1" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
            {items.map(p => <ProductItem key={p.id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function CostingsCard({ costings }: { costings: CostingProduct[] }) {
  const withMargin = costings.filter(p => p.margin !== null);
  const coffeeItems = [...withMargin].filter(p => p.category === 'Coffee').sort((a, b) => a.margin! - b.margin!);
  const foodItems   = [...withMargin].filter(p => p.category !== 'Coffee').sort((a, b) => a.margin! - b.margin!);

  const avg    = withMargin.length > 0 ? withMargin.reduce((s, p) => s + p.margin!, 0) / withMargin.length : null;
  const red    = withMargin.filter(p => p.margin! < 60).length;
  const yellow = withMargin.filter(p => p.margin! >= 60 && p.margin! < 70).length;
  const green  = withMargin.filter(p => p.margin! >= 70).length;

  const [changes, setChanges] = useState<MarginChange[]>([]);
  const [firstLoad, setFirstLoad] = useState(false);

  useEffect(() => {
    if (withMargin.length === 0) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    let hist: SnapEntry[] = [];
    try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { /* ignore */ }

    // Find oldest snapshot within last 7 days (excluding today) as comparison baseline
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const prev = hist
      .filter(e => e.date !== todayStr && new Date(e.date) >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

    setFirstLoad(!prev && hist.length === 0);

    if (prev) {
      const daysAgo = Math.round((new Date(todayStr).getTime() - new Date(prev.date).getTime()) / 86400000);
      const detected: MarginChange[] = [];
      withMargin.forEach(item => {
        const old = prev.d[item.name];
        if (!old) return;
        const dp = item.margin! - old.p;
        if (Math.abs(dp) < 0.15) return;
        // dc: positive = cost went up (margin fell), negative = cost went down
        const dc = item.sellPrice ? item.sellPrice * (1 - item.margin! / 100) - item.sellPrice * (1 - old.p / 100) : 0;
        detected.push({ name: item.name, category: item.category, oldPct: old.p, newPct: item.margin!, dp, dc, sellPrice: item.sellPrice, daysAgo });
      });
      setChanges(detected.sort((a, b) => a.dp - b.dp));
    }

    // Save today's snapshot (replace if already have today's)
    const snap: SnapEntry = { date: todayStr, d: {} };
    withMargin.forEach(item => { snap.d[item.name] = { p: item.margin!, s: item.sellPrice ?? 0 }; });
    const updated = [...hist.filter(e => e.date !== todayStr), snap]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withMargin.length]);

  return (
    <Card emoji="💰" title="Product Costings">
      {/* Summary row */}
      <div className="flex items-center gap-3 flex-wrap pb-3 mb-1" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {avg !== null && <span className="text-xs text-gray-500">Avg <span className="font-bold text-gray-700">{avg.toFixed(1)}%</span></span>}
        <div className="flex gap-2 flex-wrap">
          {[
            { count: red,    label: 'under 60%', bg: 'rgba(220,38,38,0.10)',   border: 'rgba(220,38,38,0.25)',   color: '#991b1b' },
            { count: yellow, label: '60–70%',    bg: 'rgba(217,119,6,0.10)',   border: 'rgba(217,119,6,0.25)',   color: '#78350f' },
            { count: green,  label: 'over 70%',  bg: 'rgba(22,163,74,0.10)',   border: 'rgba(22,163,74,0.25)',   color: '#14532d' },
          ].map(({ count, label, bg, border, color }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
              style={{ background: bg, border: `1px solid ${border}`, color, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
              <span className="font-black">{count}</span>
              <span style={{ fontFamily: '"stolzl", sans-serif', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.8 }}>{label}</span>
            </span>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-auto">{withMargin.length} products</span>
      </div>

      {/* Two columns */}
      <div className="flex gap-4">
        <ProductColumn label="Coffee" items={coffeeItems} />
        <ProductColumn label="Food" items={foodItems} />
      </div>

      {/* Price changes section */}
      <div className="mt-1">
        <div className="flex items-center gap-2 mb-2">
          <span style={{ ...LABEL_STYLE, color: changes.length > 0 ? '#7c4a2d' : '#aaa' }}>
            📊 Cost Changes (7 days)
          </span>
          {changes.length > 0 && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#fbcdad', color: '#7c4a2d' }}>{changes.length}</span>
          )}
        </div>
        {firstLoad ? (
          <p className="text-xs text-gray-400 italic">Baseline saved — changes will appear after tomorrow&apos;s first load.</p>
        ) : changes.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No margin movements in the last 7 days.</p>
        ) : (
          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              {changes.filter((_, i) => i % 2 === 0).map((c, i) => <ChangeCard key={i} c={c} />)}
            </div>
            <div className="flex-1 min-w-0">
              {changes.filter((_, i) => i % 2 === 1).map((c, i) => <ChangeCard key={i} c={c} />)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

const getNextDateStr = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
};

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [braindump, setBraindump] = useState('');
  const [showPromote, setShowPromote] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [nextActions, setNextActions] = useState(['', '', '']);
  const [promoting, setPromoting] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [weekTasks, setWeekTasks] = useState<Record<string, WeekDay>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [addingActionFor, setAddingActionFor] = useState<string | null>(null);
  const [newActionText, setNewActionText] = useState('');
  const [serverState, setServerState] = useState<Record<string, string[]>>({});
  const [claudePanel, setClaudePanel] = useState<ClaudePanelState | null>(null);
  const [claudeInput, setClaudeInput] = useState('');
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [costings, setCostings] = useState<CostingProduct[]>([]);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [taskContext, setTaskContext] = useState<Record<string, string>>({});
  const claudeMessagesEndRef = useRef<HTMLDivElement>(null);

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
      const state = d.state || {};
      setServerState(state);
      return state;
    } catch { return {}; }
  };

  const fetchDashboard = async (state: Record<string, string[]>) => {
    const res = await fetch('/api/dashboard');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const d = await res.json();
    setData({ ...d, dailyTasks: applyServerChecked(d.dailyTasks, d.todayStr, state) });
  };

  const fetchWeekTasks = async (state: Record<string, string[]>) => {
    const d = await fetch('/api/week-tasks').then(r => r.json());
    const enriched: Record<string, WeekDay> = {};
    for (const [date, day] of Object.entries(d.days as Record<string, WeekDay>)) {
      enriched[date] = { ...day, tasks: applyServerChecked(day.tasks, date, state) };
    }
    setWeekTasks(enriched);
  };

  useEffect(() => {
    const init = async () => {
      const [rosterData, state] = await Promise.all([
        fetch('/api/roster').then(r => r.json()).catch(() => ({ shifts: [] })),
        fetchServerState(),
      ]);
      setShifts(rosterData.shifts || []);
      await Promise.all([fetchDashboard(state).catch(() => {}), fetchWeekTasks(state).catch(() => {})]);
      fetch('/api/costings').then(r => r.json()).then(d => setCostings(d.products || [])).catch(() => {});
      fetchTaskContext().catch(() => {});
      setLoading(false);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (claudePanel) setTimeout(() => claudeMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [claudePanel?.messages.length, claudePanel]);

  const syncCheckedState = (blockId: string, date: string, checked: boolean) => {
    setServerState(prev => {
      const next = { ...prev };
      if (checked) { next[date] = [...new Set([...(next[date] || []), blockId])]; }
      else { next[date] = (next[date] || []).filter(id => id !== blockId); if (!next[date].length) delete next[date]; }
      return next;
    });
    fetch('/api/checked-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, date, checked }) }).catch(() => {});
  };

  const handleSelectDay = (date: string) => setSelectedDate(prev => prev === date ? null : date);

  const handleDeleteTask = async (blockId: string, section: 'daily' | 'week', date?: string) => {
    if (section === 'daily') setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(t => t.id !== blockId) } : prev);
    else if (section === 'week' && date) setWeekTasks(prev => ({ ...prev, [date]: { ...prev[date], count: prev[date].count - 1, tasks: prev[date].tasks.filter(t => t.id !== blockId) } }));
    await fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) });
  };

  const handleAddTask = async (date: string, text: string) => {
    await fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, text }) });
    const state = await fetchServerState();
    await fetchWeekTasks(state);
    if (date === todayStr) await fetchDashboard(state);
  };

  const handleMoveToDay = async (blockId: string, text: string, targetDate: string, isRecurring?: boolean, fromDate?: string, category?: string) => {
    const sourceDate = fromDate ?? todayStr;
    if (sourceDate === todayStr) {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(task => task.id !== blockId) } : prev);
    } else {
      setWeekTasks(prev => ({ ...prev, [sourceDate]: { ...prev[sourceDate], count: prev[sourceDate].count - 1, tasks: prev[sourceDate].tasks.filter(t => t.id !== blockId) } }));
    }
    const ops: Promise<Response>[] = [
      fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: targetDate, text, category }) }),
    ];
    if (!isRecurring) {
      ops.push(fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) }));
    }
    await Promise.all(ops);
    const state = await fetchServerState();
    await fetchWeekTasks(state);
  };

  const handleDeferToTomorrow = async (blockId: string, text: string, isRecurring?: boolean) => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const t = new Date(y, m - 1, d + 1);
    const tomorrowStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(task => task.id !== blockId) } : prev);
    const ops: Promise<Response>[] = [
      fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: tomorrowStr, text }) }),
    ];
    // Only delete the Notion block for one-time (date-prefixed) tasks.
    // Recurring tasks (no prefix, [F], [M]) must stay in Notion so they reappear next cycle.
    if (!isRecurring) {
      ops.push(fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) }));
    }
    await Promise.all(ops);
    const state = await fetchServerState();
    await fetchWeekTasks(state);
  };

  const handleClaudeChat = async (panel: ClaudePanelState, userMessage: string) => {
    const newMsgs: ClaudeMessage[] = [...panel.messages, { role: 'user', content: userMessage }];
    setClaudePanel(prev => prev ? { ...prev, messages: newMsgs } : prev);
    setClaudeInput('');
    setClaudeLoading(true);
    try {
      const res = await fetch('/api/claude-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: newMsgs, projectName: panel.projectName, actionText: panel.actionText }) });
      const d = await res.json();
      setClaudePanel(prev => prev ? { ...prev, messages: [...newMsgs, { role: 'assistant', content: d.content }] } : prev);
    } catch {
      setClaudePanel(prev => prev ? { ...prev, messages: [...newMsgs, { role: 'assistant', content: 'Something went wrong. Check ANTHROPIC_API_KEY is set in Vercel.' }] } : prev);
    }
    setClaudeLoading(false);
  };

  const openClaudePanel = (project: Project, todo: Todo) => {
    const firstMsgs: ClaudeMessage[] = [{ role: 'user', content: `Help me with this action item: "${todo.text}"` }];
    setClaudePanel({ projectId: project.id, projectName: project.name, actionText: todo.text, messages: firstMsgs });
    setClaudeInput('');
    setClaudeLoading(true);
    fetch('/api/claude-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: firstMsgs, projectName: project.name, actionText: todo.text }) })
      .then(r => r.json())
      .then(d => { setClaudePanel(prev => prev ? { ...prev, messages: [...firstMsgs, { role: 'assistant', content: d.content }] } : prev); setClaudeLoading(false); })
      .catch(() => { setClaudePanel(prev => prev ? { ...prev, messages: [...firstMsgs, { role: 'assistant', content: 'Could not reach Claude. Check ANTHROPIC_API_KEY in Vercel.' }] } : prev); setClaudeLoading(false); });
  };

  const STATUS_CYCLE = ['In Progress', 'Blocked', 'On Hold', 'Done'];
  const handleStatusChange = async (projectId: string, currentStatus: string) => {
    const idx = STATUS_CYCLE.indexOf(currentStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setData(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === projectId ? { ...p, status: next } : p) } : prev);
    if (next === 'Done') setTimeout(() => setData(prev => prev ? { ...prev, projects: prev.projects.filter(p => p.id !== projectId) } : prev), 600);
    await fetch('/api/project-status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, status: next }) });
  };

  const handleAddProjectAction = async (projectId: string, text: string) => {
    if (!text.trim()) return;
    await fetch('/api/add-project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, text: text.trim() }) });
    const state = await fetchServerState();
    await fetchDashboard(state);
    setAddingActionFor(null);
    setNewActionText('');
  };

  const toggleTodo = async (blockId: string, checked: boolean, section: 'daily' | 'project' | 'personal' | 'week', projectId?: string, date?: string) => {
    if (blockId.startsWith('header-')) return;
    if (section === 'daily') {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
      syncCheckedState(blockId, todayStr, checked);
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

  const handlePromote = async () => {
    if (!projectName.trim()) return;
    setPromoting(true);
    await fetch('/api/braindump', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName, nextActions, ideaText: braindump }) });
    const state = await fetchServerState();
    await fetchDashboard(state);
    setBraindump(''); setProjectName(''); setNextActions(['', '', '']); setShowPromote(false); setPromoting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #fef9f0 50%, #f0fff4 100%)' }}>
      <p className="text-gray-400 text-xs tracking-widest uppercase animate-pulse">Loading...</p>
    </div>
  );

  if (!data) return null;

  const isViewingOtherDay = selectedDate !== null && selectedDate !== todayStr;
  const displayedTasks = isViewingOtherDay ? (weekTasks[selectedDate!]?.tasks ?? []) : data.dailyTasks;
  const selectedShift = selectedDate ? shifts.find(s => s.date === selectedDate) : null;
  const displayDayLabel = isViewingOtherDay && selectedShift ? selectedShift.label : null;
  const dailyTasks = displayedTasks.filter(t => !t.isHeader);
  const dailyDone = dailyTasks.filter(t => t.checked).length;
  const projectsDone = data.projects.flatMap(p => p.todos).filter(t => t.checked).length;
  const projectsTotal = data.projects.flatMap(p => p.todos).length;

  const CATEGORIES = ['Coffee', 'Food', 'Retail', 'Vending', 'Uncategorised'];

  return (
    <div className="min-h-screen text-gray-900" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
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

      <div className="max-w-5xl mx-auto px-5 pb-10 grid grid-cols-1 md:grid-cols-2 gap-4 relative">

        {/* DAILY TO DO */}
        <Card emoji="⚡" title={displayDayLabel ? `Tasks — ${displayDayLabel}` : 'Daily To Do'}
          headerRight={
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 uppercase tracking-widest">{dailyDone}/{dailyTasks.length} Done</span>
              {isViewingOtherDay && <button onClick={() => setSelectedDate(null)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← Back</button>}
            </div>
          }>
          <div className="space-y-2">
            {displayedTasks.length === 0 ? <p className="text-sm text-gray-400 italic">No tasks {isViewingOtherDay ? 'this day' : 'today'} 🎉</p> : (() => {
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
              // Sort groups by priority, uncategorised last
              groups.sort((a, b) => {
                const ai = CATEGORY_ORDER.indexOf(a.category);
                const bi = CATEGORY_ORDER.indexOf(b.category);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
              });
              // Checked tasks sink to the absolute bottom of the list (across all categories)
              const checkedBucket: { task: typeof displayedTasks[0]; category: string }[] = [];
              const uncheckedGroups = groups.map(g => ({
                ...g,
                tasks: g.tasks.filter(t => { if (t.checked) { checkedBucket.push({ task: t, category: g.category }); return false; } return true; }),
              })).filter(g => g.tasks.length > 0);
              const renderTask = (task: typeof displayedTasks[0], category: string) => (
                <CheckItem key={task.id} id={task.id} text={task.text} checked={task.checked} label={category || undefined} context={taskContext[task.id]} onContextSave={handleContextSave}
                  onChange={(id, checked) => toggleTodo(id, checked, isViewingOtherDay ? 'week' : 'daily', undefined, isViewingOtherDay ? selectedDate! : undefined)}
                  onDelete={!task.isRecurring ? (id) => handleDeleteTask(id, isViewingOtherDay ? 'week' : 'daily', isViewingOtherDay ? selectedDate! : undefined) : undefined}
                  onSwipeRight={() => handleMoveToDay(task.id, task.text, getNextDateStr(isViewingOtherDay ? selectedDate! : todayStr), task.isRecurring, isViewingOtherDay ? selectedDate! : todayStr, category || undefined)}
                  onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ id: task.id, text: task.text, isRecurring: task.isRecurring, fromDate: isViewingOtherDay ? selectedDate! : todayStr, category: category || undefined })); e.dataTransfer.effectAllowed = 'move'; }} />
              );
              return [
                ...uncheckedGroups.flatMap(group => group.tasks.map(task => renderTask(task, group.category))),
                ...checkedBucket.map(({ task, category }) => renderTask(task, category)),
              ];
            })()}
          </div>
        </Card>

        {/* THE WEEK AHEAD */}
        <Card emoji="📅" title="The Week Ahead">
          <div className="space-y-2">
            {shifts.length === 0 ? <p className="text-sm text-gray-400 italic">No shifts found</p> : (
              shifts.map(shift => (
                <RosterRow key={shift.date} shift={shift} isToday={shift.date === todayStr} isHighlighted={selectedDate ? shift.date === selectedDate : shift.date === todayStr} taskCount={weekTasks[shift.date]?.count ?? 0} onAdd={handleAddTask} onSelectDay={handleSelectDay}
                  isDragOver={dragOverDate === shift.date}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDate(shift.date); }}
                  onDragLeave={() => setDragOverDate(null)}
                  onDrop={(e) => { e.preventDefault(); setDragOverDate(null); try { const d = JSON.parse(e.dataTransfer.getData('application/json')); handleMoveToDay(d.id, d.text, shift.date, d.isRecurring, undefined, d.category); } catch { /* ignore */ } }}
                />
              ))
            )}
          </div>
        </Card>

        {/* ONGOING PROJECTS */}
        <Card emoji="🎯" title="Ongoing Projects">
          <span className="text-xs text-gray-400 -mt-2">{projectsDone}/{projectsTotal} actions done</span>
          <div className="space-y-2">
            {data.projects.length === 0 ? <p className="text-sm text-gray-400 italic">No active projects</p> : (
              data.projects.map(project => (
                <div key={project.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900 flex-1">{project.name}</span>
                    <button onClick={() => handleStatusChange(project.id, project.status)} title="Click to cycle status" className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${project.status === 'In Progress' ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : project.status === 'Blocked' ? 'bg-red-100 text-red-600 hover:bg-red-200' : project.status === 'On Hold' ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>{project.status}</button>
                  </div>
                  {project.todos.length === 0 ? <p className="text-xs text-gray-400 italic ml-1">No actions set</p> : (
                    <div className="space-y-2">
                      {project.todos.map(todo => (
                        <CheckItem key={todo.id} id={todo.id} text={todo.text} checked={todo.checked} onChange={(id, checked) => toggleTodo(id, checked, 'project', project.id)} onDelegate={() => openClaudePanel(project, todo)} />
                      ))}
                    </div>
                  )}
                  {addingActionFor === project.id ? (
                    <div className="flex gap-2 mt-2">
                      <input value={newActionText} onChange={e => setNewActionText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddProjectAction(project.id, newActionText); if (e.key === 'Escape') { setAddingActionFor(null); setNewActionText(''); } }} placeholder="New action..." autoFocus className="flex-1 min-w-0 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
                      <button onClick={() => handleAddProjectAction(project.id, newActionText)} disabled={!newActionText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Add</button>
                      <button onClick={() => { setAddingActionFor(null); setNewActionText(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">&times;</button>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingActionFor(project.id); setNewActionText(''); }} className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">+ Add action</button>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* BRAIN DUMP */}
        <Card emoji="🧠" title="Brain Dump">
          {!showPromote ? (
            <div className="space-y-2">
              <textarea value={braindump} onChange={e => setBraindump(e.target.value)} placeholder="Drop an idea..." style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }} className="w-full rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" rows={4} />
              {braindump.trim() && (
                <button onClick={() => { setProjectName(braindump.trim()); setShowPromote(true); }} className="text-xs px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors shadow-sm" style={{ background: '#fbcdad', color: '#333' }}>Move to Projects →</button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 italic">&ldquo;{braindump}&rdquo;</p>
              <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project name" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }} className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              {nextActions.map((action, i) => (
                <input key={i} value={action} onChange={e => { const a = [...nextActions]; a[i] = e.target.value; setNextActions(a); }} placeholder={`Next action ${i + 1}`} style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }} className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={handlePromote} disabled={promoting || !projectName.trim()} className="text-xs disabled:opacity-40 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors shadow-sm" style={{ background: '#fbcdad', color: '#333' }}>{promoting ? 'Creating...' : 'Create Project'}</button>
                <button onClick={() => { setShowPromote(false); setProjectName(''); setNextActions(['', '', '']); }} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 transition-colors font-bold uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}
        </Card>

        {/* PRODUCT COSTINGS — carousel + price changes */}
        <div className="md:col-span-2">
          <CostingsCard costings={costings} />
        </div>

      </div>

      {/* CLAUDE CHAT DRAWER */}
      {claudePanel && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', maxHeight: '52vh' }}>
          <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span className="text-base">🤖</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>Claude</p>
              <p className="text-xs text-gray-400 truncate">{claudePanel.projectName} — {claudePanel.actionText}</p>
            </div>
            <button onClick={() => { setClaudePanel(null); setClaudeInput(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 min-h-0">
            {claudePanel.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-prose rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-gray-800' : 'text-gray-800 bg-white'}`} style={m.role === 'user' ? { background: '#fbcdad' } : { border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  {m.content}
                </div>
              </div>
            ))}
            {claudeLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-2.5 text-sm text-gray-400 animate-pulse bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>Thinking...</div>
              </div>
            )}
            <div ref={claudeMessagesEndRef} />
          </div>
          <div className="flex gap-2 px-5 py-3 shrink-0" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <input value={claudeInput} onChange={e => setClaudeInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && claudeInput.trim() && !claudeLoading) handleClaudeChat(claudePanel, claudeInput); }} placeholder="Ask Claude anything about this task..." className="flex-1 min-w-0 text-sm px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }} />
            <button onClick={() => { if (claudeInput.trim() && !claudeLoading) handleClaudeChat(claudePanel, claudeInput); }} disabled={claudeLoading || !claudeInput.trim()} className="text-sm disabled:opacity-40 px-4 py-2.5 rounded-xl font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}