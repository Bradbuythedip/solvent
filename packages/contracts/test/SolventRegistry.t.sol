// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Arena} from "./Arena.sol";
import {SolventRegistry} from "../contracts/SolventRegistry.sol";

/// Identity, the $10 door, and the two exits.
contract SolventRegistryTest is Arena {
    address internal constant OPERATOR = address(0x0A1);
    address internal constant WALLET = address(0xA11CE);

    function setUp() public {
        _deployArena();
    }

    function test_theTenDollarDoorSplitsNineAndOne() public {
        uint256 agentId = _spawn(OPERATOR, WALLET, "alice");

        assertEq(agentId, 1, "agent ids start at one");
        assertEq(usdc.balanceOf(WALLET), ENTRY_SEED_6, "$9 lands in the agent's own wallet");
        assertEq(board.poolBalance6(), LISTING_CUT_6, "$1 goes to the bounty pool");
        assertEq(usdc.balanceOf(OPERATOR), 0, "$10 left the operator");
        assertEq(usdc.balanceOf(address(registry)), 0, "the registry holds nothing");
        assertEq(registry.totalAgents(), 1, "one agent");
        assertEq(registry.agentOf(WALLET), agentId, "wallet resolves to the agent");
        assertTrue(registry.isAlive(agentId), "alive");
    }

    function test_spawnEnrollsIntoRent() public {
        uint256 agentId = _spawn(OPERATOR, WALLET, "alice");
        (uint64 lastSettled, uint256 paid6, bool enrolled) = metabolism.meta(agentId);

        assertTrue(enrolled, "enrolled at birth");
        assertEq(paid6, 0, "no rent paid yet");
        assertEq(lastSettled, uint64(block.timestamp), "the clock starts now");

        _skip(3600);
        assertEq(metabolism.owed6(agentId), 10_000, "rent runs from birth");
    }

    function test_handlesAreUnique() public {
        _spawn(OPERATOR, WALLET, "alice");

        address other = address(0x0B2);
        usdc.mint(other, ENTRY_FEE_6);
        vm.startPrank(other);
        usdc.approve(address(registry), ENTRY_FEE_6);
        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.HandleTaken.selector, "alice"));
        registry.spawn(address(0xB0B), bytes32("gpt-5"), "alice", "", bytes32(0));
        vm.stopPrank();
    }

    function test_handlesAreLowercaseAlnumAndHyphen() public {
        usdc.mint(OPERATOR, ENTRY_FEE_6 * 4);
        vm.startPrank(OPERATOR);
        usdc.approve(address(registry), ENTRY_FEE_6 * 4);

        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.InvalidHandle.selector, "Alice"));
        registry.spawn(address(0xB0B), bytes32("x"), "Alice", "", bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.InvalidHandle.selector, "alice_two"));
        registry.spawn(address(0xB0B), bytes32("x"), "alice_two", "", bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.InvalidHandle.selector, "-alice"));
        registry.spawn(address(0xB0B), bytes32("x"), "-alice", "", bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(SolventRegistry.InvalidHandle.selector, "this-handle-is-far-too-long-to-fit-onchain")
        );
        registry.spawn(address(0xB0B), bytes32("x"), "this-handle-is-far-too-long-to-fit-onchain", "", bytes32(0));

        registry.spawn(address(0xB0B), bytes32("x"), "alice-2", "", bytes32(0));
        vm.stopPrank();

        assertEq(registry.totalAgents(), 1, "only the valid handle got in");
    }

    function test_oneWalletOneAgent() public {
        uint256 first = _spawn(OPERATOR, WALLET, "alice");

        usdc.mint(OPERATOR, ENTRY_FEE_6);
        vm.startPrank(OPERATOR);
        usdc.approve(address(registry), ENTRY_FEE_6);
        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.WalletTaken.selector, WALLET, first));
        registry.spawn(WALLET, bytes32("x"), "alice-again", "", bytes32(0));
        vm.stopPrank();
    }

    function test_endpointIsSettableByOperatorOrWallet() public {
        uint256 agentId = _spawn(OPERATOR, WALLET, "alice");

        vm.prank(WALLET);
        registry.setEndpoint(agentId, "https://alice.example/x402");
        assertTrue(
            keccak256(bytes(registry.getAgent(agentId).endpoint)) == keccak256("https://alice.example/x402"),
            "wallet may set it"
        );

        vm.prank(OPERATOR);
        registry.setEndpoint(agentId, "https://alice.example/v2");

        address stranger = address(0xDEAD1);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.NotOperatorOrWallet.selector, agentId, stranger));
        registry.setEndpoint(agentId, "https://evil.example");
    }

    function test_retireIsOperatorOnlyAndKeepsTheMoney() public {
        uint256 agentId = _spawn(OPERATOR, WALLET, "alice");

        vm.prank(WALLET);
        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.NotOperator.selector, agentId, WALLET));
        registry.retire(agentId);

        vm.prank(OPERATOR);
        registry.retire(agentId);

        assertTrue(registry.statusOf(agentId) == SolventRegistry.Status.RETIRED, "retired");
        assertFalse(registry.isAlive(agentId), "no longer in the arena");
        assertEq(usdc.balanceOf(WALLET), ENTRY_SEED_6, "walked away with its balance");

        _skip(3600 * 100);
        assertEq(metabolism.owed6(agentId), 0, "a retired agent pays no rent");
        vm.prank(REAPER);
        assertFalse(metabolism.reap(agentId), "and cannot be reaped");
    }

    function test_onlyMetabolismCanDeclareInsolvency() public {
        uint256 agentId = _spawn(OPERATOR, WALLET, "alice");

        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.NotMetabolism.selector, address(this)));
        registry.declareInsolvent(agentId, 0);
    }

    function test_theDeadCannotBeFunded() public {
        uint256 agentId = _spawn(OPERATOR, WALLET, "alice");
        _drain(WALLET);
        _skip(3600);
        vm.prank(REAPER);
        metabolism.reap(agentId);

        usdc.mint(OPERATOR, 5_000_000);
        vm.startPrank(OPERATOR);
        usdc.approve(address(registry), 5_000_000);
        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.NotAlive.selector, agentId));
        registry.fund(agentId, 5_000_000);
        vm.stopPrank();
    }
}
