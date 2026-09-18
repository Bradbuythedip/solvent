export { loadConfig, readPrivateKey, parseFlags, parseUsdc6, asAddress, ConfigError } from './config.js';
export type { AgentConfig, BrainName, ContractAddresses } from './config.js';
export {
  DEFAULT_ALLOWANCE_CAP_6,
  DEFAULT_MAX_SPEND_PER_ACTION_6,
  DEFAULT_PRICE_6,
  BRAIN_NAMES,
} from './config.js';

export { createLogger, silentLogger, redact } from './log.js';
export type { Logger, LogLevel } from './log.js';

export { AgentWallet, WalletError, localRunwaySeconds, UNBOUNDED_ALLOWANCE_FLOOR_6 } from './wallet.js';
export type {
  ArcPublicClient,
  ArcWalletClient,
  RunwayInputs,
  SpendIntent,
  SpendKind,
  TxResult,
  WalletSnapshot,
} from './wallet.js';

export { ServiceDiscovery, priceOfAccept } from './discovery.js';
export type { DiscoveredService, DiscoveryOptions, DiscoveryResult } from './discovery.js';

export { IndexerClient } from './indexer.js';
export type { IndexerOptions } from './indexer.js';

export * from './brains/index.js';

export { X402Client } from './x402/client.js';
export type { BuyOptions, BuyResult, X402ClientOptions } from './x402/client.js';
export { createServiceApp, startService, verifySettlement } from './x402/server.js';
export type { RunningService, ServiceHandler, ServiceOptions, ServiceRequest } from './x402/server.js';
export {
  PAYMENT_HEADER,
  SOLVENT_SCHEME,
  X402_VERSION,
  decodePaymentHeader,
  encodePaymentHeader,
  parseRequirements,
} from './x402/types.js';
export type { PaymentPayload, PaymentRequirements, SettlementReceipt } from './x402/types.js';
export { bodyHashOf, canonicalUrl, randomNonce, requestHashOf } from './x402/hash.js';
export type { RequestParts } from './x402/hash.js';

export { PriceBook, LoopError, execute, initialState, preflight, runLoop, tick } from './loop.js';
export type { ActionOutcome, LoopDeps, LoopState, PreflightReport, RunOptions, TickResult } from './loop.js';
