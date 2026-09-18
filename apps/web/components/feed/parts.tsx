'use client';

/**
 * The cells the tape is built from.
 *
 * Two rules do most of the work here. A hash that resolves to nothing is never a
 * link, because a link to a 404 looks exactly like a receipt. And a final balance
 * is printed to all six decimals, always: the whole point of this feed is that an
 * agent died at 03:41 holding $0.006123, and rounding that to $0.01 would delete
 * the only interesting thing about it.
 */

import { useCallback, useState } from 'react';
import { formatUsd } from '@solvent/core';
import type { IndexerMode } from '@solvent/core';
import { explorerAddressUrl, explorerTxUrl, shortHex } from '@/lib/format';
import { toBig } from '@/components/charts/geometry';

/* ---------------------------------------------------------------------------
   Money at full resolution
   --------------------------------------------------------------------------- */

/**
 * A balance at the full six decimals USDC actually has, with the trailing zeros
 * recessed so the significant digits still read at a glance. The zeros stay on
 * screen because the column has to align digit-for-digit down the tape.
 */
export function FinalBalance({ value6, className = '' }: { value6: string; className?: string }) {
  const text = formatUsd(toBig(value6), { precision: 6 });
  const head = text.slice(0, -6);
  const fraction = text.slice(-6);
  const trailing = /0*$/.exec(fraction)?.[0] ?? '';
  const significant = fraction.slice(0, fraction.length - trailing.length);

  return (
    <span className={`tnum text-ink ${className}`}>
      {head}
      {significant}
      {trailing === '' ? null : <span className="text-ink-muted">{trailing}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Onchain references
   --------------------------------------------------------------------------- */

export function TxLink({
  hash,
  chainId,
  mode,
  className = '',
}: {
  hash: string;
  chainId: number;
  mode: IndexerMode;
  className?: string;
}) {
  const href = explorerTxUrl(chainId, hash, mode);
  const text = shortHex(hash, 6, 4);
  if (href === null) {
    return (
      <span
        className={`mono text-ink-muted ${className}`}
        title="Simulated — this hash resolves to nothing on Arc"
      >
        {text}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`${hash} — open on the Arc explorer`}
      className={`mono text-ink-muted transition-colors duration-150 hover:text-ink ${className}`}
    >
      {text}
    </a>
  );
}

export function AddressLink({
  address,
  chainId,
  mode,
  title,
  className = '',
}: {
  address: string;
  chainId: number;
  mode: IndexerMode;
  title?: string;
  className?: string;
}) {
  const href = explorerAddressUrl(chainId, address, mode);
  const text = shortHex(address, 6, 4);
  if (href === null) {
    return (
      <span
        className={`mono text-ink-muted ${className}`}
        title={title ?? 'Simulated — this address exists only in the demo arena'}
      >
        {text}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title ?? address}
      className={`mono text-ink-muted transition-colors duration-150 hover:text-ink ${className}`}
    >
      {text}
    </a>
  );
}

/* ---------------------------------------------------------------------------
   Copying
   --------------------------------------------------------------------------- */

/** Clipboard API where it exists, a selected textarea where it does not. Throws. */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && typeof navigator.clipboard?.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand('copy');
  field.remove();
  if (!ok) throw new Error('copy rejected');
}

type CopyStatus = 'idle' | 'copied' | 'failed';

/**
 * Per-row share control. The URL is resolved at click time rather than at render,
 * so the server and the browser never disagree about the origin.
 */
export function CopyLink({
  path,
  label,
  className = '',
}: {
  /** Absolute path on this site, e.g. /agent/17/certificate. */
  path: string;
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<CopyStatus>('idle');

  const onClick = useCallback(() => {
    void (async () => {
      try {
        await copyText(new URL(path, window.location.origin).href);
        setStatus('copied');
      } catch {
        setStatus('failed');
      }
      window.setTimeout(() => setStatus('idle'), 1_800);
    })();
  }, [path]);

  return (
    <button
      type="button"
      onClick={onClick}
      title={status === 'failed' ? 'This browser refused the clipboard' : label}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-transparent text-ink-muted transition-colors duration-150 hover:border-border hover:text-ink ${className}`}
    >
      <span className="sr-only">{status === 'copied' ? 'Link copied' : label}</span>
      {status === 'idle' ? (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M4.6 7.4 L7.4 4.6 M5.2 2.6 L6.4 1.4 A2.3 2.3 0 0 1 10.6 5.6 L9.4 6.8 M6.8 9.4 L5.6 10.6 A2.3 2.3 0 0 1 1.4 6.4 L2.6 5.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      ) : status === 'copied' ? (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 6.4 L4.6 9 L10 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span aria-hidden="true" className="text-[11px] leading-none">
          !
        </span>
      )}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   Honesty markers
   --------------------------------------------------------------------------- */

/**
 * SPEC 5.2: whenever the numbers are simulated, the page says so. Rendered for
 * any mode that is not exactly "live", including "no idea, nothing answered".
 */
export function DemoChip({ mode }: { mode: IndexerMode }) {
  if (mode === 'live') return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-[3px] text-[10px] font-bold tracking-[0.18em]"
      style={{
        color: 'var(--color-warn)',
        borderColor: 'color-mix(in oklab, var(--color-warn) 45%, transparent)',
        background: 'color-mix(in oklab, var(--color-warn) 12%, transparent)',
      }}
      title="Simulated arena — these dollars are not real and these hashes resolve to nothing"
    >
      DEMO
    </span>
  );
}

/** The socket's state, as a shape and a word. Colour stays out of it. */
export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${connected ? 'pulse' : ''}`}
        style={{ background: connected ? 'var(--color-solvent)' : 'var(--color-border-strong)' }}
      />
      {connected ? 'Live' : 'Not streaming'}
    </span>
  );
}
