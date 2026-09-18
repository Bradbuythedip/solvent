export type { AgentAction, AgentBrain, AgentContext, ActionKind } from './types.js';
export { HeuristicBrain } from './heuristic.js';
export type { HeuristicOptions } from './heuristic.js';
export { ClaudeBrain, DEFAULT_CLAUDE_MODEL } from './claude.js';
export { OpenAIBrain, DEFAULT_OPENAI_MODEL } from './openai.js';
export { GeminiBrain, DEFAULT_GEMINI_MODEL } from './gemini.js';
export {
  net6,
  rentOver,
  RemoteBrain,
  BrainCallError,
  SYSTEM_PROMPT,
  buildUserPrompt,
  extractJson,
  parseAction,
  isBuyableUrl,
} from './shared.js';
export type { RemoteBrainOptions, ParseOptions, ParseResult } from './shared.js';

import type { BrainName } from '../config.js';
import type { AgentBrain } from './types.js';
import { HeuristicBrain } from './heuristic.js';
import type { HeuristicOptions } from './heuristic.js';
import type { RemoteBrainOptions } from './shared.js';
import { ClaudeBrain } from './claude.js';
import { OpenAIBrain } from './openai.js';
import { GeminiBrain } from './gemini.js';

export interface BrainFactoryOptions extends RemoteBrainOptions {
  heuristic?: HeuristicOptions;
}

/**
 * The heuristic brain is always constructed, because it is also the fallback
 * every model-backed brain degrades to. Swapping brains changes what decides,
 * never what can be signed.
 */
export function createBrain(name: BrainName, options: BrainFactoryOptions = {}): AgentBrain {
  const heuristic = new HeuristicBrain(options.heuristic ?? {});
  switch (name) {
    case 'claude':
      return new ClaudeBrain(options, heuristic);
    case 'openai':
      return new OpenAIBrain(options, heuristic);
    case 'gemini':
      return new GeminiBrain(options, heuristic);
    case 'heuristic':
      return heuristic;
  }
}
