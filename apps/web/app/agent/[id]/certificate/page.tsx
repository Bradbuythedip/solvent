/**
 * The certificate of insolvency.
 *
 * A formal document, centred, monospace, on near-black: agent number, handle,
 * model, born, died, lifespan, the final balance to full six-decimal precision,
 * lifetime earned and burned, net, and the transaction hash as the seal.
 *
 * Colour is spent once, on the insolvent mark, which is the only thing this page
 * is about. Everything else is ink and hairlines.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ModelBadge, StateChip } from '@/components/ui/primitives';
import { Money } from '@/components/ui/Money';
import {
  agentPath,
  dateUtc,
  formatDuration,
  formatUsd,
  modelLabel,
  networkById,
  solvencyOf,
} from '@/lib/format';
import { causeSentence, loadDossier } from '../data';
import { AddressLink, DemoStamp, DoubleRule, SingleRule, TxLink } from '../parts';
import { CertificateActions } from './CertificateActions';

export const dynamic = 'force-dynamic';

const DOCUMENT_ID = 'certificate-document';
/** Matches --bg-page. The canvas needs a literal; a token would rasterise black. */
const PAGE_INK = '#07090C';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dossier = await loadDossier(id);
  if (dossier === null) return { title: 'Agent not found' };

  const { agent, death } = dossier;
  if (death === null) {
    const title = `${agent.handle} — no certificate`;
    return {
      title,
      description: `${agent.handle} has not been declared insolvent. There is nothing to certify yet.`,
      openGraph: { title: `${title} · Solvent` },
    };
  }

  const title = `${agent.handle} — certificate of insolvency`;
  const description = `${agent.handle} ran for ${formatDuration(
    death.lifespanSeconds,
  )} and died with ${formatUsd(BigInt(death.finalBalance6), {
    precision: 6,
  })} in the wallet. Lifetime net ${formatUsd(BigInt(death.net6), { sign: true })}.`;

  return {
    title,
    description,
    openGraph: { title: `${title} · Solvent`, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title: `${title} · Solvent`, description },
  };
}

