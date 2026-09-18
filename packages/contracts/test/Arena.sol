// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CheatTest} from "./Cheats.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {Ledger} from "../contracts/Ledger.sol";
import {SolventRegistry} from "../contracts/SolventRegistry.sol";
import {Metabolism} from "../contracts/Metabolism.sol";
import {ServiceMeter} from "../contracts/ServiceMeter.sol";
import {BountyBoard} from "../contracts/BountyBoard.sol";

/**
 * Shared arena fixture: the five contracts wired in the deployment order from
 * SPEC 3.6, against a 6-decimal mock of the Arc USDC precompile.
 */
abstract contract Arena is CheatTest {
    MockUSDC internal usdc;
    Ledger internal ledger;
    SolventRegistry internal registry;
    Metabolism internal metabolism;
    ServiceMeter internal meter;
    BountyBoard internal board;

    address internal constant TREASURY = address(0x7EA5);
    address internal constant REAPER = address(0xBEEF);

    uint256 internal constant ENTRY_FEE_6 = 10_000_000;
    uint256 internal constant ENTRY_SEED_6 = 9_000_000;
    uint256 internal constant LISTING_CUT_6 = 1_000_000;

    function _deployArena() internal {
        usdc = new MockUSDC();
        ledger = new Ledger();
        registry = new SolventRegistry(address(ledger));
        metabolism = new Metabolism(address(registry), address(ledger), TREASURY);
        meter = new ServiceMeter(address(registry), address(ledger));
        board = new BountyBoard(address(registry), address(ledger));

        ledger.setReporter(address(registry), true);
        ledger.setReporter(address(metabolism), true);
        ledger.setReporter(address(meter), true);
        ledger.setReporter(address(board), true);

        registry.setMetabolism(address(metabolism));
        registry.setBountyBoard(address(board));

        registry.setUsdc(address(usdc));
        metabolism.setUsdc(address(usdc));
        meter.setUsdc(address(usdc));
        board.setUsdc(address(usdc));

        // The treasury funds reaper cuts and kill bounties out of collected rent.
        usdc.mint(TREASURY, 1_000_000_000);
        vm.prank(TREASURY);
        usdc.approve(address(metabolism), type(uint256).max);

        // Solidity tests start at timestamp 0 on a fresh chain; rent maths needs
        // room to walk backwards from "now".
        if (block.timestamp < 1_000_000) vm.warp(1_000_000);
    }

    /// Spawns an agent through the $10 door and approves rent against its wallet.
    function _spawn(address operator, address wallet, string memory handle) internal returns (uint256 agentId) {
        usdc.mint(operator, ENTRY_FEE_6);

        vm.startPrank(operator);
        usdc.approve(address(registry), ENTRY_FEE_6);
        agentId = registry.spawn(wallet, bytes32("claude-opus-5"), handle, "", bytes32(0));
        vm.stopPrank();

        vm.prank(wallet);
        usdc.approve(address(metabolism), type(uint256).max);
    }

    function _approveMeter(address wallet, uint256 amount6) internal {
        vm.prank(wallet);
        usdc.approve(address(meter), amount6);
    }

    function _drain(address wallet) internal {
        uint256 bal = usdc.balanceOf(wallet);
        if (bal > 0) {
            vm.prank(wallet);
            usdc.transfer(address(0xDEAD), bal);
        }
    }

    function _skip(uint256 secondsForward) internal {
        vm.warp(block.timestamp + secondsForward);
    }
}
