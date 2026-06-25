// ─────────────────────────────────────────────────────────────────────────────
// THEME — inline-style counterparts to the .glass classes in globals.css.
// These reference the SAME CSS custom properties, so there is one source of
// truth: change a --glass-* token in globals.css and both the classes and these
// objects update together. Use these when you need to spread the frosted look
// into an existing inline `style={{ ... }}`; use the .glass classes (or the
// <GlassPanel> primitive) when styling via className. Never hardcode the recipe.
// ─────────────────────────────────────────────────────────────────────────────
import type { CSSProperties } from 'react';

// Standard frosted tile — the default surface for tiles and cards.
export const glassTileStyle: CSSProperties = {
  background: 'var(--glass-fill)',
  backdropFilter: 'var(--glass-blur)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  border: 'var(--glass-border)',
  boxShadow: 'var(--glass-shadow)',
};

// Strong frosted panel — the big widget container (heavier blur + drop shadow).
export const glassStrongStyle: CSSProperties = {
  background: 'var(--glass-fill)',
  backdropFilter: 'var(--glass-blur-strong)',
  WebkitBackdropFilter: 'var(--glass-blur-strong)',
  border: 'var(--glass-border)',
  boxShadow: 'var(--glass-shadow-lg)',
};

// Peach-tinted tile — used for NEW SKU / supplier-price prompts.
export const glassPeachStyle: CSSProperties = {
  background: 'var(--glass-fill-peach)',
  backdropFilter: 'var(--glass-blur)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  border: 'var(--glass-border)',
  boxShadow: 'var(--glass-shadow-soft)',
};

// Danger-tinted tile — used for pack-size / alert banners.
export const glassDangerStyle: CSSProperties = {
  background: 'var(--glass-fill-danger)',
  backdropFilter: 'var(--glass-blur)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  border: 'var(--glass-border)',
  boxShadow: 'var(--glass-shadow-soft)',
};
