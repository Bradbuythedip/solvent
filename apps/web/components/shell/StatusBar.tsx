/**
 * The status line at the foot of every page.
 *
 * It is the one thing on screen that says whether these dollars are real. When
 * the mode is anything but "live" it carries the DEMO chip (SPEC 5.2), and it
 * defaults to demo when nothing answered — the failure mode must never be a page
 * that quietly claims to be live.
 */

import { api } from '@/lib/api';
import '@/lib/fallback';
import { Container } from '@/components/ui/primitives';
import { StatusBarLive } from '@/components/shell/StatusBarLive';
import type { StatusSnapshot } from '@/components/shell/StatusBarLive';
import { networkById } from '@/lib/format';

export async function StatusBar() {
  const [health, stats] = await Promise.all([
    api.health().catch(() => null),
    api.stats().catch(() => null),
  ]);

  const chainId = health?.chainId ?? stats?.chainId ?? 0;
  const initial: StatusSnapshot = {
    mode: health?.mode ?? 'demo',
    chainId,
    chainName: networkById(chainId)?.name ?? 'Unknown chain',
    head: health?.head ?? 0,
    block: stats?.blockNumber ?? health?.head ?? 0,
    lag: health?.lag ?? 0,
    alive: stats?.agentsAlive ?? 0,
    dead: stats?.agentsDead ?? 0,
  };

  return (
    <footer className="sticky bottom-0 z-30 border-t border-border bg-[color-mix(in_oklab,var(--color-page)_88%,transparent)] backdrop-blur-md">
      <Container>
        <StatusBarLive initial={initial} />
      </Container>
    </footer>
  );
}
