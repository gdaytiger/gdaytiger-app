// ─────────────────────────────────────────────────────────────────────────────
// SHARED WIDGET PRIMITIVES — the building blocks every TigerOS widget composes
// from, so they read as one consistent set. Styling comes from the design tokens
// and .glass / .pill classes in globals.css — never hardcode brand colours, blur,
// or shadow here. See the widget-anatomy page in the Second Brain vault.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';

type GlassVariant = 'default' | 'strong' | 'peach' | 'danger';

const VARIANT_CLASS: Record<GlassVariant, string> = {
  default: 'glass',
  strong: 'glass-strong',
  peach: 'glass glass-peach',
  danger: 'glass glass-danger',
};

// Frosted surface — the canonical look for tiles and panels. `variant="strong"`
// is the big widget container; `peach` / `danger` are tinted; `active` adds the
// selected-ring. Renders a <div> by default; pass `as` for a button etc.
export function GlassPanel({
  variant = 'default',
  active = false,
  rounded = 'rounded-2xl',
  className = '',
  style,
  children,
  ...rest
}: {
  variant?: GlassVariant;
  active?: boolean;
  rounded?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const cls = [VARIANT_CLASS[variant], active ? 'glass-active' : '', rounded, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={style} {...rest}>
      {children}
    </div>
  );
}

// Small uppercase status chip — NEW SKU, counts, statuses. `tone` recolours it;
// default is the brand peach badge defined by .pill.
export function Pill({
  tone = 'brand',
  className = '',
  style,
  children,
}: {
  tone?: 'brand' | 'danger' | 'success' | 'muted';
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const toneStyle: React.CSSProperties =
    tone === 'danger' ? { background: 'rgba(220,38,38,0.12)', color: 'var(--color-danger-deep)' }
    : tone === 'success' ? { background: 'rgba(22,163,74,0.12)', color: 'var(--color-success)' }
    : tone === 'muted' ? { background: 'rgba(0,0,0,0.06)', color: 'var(--color-ink-label)' }
    : {}; // brand: inherit .pill defaults
  return (
    <span className={`pill text-[10px] px-1.5 py-0.5 ${className}`} style={{ ...toneStyle, ...style }}>
      {children}
    </span>
  );
}

// Widget header row — icon + uppercase title, optional right-hand slot. Matches
// the Card header so standalone sections line up with full widgets.
export function WidgetHeader({
  icon,
  title,
  right,
  className = '',
}: {
  icon?: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 shrink-0 ${className}`}>
      {icon}
      <span
        className="text-xs font-bold tracking-widest uppercase"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--color-ink-label)' }}
      >
        {title}
      </span>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}
