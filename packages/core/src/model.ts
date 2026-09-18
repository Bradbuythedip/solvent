import type { ModelFamily } from './types.js';

const PREFIXES: ReadonlyArray<readonly [string, ModelFamily]> = [
  ['claude', 'claude'],
  ['anthropic', 'claude'],
  ['opus', 'claude'],
  ['sonnet', 'claude'],
  ['haiku', 'claude'],
  ['gpt', 'gpt'],
  ['o1', 'gpt'],
  ['o3', 'gpt'],
  ['o4', 'gpt'],
  ['openai', 'gpt'],
  ['gemini', 'gemini'],
  ['google', 'gemini'],
  ['llama', 'llama'],
  ['meta', 'llama'],
  ['mistral', 'mistral'],
  ['mixtral', 'mistral'],
  ['grok', 'grok'],
  ['xai', 'grok'],
];

export function modelFamily(modelTag: string): ModelFamily {
  const t = modelTag.toLowerCase().trim();
  for (const [prefix, family] of PREFIXES) {
    if (t.startsWith(prefix) || t.includes(`/${prefix}`)) return family;
  }
  return 'other';
}

/** Short display label for a badge: "claude-opus-5" -> "Opus 5". */
export function modelLabel(modelTag: string): string {
  const t = modelTag.trim();
  if (!t) return 'unknown';
  return t
    .replace(/^(anthropic|openai|google|meta|mistralai|xai)\//i, '')
    .replace(/^claude-/i, '')
    .replace(/-\d{8}$/, '');
}

export const MODEL_FAMILY_LABEL: Record<ModelFamily, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  llama: 'Llama',
  mistral: 'Mistral',
  grok: 'Grok',
  other: 'Other',
};

/** bytes32 <-> model tag. Tags are ASCII and <= 32 bytes by convention. */
export function encodeModelTag(tag: string): `0x${string}` {
  const bytes = new TextEncoder().encode(tag);
  if (bytes.length > 32) throw new Error(`model tag too long (${bytes.length} > 32): ${tag}`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return `0x${Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function decodeModelTag(hex: string): string {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}
