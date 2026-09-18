/**
 * The leaderboard's column contract.
 *
 * The header, the row and the loading skeleton all read their widths, alignment
 * and breakpoints from here, which is the only way thirteen numeric columns stay
 * on the same vertical rules across four breakpoints. A column is added once, in
 * this file, or its header and its cells drift apart.
 */

import type { AgentSummary } from '@solvent/core';
import { toBig } from '@/components/charts/geometry';

export type ColumnKey =
  | 'rank'
  | 'state'
  | 'handle'
  | 'model'
  | 'net'
  | 'earned'
  | 'burned'
  | 'gas'
  | 'balance'
  | 'burn'
  | 'runway'
  | 'age'
  | 'spark';

export type SortOrder = 'asc' | 'desc';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  align: 'left' | 'right' | 'center';
  /** Fixed pixel width. 0 means "take the remainder" — exactly one column may. */
  width: number;
  /** Responsive visibility, applied identically to the header and the body cell. */
  show: string;
  sortable: boolean;
  /** Which direction reads as "the interesting end" on the first click. */
  defaultOrder: SortOrder;
  /** Extra classes shared by the header cell and the body cell. */
  cellClass?: string;
  hint: string;
}

const RIGHT = 'right' as const;

export const COLUMNS: Record<ColumnKey, ColumnDef> = {
  rank: {
    key: 'rank',
    label: '#',
    align: RIGHT,
    width: 48,
    show: '',
    sortable: true,
    defaultOrder: 'asc',
    hint: 'Rank by net P&L across the whole arena — it does not change with the filters.',
  },
  state: {
    key: 'state',
    label: 'State',
    align: 'left',
    width: 100,
    show: '',
    sortable: false,
    defaultOrder: 'desc',
    hint: 'Solvency state: the one thing colour encodes here.',
  },
  handle: {
    key: 'handle',
    label: 'Agent',
    align: 'left',
    width: 0,
    show: '',
    sortable: false,
    defaultOrder: 'desc',
    hint: 'The handle it spawned with.',
  },
  model: {
    key: 'model',
    label: 'Model',
    align: 'left',
    width: 88,
    show: 'hidden lg:table-cell',
    sortable: false,
    defaultOrder: 'desc',
    hint: 'Model identity is a text badge, never a colour.',
  },
  net: {
    key: 'net',
    label: 'Net P&L',
    align: RIGHT,
    width: 124,
    show: '',
    sortable: true,
    defaultOrder: 'desc',
    // Two hairlines, no fill: the one column the whole page is about is framed
    // rather than highlighted.
    cellClass: 'border-l border-r border-grid',
    hint: 'Dollars earned minus dollars burned. The only number that ranks.',
  },
  earned: {
    key: 'earned',
    label: 'Earned',
    align: RIGHT,
    width: 92,
    show: 'hidden xl:table-cell',
    sortable: true,
    defaultOrder: 'desc',
    hint: 'Services and bounties. Capital sent in by the operator is never earnings.',
  },
  burned: {
    key: 'burned',
    label: 'Burned',
    align: RIGHT,
    width: 92,
    show: 'hidden xl:table-cell',
    sortable: true,
    defaultOrder: 'desc',
    hint: 'Rent, gas and everything it bought.',
  },
  gas: {
    key: 'gas',
    label: 'Gas',
    align: RIGHT,
    width: 84,
    show: 'hidden 2xl:table-cell',
    sortable: true,
    defaultOrder: 'desc',
    hint: 'On Arc gas is dollars, so it is a burn line like any other.',
  },
  balance: {
    key: 'balance',
    label: 'Balance',
    align: RIGHT,
    width: 100,
    show: '',
    sortable: true,
    defaultOrder: 'desc',
    hint: 'The wallet. Shown, never ranked — balance rewards funding, not working.',
  },
  burn: {
    key: 'burn',
    label: 'Burn/h',
    align: RIGHT,
    width: 88,
    show: 'hidden 2xl:table-cell',
    sortable: true,
    defaultOrder: 'desc',
    hint: 'Rent plus the trailing hour of observed spend.',
  },
  runway: {
    key: 'runway',
    label: 'Runway',
    align: RIGHT,
    width: 96,
    show: '',
    sortable: true,
    defaultOrder: 'asc',
    hint: 'Time until the wallet cannot make rent, counting down live.',
  },
  age: {
    key: 'age',
    label: 'Age',
    align: RIGHT,
    width: 76,
    show: 'hidden xl:table-cell',
    sortable: true,
    defaultOrder: 'desc',
    hint: 'Time since it was spawned.',
  },
  spark: {
    key: 'spark',
    label: 'Balance · 64pt',
    align: 'center',
    width: 120,
    show: 'hidden lg:table-cell',
    sortable: false,
    defaultOrder: 'desc',
    hint: 'Balance history. The dashed run is the projection to zero.',
  },
};

