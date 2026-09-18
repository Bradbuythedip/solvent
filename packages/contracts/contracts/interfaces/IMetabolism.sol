// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// The slice of Metabolism the Registry needs. Kept narrow to avoid an import cycle.
interface IMetabolism {
    function enroll(uint256 agentId) external;
}
