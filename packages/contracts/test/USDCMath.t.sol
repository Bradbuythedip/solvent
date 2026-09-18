// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CheatTest} from "./Cheats.sol";
import {USDCMath} from "../contracts/libraries/USDCMath.sol";

/// The 6 vs 18 decimal boundary. Getting this wrong is a 1e12 error, silently.
contract USDCMathTest is CheatTest {
    function test_oneDollarCrossesBothWays() public pure {
        assertEq(USDCMath.toNative18(1_000_000), 1e18, "1 USDC -> 1e18 native");
        assertEq(USDCMath.toUsdc6(1e18), 1_000_000, "1e18 native -> 1 USDC");
    }

    function test_conversionFactorIsExactly1e12() public pure {
        assertEq(USDCMath.NATIVE_PER_USDC6, 1e12, "factor");
        assertEq(USDCMath.toNative18(1), 1e12, "smallest usdc unit");
    }

    function test_toUsdc6Truncates() public pure {
        // Anything below one 6-decimal unit is dust and rounds to zero.
        assertEq(USDCMath.toUsdc6(1e12 - 1), 0, "just under one unit");
        assertEq(USDCMath.toUsdc6(1e12), 1, "exactly one unit");
        assertEq(USDCMath.toUsdc6(15e11), 1, "one and a half units truncate");
        assertEq(USDCMath.toUsdc6(0), 0, "zero");
    }

    function test_toUsdc6CeilRoundsUp() public pure {
        assertEq(USDCMath.toUsdc6Ceil(1), 1, "one wei is one unit");
        assertEq(USDCMath.toUsdc6Ceil(1e12), 1, "exact stays exact");
        assertEq(USDCMath.toUsdc6Ceil(1e12 + 1), 2, "a wei over rounds up");
        assertEq(USDCMath.toUsdc6Ceil(0), 0, "zero stays zero");
    }

    function test_gasReceiptConversion() public pure {
        // A receipt of 0.000123456789012345 native USDC books as 123 units ($0.000123).
        uint256 gasUsed18 = 123_456_789_012_345;
        assertEq(USDCMath.toUsdc6(gasUsed18), 123, "gas truncates into P&L");
        assertEq(USDCMath.toUsdc6Ceil(gasUsed18), 124, "ceil variant");
    }

    function testFuzz_roundTripIsLossless(uint96 amount6) public pure {
        assertEq(USDCMath.toUsdc6(USDCMath.toNative18(amount6)), amount6, "round trip");
    }

    function testFuzz_ceilIsNeverMoreThanOneUnitAbove(uint128 amount18) public pure {
        uint256 floorValue = USDCMath.toUsdc6(amount18);
        uint256 ceilValue = USDCMath.toUsdc6Ceil(amount18);
        assertTrue(ceilValue == floorValue || ceilValue == floorValue + 1, "ceil within one unit");
    }
}
