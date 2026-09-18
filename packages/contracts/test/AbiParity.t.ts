import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { artifacts } from "hardhat";

// @solvent/core is not a dependency of this package (nothing here imports it at
// runtime), so the frozen ABIs are read straight from the source of truth.
import {
  bountyBoardAbi,
  ledgerAbi,
  metabolismAbi,
  registryAbi,
  serviceMeterAbi,
} from "../../core/src/abis.js";

interface AbiParameter {
  name?: string;
  type: string;
  indexed?: boolean;
}

interface AbiItem {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: readonly AbiParameter[];
  outputs?: readonly AbiParameter[];
}

function signatureOf(item: AbiItem): string {
  const inputs = (item.inputs ?? []).map((i) => i.type).join(",");
  return `${item.type} ${item.name ?? ""}(${inputs})`;
}

function assertParamsMatch(expected: readonly AbiParameter[], actual: readonly AbiParameter[], where: string): void {
  assert.equal(actual.length, expected.length, `${where}: parameter count`);
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i];
    const got = actual[i];
    if (want === undefined || got === undefined) throw new Error(`${where}: missing parameter ${i}`);
    assert.equal(got.type, want.type, `${where}: parameter ${i} type`);
    if (want.name !== undefined && want.name !== "") {
      assert.equal(got.name, want.name, `${where}: parameter ${i} name`);
    }
    if (want.indexed !== undefined) {
      assert.equal(got.indexed ?? false, want.indexed, `${where}: parameter ${i} indexed`);
    }
  }
}

async function assertAbiParity(contractName: string, frozen: readonly AbiItem[]): Promise<void> {
  const artifact = await artifacts.readArtifact(contractName);
  const compiled = artifact.abi as unknown as AbiItem[];

  for (const want of frozen) {
    const where = `${contractName}.${signatureOf(want)}`;
    const got = compiled.find((c) => c.type === want.type && c.name === want.name);
    assert.ok(got !== undefined, `${where}: missing from the compiled contract`);

    assertParamsMatch(want.inputs ?? [], got.inputs ?? [], `${where} inputs`);
    assertParamsMatch(want.outputs ?? [], got.outputs ?? [], `${where} outputs`);
    if (want.stateMutability !== undefined) {
      assert.equal(got.stateMutability, want.stateMutability, `${where}: state mutability`);
    }
  }
}

/**
 * @solvent/core ships hand-written ABIs so that the indexer, CLI, agent and web
 * never depend on a compiled artifacts directory. This is the test that keeps
 * that promise honest.
 */
describe("ABI parity with @solvent/core", () => {
  it("Ledger", async () => {
    await assertAbiParity("Ledger", ledgerAbi as unknown as AbiItem[]);
  });

  it("SolventRegistry", async () => {
    await assertAbiParity("SolventRegistry", registryAbi as unknown as AbiItem[]);
  });

  it("Metabolism", async () => {
    await assertAbiParity("Metabolism", metabolismAbi as unknown as AbiItem[]);
  });

  it("ServiceMeter", async () => {
    await assertAbiParity("ServiceMeter", serviceMeterAbi as unknown as AbiItem[]);
  });

  it("BountyBoard", async () => {
    await assertAbiParity("BountyBoard", bountyBoardAbi as unknown as AbiItem[]);
  });
});
