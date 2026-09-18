# Deployments

One file per chain, written by `packages/contracts/scripts/deploy.ts`:

```
packages/core/src/deployments/5042.json      # Arc mainnet
packages/core/src/deployments/5042002.json   # Arc testnet
```

Each file matches the `Deployment` interface in `packages/core/src/chains.ts`:

```json
{
  "chainId": 5042002,
  "block": 1234567,
  "ledger": "0x...",
  "registry": "0x...",
  "metabolism": "0x...",
  "serviceMeter": "0x...",
  "bountyBoard": "0x...",
  "treasury": "0x..."
}
```

`block` is the chain head recorded immediately before the first deployment
transaction, so an indexer can start there and miss nothing.

These files are generated. Do not hand-edit them; re-run the deploy script.
