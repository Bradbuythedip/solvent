/**
 * The share card, shared by the dossier route and the certificate route.
 *
 * A dead agent previews as its certificate of insolvency; a living one previews
 * as its dossier with the projection to zero, because a link to a living agent
 * is a link to a countdown.
 *
 * Satori has only the font next/og bundles, so this file uses no webfont, no
 * remote fetch and no CSS variables — hierarchy comes from size, letterspacing
 * and the same three inks the site uses. Every div that holds more than one
 * child declares display:flex, which Satori requires.
 *
 * Not named opengraph-image: Next does not hand a parent segment's image file
 * down to a nested route, so both routes declare their own and call in here.
 */

import { ImageResponse } from 'next/og';
import { formatDuration, formatUsd, modelLabel, shortHex } from '@/lib/format';
import { loadDossier } from './data';

export const OG_SIZE = { width: 1200, height: 630 };

const INK = '#E8E9ED';
const INK_2 = '#A7AFBC';
const INK_MUTED = '#6B7484';
const PAGE = '#07090C';
const BORDER = '#2A3142';
const GRID = '#1C2230';
const INSOLVENT = '#C9304A';
const SOLVENT = '#00A6C0';
const NEG = '#FF7A90';
const POS = '#3DE0F5';
const WARN = '#F5B94A';

const LABEL = {
  fontSize: 15,
  letterSpacing: 3,
  textTransform: 'uppercase' as const,
  color: INK_MUTED,
};

function Rules({ color, marginTop }: { color: string; marginTop: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginTop }}>
      <div style={{ width: '100%', height: 1, backgroundColor: color }} />
      <div style={{ width: '100%', height: 1, backgroundColor: color, marginTop: 3 }} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ ...LABEL, fontSize: 13, letterSpacing: 2.4 }}>{label}</div>
      <div style={{ fontSize: 34, color, marginTop: 10, letterSpacing: -0.5 }}>{value}</div>
    </div>
  );
}

export async function renderAgentOgImage(rawId: string): Promise<ImageResponse> {
  const dossier = await loadDossier(rawId);

  if (dossier === null) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: PAGE,
            color: INK,
          }}
        >
          <div style={{ ...LABEL, fontSize: 18 }}>Solvent</div>
          <div style={{ fontSize: 56, marginTop: 20 }}>No such agent</div>
        </div>
      ),
      OG_SIZE,
    );
  }

  const { agent, death, mode } = dossier;
  const demo = mode !== 'live';
  const dead = death !== null;
  const accent = dead ? INSOLVENT : SOLVENT;
  const number = String(agent.id).padStart(4, '0');

  const net = BigInt(agent.net6);
  const balance6 = death === null ? agent.balance6 : death.finalBalance6;
  const lifespan = death === null ? agent.lifespanSeconds : death.lifespanSeconds;
  const runway = agent.runwaySeconds;

  const handleSize = agent.handle.length > 22 ? 62 : agent.handle.length > 15 ? 78 : 94;

  const footer = dead
    ? death.txHash === null
      ? 'Reap receipt older than the indexed window'
      : `Sealed by ${shortHex(death.txHash, 14, 10)}`
    : runway === null || runway < 0
      ? 'No burn rate — the projection has no zero crossing'
      : `Projected insolvency in ${formatDuration(runway)}`;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: PAGE,
          color: INK,
        }}
      >
        <div style={{ width: '100%', height: 6, backgroundColor: accent }} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            margin: 34,
            border: `1px solid ${BORDER}`,
            padding: '38px 56px 34px 56px',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <div style={{ ...LABEL, fontSize: 17, letterSpacing: 5, color: INK }}>Solvent</div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              {demo ? (
                <div
                  style={{
                    fontSize: 13,
                    letterSpacing: 3,
                    color: WARN,
                    border: `1px solid ${WARN}`,
                    padding: '4px 10px',
                    marginRight: 16,
                  }}
                >
                  DEMO
                </div>
              ) : null}
              <div style={{ ...LABEL, fontSize: 14 }}>{`Agent no. ${number}`}</div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <div style={{ ...LABEL, fontSize: 16, letterSpacing: 6, color: dead ? NEG : INK_MUTED }}>
              {dead ? 'Certificate of insolvency' : 'Live agent'}
            </div>

            <div
              style={{
                fontSize: handleSize,
                letterSpacing: -3,
                marginTop: 18,
                color: INK,
              }}
            >
              {agent.handle}
            </div>

            <div style={{ fontSize: 20, color: INK_2, marginTop: 16 }}>
              {`${modelLabel(agent.modelTag)} · ${
                dead ? `lived ${formatDuration(lifespan)}` : `alive ${formatDuration(lifespan)}`
              }`}
            </div>

            <Rules color={GRID} marginTop={30} />

            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                width: '100%',
                marginTop: 30,
              }}
            >
              {/* Six decimals is the point on a certificate — an agent dies
                  owing fractions of a cent. On a living card it is just noise
                  beside three adaptive figures. */}
              <Stat
                label={dead ? 'Final balance' : 'Balance'}
                value={
                  dead
                    ? formatUsd(BigInt(balance6), { precision: 6 })
                    : formatUsd(BigInt(balance6))
                }
                color={INK}
              />
              <Stat label="Earned" value={formatUsd(BigInt(agent.earned6))} color={INK_2} />
              <Stat label="Burned" value={formatUsd(BigInt(agent.burned6))} color={INK_2} />
              <Stat
                label="Net"
                value={formatUsd(net, { sign: true })}
                color={net > 0n ? POS : net < 0n ? NEG : INK}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              borderTop: `1px solid ${GRID}`,
              paddingTop: 20,
            }}
          >
            <div style={{ fontSize: 16, color: INK_MUTED }}>{footer}</div>
            <div style={{ ...LABEL, fontSize: 13 }}>Earned minus burned. Nothing else.</div>
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
