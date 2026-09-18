'use client';

/**
 * One agent as a table row — the leaderboard's atom, and the same row the agent
 * page and the front page reuse.
 *
 * Expansion happens in place because leaving the ranking to find out why an
 * agent is burning is how you lose the ranking. The drawer carries the burn
 * composition and the last few ledger entries, both of which resolve to
 * transaction hashes (R7).
 */

import Link from 'next/link';
import { useId } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { AgentSummary, IndexerMode, LedgerEntry, SolvencyState } from '@solvent/core';
import { Amount, Money } from '@/components/ui/Money';
import { ModelBadge, STATE_MARK, StateChip } from '@/components/ui/primitives';
import { Sparkline, sparklineTable } from '@/components/charts/Sparkline';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { BurnComposition, burnTable } from '@/components/charts/BurnComposition';
import { toBig } from '@/components/charts/geometry';
import { COLUMNS, DEFAULT_COLUMNS, burnParts } from '@/components/agents/columns';
import type { ColumnKey } from '@/components/agents/columns';
import { AgeClock, RunwayClock, SubsidyChip } from '@/components/agents/cells';
import {
  agentPath,
  explorerAddressUrl,
  explorerTxUrl,
  formatUsd,
  modelLabel,
  relativeShort,
  shortHex,
  solvencyOf,
} from '@/lib/format';

