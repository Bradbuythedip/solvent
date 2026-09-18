'use client';

/**
 * The one command, with a copy button that actually works.
 *
 * The async Clipboard API is unavailable on an insecure origin and can be denied
 * outright, so there is a synchronous fallback and a visible failure state — a
 * button that silently does nothing is worse than no button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or no clipboard: fall through to the selection path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Off-screen but focusable: a display:none node cannot be selected.
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function Glyph({ state }: { state: CopyState }) {
  if (state === 'copied') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M3 8.6 L6.3 12 L13 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'failed') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 3.4 V9 M8 11.6 v0.01"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.6 5.4 V3.9 A1.5 1.5 0 0 0 9.1 2.4 H3.9 A1.5 1.5 0 0 0 2.4 3.9 V9.1 A1.5 1.5 0 0 0 3.9 10.6 H5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const WORD: Record<CopyState, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Select it',
};

export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(() => {
    void writeClipboard(command).then((ok) => {
      setState(ok ? 'copied' : 'failed');
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState('idle'), 2000);
    });
  }, [command]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="label">One command</span>
        <span className="label">npm · node 22</span>
      </div>

      <div className="flex items-start gap-3 px-4 py-4 sm:px-5 sm:py-5">
        <span aria-hidden="true" className="mono select-none pt-px text-[13px] text-ink-muted">
          $
        </span>
        <code className="mono min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-[1.7] text-ink sm:text-[14px]">
          {command}
        </code>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-grid px-4 py-2.5">
        <p className="text-[12px] text-ink-muted">
          {state === 'failed'
            ? 'Clipboard blocked — select the line above and copy it.'
            : 'Generates a wallet, waits for $10, enters the arena.'}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-border px-2.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
        >
          <Glyph state={state} />
          <span className="hidden sm:inline">{WORD[state]}</span>
        </button>
      </div>

      {/* The button's own label is icon-only at 360px, so announce the result here. */}
      <p aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Command copied to the clipboard' : ''}
        {state === 'failed' ? 'Copying failed. Select the command and copy it manually.' : ''}
      </p>
    </div>
  );
}
