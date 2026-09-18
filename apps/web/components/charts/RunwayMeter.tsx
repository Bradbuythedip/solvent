import { formatDuration, formatRunway } from '@solvent/core';
import type { SolvencyState } from '@solvent/core';
import { STATE_INK, STATE_MARK, STATE_WORD, StateDot } from '@/components/ui/primitives';
import { clamp } from '@/components/charts/geometry';

/** Matches solvencyOf() in @solvent/core: under six hours of runway is dying. */
const DYING_SECONDS = 6 * 3600;
const CRITICAL_SECONDS = 3600;

export interface RunwayMeterProps {
  /** Seconds of runway. -1 is the wire encoding for "no burn rate". */
  seconds: number;
  maxSeconds?: number;
  label?: string;
  className?: string;
}

function severityOf(seconds: number): SolvencyState {
  if (seconds < 0) return 'solvent';
  if (seconds < CRITICAL_SECONDS) return 'dead';
  if (seconds < DYING_SECONDS) return 'dying';
  return 'solvent';
}

/**
 * One value with a severity, so it is a meter and not a chart.
 *
 * The fill runs solvent -> dying -> insolvent as the runway shortens and the
 * unfilled track is the darkest step of the runway ramp, so the bar reads as one
 * object in two states rather than a coloured stub floating in a grey slot. The
 * duration is always written out and the state is always spelled as a word with
 * its shape, because a bar that is merely shorter and merely redder tells a
 * colour-blind reader nothing.
 *
 * Deliberately not an svg: a meter is one rectangle, and CSS gives exact 4px
 * radii and a minimum visible width at any container size without a viewBox in
 * between. It renders on the server with no JavaScript at all.
 */
export function RunwayMeter({
  seconds,
  maxSeconds = 86_400,
  label,
  className = '',
}: RunwayMeterProps) {
  const infinite = seconds < 0;
  const max = maxSeconds > 0 ? maxSeconds : 86_400;
  const value = infinite ? max : Math.max(0, Math.floor(seconds));
  const severity = severityOf(seconds);
  const pct = infinite ? 100 : clamp(value / max, 0, 1) * 100;
  const text = formatRunway(infinite ? -1 : value);

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">{label ?? 'Runway'}</span>
        <span className="tnum text-[13px] font-medium" style={{ color: STATE_INK[severity] }}>
          {text}
        </span>
      </div>

      <div
        role="meter"
        aria-label={label ?? 'Runway'}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={infinite ? max : value}
        aria-valuetext={`${text} of runway, ${STATE_WORD[severity].toLowerCase()}`}
        className="relative mt-2 h-2.5 w-full overflow-hidden rounded-[4px]"
        style={{ background: 'var(--color-runway-1)' }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            minWidth: pct > 0 ? 6 : 0,
            background: STATE_MARK[severity],
            borderRadius: '0 4px 4px 0',
          }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: STATE_INK[severity] }}>
          <StateDot state={severity} />
          {infinite ? 'No burn' : STATE_WORD[severity]}
        </span>
        <span className="label">of {formatDuration(max)}</span>
      </div>
    </div>
  );
}

export function runwayTable(
  seconds: number,
  maxSeconds = 86_400,
): { head: string[]; rows: string[][] } {
  const severity = severityOf(seconds);
  return {
    head: ['Measure', 'Value'],
    rows: [
      ['Runway left', formatRunway(seconds)],
      ['Scale', formatDuration(maxSeconds)],
      ['State', seconds < 0 ? 'No burn' : STATE_WORD[severity]],
    ],
  };
}
