#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// DESIGN-DRIFT GUARDRAIL
// Fails if a component reintroduces a hardcoded brand colour or the frosted-glass
// shadow recipe inline, instead of using the design tokens. This is what keeps
// every widget on one design language over time.
//   • Brand colours  → use a token: bg-brand-peach / var(--color-brand-peach)
//   • Glass surfaces → use .glass / .glass-strong, <GlassPanel>, or the
//                      glass*Style objects from app/lib/theme.ts
// Tokens are DEFINED in app/globals.css and app/lib/theme.ts — those files, plus
// this script, are exempt. Run: npm run check:design
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = 'app';
const EXEMPT = new Set(['theme.ts', 'globals.css']); // token definitions live here

// Hex forms of the tokenised brand palette — must be referenced via tokens.
const BRAND_HEX = /#(fbcdad|fed7aa|7c2d12|7c4a2d|dc2626|7f1d1d|16a34a|d97706|6b7280|9ca3af)\b/i;
// The frosted-glass inset highlight — signature of an inline glass recipe.
const GLASS_SHADOW = /inset 0 1px 0 rgba\(255, ?255, ?255, ?0\.(8|6)\)/;

function walk(dir) {
  let files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files = files.concat(walk(p));
    else if (/\.(tsx?|css)$/.test(name)) files.push(p);
  }
  return files;
}

const violations = [];
for (const file of walk(ROOT)) {
  if (EXEMPT.has(basename(file))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // <meta name="theme-color"> needs a literal hex — HTML attrs can't use CSS vars.
    if (/theme-color/.test(line)) return;
    if (BRAND_HEX.test(line)) violations.push([file, i + 1, 'raw brand hex — use a colour token', line.trim()]);
    if (GLASS_SHADOW.test(line)) violations.push([file, i + 1, 'inline glass recipe — use .glass / glassTileStyle', line.trim()]);
  });
}

if (violations.length) {
  console.error(`\n✖ Design-drift check failed (${violations.length} issue${violations.length > 1 ? 's' : ''}):\n`);
  for (const [file, ln, why, src] of violations) {
    console.error(`  ${file}:${ln}  ${why}`);
    console.error(`      ${src.slice(0, 100)}`);
  }
  console.error('\nFix: reference a token instead of hardcoding. See the widget-anatomy page in the vault.\n');
  process.exit(1);
}
console.log('✓ Design tokens: no drift — all brand colours and glass surfaces use tokens.');
