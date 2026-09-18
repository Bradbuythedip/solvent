// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Arena} from "./Arena.sol";
import {Ledger} from "../contracts/Ledger.sol";

/// R1 and R2: capital is not revenue, and rank is earned minus burned.
contract LedgerTest is Arena {
    address internal constant OPERATOR = address(0x0A1);
    address internal constant WALLET = address(0xA11CE);
    address internal constant RICH_OPERATOR = address(0x0B2);
    address internal constant RICH_WALLET = address(0xB0B);

    uint256 internal worker;
    uint256 internal freeloader;

    function setUp() public {
        _deployArena();
        worker = _spawn(OPERATOR, WALLET, "worker");
        freeloader = _spawn(RICH_OPERATOR, RICH_WALLET, "freeloader");
        ledger.setReporter(address(this), true);
    }

    function test_spawnSeedIsCapitalNotRevenue() public view {
        assertEq(ledger.capitalIn6(worker), ENTRY_SEED_6, "the $9 seed is capital");
        assertEq(ledger.earned6(worker), 0, "and it earned nothing by being born");
        // The $1 listing cut is a real dollar spent to stand in the arena.
        assertEq(ledger.burned6(worker), LISTING_CUT_6, "listing cut is the first burn");
        assertEq(ledger.net(worker), -int256(LISTING_CUT_6), "every agent starts a dollar down");
    }

    function test_fundingAnAgentDoesNotMoveItsRank() public {
        int256 before = ledger.net(freeloader);

        usdc.mint(RICH_OPERATOR, 500_000_000); // $500 of pure subsidy
        vm.startPrank(RICH_OPERATOR);
        usdc.approve(address(registry), 500_000_000);
        registry.fund(freeloader, 500_000_000);
        vm.stopPrank();

        assertEq(ledger.net(freeloader), before, "net P&L is untouched by capital");
        assertEq(ledger.earned6(freeloader), 0, "capital never becomes revenue");
        assertEq(ledger.capitalIn6(freeloader), ENTRY_SEED_6 + 500_000_000, "capital is recorded");
        assertEq(usdc.balanceOf(RICH_WALLET), ENTRY_SEED_6 + 500_000_000, "the money did arrive");
        assertEq(ledger.totalEarned6(), 0, "arena revenue did not move either");
    }

    function test_aFundedAgentStillRanksBelowOneThatWorked() public {
        // The worker sells one dollar of service to an external buyer.
        address buyer = address(0xB4E5);
        usdc.mint(buyer, 1_000_000);
        vm.startPrank(buyer);
        usdc.approve(address(meter), 1_000_000);
        meter.payExternal(worker, 1_000_000, keccak256("req-1"));
        vm.stopPrank();

        // The freeloader is handed a hundred times more, as capital.
        usdc.mint(RICH_OPERATOR, 100_000_000);
        vm.startPrank(RICH_OPERATOR);
        usdc.approve(address(registry), 100_000_000);
        registry.fund(freeloader, 100_000_000);
        vm.stopPrank();

        assertGt(usdc.balanceOf(RICH_WALLET), usdc.balanceOf(WALLET), "the freeloader is richer");
        assertTrue(ledger.net(worker) > ledger.net(freeloader), "and still ranks below the worker");
    }

    function test_capitalEntriesEmitAsEarnButNeverCount() public {
        ledger.record(worker, Ledger.Flow.BURN, Ledger.Category.CAPITAL, 5_000_000, address(this), bytes32("memo"));

        // Even asked to book capital as a burn, the ledger records it as capital.
        assertEq(ledger.capitalIn6(worker), ENTRY_SEED_6 + 5_000_000, "capital accumulated");
        assertEq(ledger.burned6(worker), LISTING_CUT_6, "burn untouched");
        assertEq(ledger.earned6(worker), 0, "earned untouched");
    }

    function test_netIsSignedAndTracksBothSides() public {
        ledger.record(worker, Ledger.Flow.EARN, Ledger.Category.SERVICE, 3_000_000, address(this), bytes32(0));
        assertEq(ledger.net(worker), int256(3_000_000) - int256(LISTING_CUT_6), "earn lifts net");

        ledger.record(worker, Ledger.Flow.BURN, Ledger.Category.GAS, 4_000_000, address(this), bytes32(0));
        assertEq(ledger.net(worker), int256(3_000_000) - int256(LISTING_CUT_6) - int256(4_000_000), "burn sinks it");
        assertTrue(ledger.net(worker) < 0, "an agent can be underwater");
    }

    function test_onlyReportersCanRecord() public {
        address stranger = address(0xDEAD1);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ledger.NotReporter.selector, stranger));
        ledger.record(worker, Ledger.Flow.EARN, Ledger.Category.OTHER, 1, stranger, bytes32(0));
    }

    function test_arenaTotalsTrackEveryEntry() public {
        ledger.record(worker, Ledger.Flow.EARN, Ledger.Category.BOUNTY, 2_000_000, address(this), bytes32(0));
        ledger.record(freeloader, Ledger.Flow.BURN, Ledger.Category.RENT, 500_000, address(this), bytes32(0));

        assertEq(ledger.totalEarned6(), 2_000_000, "total earned");
        assertEq(ledger.totalBurned6(), 2 * LISTING_CUT_6 + 500_000, "total burned includes both listing cuts");
    }
}
