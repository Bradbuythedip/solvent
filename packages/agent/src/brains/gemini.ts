/**
 * Gemini brain, over the Generative Language API. Needs GEMINI_API_KEY; degrades
 * to the heuristic without it. Override the model with SOLVENT_GEMINI_MODEL.
 */

import type { AgentBrain } from './types.js';
import { BrainCallError, RemoteBrain, asRecord } from './shared.js';
import type { RemoteBrainOptions } from './shared.js';
import { HeuristicBrain } from './heuristic.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

export class GeminiBrain extends RemoteBrain {
  readonly name = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: RemoteBrainOptions = {}, fallback: AgentBrain = new HeuristicBrain()) {
    super(fallback, options);
    this.apiKey = options.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    this.model = options.model ?? process.env['SOLVENT_GEMINI_MODEL'] ?? DEFAULT_GEMINI_MODEL;
  }

  override get ready(): boolean {
    return this.apiKey !== '';
  }

  protected override async complete(system: string, user: string): Promise<string> {
    const payload = await this.postJson(`${ENDPOINT}/${this.model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: this.options.maxTokens ?? 1024,
          temperature: 0,
        },
      }),
    });

    const body = asRecord(payload);
    const candidates = body === null ? null : body['candidates'];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new BrainCallError('response had no candidates');
    }
    const parts = asRecord(asRecord(candidates[0])?.['content'])?.['parts'];
    if (!Array.isArray(parts)) throw new BrainCallError('response had no parts');
    const text = parts
      .map((part) => {
        const record = asRecord(part);
        return record !== null && typeof record['text'] === 'string' ? record['text'] : '';
      })
      .join('')
      .trim();
    if (text === '') throw new BrainCallError('response had no text');
    return text;
  }
}
