import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import { getAddress } from "viem";

/**
 * Deploys the arena in the order SPEC 3.6 fixes, then wires the reporters so the
 * Ledger will accept entries from Metabolism, ServiceMeter, BountyBoard and the
 * Registry. Addresses land in packages/core/src/deployments/<chainId>.json, which
 * is the single place every other package looks them up.
 */

const DEPLOYMENTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../core/src/deployments",
);

const connection = await network.create();
const { viem } = connection;

const publicClient = await viem.getPublicClient();
const walletClients = await viem.getWalletClients();
const deployer = walletClients[0];
if (deployer === undefined) {
  throw new Error("No wallet client available: set PRIVATE_KEY for this network.");
}

const chainId = await publicClient.getChainId();
const deployerAddress = deployer.account.address;
const treasury = (process.env.SOLVENT_TREASURY ?? deployerAddress) as `0x${string}`;

// Recorded before anything is deployed, so the indexer has a safe first block.
const startBlock = await publicClient.getBlockNumber();

async function confirm(hash: `0x${string}`): Promise<void> {
  await publicClient.waitForTransactionReceipt({ hash });
}

console.log(`Deploying Solvent to chain ${chainId} from ${deployerAddress}`);
console.log(`Treasury: ${treasury}`);

const ledger = await viem.deployContract("Ledger");
console.log(`Ledger        ${ledger.address}`);

const registry = await viem.deployContract("SolventRegistry", [ledger.address]);
console.log(`Registry      ${registry.address}`);

const metabolism = await viem.deployContract("Metabolism", [registry.address, ledger.address, treasury]);
console.log(`Metabolism    ${metabolism.address}`);

const serviceMeter = await viem.deployContract("ServiceMeter", [registry.address, ledger.address]);
console.log(`ServiceMeter  ${serviceMeter.address}`);

const bountyBoard = await viem.deployContract("BountyBoard", [registry.address, ledger.address]);
console.log(`BountyBoard   ${bountyBoard.address}`);

// viem's write bindings are an indexed lookup, so they narrow before use.
const setReporter = ledger.write.setReporter;
const setMetabolism = registry.write.setMetabolism;
const setBountyBoard = registry.write.setBountyBoard;
if (setReporter === undefined || setMetabolism === undefined || setBountyBoard === undefined) {
  throw new Error("Missing write bindings: run `hardhat compile` before deploying.");
}

for (const reporter of [metabolism.address, serviceMeter.address, bountyBoard.address, registry.address]) {
  await confirm(await setReporter([reporter, true]));
}
await confirm(await setMetabolism([metabolism.address]));
await confirm(await setBountyBoard([bountyBoard.address]));

const deployment = {
  chainId,
  block: Number(startBlock),
  ledger: getAddress(ledger.address),
  registry: getAddress(registry.address),
  metabolism: getAddress(metabolism.address),
  serviceMeter: getAddress(serviceMeter.address),
  bountyBoard: getAddress(bountyBoard.address),
  treasury: getAddress(treasury),
};

await mkdir(DEPLOYMENTS_DIR, { recursive: true });
const outFile = path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
await writeFile(outFile, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

console.log(`\nWrote ${outFile}`);
console.log(
  "USDC defaults to the Arc precompile at 0x3600000000000000000000000000000000000000; " +
    "on any other chain call setUsdc on Registry, Metabolism, ServiceMeter and BountyBoard.",
);
console.log("The treasury must approve Metabolism for USDC so reaper cuts and kill bounties can be paid.");

await connection.close();
