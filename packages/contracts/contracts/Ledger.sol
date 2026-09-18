// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * The append-only P&L record. Every dollar an agent earns or burns lands here as
 * one `Entry`, and the scoreboard is nothing but `earned6 - burned6`.
 *
 * Rule R1 lives in `record`: a CAPITAL entry writes `capitalIn6` and is emitted
 * for auditability, but never touches `earned6`. Funding your own agent must not
 * move its rank.
 */
contract Ledger is Ownable {
    enum Flow {
        EARN,
        BURN
    }

    enum Category {
        RENT,
        SERVICE,
        BOUNTY,
        GAS,
        SPAWN,
        CAPITAL,
        OTHER
    }

    event Entry(
        uint256 indexed agentId,
        Flow indexed flow,
        Category indexed category,
        uint256 amount6,
        address counterparty,
        bytes32 memoHash,
        uint64 at,
        uint256 runningEarned6,
        uint256 runningBurned6
    );

    event ReporterSet(address indexed reporter, bool allowed);

    error NotReporter(address caller);
    error ZeroAgentId();
    error ZeroAddress();

    mapping(uint256 => uint256) public earned6;
    mapping(uint256 => uint256) public burned6;
    mapping(uint256 => uint256) public capitalIn6;

    uint256 public totalEarned6;
    uint256 public totalBurned6;
    uint256 public totalCapitalIn6;

    mapping(address => bool) public reporters;

    constructor() Ownable(msg.sender) {}

    modifier onlyReporter() {
        if (!reporters[msg.sender]) revert NotReporter(msg.sender);
        _;
    }

    function record(
        uint256 agentId,
        Flow flow,
        Category cat,
        uint256 amount6,
        address counterparty,
        bytes32 memoHash
    ) external onlyReporter {
        if (agentId == 0) revert ZeroAgentId();

        Flow effectiveFlow = flow;

        if (cat == Category.CAPITAL) {
            // R1: capital is not revenue. Recorded, displayed, never ranked.
            capitalIn6[agentId] += amount6;
            totalCapitalIn6 += amount6;
            effectiveFlow = Flow.EARN;
        } else if (flow == Flow.EARN) {
            earned6[agentId] += amount6;
            totalEarned6 += amount6;
        } else {
            burned6[agentId] += amount6;
            totalBurned6 += amount6;
        }

        emit Entry(
            agentId,
            effectiveFlow,
            cat,
            amount6,
            counterparty,
            memoHash,
            uint64(block.timestamp),
            earned6[agentId],
            burned6[agentId]
        );
    }

    /// The only number the scoreboard ranks by.
    function net(uint256 agentId) external view returns (int256) {
        return int256(earned6[agentId]) - int256(burned6[agentId]);
    }

    function setReporter(address reporter, bool allowed) external onlyOwner {
        if (reporter == address(0)) revert ZeroAddress();
        reporters[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }
}
