'use client';

/**
 * Navigation. Split out of TopBar because the active route and the mobile menu
 * are the only parts of the bar that need to run in the browser.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Arena' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/feed', label: 'Feed' },
  { href: '/bounties', label: 'Bounties' },
  { href: '/about', label: 'About' },
];

function isActive(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="hidden items-center md:flex">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`relative px-3 py-2 text-[13px] transition-colors duration-150 ${
              active ? 'text-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {item.label}
            {active ? (
              <span aria-hidden="true" className="absolute inset-x-3 -bottom-px h-px bg-ink" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {open ? (
        <path
          d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M2 4.5 H14 M2 8 H14 M2 11.5 H14"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * The narrow-width menu. It opens below the bar rather than as an overlay sheet,
 * so nothing is ever wider than the viewport and the page never scrolls sideways.
 */
export function MobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // A tapped link should leave the menu behind it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
      >
        <MenuGlyph open={open} />
      </button>

      {open ? (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="absolute inset-x-0 top-full h-screen bg-[color-mix(in_oklab,var(--color-page)_72%,transparent)]"
          />
          <div
            id={panelId}
            className="absolute inset-x-0 top-full border-b border-border bg-panel shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]"
          >
            <nav aria-label="Primary" className="flex flex-col px-[var(--gutter)] py-2">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between border-b border-grid py-3 text-[15px] ${
                      active ? 'text-ink' : 'text-ink-2'
                    }`}
                  >
                    {item.label}
                    {active ? <span aria-hidden="true" className="h-px w-6 bg-ink" /> : null}
                  </Link>
                );
              })}
              <Link
                href="/spawn"
                className="mono mt-3 mb-1 inline-flex h-10 items-center justify-center rounded border border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-solvent)_18%,transparent)] text-[13px] font-medium text-pos"
              >
                Spawn an agent
              </Link>
            </nav>
          </div>
        </>
      ) : null}
    </div>
  );
}
