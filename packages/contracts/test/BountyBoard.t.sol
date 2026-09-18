// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Arena} from "./Arena.sol";
import {BountyBoard} from "../contracts/BountyBoard.sol";

/// Dollars from outside the arena, and the clause that stops a silent poster
/// from griefing an agent that delivered.
contract BountyBoardTest is Arena {
    address internal constant OPERATOR = address(0x0A1);
    address internal constant WALLET = address(0xA11CE);
    address internal constant POSTER = address(0x9057);

    uint256 internal agentId;
    uint256 internal bountyId;

    uint64 internal constant REVIEW_WINDOW = 2 days;
    uint256 internal constant REWARD_6 = 25_000_000; // $25.00

    function setUp() public {
        _deployArena();
        agentId = _spawn(OPERATOR, WALLET, "alice");

        usdc.mint(POSTER, REWARD_6 * 4);
        vm.startPrank(POSTER);
        usdc.approve(address(board), REWARD_6 * 4);
        bountyId = board.post(REWARD_6, uint64(block.timestamp + 7 days), REVIEW_WINDOW, bytes32("spec"), "ipfs://spec");
        vm.stopPrank();
    }

    function _submit() internal {
        vm.prank(WALLET);
        board.submit(bountyId, agentId, bytes32("deliverable"), "ipfs://deliverable");
    }

    function test_postingEscrowsTheReward() public view {
        assertEq(usdc.balanceOf(address(board)), REWARD_6 + LISTING_CUT_6, "escrow plus the listing cut");
        assertEq(board.escrowed6(), REWARD_6, "escrow tracked separately from the pool");
        assertEq(board.poolBalance6(), LISTING_CUT_6, "the registry seeded the pool");
    }

    function test_acceptPaysTheAgentAndBooksTheEarn() public {
        _submit();
        uint256 balanceBefore = usdc.balanceOf(WALLET);

        vm.prank(POSTER);
        board.accept(bountyId);

        assertEq(usdc.balanceOf(WALLET), balanceBefore + REWARD_6, "paid to the agent's own wallet");
        assertEq(ledger.earned6(agentId), REWARD_6, "booked as revenue");
        assertEq(board.escrowed6(), 0, "escrow released");
    }

    function test_autoReleasePaysTheAgentAfterTheReviewWindow() public {
        _submit();
        uint256 balanceBefore = usdc.balanceOf(WALLET);

        // The poster goes silent. Anyone at all can close the loop.
        _skip(REVIEW_WINDOW);
        vm.prank(REAPER);
        board.autoRelease(bountyId);

        assertEq(usdc.balanceOf(WALLET), balanceBefore + REWARD_6, "the agent got paid anyway");
        assertEq(ledger.earned6(agentId), REWARD_6, "and it counts as revenue");
    }

    function test_autoReleaseRevertsWhileTheWindowIsOpen() public {
        _submit();

        _skip(REVIEW_WINDOW - 1);
        // Read the stored timestamp back: the optimizer treats block.timestamp as
        // constant within a call, which a warp between statements is not.
        uint64 submittedAt = board.getBounty(bountyId).submittedAt;
        vm.prank(REAPER);
        vm.expectRevert(
            abi.encodeWithSelector(BountyBoard.ReviewWindowOpen.selector, bountyId, submittedAt + REVIEW_WINDOW)
        );
        board.autoRelease(bountyId);
    }

    function test_autoReleaseNeedsASubmission() public {
        _skip(REVIEW_WINDOW * 2);
        vm.expectRevert(
            abi.encodeWithSelector(BountyBoard.WrongState.selector, bountyId, BountyBoard.BountyState.OPEN)
        );
        board.autoRelease(bountyId);
    }

    function test_rejectReopensTheBounty() public {
        _submit();

        vm.prank(POSTER);
        board.reject(bountyId);

        BountyBoard.Bounty memory b = board.getBounty(bountyId);
        assertTrue(b.state == BountyBoard.BountyState.OPEN, "back to open");
        assertEq(b.claimantAgentId, 0, "claimant cleared");
        assertEq(usdc.balanceOf(WALLET), ENTRY_SEED_6, "nothing was paid");

        // And a rejected submission can be replaced.
        _submit();
        assertTrue(board.getBounty(bountyId).state == BountyBoard.BountyState.SUBMITTED, "resubmitted");
    }

    function test_rejectingForeverStillEndsInAPayout() public {
        // The griefing path: reject, then go silent. The agent resubmits and the
        // review window releases the escrow without the poster's cooperation.
        _submit();
        vm.prank(POSTER);
        board.reject(bountyId);
        _submit();

        _skip(REVIEW_WINDOW);
        board.autoRelease(bountyId);
        assertEq(ledger.earned6(agentId), REWARD_6, "paid");
    }

    function test_posterReclaimsAfterTheDeadline() public {
        uint256 balanceBefore = usdc.balanceOf(POSTER);
        _skip(8 days);

        vm.prank(POSTER);
        board.reclaim(bountyId);

        assertEq(usdc.balanceOf(POSTER), balanceBefore + REWARD_6, "refunded");
        assertTrue(board.getBounty(bountyId).state == BountyBoard.BountyState.REFUNDED, "refunded state");
    }

    function test_reclaimIsBlockedOnceWorkIsSubmitted() public {
        _submit();
        _skip(8 days);

        vm.prank(POSTER);
        vm.expectRevert(
            abi.encodeWithSelector(BountyBoard.WrongState.selector, bountyId, BountyBoard.BountyState.SUBMITTED)
        );
        board.reclaim(bountyId);
    }

    function test_onlyAliveAgentsCanSubmit() public {
        _drain(WALLET);
        _skip(3600);
        vm.prank(REAPER);
        metabolism.reap(agentId);

        vm.prank(WALLET);
        vm.expectRevert(abi.encodeWithSelector(BountyBoard.AgentNotAlive.selector, agentId));
        board.submit(bountyId, agentId, bytes32("deliverable"), "ipfs://deliverable");
    }

    function test_submissionAfterTheDeadlineIsRefused() public {
        _skip(8 days);
        vm.prank(WALLET);
        vm.expectRevert(abi.encodeWithSelector(BountyBoard.PastDeadline.selector, bountyId));
        board.submit(bountyId, agentId, bytes32("deliverable"), "ipfs://deliverable");
    }

    function test_poolCanFundAHouseBounty() public {
        uint256 poolBefore = board.poolBalance6();
        assertGt(poolBefore, 0, "seeded by the listing cut");

        uint256 houseId = board.postFromPool(
            poolBefore,
            uint64(block.timestamp + 1 days),
            REVIEW_WINDOW,
            bytes32("house"),
            "ipfs://house"
        );

        assertEq(board.poolBalance6(), 0, "pool spent");
        vm.prank(WALLET);
        board.submit(houseId, agentId, bytes32("done"), "ipfs://done");

        _skip(REVIEW_WINDOW);
        board.autoRelease(houseId);
        assertEq(ledger.earned6(agentId), poolBefore, "the pool paid an agent");
    }

    function test_anAgentPostingABountyBurnsForIt() public {
        // Both legs of an agent-to-agent dollar, even through the board.
        uint256 poster = _spawn(address(0x0B2), address(0xB0B), "bob");
        vm.startPrank(address(0xB0B));
        usdc.approve(address(board), 1_000_000);
        uint256 id = board.post(1_000_000, uint64(block.timestamp + 1 days), REVIEW_WINDOW, bytes32("s"), "ipfs://s");
        vm.stopPrank();

        vm.prank(WALLET);
        board.submit(id, agentId, bytes32("done"), "ipfs://done");
        _skip(REVIEW_WINDOW);
        board.autoRelease(id);

        assertEq(ledger.earned6(agentId), 1_000_000, "worker earned");
        assertEq(ledger.burned6(poster), LISTING_CUT_6 + 1_000_000, "poster burned");
    }
}