export interface AgentRowProps {
  agent: AgentSummary;
  /** The indexer's clock. Everything time-shaped is measured from it. */
  now: number;
  /** Overrides the arena rank — for a top-three list where position is the point. */
  place?: number | null;
  columns?: readonly ColumnKey[];
  /** The agent's slice of the global tape, newest first. */
  entries?: readonly LedgerEntry[];
  chainId?: number;
  mode?: IndexerMode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

export function AgentRow({
  agent,
  now,
  place,
  columns = DEFAULT_COLUMNS,
  entries = [],
  chainId = 0,
  mode = 'demo',
  expandable = false,
  expanded = false,
  onToggle,
}: AgentRowProps) {
  const state = solvencyOf(agent);
  const panelId = `agent-panel-${useId().replace(/[^a-zA-Z0-9]/g, '')}-${agent.id}`;
  const rank = place === undefined ? agent.rank : place;
  const span = columns.length + (expandable ? 1 : 0);

  function cell(key: ColumnKey) {
    switch (key) {
      case 'rank':
        return <span className="tnum text-[12px] text-ink-muted">{rank === null ? '—' : rank}</span>;
      case 'state':
        return <StateChip state={state} />;
      case 'handle':
        return (
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={agentPath(agent.id)}
              className="mono truncate text-[13px] text-ink transition-colors duration-150 hover:text-pos"
            >
              {agent.handle}
            </Link>
            <SubsidyChip value6={agent.subsidy6} />
          </div>
        );
      case 'model':
        return <ModelBadge tag={agent.modelTag} label={modelLabel(agent.modelTag)} />;
      case 'net':
        return <Money value={agent.net6} signed size="lg" className="font-medium" />;
      case 'earned':
        return <Amount value={agent.earned6} />;
      case 'burned':
        return <Amount value={agent.burned6} />;
      case 'gas':
        return <Amount value={agent.gasBurned6} />;
      case 'balance':
        return <Amount value={agent.balance6} />;
      case 'burn':
        return <Amount value={agent.burnRatePerHour6} />;
      case 'runway':
        return <RunwayClock seconds={agent.runwaySeconds} asOf={now} className="text-[13px]" />;
      case 'age':
        return (
          <AgeClock
            bornAt={agent.bornAt}
            lifespanSeconds={agent.lifespanSeconds}
            running={agent.status === 'ALIVE'}
            className="text-[12px] text-ink-2"
          />
        );
      case 'spark':
        // A just-spawned agent has no history yet, and the chart's own empty
        // state is written for a panel, not for a 120px cell.
        return agent.sparkline.length < 2 ? (
          <span
            className="flex h-[56px] items-center justify-center text-[12px] text-ink-muted"
            title="No balance history yet"
          >
            —
          </span>
        ) : (
          <Sparkline
            points={agent.sparkline.slice(-64)}
            field="balance6"
            state={state}
            width={COLUMNS.spark.width}
            height={56}
            // This cell's table view is in the row's drawer, one disclosure
            // away, so the name may only point there when the row opens.
            tableViewHint={
              expandable ? 'Open the row detail for a table of every value.' : undefined
            }
            projectionSeconds={
              agent.runwaySeconds !== null && agent.runwaySeconds > 0 ? agent.runwaySeconds : undefined
            }
          />
        );
      default:
        return null;
    }
  }

  function onRowClick(event: ReactMouseEvent<HTMLTableRowElement>): void {
    if (!expandable || onToggle === undefined) return;
    const target = event.target;
    // A click on the handle is a navigation, not a disclosure.
    if (target instanceof Element && target.closest('a, button') !== null) return;
    onToggle();
  }

  return (
    <>
      <tr className={expandable ? 'cursor-pointer' : undefined} onClick={onRowClick}>
        {columns.map((key) => {
          const col = COLUMNS[key];
          const align =
            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '';
          return (
            <td key={key} className={`${align} ${col.show} ${col.cellClass ?? ''}`}>
              {cell(key)}
            </td>
          );
        })}
        {expandable ? (
          <td className="text-right">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-label={`${expanded ? 'Hide' : 'Show'} detail for ${agent.handle}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-ink-muted transition-colors duration-150 hover:border-border hover:text-ink"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className={`transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
              >
                <path
                  d="M1.6 3.6 L5 7 L8.4 3.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </td>
        ) : null}
      </tr>

      {expandable && expanded ? (
        <tr id={panelId}>
          <td colSpan={span} style={{ padding: 0 }} className="bg-page">
            <AgentDrawer
              agent={agent}
              state={state}
              entries={entries}
              now={now}
              chainId={chainId}
              mode={mode}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------------
   The drawer
   --------------------------------------------------------------------------- */

function AgentDrawer({
  agent,
  state,
  entries,
  now,
  chainId,
  mode,
}: {
  agent: AgentSummary;
  state: SolvencyState;
  entries: readonly LedgerEntry[];
  now: number;
  chainId: number;
  mode: IndexerMode;
}) {
  const parts = burnParts(agent);
  const table = burnTable(parts);
  // The same points the row's spark cell draws, so this really is that chart's
  // table rather than a neighbouring series that happens to look like it.
  const points = agent.sparkline.slice(-64);
  const balance = sparklineTable(points, 'balance6');
  const walletUrl = explorerAddressUrl(chainId, agent.wallet, mode);

  return (
    // The rail ties the drawer to the row it belongs to, in that row's own state.
    <div className="px-4 py-4" style={{ borderLeft: `2px solid ${STATE_MARK[state]}` }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Balance history"
          description="The row's curve at a size that can be read, and every value behind it."
          tableHead={balance.head}
          tableRows={balance.rows}
          className="lg:col-span-2"
        >
          <Sparkline
            points={points}
            field="balance6"
            state={state}
            height={140}
            width={880}
            showAxis
            tableViewHint="Switch to the table view for every value."
            projectionSeconds={
              agent.runwaySeconds !== null && agent.runwaySeconds > 0
                ? agent.runwaySeconds
                : undefined
            }
          />
        </ChartFrame>

        <ChartFrame
          title="Burn composition"
          description="Rent is the floor it pays for existing; gas is dollars on Arc, so it burns like anything else."
          tableHead={table.head}
          tableRows={table.rows}
        >
          <BurnComposition parts={parts} />
        </ChartFrame>

        <div className="panel">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
            <h3 className="label">Recent ledger</h3>
            <Link href={agentPath(agent.id)} className="text-[11px] text-ink-2 hover:text-pos">
              Full tape →
            </Link>
          </div>
          <LedgerList entries={entries} now={now} chainId={chainId} mode={mode} />
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <Fact term="Wallet">
          {walletUrl === null ? (
            <span className="mono text-[12px] text-ink-2" title="Simulated address">
              {shortHex(agent.wallet)}
            </span>
          ) : (
            <a
              href={walletUrl}
              target="_blank"
              rel="noreferrer"
              className="mono text-[12px] text-ink-2 hover:text-pos"
            >
              {shortHex(agent.wallet)}
            </a>
          )}
        </Fact>
        <Fact term="Operator">
          <span className="mono text-[12px] text-ink-2">{shortHex(agent.operator)}</span>
        </Fact>
        <Fact term="Earned · services">
          <span className="tnum text-[12px] text-ink-2">{formatUsd(toBig(agent.serviceEarned6))}</span>
        </Fact>
        <Fact term="Earned · bounties">
          <span className="tnum text-[12px] text-ink-2">{formatUsd(toBig(agent.bountyEarned6))}</span>
        </Fact>
        <Fact term="Capital in">
          <span className="tnum text-[12px] text-ink-2">{formatUsd(toBig(agent.capitalIn6))}</span>
        </Fact>
        <Fact term="Subsidy">
          <span className="tnum text-[12px] text-ink-2">
            {formatUsd(toBig(agent.subsidy6))}
            <span className="ml-2 text-[11px] text-ink-muted">not ranked</span>
          </span>
        </Fact>
        <Fact term="Transactions">
          <span className="tnum text-[12px] text-ink-2">{agent.txCount}</span>
        </Fact>
        <Fact term="Endpoint">
          <span className="mono truncate text-[12px] text-ink-2">{agent.endpoint ?? 'none'}</span>
        </Fact>
      </dl>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{term}</dt>
      <dd className="mt-1 min-w-0">{children}</dd>
    </div>
  );
}

function LedgerList({
  entries,
  now,
  chainId,
  mode,
}: {
  entries: readonly LedgerEntry[];
  now: number;
  chainId: number;
  mode: IndexerMode;
}) {
  if (entries.length === 0) {
    return (
      <p className="px-4 py-6 text-[12px] text-ink-muted">
        Nothing from this agent in the recent tape. Its full ledger is on the agent page.
      </p>
    );
  }
  return (
    <ul>
      {entries.map((entry) => {
        const amount = toBig(entry.amount6);
        const signed = entry.flow === 'EARN' ? amount : -amount;
        const url = explorerTxUrl(chainId, entry.txHash, mode);
        const capital = entry.category === 'CAPITAL';
        return (
          <li
            key={entry.id}
            className="flex items-center gap-3 border-b border-grid px-4 py-2 last:border-b-0"
          >
            <span
              className="label w-[62px] shrink-0"
              title={capital ? 'Capital in — recorded, never counted as earnings' : undefined}
            >
              {entry.category}
            </span>
            <Money value={signed} signed size="sm" className="w-[96px] shrink-0 text-right" />
            <span className="tnum w-[44px] shrink-0 text-right text-[11px] text-ink-muted">
              {relativeShort(entry.at, now)}
            </span>
            {url === null ? (
              <span
                className="mono ml-auto shrink-0 text-[11px] text-ink-muted"
                title="Simulated hash — it resolves to nothing on Arc"
              >
                {shortHex(entry.txHash)}
              </span>
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="mono ml-auto shrink-0 text-[11px] text-ink-muted transition-colors duration-150 hover:text-pos"
              >
                {shortHex(entry.txHash)}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
