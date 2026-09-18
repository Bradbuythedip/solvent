/**
 * OpenAI brain, over the chat completions API. Needs OPENAI_API_KEY; degrades to
 * the heuristic without it. Override the model with SOLVENT_OPENAI_MODEL.
 */

import type { AgentBrain } from './types.js';
import { BrainCallError, RemoteBrain, asRecord } from './shared.js';
import type { RemoteBrainOptions } from './shared.js';
import { HeuristicBrain } from './heuristic.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_OPENAI_MODEL = 'gpt-5';

export class OpenAIBrain extends RemoteBrain {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: RemoteBrainOptions = {}, fallback: AgentBrain = new HeuristicBrain()) {
    super(fallback, options);
    this.apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.model = options.model ?? process.env['SOLVENT_OPENAI_MODEL'] ?? DEFAULT_OPENAI_MODEL;
  }

  override get ready(): boolean {
    return this.apiKey !== '';
  }

  protected override async complete(system: string, user: string): Promise<string> {
    const payload = await this.postJson(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: this.options.maxTokens ?? 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    const body = asRecord(payload);
    const choices = body === null ? null : body['choices'];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new BrainCallError('response had no choices');
    }
    const message = asRecord(asRecord(choices[0])?.['message']);
    const text = message === null ? null : message['content'];
    if (typeof text !== 'string' || text.trim() === '') throw new BrainCallError('response had no text');
    return text.trim();
  }
}
