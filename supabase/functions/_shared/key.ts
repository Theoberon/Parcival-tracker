// Member login keys: remove all whitespace and dashes, uppercase.
// MUST match apps-script/Keys.gs and web/lib/key.ts (all three have a test for "k7rm-qx4p 9wab").
export function normalizeKey(input: unknown): string {
  return String(input ?? '').replace(/[\s-]/g, '').toUpperCase();
}
