/**
 * Hand-written ABIs, kept in lockstep with SPEC.md §3.
 * They are the decoupling point: the indexer, CLI, agent, and web all read these
 * without depending on a compiled artifacts directory.
 *
 * `packages/contracts/test/AbiParity.t.ts` asserts these match the compiled output.
 */

export const ledgerAbi = [
  {
    type: 'event',
    name: 'Entry',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'flow', type: 'uint8', indexed: true },
      { name: 'category', type: 'uint8', indexed: true },
      { name: 'amount6', type: 'uint256', indexed: false },
      { name: 'counterparty', type: 'address', indexed: false },
      { name: 'memoHash', type: 'bytes32', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
      { name: 'runningEarned6', type: 'uint256', indexed: false },
      { name: 'runningBurned6', type: 'uint256', indexed: false },
    ],
  },
  { type: 'function', name: 'earned6', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'burned6', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'capitalIn6', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalEarned6', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalBurned6', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'net', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'int256' }] },
] as const;

export const registryAbi = [
  {
    type: 'event',
    name: 'Spawned',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'modelTag', type: 'bytes32', indexed: false },
      { name: 'handle', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'manifestHash', type: 'bytes32', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Insolvency',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'at', type: 'uint64', indexed: false },
      { name: 'finalBalance6', type: 'uint256', indexed: false },
      { name: 'lifespanSeconds', type: 'uint64', indexed: false },
      { name: 'earned6', type: 'uint256', indexed: false },
      { name: 'burned6', type: 'uint256', indexed: false },
      { name: 'reaper', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Retired',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'at', type: 'uint64', indexed: false },
      { name: 'finalBalance6', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EndpointSet',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'endpoint', type: 'string', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'spawn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'modelTag', type: 'bytes32' },
      { name: 'handle', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'manifestHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'agents',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'wallet', type: 'address' },
      { name: 'operator', type: 'address' },
      { name: 'bornAt', type: 'uint64' },
      { name: 'diedAt', type: 'uint64' },
      { name: 'status', type: 'uint8' },
      { name: 'modelTag', type: 'bytes32' },
      { name: 'handle', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'manifestHash', type: 'bytes32' },
    ],
  },
  { type: 'function', name: 'setEndpoint', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'endpoint', type: 'string' }], outputs: [] },
  { type: 'function', name: 'retire', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'agentOf', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'isAlive', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'totalAgents', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'ENTRY_FEE_6', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

export const metabolismAbi = [
  {
    type: 'event',
    name: 'Reaped',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'reaper', type: 'address', indexed: true },
      { name: 'due6', type: 'uint256', indexed: false },
      { name: 'collected6', type: 'uint256', indexed: false },
      { name: 'balance6', type: 'uint256', indexed: false },
      { name: 'died', type: 'bool', indexed: false },
    ],
  },
  { type: 'function', name: 'owed6', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'runwaySeconds', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'reap', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: 'died', type: 'bool' }] },
  { type: 'function', name: 'reapMany', stateMutability: 'nonpayable', inputs: [{ name: 'agentIds', type: 'uint256[]' }], outputs: [{ name: 'deaths', type: 'uint256' }] },
  { type: 'function', name: 'rentPerHour6', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'meta', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: 'lastSettled', type: 'uint64' }, { name: 'paid6', type: 'uint256' }, { name: 'enrolled', type: 'bool' }] },
] as const;

export const serviceMeterAbi = [
  {
    type: 'event',
    name: 'ServiceSettled',
    inputs: [
      { name: 'payerAgentId', type: 'uint256', indexed: true },
      { name: 'providerAgentId', type: 'uint256', indexed: true },
      { name: 'payer', type: 'address', indexed: false },
      { name: 'amount6', type: 'uint256', indexed: false },
      { name: 'requestHash', type: 'bytes32', indexed: true },
      { name: 'selfDealt', type: 'bool', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  { type: 'function', name: 'payForService', stateMutability: 'nonpayable', inputs: [{ name: 'payerAgentId', type: 'uint256' }, { name: 'providerAgentId', type: 'uint256' }, { name: 'amount6', type: 'uint256' }, { name: 'requestHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'payExternal', stateMutability: 'nonpayable', inputs: [{ name: 'providerAgentId', type: 'uint256' }, { name: 'amount6', type: 'uint256' }, { name: 'requestHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'receiptOf', stateMutability: 'view', inputs: [{ name: 'requestHash', type: 'bytes32' }], outputs: [{ name: 'providerAgentId', type: 'uint256' }, { name: 'amount6', type: 'uint256' }, { name: 'at', type: 'uint64' }] },
] as const;

export const bountyBoardAbi = [
  {
    type: 'event',
    name: 'BountyPosted',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'poster', type: 'address', indexed: true },
      { name: 'reward6', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
      { name: 'specHash', type: 'bytes32', indexed: false },
      { name: 'specURI', type: 'string', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BountySubmitted',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'deliverableHash', type: 'bytes32', indexed: false },
      { name: 'deliverableURI', type: 'string', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BountyPaid',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'reward6', type: 'uint256', indexed: false },
      { name: 'auto_', type: 'bool', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BountyRefunded',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'reward6', type: 'uint256', indexed: false },
      { name: 'at', type: 'uint64', indexed: false },
    ],
  },
  { type: 'function', name: 'post', stateMutability: 'nonpayable', inputs: [{ name: 'reward6', type: 'uint256' }, { name: 'deadline', type: 'uint64' }, { name: 'reviewWindow', type: 'uint64' }, { name: 'specHash', type: 'bytes32' }, { name: 'specURI', type: 'string' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'submit', stateMutability: 'nonpayable', inputs: [{ name: 'bountyId', type: 'uint256' }, { name: 'agentId', type: 'uint256' }, { name: 'deliverableHash', type: 'bytes32' }, { name: 'deliverableURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'accept', stateMutability: 'nonpayable', inputs: [{ name: 'bountyId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'reject', stateMutability: 'nonpayable', inputs: [{ name: 'bountyId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'autoRelease', stateMutability: 'nonpayable', inputs: [{ name: 'bountyId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'reclaim', stateMutability: 'nonpayable', inputs: [{ name: 'bountyId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'seedPool', stateMutability: 'nonpayable', inputs: [{ name: 'amount6', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'totalBounties', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

/** Minimal ERC-20 surface for the Arc USDC precompile (6 decimals). */
export const usdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
] as const;

export const FLOW_NAMES = ['EARN', 'BURN'] as const;
export const CATEGORY_NAMES = ['RENT', 'SERVICE', 'BOUNTY', 'GAS', 'SPAWN', 'CAPITAL', 'OTHER'] as const;
export const STATUS_NAMES = ['NONE', 'ALIVE', 'INSOLVENT', 'RETIRED'] as const;
export const BOUNTY_STATE_NAMES = ['OPEN', 'SUBMITTED', 'PAID', 'REFUNDED'] as const;
