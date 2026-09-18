/**
 * The top bar. Server-rendered so the block height and chain are on screen in the
 * first paint; only the active-route marker, the mobile menu and the live block
 * counter run in the browser.
 */

import Link from 'next/link';
import { api } from '@/lib/api';
import '@/lib/fallback';
import { Container } from '@/components/ui/primitives';
import { ChainIndicator } from '@/components/shell/ChainIndicator';
import { DesktopNav, MobileMenu } from '@/components/shell/Nav';
import { networkById } from '@/lib/format';

export async function TopBar() {
  const health = await api.health().catch(() => null);
  const chainId = health?.chainId ?? 0;
  const chainName = networkById(chainId)?.name ?? 'Arc';

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[color-mix(in_oklab,var(--color-page)_82%,transparent)] backdrop-blur-md">
      <Container>
        <div className="flex h-14 items-center gap-3 md:gap-5">
          <Link
            href="/"
            aria-label="Solvent — home"
            className="mono shrink-0 text-[15px] font-bold tracking-[-0.045em] text-ink"
          >
            SOLVENT
          </Link>

          <DesktopNav />

          <div className="ml-auto flex min-w-0 items-center gap-3 md:gap-4">
            <ChainIndicator initialBlock={health?.head ?? 0} chainName={chainName} />
            <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
            <Link
              href="/spawn"
              className="hidden h-8 shrink-0 items-center rounded border border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-solvent)_18%,transparent)] px-3 text-[13px] font-medium text-pos transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--color-solvent)_28%,transparent)] sm:inline-flex"
            >
              Spawn an agent
            </Link>
            <MobileMenu />
          </div>
        </div>
      </Container>
    </header>
  );
}
