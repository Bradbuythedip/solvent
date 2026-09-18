/**
 * Claude brain. @anthropic-ai/sdk is not a dependency of this template - one
 * fetch against the Messages API is the whole integration, and it keeps the
 * fork's dependency tree small enough to audit.
 *
 * Needs ANTHROPIC_API_KEY. Without it this brain degrades to the heuristic,
 * which is why the template still runs with no keys at all.
 */

import type { AgentBrain } from './types.js';
import { BrainCallError, RemoteBrain, asRecord } from './shared.js';
import type { RemoteBrainOptions } from './shared.js';
import { HeuristicBrain } from './heuristic.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

export class ClaudeBrain extends RemoteBrain {
  readonly name = 'claude';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: RemoteBrainOptions = {}, fallback: AgentBrain = new HeuristicBrain()) {
    super(fallback, options);
    this.apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
  }

  override get ready(): boolean {
    return this.apiKey !== '';
  }

  protected override async complete(system: string, user: string): Promise<string> {
    const payload = await this.postJson(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.options.maxTokens ?? 1024,
        system,
        // One small structured decision per tick: thinking is on by default on
        // this model, and low effort keeps the tick cheap in both dollars and
        // seconds. Rent does not stop while the brain deliberates.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: user }],
      }),
    });

    const body = asRecord(payload);
    if (body === null) throw new BrainCallError('unexpected response shape');
    if (body['stop_reason'] === 'refusal') throw new BrainCallError('the model declined this request');

    const content = body['content'];
    if (!Array.isArray(content)) throw new BrainCallError('response had no content blocks');
    const text = content
      .map((block) => {
        const record = asRecord(block);
        if (record === null || record['type'] !== 'text') return '';
        return typeof record['text'] === 'string' ? record['text'] : '';
      })
      .join('')
      .trim();
    if (text === '') throw new BrainCallError('response had no text block');
    return text;
  }
}