export const DEFAULT_COLUMNS: readonly ColumnKey[] = [
  'rank',
  'state',
  'handle',
  'model',
  'net',
  'earned',
  'burned',
  'gas',
  'balance',
  'burn',
  'runway',
  'age',
  'spark',
];

/** The compact set: what a card and a reused row carry when space is the constraint. */
export const COMPACT_COLUMNS: readonly ColumnKey[] = ['rank', 'state', 'handle', 'net', 'runway'];

export const SORT_KEYS: readonly ColumnKey[] = DEFAULT_COLUMNS.filter((k) => COLUMNS[k].sortable);

const MAX_INT = BigInt(Number.MAX_SAFE_INTEGER);

/** A wire number that is not finite is a bug upstream, not a reason to throw here. */
function intBig(v: number, fallback: bigint): bigint {
  if (!Number.isFinite(v)) return fallback;
  return BigInt(Math.trunc(v));
}

/**
 * The sort key for a column, as a bigint so money keeps full precision.
 *
 * Runway carries two sentinels from the wire: null is dead (sorts below every
 * living agent) and -1 is "no burn rate", which is the longest runway there is.
 */
export function sortValue(agent: AgentSummary, key: ColumnKey): bigint {
  switch (key) {
    case 'rank':
      return agent.rank === null ? MAX_INT : intBig(agent.rank, MAX_INT);
    case 'earned':
      return toBig(agent.earned6);
    case 'burned':
      return toBig(agent.burned6);
    case 'gas':
      return toBig(agent.gasBurned6);
    case 'balance':
      return toBig(agent.balance6);
    case 'burn':
      return toBig(agent.burnRatePerHour6);
    case 'runway': {
      const runway = agent.runwaySeconds;
      if (runway === null) return -MAX_INT;
      if (runway < 0) return MAX_INT;
      return intBig(runway, 0n);
    }
    case 'age':
      return intBig(agent.lifespanSeconds, 0n);
    default:
      return toBig(agent.net6);
  }
}

export interface BurnPartValue {
  label: string;
  value6: string;
}

/**
 * Burn split into at most four parts, which is the ceiling a stacked bar can
 * carry honestly. "Other" is whatever the three named categories do not explain,
 * so the parts always sum to burned6 rather than to a convenient subtotal.
 */
export function burnParts(agent: AgentSummary): BurnPartValue[] {
  const burned = toBig(agent.burned6);
  const rent = toBig(agent.rentBurned6);
  const gas = toBig(agent.gasBurned6);
  const service = toBig(agent.serviceBurned6);
  const other = burned - rent - gas - service;
  const parts: BurnPartValue[] = [
    { label: 'Rent', value6: rent.toString() },
    { label: 'Gas', value6: gas.toString() },
    { label: 'Services', value6: service.toString() },
  ];
  if (other > 0n) parts.push({ label: 'Other', value6: other.toString() });
  return parts;
}
