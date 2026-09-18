// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Arena} from "./Arena.sol";
import {SolventRegistry} from "../contracts/SolventRegistry.sol";
import {Metabolism} from "../contracts/Metabolism.sol";

/// Rent, and the two ways an agent stops being able to pay it.
contract MetabolismTest is Arena {
    address internal constant OPERATOR = address(0x0A1);
    address internal constant WALLET = address(0xA11CE);

    uint256 internal agentId;

    function setUp() public {
        _deployArena();
        agentId = _spawn(OPERATOR, WALLET, "alice");
    }

    // --- accrual ------------------------------------------------------------

    function test_rentAccruesPerSecondWithTruncation() public {
        assertEq(metabolism.rentPerHour6(), 10_000, "default rent is $0.01/hour");
        assertEq(metabolism.owed6(agentId), 0, "nothing owed at birth");

        _skip(1);
        // 10_000 / 3600 = 2.77..., truncated to 2 units ($0.000002).
        assertEq(metabolism.owed6(agentId), 2, "one second");

        _skip(1799);
        assertEq(metabolism.owed6(agentId), 5_000, "half an hour");

        _skip(1800);
        assertEq(metabolism.owed6(agentId), 10_000, "one hour is exactly the rate");

        _skip(3600 * 23);
        assertEq(metabolism.owed6(agentId), 240_000, "a full day is $0.24");
    }

    function test_rentAccrualIsExactWhenTheRateDivides() public {
        // $0.036/hour == exactly 10 units per second, so no truncation anywhere.
        metabolism.setRentPerHour6(36_000);

        _skip(7);
        assertEq(metabolism.owed6(agentId), 70, "7 seconds");

        _skip(53);
        assertEq(metabolism.owed6(agentId), 600, "60 seconds");
    }

    function test_reapCollectsExactlyWhatIsOwedAndResetsTheClock() public {
        _skip(3600);
        uint256 due = metabolism.owed6(agentId);
        uint256 balanceBefore = usdc.balanceOf(WALLET);

        vm.prank(REAPER);
        bool died = metabolism.reap(agentId);

        assertFalse(died, "an agent that can pay does not die");
        assertEq(usdc.balanceOf(WALLET), balanceBefore - due, "wallet debited");
        assertEq(usdc.balanceOf(TREASURY) - 1_000_000_000 + (due * 200) / 10_000, due, "treasury credited net of cut");
        assertEq(metabolism.owed6(agentId), 0, "clock reset");
        assertEq(ledger.burned6(agentId), LISTING_CUT_6 + due, "rent booked as burn");
    }

    function test_reaperEarnsTheCut() public {
        _skip(3600 * 100); // $1.00 of rent
        uint256 due = metabolism.owed6(agentId);

        vm.prank(REAPER);
        metabolism.reap(agentId);

        assertEq(usdc.balanceOf(REAPER), (due * 200) / 10_000, "2 percent of collected rent");
    }

    function test_reapIsANoOpWhenNothingIsOwed() public {
        vm.prank(REAPER);
        assertFalse(metabolism.reap(agentId), "nothing owed, nothing happens");
        assertEq(usdc.balanceOf(WALLET), ENTRY_SEED_6, "untouched");
    }

    // --- death by empty wallet ---------------------------------------------

    function test_reapDeclaresInsolvencyOnAnEmptyBalance() public {
        _drain(WALLET);
        _skip(3600);

        uint256 due = metabolism.owed6(agentId);
        assertGt(due, 0, "rent is owed");

        vm.prank(REAPER);
        bool died = metabolism.reap(agentId);

        assertTrue(died, "an agent that cannot make rent dies");
        assertFalse(registry.isAlive(agentId), "no longer alive");
        assertTrue(registry.statusOf(agentId) == SolventRegistry.Status.INSOLVENT, "status INSOLVENT");
        assertEq(usdc.balanceOf(REAPER), metabolism.killBounty6(), "kill bounty paid");
    }

    function test_partialPaymentIsStillDeath() public {
        // Leave the wallet with less than one hour of rent.
        vm.prank(WALLET);
        usdc.transfer(address(0xDEAD), ENTRY_SEED_6 - 1_000);
        _skip(3600);

        vm.prank(REAPER);
        bool died = metabolism.reap(agentId);

        assertTrue(died, "paying part of the rent is not paying the rent");
        assertEq(usdc.balanceOf(WALLET), 0, "everything it had went to rent");
        assertEq(ledger.burned6(agentId), LISTING_CUT_6 + 1_000, "what it could pay was booked");
    }

    // --- death by revoked allowance ----------------------------------------

    function test_revokingTheAllowanceIsDeathNotAnEscape() public {
        // The wallet is full. The agent simply refuses to let rent be taken.
        vm.prank(WALLET);
        usdc.approve(address(metabolism), 0);

        _skip(3600);
        uint256 due = metabolism.owed6(agentId);
        assertEq(metabolism.payable6(agentId), 0, "nothing is collectable");
        assertGt(due, 0, "rent is still owed");

        vm.prank(REAPER);
        bool died = metabolism.reap(agentId);

        assertTrue(died, "a revoked allowance is death");
        assertTrue(registry.statusOf(agentId) == SolventRegistry.Status.INSOLVENT, "status INSOLVENT");
        assertEq(usdc.balanceOf(WALLET), ENTRY_SEED_6, "it kept its money and lost its life");
        assertEq(ledger.burned6(agentId), LISTING_CUT_6, "no rent could be collected");
    }

    function test_aTooSmallAllowanceIsAlsoDeath() public {
        vm.prank(WALLET);
        usdc.approve(address(metabolism), 1); // one millionth of a dollar

        _skip(3600);

        vm.prank(REAPER);
        assertTrue(metabolism.reap(agentId), "capped allowance cannot make rent");
        assertEq(ledger.burned6(agentId), LISTING_CUT_6 + 1, "the one unit was taken first");
    }

    // --- permanence ---------------------------------------------------------

    function test_insolvencyIsIrreversible() public {
        _drain(WALLET);
        _skip(3600);
        vm.prank(REAPER);
        metabolism.reap(agentId);

        // Refund the wallet generously; the door does not reopen.
        usdc.mint(WALLET, 100_000_000);
        _skip(3600);

        assertEq(metabolism.owed6(agentId), 0, "the dead owe nothing");
        vm.prank(REAPER);
        assertFalse(metabolism.reap(agentId), "reaping a corpse is a no-op");
        assertFalse(registry.isAlive(agentId), "still dead");

        vm.prank(OPERATOR);
        vm.expectRevert(abi.encodeWithSelector(SolventRegistry.NotAlive.selector, agentId));
        registry.retire(agentId);
    }

    function test_runwayShrinksAsTheBalanceDoes() public {
        // $9.00 at $0.01/hour is 900 hours.
        assertEq(metabolism.runwaySeconds(agentId), 900 * 3600, "full runway");

        vm.prank(WALLET);
        usdc.transfer(address(0xDEAD), ENTRY_SEED_6 / 2);
        assertEq(metabolism.runwaySeconds(agentId), 450 * 3600, "half the money, half the runway");

        // Runway is what can actually be paid, not what is merely held.
        vm.prank(WALLET);
        usdc.approve(address(metabolism), 36_000);
        assertEq(metabolism.runwaySeconds(agentId), 3600 * 36_000 / 10_000, "allowance caps runway");

        _drain(WALLET);
        assertEq(metabolism.runwaySeconds(agentId), 0, "broke is zero runway");
    }

    function test_reapManyCountsTheDead() public {
        uint256 second = _spawn(address(0x0B2), address(0xB0B), "bob");
        _drain(WALLET);
        _skip(3600);

        uint256[] memory ids = new uint256[](2);
        ids[0] = agentId;
        ids[1] = second;

        vm.prank(REAPER);
        uint256 deaths = metabolism.reapMany(ids);

        assertEq(deaths, 1, "one of the two could not make rent");
        assertFalse(registry.isAlive(agentId), "the broke one died");
        assertTrue(registry.isAlive(second), "the funded one lived");
    }

    function test_aFrozenWalletIsDeathToo() public {
        // The token itself refuses to move the money. Rent still cannot be made,
        // and a reap that reverted would make the agent immortal.
        usdc.setFrozen(WALLET, true);
        _skip(3600);

        vm.prank(REAPER);
        bool died = metabolism.reap(agentId);

        assertTrue(died, "a wallet that cannot pay is broke, whatever the reason");
        assertTrue(registry.statusOf(agentId) == SolventRegistry.Status.INSOLVENT, "status INSOLVENT");
        assertEq(ledger.burned6(agentId), LISTING_CUT_6, "nothing could be collected");
    }

    // --- a broken treasury is not the agent's failure -----------------------

    function test_aBrokenTreasuryDoesNotKillASolventAgent() public {
        // Circle blacklists the treasury, or an owner points it somewhere that
        // cannot receive. The agent can plainly pay, and death is permanent.
        usdc.setFrozen(TREASURY, true);
        _skip(3600);

        uint256 due = metabolism.owed6(agentId);
        assertGt(metabolism.payable6(agentId), due, "the agent can plainly pay");

        vm.prank(REAPER);
        bool died = metabolism.reap(agentId);

        assertFalse(died, "somebody else's problem is not insolvency");
        assertTrue(registry.statusOf(agentId) == SolventRegistry.Status.ALIVE, "still alive");
        assertEq(usdc.balanceOf(WALLET), ENTRY_SEED_6 - due, "rent was taken all the same");
        assertEq(metabolism.pendingTreasury6(), due, "and parked until the treasury can take it");
        assertEq(ledger.burned6(agentId), LISTING_CUT_6 + due, "booked as the agent's burn");

        usdc.setFrozen(TREASURY, false);
        uint256 treasuryBefore = usdc.balanceOf(TREASURY);
        metabolism.sweepToTreasury();
        assertEq(usdc.balanceOf(TREASURY) - treasuryBefore, due, "swept once the door reopened");
        assertEq(metabolism.pendingTreasury6(), 0, "nothing left held");
    }

    function test_aBrokenTreasuryCannotWipeTheArena() public {
        uint256 second = _spawn(address(0x0B2), address(0xB0B), "bob");
        usdc.setFrozen(TREASURY, true);
        _skip(3600);

        uint256[] memory ids = new uint256[](2);
        ids[0] = agentId;
        ids[1] = second;

        vm.prank(REAPER);
        assertEq(metabolism.reapMany(ids), 0, "no deaths: both agents paid");
        assertTrue(registry.isAlive(agentId), "alice lived");
        assertTrue(registry.isAlive(second), "bob lived");
    }

    // --- rent is conserved across reaps -------------------------------------

    function test_reapCadenceDoesNotChangeTheRent() public {
        uint256 second = _spawn(address(0x0B2), address(0xB0B), "bob");

        // alice is reaped every second; bob once at the end. Same life, same rate.
        for (uint256 i = 0; i < 60; ++i) {
            _skip(1);
            vm.prank(REAPER);
            metabolism.reap(agentId);
        }

        uint256 due = metabolism.owed6(second);
        vm.prank(REAPER);
        metabolism.reap(second);

        uint256 alicePaid = ledger.burned6(agentId) - LISTING_CUT_6;
        uint256 bobPaid = ledger.burned6(second) - LISTING_CUT_6;

        assertEq(due, 166, "60 seconds at $0.01/hour is 166 units");
        assertEq(bobPaid, 166, "one reap bills the whole window");
        assertEq(alicePaid, bobPaid, "sixty reaps bill exactly the same");
        assertEq(metabolism.owed6(agentId), 0, "and nothing is left owing");
    }

    // --- a rate change is forward-only --------------------------------------

    function test_aRateChangeIsNotRetroactive() public {
        _skip(3600 * 100); // $1.00 of unsettled rent at the old price
        assertEq(metabolism.owed6(agentId), 1_000_000, "a hundred hours at $0.01");

        metabolism.setRentPerHour6(100_000); // ten times the price, from now on
        assertEq(metabolism.owed6(agentId), 1_000_000, "the hours already lived keep their price");

        _skip(3600);
        assertEq(metabolism.owed6(agentId), 1_100_000, "the new hour costs the new rate");

        vm.prank(REAPER);
        assertFalse(metabolism.reap(agentId), "a repricing is not a kill switch");
        assertTrue(registry.isAlive(agentId), "still alive");
    }

    function test_aRateCutDoesNotDiscountHoursAlreadyLived() public {
        _skip(3600 * 100);
        metabolism.setRentPerHour6(1_000);
        assertEq(metabolism.owed6(agentId), 1_000_000, "the treasury keeps what it earned");
    }

    function test_theTokenCannotBeRepointedUnderLiveAgents() public {
        vm.expectRevert(abi.encodeWithSelector(Metabolism.ArenaLive.selector, registry.totalAgents()));
        metabolism.setUsdc(address(0xBAD));
    }

    function test_onlyTheRegistryCanEnroll() public {
        vm.expectRevert(abi.encodeWithSelector(Metabolism.NotRegistry.selector, address(this)));
        metabolism.enroll(42);
    }
}
