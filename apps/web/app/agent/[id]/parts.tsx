/**
 * Small presentational pieces shared by the dossier and the certificate.
 *
 * No hooks and no state, so a server component and a client component can both
 * import this module.
 */

import type { ReactNode } from 'react';
import type { IndexerMode } from '@solvent/core';
import { explorerAddressUrl, explorerTxUrl, shortHex } from '@/lib/format';

/**
 * A hash or address is a receipt, so it links to the explorer — except in demo
 * mode, where it was minted from a seed and resolves to nothing. There it is
 * plain text with a title that says so, rather than a link to a 404 that would
 * look like proof (SPEC 5.2).
 */
export function HexLink({
  value,
  href,
  text,
  className = '',
}: {
  value: string;
  href: string | null;
  text: string;
  className?: string;
}) {
  if (href === null) {
    return (
      <span
        title={`${value} — simulated, resolves to nothing on Arc`}
        className={`mono text-ink-muted ${className}`}
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
      title={value}
      className={`mono text-ink-2 underline decoration-border underline-offset-[3px] transition-colors duration-150 hover:text-pos hover:decoration-[color-mix(in_oklab,var(--color-pos)_60%,transparent)] ${className}`}
    >
      {text}
    </a>
  );
}

export function AddressLink({
  address,
  chainId,
  mode,
  lead = 6,
  tail = 4,
  className = '',
}: {
  address: string;
  chainId: number;
  mode: IndexerMode;
  lead?: number;
  tail?: number;
  className?: string;
}) {
  return (
    <HexLink
      value={address}
      href={explorerAddressUrl(chainId, address, mode)}
      text={shortHex(address, lead, tail)}
      className={className}
    />
  );
}

export function TxLink({
  hash,
  chainId,
  mode,
  full = false,
  className = '',
}: {
  hash: string;
  chainId: number;
  mode: IndexerMode;
  full?: boolean;
  className?: string;
}) {
  return (
    <HexLink
      value={hash}
      href={explorerTxUrl(chainId, hash, mode)}
      text={full ? hash : shortHex(hash, 8, 6)}
      className={className}
    />
  );
}

/** Label above, value below. The unit of this page's header grid. */
export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="label">{label}</div>
      <div className="mt-1.5 truncate text-[13px] text-ink">{children}</div>
    </div>
  );
}

/**
 * The DEMO marker, repeated on any surface that can be screenshotted or shared
 * away from the status bar. Simulated dollars are never presented as real.
 */
export function DemoStamp({ className = '' }: { className?: string }) {
  return (
    <span
      className={`mono inline-flex items-center rounded-[3px] border px-1.5 py-[3px] text-[10px] font-bold tracking-[0.18em] ${className}`}
      style={{
        color: 'var(--color-warn)',
        borderColor: 'color-mix(in oklab, var(--color-warn) 45%, transparent)',
        background: 'color-mix(in oklab, var(--color-warn) 12%, transparent)',
      }}
    >
      DEMO
    </span>
  );
}

/**
 * The engraved rule: a hairline, a gap, a second hairline. Two borders on one
 * element rather than two elements, so it cannot break across a flex gap.
 */
export function DoubleRule({
  className = '',
  accent = false,
}: {
  className?: string;
  accent?: boolean;
}) {
  const tone = accent
    ? 'color-mix(in oklab, var(--color-insolvent) 55%, transparent)'
    : 'var(--color-border)';
  return (
    <div
      aria-hidden="true"
      className={`h-[3px] w-full ${className}`}
      style={{ borderTop: `1px solid ${tone}`, borderBottom: `1px solid ${tone}` }}
    />
  );
}

/** A single hairline, for the inner divisions of the certificate. */
export function SingleRule({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`h-px w-full bg-border ${className}`} />;
}
