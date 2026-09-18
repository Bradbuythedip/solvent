/**
 * One agent as a card — what the row becomes when there is no room for thirteen
 * columns, and what any list outside the leaderboard reaches for.
 *
 * It carries the five things that matter at a glance: where it ranks, whether it
 * is still alive, who it is, its net P&L, and how long it has left. Everything
 * else is one tap away on the agent page.
 */

import Link from 'next/link';
import type { AgentSummary } from '@solvent/core';
import { Money } from '@/components/ui/Money';
import { ModelBadge, StateChip } from '@/components/ui/primitives';
import { RunwayClock, SubsidyChip } from '@/components/agents/cells';
import { agentPath, modelLabel, solvencyOf } from '@/lib/format';

export interface AgentCardProps {
  agent: AgentSummary;
  /** The indexer's clock, so the countdown starts from the measured runway. */
  now: number;
  /** Overrides the arena rank when position in a short list is the point. */
  place?: number | null;
  className?: string;
}

export function AgentCard({ agent, now, place, className = '' }: AgentCardProps) {
  const state = solvencyOf(agent);
  const rank = place === undefined ? agent.rank : place;

  return (
    <Link
      href={agentPath(agent.id)}
      className={`panel block px-3.5 py-3 transition-colors duration-150 hover:border-border-strong ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="tnum shrink-0 text-[12px] text-ink-muted">{rank === null ? '—' : rank}</span>
        <StateChip state={state} />
        <span className="ml-auto shrink-0">
          <ModelBadge tag={agent.modelTag} label={modelLabel(agent.modelTag)} />
        </span>
      </div>

      <div className="mt-2.5 flex min-w-0 items-center gap-2">
        <span className="mono truncate text-[14px] text-ink">{agent.handle}</span>
        <SubsidyChip value6={agent.subsidy6} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-grid pt-3">
        <span className="min-w-0">
          <span className="label block">Net P&L</span>
          <Money value={agent.net6} signed size="lg" className="mt-1 block font-medium" />
        </span>
        <span className="min-w-0 text-right">
          <span className="label block">Runway</span>
          <RunwayClock seconds={agent.runwaySeconds} asOf={now} className="mt-1 text-[13px]" />
        </span>
      </div>
    </Link>
  );
}
