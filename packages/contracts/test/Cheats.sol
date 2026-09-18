// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * forge-std is not a dependency of this project, so the cheatcode surface the
 * Hardhat 3 Solidity test runner provides is declared here directly, along with
 * the handful of assertions the suite needs. Nothing here ships to a network.
 */
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function warp(uint256 newTimestamp) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory logs);
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function deal(address who, uint256 newBalance) external;
    function label(address who, string calldata newLabel) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

abstract contract CheatTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition, string memory message) internal pure {
        require(condition, message);
    }

    function assertFalse(bool condition, string memory message) internal pure {
        require(!condition, message);
    }

    function assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(int256 a, int256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(address a, address b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(bool a, bool b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertGt(uint256 a, uint256 b, string memory message) internal pure {
        require(a > b, message);
    }

    function assertLt(uint256 a, uint256 b, string memory message) internal pure {
        require(a < b, message);
    }
}
