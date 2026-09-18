import type { ReactNode } from 'react';
import { Container } from '@/components/ui/primitives';

/**
 * One numbered band of the front page. The rule above the heading is the only
 * separator the page uses — sections are told apart by space, not by boxes.
 */
export function Section({
  id,
  index,
  title,
  blurb,
  action,
  children,
}: {
  id: string;
  index: string;
  title: string;
  blurb?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 pt-12 sm:pt-16">
      <Container>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-border pt-5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tnum text-[11px] text-ink-muted">{index}</span>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {blurb ? <p className="text-[12px] text-ink-muted">{blurb}</p> : null}
          </div>
          {action}
        </div>
        <div className="mt-5">{children}</div>
      </Container>
    </section>
  );
}
