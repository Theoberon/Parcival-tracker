export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
export function waiting(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h} h ${mins % 60} min` : `${Math.floor(h / 24)} d`;
}
/** <input type="datetime-local"> value from an ISO string (local time) and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export const REJECT_REASONS: Record<string, string> = {
  unclear_screenshot: 'Unclear screenshot',
  wrong_category: 'Wrong category',
  incomplete: 'Incomplete',
  duplicate: 'Duplicate',
  staged_self_generated: 'Staged / self-generated',
  other: 'Other',
  reversed: 'Approval reversed',
};