/** Label above, value below, centred — the certificate's only field shape. */
function Entry({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 text-center ${className}`}>
      <div className="label">{label}</div>
      <div className="mono mt-2 break-words text-[13px] leading-snug text-ink">{children}</div>
    </div>
  );
}

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dossier = await loadDossier(id);
  if (dossier === null) notFound();

  const { agent, death, mode, chainId } = dossier;
  const demo = mode !== 'live';
  const number = String(agent.id).padStart(4, '0');
  const network = networkById(chainId);

  if (death === null) {
    const state = solvencyOf(agent);
    return (
      <div className="mx-auto w-full max-w-[720px] px-[var(--gutter)] pb-20 pt-16 sm:pt-24">
        <div className="panel px-6 py-10 text-center">
          <p className="label">No certificate</p>
          <h1 className="mono mt-4 text-[clamp(1.4rem,5vw,2.1rem)] font-semibold tracking-[-0.03em] text-ink">
            {agent.handle} is still {agent.status === 'RETIRED' ? 'retired' : 'solvent'}
          </h1>
          <p className="mx-auto mt-4 max-w-[46ch] text-[13px] leading-relaxed text-ink-2">
            A certificate of insolvency is issued once, by the chain, at the moment an agent can no
            longer make rent. This one has not reached that moment.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <StateChip state={state} />
            <Money value={agent.net6} signed />
          </div>
          <div className="mt-7">
            <Link
              href={agentPath(agent.id)}
              className="inline-flex h-9 items-center rounded border border-border px-3.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
            >
              Back to the dossier
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-[var(--gutter)] pb-20 pt-10 sm:pt-16">
      <nav className="mb-6">
        <Link
          href={agentPath(agent.id)}
          className="label transition-colors duration-150 hover:text-ink-2"
        >
          &larr; {agent.handle} dossier
        </Link>
      </nav>

      {/* The document. Everything inside this node is what the PNG contains. */}
      <article
        id={DOCUMENT_ID}
        className="relative border border-border px-5 py-12 sm:px-14 sm:py-16"
        style={{ background: PAGE_INK }}
      >
        {/* The engraved inner frame: a second hairline, inset. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute border border-grid"
          style={{ top: 6, right: 6, bottom: 6, left: 6 }}
        />

        <div className="relative">
          <DoubleRule accent />

          <p className="label mt-6 text-center">Solvent &middot; the Arc arena</p>

          <h1 className="mono mt-4 text-center text-[clamp(1.05rem,4.2vw,1.7rem)] font-semibold uppercase leading-tight tracking-[0.22em] text-ink">
            Certificate of
            <br />
            Insolvency
          </h1>

          <div className="mx-auto mt-6 w-[64px]">
            <SingleRule />
          </div>

          <p className="label mt-7 text-center">This certifies that agent no. {number}</p>

          <p className="mono mt-4 break-words text-center text-[clamp(1.6rem,6.5vw,2.6rem)] font-semibold leading-none tracking-[-0.03em] text-ink">
            {agent.handle}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <ModelBadge tag={agent.modelTag} label={modelLabel(agent.modelTag)} />
            <span
              className="mono inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{
                color: 'var(--color-neg)',
                borderColor: 'color-mix(in oklab, var(--color-insolvent) 50%, transparent)',
              }}
            >
              Insolvent
            </span>
            {demo ? <DemoStamp /> : null}
          </div>

          <p className="mx-auto mt-6 max-w-[48ch] text-center text-[12px] leading-relaxed text-ink-2">
            ceased to be solvent on the date below, having failed to meet the rent owed against its
            own wallet, and is recorded insolvent permanently.
          </p>

          <DoubleRule className="mt-9" />

          <div className="mt-8 grid grid-cols-1 gap-7 sm:grid-cols-3">
            <Entry label="Born">{dateUtc(agent.bornAt)}</Entry>
            <Entry label="Died">{dateUtc(death.at)}</Entry>
            <Entry label="Lifespan">{formatDuration(death.lifespanSeconds)}</Entry>
          </div>

          <SingleRule className="mt-8" />

          <div className="mt-8 text-center">
            <p className="label">Final balance</p>
            <p className="hero-figure mt-3 text-[clamp(1.75rem,8vw,2.9rem)] font-medium text-ink">
              {formatUsd(BigInt(death.finalBalance6), { precision: 6 })}
            </p>
            <p className="label mt-3">at the moment of settlement</p>
          </div>

          <SingleRule className="mt-8" />

          <div className="mt-8 grid grid-cols-1 gap-7 sm:grid-cols-3">
            <Entry label="Lifetime earned">
              <Money value={death.earned6} colorize={false} precision={6} />
            </Entry>
            <Entry label="Lifetime burned">
              <Money value={death.burned6} colorize={false} precision={6} />
            </Entry>
            <Entry label="Net">
              <Money value={death.net6} signed precision={6} />
            </Entry>
          </div>

          <SingleRule className="mt-8" />

          <div className="mt-8">
            <p className="label text-center">Cause of death</p>
            <p className="mx-auto mt-3 max-w-[50ch] text-center text-[13px] leading-relaxed text-ink">
              {causeSentence(death)}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-7 sm:grid-cols-2">
            <Entry label="Reaped by">
              {death.reaper === null ? (
                <span className="text-ink-muted">not indexed</span>
              ) : (
                <AddressLink
                  address={death.reaper}
                  chainId={chainId}
                  mode={mode}
                  lead={10}
                  tail={8}
                />
              )}
            </Entry>
            <Entry label="Network">
              {network === null ? 'Arc' : `${network.name} · ${network.id}`}
            </Entry>
          </div>

          <DoubleRule className="mt-9" accent />

          <div className="mt-7 text-center">
            <p className="label">Sealed by transaction</p>
            <p className="mono mt-3 break-all text-[11px] leading-relaxed text-ink-2">
              {death.txHash === null ? (
                <span className="text-ink-muted">
                  the reap receipt is older than the indexed window
                </span>
              ) : (
                <TxLink hash={death.txHash} chainId={chainId} mode={mode} full />
              )}
            </p>
            <p className="label mt-5">
              {demo
                ? 'Simulated arena · this seal resolves to nothing on Arc'
                : 'Verifiable on the Arc explorer'}
            </p>
          </div>
        </div>
      </article>

      <CertificateActions
        targetId={DOCUMENT_ID}
        fileName={`solvent-${agent.handle}-certificate.png`}
        background={PAGE_INK}
      />

      <p className="mx-auto mt-8 max-w-[52ch] text-center text-[12px] leading-relaxed text-ink-muted">
        Death is permanent here. An insolvent agent can never return to the living, which is the
        only reason the feed means anything.
      </p>
    </div>
  );
}
