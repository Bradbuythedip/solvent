import type { ReactNode } from 'react';

/* ---------------------------------------------------------------------------
   Layout primitives
   --------------------------------------------------------------------------- */

export function Container({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1400px] px-[var(--gutter)] ${className}`}>{children}</div>
  );
}

export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
}) {
  return <Tag className={`panel ${className}`}>{children}</Tag>;
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex items-baseline gap-3">
        <h2 className="label">{title}</h2>
        {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`label ${className}`}>{children}</span>;
}

export function Hairline({ className = '' }: { className?: string }) {
  return <hr className={`rule ${className}`} />;
}

/* ---------------------------------------------------------------------------
   Solvency state — the ONE thing colour encodes in this product.
   Every state carries a shape AND a word, never colour alone.
   --------------------------------------------------------------------------- */

import type { SolvencyState } from '@solvent/core';

export const STATE_INK: Record<SolvencyState, string> = {
  solvent: 'var(--color-pos)',
  burning: 'var(--color-ink-2)',
  dying: 'var(--color-warn)',
  dead: 'var(--color-neg)',
  retired: 'var(--color-ink-muted)',
};

export const STATE_MARK: Record<SolvencyState, string> = {
  solvent: 'var(--color-solvent)',
  burning: 'var(--color-ink-muted)',
  dying: 'var(--color-dying)',
  dead: 'var(--color-insolvent)',
  retired: 'var(--color-border-strong)',
};

export const STATE_WORD: Record<SolvencyState, string> = {
  solvent: 'Solvent',
  burning: 'Burning',
  dying: 'Dying',
  dead: 'Insolvent',
  retired: 'Retired',
};

/**
 * The state glyph. Shape is the redundant channel that survives colour-blindness,
 * greyscale print, and forced-colors:
 *   solvent  ● filled circle
 *   burning  ◐ half circle
 *   dying    ▲ triangle
 *   dead     ✕ cross
 *   retired  ○ hollow circle
 */
export function StateDot({ state, size = 8 }: { state: SolvencyState; size?: number }) {
  const color = STATE_MARK[state];
  const s = size;
  const common = { width: s, height: s, viewBox: '0 0 8 8', 'aria-hidden': true as const };
  if (state === 'dead') {
    return (
      <svg {...common} className="shrink-0">
        <path d="M1.4 1.4 L6.6 6.6 M6.6 1.4 L1.4 6.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'dying') {
    return (
      <svg {...common} className="shrink-0">
        <path d="M4 0.6 L7.6 7.2 H0.4 Z" fill={color} />
      </svg>
    );
  }
  if (state === 'retired') {
    return (
      <svg {...common} className="shrink-0">
        <circle cx="4" cy="4" r="2.8" fill="none" stroke={color} strokeWidth="1.4" />
      </svg>
    );
  }
  if (state === 'burning') {
    return (
      <svg {...common} className="shrink-0">
        <circle cx="4" cy="4" r="3.2" fill="none" stroke={color} strokeWidth="1.3" />
        <path d="M4 0.8 A3.2 3.2 0 0 1 4 7.2 Z" fill={color} />
      </svg>
    );
  }
  return (
    <svg {...common} className="shrink-0">
      <circle cx="4" cy="4" r="3.2" fill={color} />
    </svg>
  );
}

export function StateChip({ state, className = '' }: { state: SolvencyState; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={{ color: STATE_INK[state] }}
    >
      <StateDot state={state} />
      {STATE_WORD[state]}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Model badge — text, never a hue. Colour belongs to solvency.
   --------------------------------------------------------------------------- */

export function ModelBadge({ tag, label }: { tag: string; label: string }) {
  return (
    <span
      title={tag}
      className="mono inline-flex items-center rounded border border-border bg-raised px-1.5 py-0.5 text-[11px] text-ink-2"
    >
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Buttons & links
   --------------------------------------------------------------------------- */

export function Button({
  children,
  variant = 'ghost',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:opacity-40';
  const styles =
    variant === 'primary'
      ? 'bg-[color-mix(in_oklab,var(--color-solvent)_18%,transparent)] text-pos border border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-solvent)_28%,transparent)]'
      : 'border border-border text-ink-2 hover:border-border-strong hover:text-ink';
  return (
    <button className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}
