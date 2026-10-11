import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('glass-panel rounded-2xl border p-4 sm:p-5', className)}>{children}</section>;
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-base font-semibold text-slate-900">{children}</h2>;
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-sky-300 text-slate-950 shadow-sm shadow-sky-950/30 hover:bg-sky-200 disabled:bg-white/5 disabled:text-slate-400',
  secondary: 'border border-slate-300 bg-slate-950/55 text-slate-800 hover:bg-white/5 disabled:text-slate-500',
  danger: 'bg-red-500/90 text-white hover:bg-red-400 disabled:bg-red-950 disabled:text-red-300',
  ghost: 'text-slate-600 hover:bg-white/5 disabled:text-slate-400',
};

export function Button({ variant = 'primary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={cx('neo-control inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 disabled:cursor-not-allowed', VARIANTS[variant], className)}
    />
  );
}

const FIELD = 'neo-inset block w-full rounded-xl border border-slate-300/80 bg-slate-950/55 px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-sky-300/70 focus:outline-none focus:ring-2 focus:ring-sky-300/20 disabled:bg-white/5 disabled:text-slate-500 sm:text-sm';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(FIELD, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(FIELD, props.className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

const TONES = {
  info: 'border-sky-300/25 bg-sky-300/8 text-sky-100',
  warn: 'border-amber-300/25 bg-amber-300/8 text-amber-100',
  error: 'border-red-300/25 bg-red-300/8 text-red-100',
  success: 'border-emerald-300/25 bg-emerald-300/8 text-emerald-100',
};
export function Alert({ tone = 'info', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl border px-4 py-3 text-sm leading-relaxed', TONES[tone])}>{children}</div>;
}

const BADGES: Record<string, string> = {
  pending: 'border border-amber-300/20 bg-amber-300/10 text-amber-100',
  approved: 'border border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
  rejected: 'border border-red-300/20 bg-red-300/10 text-red-100',
  reversed: 'border border-red-300/20 bg-red-300/10 text-red-100',
  withdrawn: 'border border-slate-300/15 bg-white/5 text-slate-500',
  draft: 'border border-slate-300/15 bg-white/5 text-slate-500',
  flag: 'border border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100',
  neutral: 'border border-slate-300/15 bg-white/5 text-slate-600',
};
export function Badge({ kind = 'neutral', children }: { kind?: string; children: ReactNode }) {
  return <span className={cx('inline-block rounded-full px-2.5 py-1 text-xs font-medium', BADGES[kind] ?? BADGES.neutral)}>{children}</span>;
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cx('mx-auto w-full flex-1 space-y-5 px-4 py-6 sm:py-9', wide ? 'max-w-5xl' : 'max-w-2xl')}>{children}</main>;
}
