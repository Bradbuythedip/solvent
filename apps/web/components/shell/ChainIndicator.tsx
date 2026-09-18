'use client';

/**
 * The live chain indicator: is anything actually moving out there.
 *
 * The block height arrives with the server render and is then carried forward by
 * the stream. With no indexer the dot goes hollow, the height stays where the
 * server left it, and nothing else changes — which is the honest picture.
 */

import { StateDot } from '@/components/ui/primitives';
import { useStream } from '@/lib/stream';
import { formatBlock } from '@/lib/format';

export function ChainIndicator({
  initialBlock,
  chainName,
}: {
  initialBlock: number;
  chainName: string;
}) {
  const { stats, connected } = useStream();
  const block = stats?.blockNumber ?? initialBlock;

  return (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      title={`${chainName} · block ${formatBlock(block)} · ${connected ? 'streaming' : 'not streaming'}`}
    >
      <span className={`inline-flex ${connected ? 'pulse' : ''}`}>
        <StateDot state={connected ? 'solvent' : 'retired'} />
      </span>
      <span className="label hidden lg:inline">Block</span>
      <span className="tnum text-[12px] text-ink-2">{formatBlock(block)}</span>
      <span className="sr-only">
        {connected ? 'Live: streaming from the indexer.' : 'Not streaming. Showing the last indexed state.'}
      </span>
    </span>
  );
}
