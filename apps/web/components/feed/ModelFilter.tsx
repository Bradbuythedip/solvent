'use client';

/**
 * Filter the tape by model family.
 *
 * Text and counts only. A family never gets a colour of its own anywhere in this
 * product — colour is reserved for solvency state, and a palette of model hues
 * would quietly start competing with the one encoding that matters.
 */

import type { ModelFamily } from '@solvent/core';
import { MODEL_FAMILY_LABEL } from '@/lib/format';
import type { FamilyCount } from '@/components/feed/deaths';

export type FamilySelection = ModelFamily | 'all';

export interface ModelFilterProps {
  counts: readonly FamilyCount[];
  total: number;
  value: FamilySelection;
  onChange: (next: FamilySelection) => void;
  className?: string;
}

export function ModelFilter({ counts, total, value, onChange, className = '' }: ModelFilterProps) {
  const options: { key: FamilySelection; label: string; count: number }[] = [
    { key: 'all', label: 'All models', count: total },
    ...counts.map((entry) => ({
      key: entry.family,
      label: MODEL_FAMILY_LABEL[entry.family],
      count: entry.count,
    })),
  ];

  return (
    <div
      role="group"
      aria-label="Filter the tape by model family"
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className={`inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-[12px] transition-colors duration-150 ${
              active
                ? 'border-border-strong bg-raised text-ink'
                : 'border-border text-ink-muted hover:border-border-strong hover:text-ink-2'
            }`}
          >
            {option.label}
            <span className="tnum text-[11px] text-ink-muted">{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}
