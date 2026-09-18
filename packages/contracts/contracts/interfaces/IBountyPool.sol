// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// The slice of BountyBoard the Registry needs to route the listing cut.
interface IBountyPool {
    function seedPool(uint256 amount6) external;
}
