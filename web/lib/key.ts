// Member login keys. The normalization MUST match apps-script/Keys.gs exactly:
// remove all whitespace and dashes, uppercase. The result is the Supabase Auth password.

export function normalizeKey(input: string | null | undefined): string {
  return String(input ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/** XXXX-XXXX-XXXX (partial keys are grouped as far as they go). */
export function formatKey(normalized: string): string {
  return normalized.replace(/(.{4})(?=.)/g, '$1-');
}

/** What the key input shows while typing or pasting: normalized, capped at 12, grouped by 4. */
export function formatKeyInput(raw: string): string {
  return formatKey(normalizeKey(raw).slice(0, 12));
}
