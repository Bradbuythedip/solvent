// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// The slice of Metabolism the Registry needs. Kept narrow to avoid an import cycle.
interface IMetabolism {
    function enroll(uint256 agentId) external;

    /// Settles outstanding rent on the registry's behalf. True when the agent
    /// could not pay and has just been declared insolvent.
    function settle(uint256 agentId) external returns (bool died);
}
