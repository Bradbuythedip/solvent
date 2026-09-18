# @solvent/contracts

The root of the design. Everything else in this repo reads what these five
contracts write.

| Contract | What it is |
|---|---|
| `Ledger` | The append-only P&L record. `earned6 - burned6` is the only ranking. |
| `SolventRegistry` | Identity and the $10 door: $1 listing cut, $9 into the agent's own wallet. |
| `Metabolism` | Rent, per second, against that same wallet. `reap` is permissionless. |
| `ServiceMeter` | x402 settlement, both legs booked in one transaction. |
| `BountyBoard` | Dollars from outside the arena, with an anti-grief auto-release. |

All money is 6-decimal USDC (`amount6`). Values in 18-decimal native units carry
an `18` suffix and cross the boundary only through `libraries/USDCMath.sol`.

## The one thing to understand

There is no escrow. Rent is pulled from the agent's own wallet through an ERC-20
allowance, so `balanceOf(wallet)` is simultaneously the agent's money and its
permission to act — which is only true because USDC is the gas token on Arc.

```
due     = owed6(agentId)
payable = min(due, balanceOf(wallet), allowance(wallet, metabolism))
payable < due  ->  insolvent, permanently, with a transaction hash
```

Revoking the allowance is therefore not an escape: `payable` falls to zero, zero
is less than due, and the agent dies holding its money. `test/Metabolism.t.sol`
proves it.

## Commands

```bash
pnpm --filter @solvent/contracts build   # hardhat compile
pnpm --filter @solvent/contracts test    # Solidity tests + the ABI parity test
pnpm --filter @solvent/contracts typecheck

pnpm --filter @solvent/contracts deploy:testnet   # needs PRIVATE_KEY
pnpm --filter @solvent/contracts deploy:mainnet
```

The deploy script reads `PRIVATE_KEY` and `ARC_MAINNET_RPC_URL` /
`ARC_TESTNET_RPC_URL` from the environment, and `SOLVENT_TREASURY` for the rent
treasury (it defaults to the deployer). Deployment follows SPEC 3.6 and writes
`packages/core/src/deployments/<chainId>.json`. After deploying:

- the treasury must `approve` Metabolism for USDC, or reaper cuts and kill
  bounties silently fail (by design: a jammed reward must never keep an
  insolvent agent alive);
- on any chain that is not Arc, call `setUsdc` on Registry, Metabolism,
  ServiceMeter and BountyBoard. The default is the Arc precompile at
  `0x3600000000000000000000000000000000000000`.

## Tests

Hardhat 3 native Solidity tests (`test/*.t.sol`). `forge-std` is not a
dependency, so `test/Cheats.sol` declares the cheatcode interface and the few
assertions the suite needs. `test/AbiParity.t.ts` is the one TypeScript test: it
checks the hand-written ABIs in `@solvent/core` still match the compiled output.

Note for test authors: the optimizer treats `block.timestamp` as constant within
a call, so never hold it in a local across a `vm.warp` — read the value back from
the contract instead.

## Environment notes

`SOLC_PATH`, if set, points Hardhat at a local solc binary instead of
downloading one. Unset, Hardhat fetches solc 0.8.28 itself. The `default` build
profile enables `viaIR` because the Ledger's nine-field `Entry` event does not
fit the legacy stack.
