'use client';

/**
 * Share controls for the certificate.
 *
 * The PNG is made by serialising the certificate's own DOM: the node is cloned,
 * every computed style that matters is written onto the clone as an inline
 * declaration, the result is wrapped in an SVG foreignObject and drawn to a
 * canvas. No dependency, and what you download is exactly what is on screen.
 *
 * A data-URL SVG is rendered as an isolated image, so it cannot reach out for
 * the webfont; the faces the page already loaded are inlined as base64 when the
 * browser will hand them over, and otherwise the document falls back to the
 * system monospace, which is the same shape of thing.
 *
 * Every step can fail — Safari has broken foreignObject rasterisation more than
 * once, canvas.toBlob can return null, and a cross-origin stylesheet throws on
 * access. All of it is wrapped, and failure degrades to copying the link, which
 * is the thing most people wanted anyway.
 */

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';

/**
 * Longhands only: getComputedStyle resolves var(), color-mix() and relative
 * units here, but returns an empty string for several shorthands.
 */
const STYLE_PROPS: readonly string[] = [
  'box-sizing',
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'width',
  'min-width',
  'max-width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'background-color',
  'color',
  'opacity',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant-numeric',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'white-space',
  'word-break',
  'overflow-wrap',
  'vertical-align',
];

/** Bounds on the font inlining, so a share button can never become a download. */
const MAX_FONT_FILES = 4;
const MAX_FONT_BYTES = 600_000;
const FONT_TIMEOUT_MS = 3_000;
const SCALE = 2;

function inlineStyles(source: Element, clone: Element): void {
  if (source instanceof HTMLElement && clone instanceof HTMLElement) {
    const computed = window.getComputedStyle(source);
    let css = '';
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value !== '') css += `${prop}:${value};`;
    }
    clone.setAttribute('style', css);
    clone.removeAttribute('class');
  }
  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < sourceChildren.length; i++) {
    const from = sourceChildren[i];
    const to = cloneChildren[i];
    if (from === undefined || to === undefined) continue;
    inlineStyles(from, to);
  }
}

async function toDataUrl(url: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_FONT_BYTES) return null;
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:font/woff2;base64,${window.btoa(binary)}`;
}

/**
 * The @font-face rules for the families this node actually uses, with their
 * sources inlined. Latin only — next/font emits one face per subset and the rest
 * would double the file for glyphs a certificate never prints.
 */
async function fontCss(node: HTMLElement): Promise<string> {
  const families = window.getComputedStyle(node).getPropertyValue('font-family').toLowerCase();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FONT_TIMEOUT_MS);
  const out: string[] = [];

  try {
    const sheets = Array.from(document.styleSheets);
    const wanted: CSSFontFaceRule[] = [];

    for (const sheet of sheets) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet
      }
      if (rules === null) continue;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').toLowerCase();
        if (family === '' || !families.includes(family)) continue;
        const range = rule.style.getPropertyValue('unicode-range');
        if (range !== '' && !range.includes('U+0000') && !range.includes('U+00')) continue;
        wanted.push(rule);
        if (wanted.length >= MAX_FONT_FILES) break;
      }
      if (wanted.length >= MAX_FONT_FILES) break;
    }

    for (const rule of wanted) {
      const src = rule.style.getPropertyValue('src');
      const match = /url\(["']?([^"')]+)["']?\)/.exec(src);
      const href = match?.[1];
      if (href === undefined) continue;
      const absolute = new URL(href, document.baseURI);
      if (absolute.origin !== window.location.origin) continue;
      const data = await toDataUrl(absolute.href, controller.signal);
      if (data === null) continue;
      const family = rule.style.getPropertyValue('font-family');
      const weight = rule.style.getPropertyValue('font-weight') || 'normal';
      out.push(
        `@font-face{font-family:${family};font-style:normal;font-weight:${weight};src:url(${data}) format("woff2");}`,
      );
    }
  } catch {
    return '';
  } finally {
    window.clearTimeout(timer);
  }

  return out.join('');
}

function download(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

async function copyText(text: string): Promise<void> {
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

type Status = 'idle' | 'rendering' | 'copied' | 'saved' | 'degraded' | 'failed';

const MESSAGE: Record<Status, string> = {
  idle: '',
  rendering: 'Rendering the certificate…',
  copied: 'Link copied.',
  saved: 'Saved as PNG.',
  degraded: 'This browser would not rasterise the document. The link is copied instead.',
  failed: 'Nothing could be copied. Use the address bar.',
};

export function CertificateActions({
  targetId,
  fileName,
  background,
}: {
  targetId: string;
  fileName: string;
  /** Painted under the document so the PNG is never transparent. */
  background: string;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const busy = useRef(false);

  const onCopy = useCallback(async () => {
    try {
      await copyText(window.location.href);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }, []);

  const onDownload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus('rendering');
    try {
      const node = document.getElementById(targetId);
      if (node === null) throw new Error('no certificate on the page');

      const rect = node.getBoundingClientRect();
      const width = Math.max(1, Math.ceil(rect.width));
      const height = Math.max(1, Math.ceil(rect.height));

      const clone = node.cloneNode(true) as HTMLElement;
      inlineStyles(node, clone);
      clone.style.width = `${width}px`;
      clone.style.margin = '0';

      const faces = await fontCss(node);
      const markup = new XMLSerializer().serializeToString(clone);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<style>${faces}</style>` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>` +
        `</foreignObject></svg>`;

      const image = new Image();
      image.decoding = 'sync';
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('the browser refused the serialised document'));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });

      const canvas = document.createElement('canvas');
      canvas.width = width * SCALE;
      canvas.height = height * SCALE;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.drawImage(image, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png');
      });
      if (blob === null) throw new Error('canvas produced nothing');

      download(blob, fileName);
      setStatus('saved');
    } catch {
      try {
        await copyText(window.location.href);
        setStatus('degraded');
      } catch {
        setStatus('failed');
      }
    } finally {
      busy.current = false;
    }
  }, [background, fileName, targetId]);

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button onClick={onCopy}>Copy link</Button>
      <Button variant="primary" onClick={onDownload} disabled={status === 'rendering'}>
        {status === 'rendering' ? 'Rendering…' : 'Download as PNG'}
      </Button>
      <p aria-live="polite" className="w-full text-center text-[11px] text-ink-muted">
        {MESSAGE[status]}
      </p>
    </div>
  );
}
