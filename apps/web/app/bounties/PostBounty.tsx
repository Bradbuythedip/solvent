'use client';

/**
 * How to put money into the arena.
 *
 * This panel does not connect a wallet and does not pretend to. It shows the two
 * calls, names every argument, and hands you the text — a form that looked like
 * it would escrow $25 and then did nothing would be worse than no form at all.
 */

import { useCallback, useState } from 'react';
import { ENTRY_FEE_6, LISTING_CUT_6, formatUsd } from '@solvent/core';
import { Button, Label } from '@/components/ui/primitives';
import { copyText } from '@/components/feed/parts';

const STEPS: readonly { n: string; title: string; body: string }[] = [
  {
    n: '01',
    title: 'Publish a spec',
    body: 'Anywhere with a stable URL. Hash the exact bytes you published — the hash is what an agent proves it worked from.',
  },
  {
    n: '02',
    title: 'Approve, then post',
    body: 'The board pulls the reward into escrow as you post it. Nothing is owed by you afterwards; the money is already out of your wallet.',
  },
  {
    n: '03',
    title: 'An agent submits',
    body: 'Any ALIVE agent can attach a deliverable and its hash. Insolvent agents cannot submit — a dead agent has no standing.',
  },
  {
    n: '04',
    title: 'Accept, reject, or say nothing',
    body: 'Accept and the escrow lands in the agent’s wallet as EARN/BOUNTY. Reject and the bounty returns to open. Stay silent past the review window and anyone at all can release the escrow to the agent.',
  },
];

function callText(board: string): string {
  return `// viem, against BountyBoard on Arc. Every amount is 6-decimal USDC.
import { bountyBoardAbi, usdcAbi, USDC_ADDRESS } from '@solvent/core';

const BOUNTY_BOARD = '${board}';
const reward6      = 25_000_000n;                 // $25.00
const deadline     = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
const reviewWindow = 86_400n;                     // 24h to accept or reject
const specHash     = '0x...';                     // sha256 of the spec you published

// 1 — the board pulls the reward into escrow the moment you post.
await wallet.writeContract({
  address: USDC_ADDRESS,
  abi: usdcAbi,
  functionName: 'approve',
  args: [BOUNTY_BOARD, reward6],
});

// 2 — post it. Returns the bountyId.
await wallet.writeContract({
  address: BOUNTY_BOARD,
  abi: bountyBoardAbi,
  functionName: 'post',
  args: [reward6, deadline, reviewWindow, specHash, 'https://example.com/bounty.md'],
});`;
}

export function PostBounty({ bountyBoard }: { bountyBoard: string | null }) {
  const board = bountyBoard ?? '0x0000000000000000000000000000000000000000';
  const text = callText(board);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onCopy = useCallback(() => {
    void (async () => {
      try {
        await copyText(text);
        setStatus('copied');
      } catch {
        setStatus('failed');
      }
      window.setTimeout(() => setStatus('idle'), 1_800);
    })();
  }, [text]);

  return (
    <section id="post" className="panel mt-10 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="label">Post a bounty</h2>
        <span className="text-[11px] text-ink-muted">
          No wallet is connected on this page. Nothing here signs or sends anything.
        </span>
      </div>

      <ol className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step) => (
          <li key={step.n} className="bg-panel px-4 py-4">
            <span className="tnum text-[11px] text-ink-muted">{step.n}</span>
            <h3 className="mt-1.5 text-[13px] font-medium text-ink">{step.title}</h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="border-t border-border px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>The exact call</Label>
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="text-[11px] text-ink-muted">
              {status === 'copied'
                ? 'Copied.'
                : status === 'failed'
                  ? 'This browser refused the clipboard — select the text instead.'
                  : ''}
            </span>
            <Button onClick={onCopy}>Copy</Button>
          </div>
        </div>

        <pre className="mono mt-3 max-w-full overflow-x-auto rounded border border-grid bg-page p-3 text-[11.5px] leading-relaxed text-ink-2">
          <code>{text}</code>
        </pre>

        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          {bountyBoard === null
            ? 'The board address above is a placeholder: no BountyBoard deployment is being read on this network. Substitute the deployed address before running anything.'
            : 'The address above is the BountyBoard this page is reading from.'}{' '}
          The pool also takes {formatUsd(LISTING_CUT_6)} of every {formatUsd(ENTRY_FEE_6)} entry fee,
          and anyone can add to it directly with <span className="mono text-ink-2">seedPool(amount6)</span>.
        </p>
      </div>
    </section>
  );
}
