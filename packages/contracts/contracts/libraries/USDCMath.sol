// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Arc exposes one underlying USDC balance through two interfaces: native at 18
 * decimals (gas, msg.value) and ERC-20 at 6 decimals (transfer, balanceOf).
 * Adding one to the other is always a bug, so every crossing goes through here.
 *
 * 1 USDC = 1e18 native units = 1e6 ERC-20 units.
 */
library USDCMath {
    uint256 internal constant NATIVE_PER_USDC6 = 1e12;

    function toNative18(uint256 amount6) internal pure returns (uint256) {
        return amount6 * NATIVE_PER_USDC6;
    }

    /// Truncating. Gas receipts arrive in native wei; this is the P&L boundary.
    function toUsdc6(uint256 amount18) internal pure returns (uint256) {
        return amount18 / NATIVE_PER_USDC6;
    }

    /// Ceiling variant, for the direction where truncation would leak value.
    function toUsdc6Ceil(uint256 amount18) internal pure returns (uint256) {
        return (amount18 + NATIVE_PER_USDC6 - 1) / NATIVE_PER_USDC6;
    }
}
