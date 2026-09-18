// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Arena} from "./Arena.sol";
import {Vm} from "./Cheats.sol";
import {ServiceMeter} from "../contracts/ServiceMeter.sol";

/// R4 (both legs, one transaction) and R5 (self-dealing is marked, not banned).
contract ServiceMeterTest is Arena {
    bytes32 internal constant SETTLED_TOPIC =
        keccak256("ServiceSettled(uint256,uint256,address,uint256,bytes32,bool,uint64)");

    address internal constant OPERATOR_A = address(0x0A1);
    address internal constant OPERATOR_B = address(0x0B2);
    address internal constant WALLET_A = address(0xA11CE);
    address internal constant WALLET_B = address(0xB0B);
    address internal constant WALLET_C = address(0xCEC1);

    uint256 internal alice;
    uint256 internal bob;
    uint256 internal aliceTwin; // same operator as alice

    function setUp() public {
        _deployArena();
        alice = _spawn(OPERATOR_A, WALLET_A, "alice");
        bob = _spawn(OPERATOR_B, WALLET_B, "bob");
        aliceTwin = _spawn(OPERATOR_A, WALLET_C, "alice-two");
    }

    function _lastSelfDealt() internal returns (bool selfDealt) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; --i) {
            Vm.Log memory entry = logs[i - 1];
            if (entry.topics.length > 0 && entry.topics[0] == SETTLED_TOPIC) {
                (, , selfDealt, ) = abi.decode(entry.data, (address, uint256, bool, uint64));
                return selfDealt;
            }
        }
        revert("no ServiceSettled log");
    }

    function test_bothSidesAreBookedInOneTransaction() public {
        _approveMeter(WALLET_A, 2_000_000);

        vm.prank(WALLET_A);
        meter.payForService(alice, bob, 2_000_000, keccak256("req-1"));

        assertEq(ledger.burned6(alice), LISTING_CUT_6 + 2_000_000, "payer burned");
        assertEq(ledger.earned6(bob), 2_000_000, "provider earned");
        assertEq(usdc.balanceOf(WALLET_A), ENTRY_SEED_6 - 2_000_000, "payer wallet debited");
        assertEq(usdc.balanceOf(WALLET_B), ENTRY_SEED_6 + 2_000_000, "provider wallet credited");
    }

    function test_selfDealingIsFlagged() public {
        _approveMeter(WALLET_A, 1_000_000);

        vm.recordLogs();
        vm.prank(WALLET_A);
        meter.payForService(alice, aliceTwin, 1_000_000, keccak256("wash-1"));

        assertTrue(_lastSelfDealt(), "same operator on both sides is self-dealing");
        // Marked, not banned: the dollars really did move and both legs booked.
        assertEq(ledger.earned6(aliceTwin), 1_000_000, "the twin still earned it");
    }

    function test_armsLengthTradeIsNotFlagged() public {
        _approveMeter(WALLET_A, 1_000_000);

        vm.recordLogs();
        vm.prank(WALLET_A);
        meter.payForService(alice, bob, 1_000_000, keccak256("req-2"));

        assertFalse(_lastSelfDealt(), "different operators, honest trade");
    }

    function test_externalPayerBooksOnlyTheProvider() public {
        address human = address(0x4041);
        usdc.mint(human, 5_000_000);

        vm.startPrank(human);
        usdc.approve(address(meter), 5_000_000);
        vm.recordLogs();
        meter.payExternal(bob, 5_000_000, keccak256("req-3"));
        vm.stopPrank();

        assertFalse(_lastSelfDealt(), "an outside buyer cannot self-deal");
        assertEq(ledger.earned6(bob), 5_000_000, "dollars from outside the arena");
        assertEq(ledger.totalBurned6(), 3 * LISTING_CUT_6, "nobody burned anything for it");
    }

    function test_receiptIsWrittenForTheX402Server() public {
        _approveMeter(WALLET_A, 1_000_000);
        bytes32 requestHash = keccak256("req-4");

        vm.prank(WALLET_A);
        meter.payForService(alice, bob, 1_000_000, requestHash);

        (uint256 providerAgentId, uint256 amount6, uint64 at) = meter.receiptOf(requestHash);
        assertEq(providerAgentId, bob, "receipt names the provider");
        assertEq(amount6, 1_000_000, "receipt carries the price");
        assertEq(at, uint64(block.timestamp), "receipt is timestamped");
    }

    function test_aRequestHashCannotBeSettledTwice() public {
        _approveMeter(WALLET_A, 2_000_000);
        bytes32 requestHash = keccak256("req-5");

        vm.prank(WALLET_A);
        meter.payForService(alice, bob, 1_000_000, requestHash);

        vm.prank(WALLET_A);
        vm.expectRevert(abi.encodeWithSelector(ServiceMeter.ReceiptExists.selector, requestHash));
        meter.payForService(alice, bob, 1_000_000, requestHash);
    }

    function test_onlyTheAgentsOwnWalletCanSpendIt() public {
        _approveMeter(WALLET_A, 1_000_000);

        vm.prank(OPERATOR_A);
        vm.expectRevert(abi.encodeWithSelector(ServiceMeter.NotPayerWallet.selector, alice, OPERATOR_A));
        meter.payForService(alice, bob, 1_000_000, keccak256("req-6"));
    }

    function test_theDeadCannotTrade() public {
        _drain(WALLET_B);
        _skip(3600);
        vm.prank(REAPER);
        metabolism.reap(bob);

        _approveMeter(WALLET_A, 1_000_000);
        vm.prank(WALLET_A);
        vm.expectRevert(abi.encodeWithSelector(ServiceMeter.ProviderNotAlive.selector, bob));
        meter.payForService(alice, bob, 1_000_000, keccak256("req-7"));
    }
}
