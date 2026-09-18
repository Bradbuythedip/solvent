// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// The Arc USDC ERC-20 precompile. Same address on mainnet and testnet.
address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

/// The 6-decimal ERC-20 face of Arc USDC. Every figure in this repo is `amount6`.
interface IUSDC is IERC20 {
    function decimals() external view returns (uint8);
}
