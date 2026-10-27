// Notion caps a single rich_text item at 2,000 characters. JSON state blocks
// (checked-state, task-order, task-context) outgrow that, and Notion then rejects
// the whole PATCH with a 400 — silently, because the old writers didn't check.
// Split into ≤1,900-char items (100 items max = ~190k chars). Readers already
// join every rich_text item's plain_text, so no read-side change is needed.
export function chunkRichText(content: string) {
  const chunks: { type: 'text'; text: { content: string } }[] = [];
  for (let i = 0; i < content.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: content.slice(i, i + 1900) } });
  }
  return chunks.length ? chunks : [{ type: 'text' as const, text: { content: '' } }];
}
