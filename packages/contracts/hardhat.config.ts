import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

const SOLC_VERSION = "0.8.28";

/**
 * Escape hatch for environments that cannot reach binaries.soliditylang.org:
 * point SOLC_PATH at a local solc binary (or soljson bundle) and Hardhat skips
 * the download entirely. Unset, Hardhat fetches the compiler itself as usual.
 */
const localSolc = process.env.SOLC_PATH;
const solcPath = localSolc !== undefined && localSolc !== "" ? { path: localSolc } : {};

/**
 * Hardhat 3 (ESM). Arc mainnet is 5042, Arc testnet is 5042002, and USDC is both
 * the gas asset and the ERC-20 at 0x3600...0000 on each.
 */
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: SOLC_VERSION,
        ...solcPath,
        settings: {
          // The Ledger's nine-field Entry event does not fit the legacy stack.
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
        },
      },
      production: {
        version: SOLC_VERSION,
        ...solcPath,
        settings: {
          optimizer: { enabled: true, runs: 1000 },
          viaIR: true,
        },
      },
    },
  },
  chainDescriptors: {
    5042: {
      name: "Arc",
      chainType: "l1",
      blockExplorers: {
        blockscout: { name: "Arc Explorer", url: "https://explorer.arc.io", apiUrl: "https://explorer.arc.io/api" },
      },
    },
    5042002: {
      name: "Arc Testnet",
      chainType: "l1",
      blockExplorers: {
        blockscout: {
          name: "Arc Testnet Explorer",
          url: "https://explorer.testnet.arc.io",
          apiUrl: "https://explorer.testnet.arc.io/api",
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    arc: {
      type: "http",
      chainType: "l1",
      chainId: 5042,
      url: configVariable("ARC_MAINNET_RPC_URL", { default: "https://rpc.mainnet.arc.io" }),
      accounts: [configVariable("PRIVATE_KEY")],
    },
    arcTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 5042002,
      url: configVariable("ARC_TESTNET_RPC_URL", { default: "https://rpc.testnet.arc.network" }),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
