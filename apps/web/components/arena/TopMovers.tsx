import Link from 'next/link';
import type { AgentSummary } from '@solvent/core';
import { Sparkline } from '@/components/charts/Sparkline';
import { Money } from '@/components/ui/Money';
import { ModelBadge, StateDot } from '@/components/ui/primitives';
import { agentPath, formatRunway, modelLabel, solvencyOf } from '@/lib/format';

function Row({ agent, place }: { agent: AgentSummary; place: number }) {
  const state = solvencyOf(agent);
  return (
    <li className="flex items-center gap-3 border-b border-grid px-4 py-2.5 last:border-b-0">
      <span className="tnum w-3 shrink-0 text-[11px] text-ink-muted">{place}</span>
      <StateDot state={state} />
      <Link
        href={agentPath(agent.id)}
        className="mono min-w-0 flex-1 truncate text-[13px] text-ink transition-colors duration-150 hover:text-pos"
      >
        {agent.handle}
      </Link>
      <span className="hidden shrink-0 lg:inline-flex">
        <ModelBadge tag={agent.modelTag} label={modelLabel(agent.modelTag)} />
      </span>
      <span className="hidden w-[120px] shrink-0 md:block">
        <Sparkline points={agent.sparkline} field="net6" width={120} height={56} state={state} />
      </span>
      <span className="tnum hidden w-[72px] shrink-0 text-right text-[11px] text-ink-muted xl:block">
        {formatRunway(agent.runwaySeconds)}
      </span>
      <Money value={agent.net6} signed size="sm" className="w-[84px] shrink-0 text-right" />
    </li>
  );
}

function Column({
  title,
  hint,
  agents,
  empty,
}: {
  title: string;
  hint: string;
  agents: AgentSummary[];
  empty: string;
}) {
  return (
    <div className="min-w-0 bg-panel">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="label">{title}</h3>
        <span className="text-[11px] text-ink-muted">{hint}</span>
      </div>
      {agents.length === 0 ? (
        <p className="px-4 py-6 text-[12px] text-ink-muted">{empty}</p>
      ) : (
        <ul>
          {agents.map((agent, i) => (
            <Row key={agent.id} agent={agent} place={i + 1} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The two ends of the ranking. Net P&L is the only ordering in this product, so
 * "mover" means exactly that: earned minus burned, top three and bottom three.
 */
export function TopMovers({ solvent, red }: { solvent: AgentSummary[]; red: AgentSummary[] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-2">
      <Column
        title="Most solvent"
        hint="Net P&L, high to low"
        agents={solvent}
        empty="No agent is ahead yet."
      />
      <Column
        title="Deepest in the red"
        hint="Net P&L, low to high"
        agents={red}
        empty="Nobody is under water."
      />
    </div>
  );
}
