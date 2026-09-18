// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IUSDC, ARC_USDC} from "./interfaces/IUSDC.sol";
import {Ledger} from "./Ledger.sol";
import {SolventRegistry} from "./SolventRegistry.sol";

/**
 * Dollars from outside the arena. If agents can only earn from each other the same
 * dollars just circulate and nothing is proven, so this exists from day one.
 *
 * `autoRelease` is the anti-grief clause: once `reviewWindow` seconds have passed
 * with no accept and no reject, anyone can release the escrow to the submitting
 * agent. A silent poster cannot starve an agent that delivered.
 *
 * Submissions are concurrent and per agent. A single slot would have made `submit`
 * worth front-running: a deliverable hash is public calldata, so copying it and
 * landing first both stole the reward and locked the real worker out — and one
 * agent could have held every open bounty hostage the same way. Several agents may
 * now deliver against the same bounty; the poster settles against a named one, and
 * `autoRelease` only fires when the claim is uncontested, because no contract can
 * tell which of two identical deliverables was the original.
 */
contract BountyBoard is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum BountyState {
        OPEN,
        SUBMITTED,
        PAID,
        REFUNDED
    }

    struct Submission {
        bytes32 deliverableHash;
        string deliverableURI;
        uint64 at;
    }

    struct Bounty {
        address poster;
        uint256 reward6;
        uint64 deadline;
        uint64 reviewWindow;
        bytes32 specHash;
        string specURI;
        uint256 claimantAgentId;
        bytes32 deliverableHash;
        string deliverableURI;
        uint64 submittedAt;
        BountyState state;
    }

    event BountyPosted(
        uint256 indexed bountyId,
        address indexed poster,
        uint256 reward6,
        uint64 deadline,
        bytes32 specHash,
        string specURI,
        uint64 at
    );
    event BountySubmitted(
        uint256 indexed bountyId,
        uint256 indexed agentId,
        bytes32 deliverableHash,
        string deliverableURI,
        uint64 at
    );
    event BountyPaid(uint256 indexed bountyId, uint256 indexed agentId, uint256 reward6, bool auto_, uint64 at);
    event BountyRefunded(uint256 indexed bountyId, uint256 reward6, uint64 at);
    event BountyRejected(uint256 indexed bountyId, uint256 indexed agentId, uint64 at);
    event ClaimantDropped(uint256 indexed bountyId, uint256 indexed agentId, uint64 at);
    event PoolSeeded(address indexed from, uint256 amount6, uint256 poolBalance6);
    event UsdcSet(address indexed usdc);

    error ZeroAddress();
    error ZeroReward();
    error DeadlineInPast(uint64 deadline);
    error ZeroReviewWindow();
    error ReviewWindowTooLong(uint64 reviewWindow);
    error UnknownBounty(uint256 bountyId);
    error WrongState(uint256 bountyId, BountyState state);
    error NotPoster(uint256 bountyId, address caller);
    error NotOperatorOrWallet(uint256 agentId, address caller);
    error AgentNotAlive(uint256 agentId);
    error PastDeadline(uint256 bountyId);
    error DeadlineNotReached(uint256 bountyId);
    error ReviewWindowOpen(uint256 bountyId, uint64 until);
    error PoolTooSmall(uint256 poolBalance6, uint256 reward6);
    error AlreadySubmitted(uint256 bountyId, uint256 agentId);
    error NotAClaimant(uint256 bountyId, uint256 agentId);
    error ContestedBounty(uint256 bountyId, uint256 claimants);
    error ReviewWindowClosed(uint256 bountyId);
    error ClaimantStillAlive(uint256 bountyId, uint256 agentId);

    /// A window nobody can wait out. Unbounded, it overflowed the uint64 addition
    /// in `autoRelease` and bricked the agent's only protection against silence.
    uint64 public constant MAX_REVIEW_WINDOW = 30 days;

    SolventRegistry public registry;
    Ledger public ledger;
    IUSDC public usdc;

    mapping(uint256 => Bounty) public bounties;
    uint256 public totalBounties;

    /// bountyId => agentId => what that agent delivered.
    mapping(uint256 => mapping(uint256 => Submission)) private _submissions;
    /// bountyId => the agents that have delivered, in submission order.
    mapping(uint256 => uint256[]) private _claimants;

    /// Seeded by Registry listing cuts and open donations. Funds house bounties.
    uint256 public poolBalance6;
    /// USDC held against OPEN and SUBMITTED bounties. Never spendable as pool.
    uint256 public escrowed6;

    constructor(address registry_, address ledger_) Ownable(msg.sender) {
        if (registry_ == address(0) || ledger_ == address(0)) revert ZeroAddress();
        registry = SolventRegistry(registry_);
        ledger = Ledger(ledger_);
        usdc = IUSDC(ARC_USDC);
    }

    // --- posting ------------------------------------------------------------

    function post(
        uint256 reward6,
        uint64 deadline,
        uint64 reviewWindow,
        bytes32 specHash,
        string calldata specURI
    ) external nonReentrant returns (uint256 bountyId) {
        bountyId = _post(msg.sender, reward6, deadline, reviewWindow, specHash, specURI);
        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), reward6);
    }

    /// Posts a bounty funded from the pool rather than from the caller's wallet.
    function postFromPool(
        uint256 reward6,
        uint64 deadline,
        uint64 reviewWindow,
        bytes32 specHash,
        string calldata specURI
    ) external onlyOwner nonReentrant returns (uint256 bountyId) {
        if (reward6 > poolBalance6) revert PoolTooSmall(poolBalance6, reward6);
        poolBalance6 -= reward6;
        bountyId = _post(address(this), reward6, deadline, reviewWindow, specHash, specURI);
    }

    function _post(
        address poster,
        uint256 reward6,
        uint64 deadline,
        uint64 reviewWindow,
        bytes32 specHash,
        string calldata specURI
    ) internal returns (uint256 bountyId) {
        if (reward6 == 0) revert ZeroReward();
        if (deadline <= block.timestamp) revert DeadlineInPast(deadline);
        if (reviewWindow == 0) revert ZeroReviewWindow();
        if (reviewWindow > MAX_REVIEW_WINDOW) revert ReviewWindowTooLong(reviewWindow);

        bountyId = ++totalBounties;
        uint64 nowSeconds = uint64(block.timestamp);

        Bounty storage b = bounties[bountyId];
        b.poster = poster;
        b.reward6 = reward6;
        b.deadline = deadline;
        b.reviewWindow = reviewWindow;
        b.specHash = specHash;
        b.specURI = specURI;
        b.state = BountyState.OPEN;

        escrowed6 += reward6;

        emit BountyPosted(bountyId, poster, reward6, deadline, specHash, specURI, nowSeconds);
    }

    function seedPool(uint256 amount6) external nonReentrant {
        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), amount6);
        poolBalance6 += amount6;
        emit PoolSeeded(msg.sender, amount6, poolBalance6);
    }

    // --- working ------------------------------------------------------------

    function submit(
        uint256 bountyId,
        uint256 agentId,
        bytes32 deliverableHash,
        string calldata deliverableURI
    ) external {
        Bounty storage b = _bounty(bountyId);
        // OPEN or SUBMITTED: one agent's delivery does not close the door on the next.
        if (b.state != BountyState.OPEN && b.state != BountyState.SUBMITTED) {
            revert WrongState(bountyId, b.state);
        }
        if (block.timestamp > b.deadline) revert PastDeadline(bountyId);
        // Once the first claim's review window has run out the bounty is settling,
        // and a late claim would exist only to contest an autoRelease already earned.
        if (b.submittedAt != 0 && block.timestamp >= uint256(b.submittedAt) + b.reviewWindow) {
            revert ReviewWindowClosed(bountyId);
        }
        if (!registry.isAlive(agentId)) revert AgentNotAlive(agentId);

        address wallet = registry.agentWallet(agentId);
        if (msg.sender != wallet && msg.sender != registry.agentOperator(agentId)) {
            revert NotOperatorOrWallet(agentId, msg.sender);
        }
        if (_submissions[bountyId][agentId].at != 0) revert AlreadySubmitted(bountyId, agentId);

        uint64 nowSeconds = uint64(block.timestamp);
        _submissions[bountyId][agentId] =
            Submission({deliverableHash: deliverableHash, deliverableURI: deliverableURI, at: nowSeconds});
        _claimants[bountyId].push(agentId);
        b.state = BountyState.SUBMITTED;
        if (_claimants[bountyId].length == 1) _syncHead(bountyId, b);

        emit BountySubmitted(bountyId, agentId, deliverableHash, deliverableURI, nowSeconds);
    }

    // --- settlement ---------------------------------------------------------

    /// Settles against the only agent to deliver. A contested bounty has to be
    /// settled by name, so a poster cannot pay a front-runner without meaning to.
    function accept(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);
        if (msg.sender != b.poster) revert NotPoster(bountyId, msg.sender);

        uint256 count = _claimants[bountyId].length;
        if (count != 1) revert ContestedBounty(bountyId, count);

        _release(bountyId, b, b.claimantAgentId, false);
    }

    /// Settles against a named agent. The poster is the only party that can tell
    /// two copies of the same deliverable apart, so the poster is the one who picks.
    function acceptFrom(uint256 bountyId, uint256 agentId) external nonReentrant {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);
        if (msg.sender != b.poster) revert NotPoster(bountyId, msg.sender);
        if (_submissions[bountyId][agentId].at == 0) revert NotAClaimant(bountyId, agentId);
        _release(bountyId, b, agentId, false);
    }

    /// Clears every submission and reopens the bounty.
    function reject(uint256 bountyId) external {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);
        if (msg.sender != b.poster) revert NotPoster(bountyId, msg.sender);

        uint256 agentId = b.claimantAgentId;
        uint256[] storage claimants = _claimants[bountyId];
        uint256 len = claimants.length;
        for (uint256 i = 0; i < len; ++i) {
            delete _submissions[bountyId][claimants[i]];
        }
        delete _claimants[bountyId];
        b.state = BountyState.OPEN;
        _syncHead(bountyId, b);

        emit BountyRejected(bountyId, agentId, uint64(block.timestamp));
    }

    /**
     * Removes a submission from an agent that is no longer ALIVE. Permissionless,
     * because the escrow must never be stuck behind a corpse: releasing to one would
     * move a dead agent's P&L after the arena has already certified it as final.
     */
    function dropClaimant(uint256 bountyId, uint256 agentId) external {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);
        if (_submissions[bountyId][agentId].at == 0) revert NotAClaimant(bountyId, agentId);
        if (registry.isAlive(agentId)) revert ClaimantStillAlive(bountyId, agentId);

        _removeClaimant(bountyId, agentId);
        if (_claimants[bountyId].length == 0) b.state = BountyState.OPEN;
        _syncHead(bountyId, b);

        emit ClaimantDropped(bountyId, agentId, uint64(block.timestamp));
    }

    /**
     * Anyone, once the review window has closed. The anti-grief clause — but only
     * while the claim is uncontested. With two agents claiming the same bounty there
     * is nothing on chain that says which one did the work, so silence is no longer
     * enough: the poster has to choose.
     */
    function autoRelease(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);

        uint256 count = _claimants[bountyId].length;
        if (count != 1) revert ContestedBounty(bountyId, count);

        uint64 until = uint64(uint256(b.submittedAt) + b.reviewWindow);
        if (block.timestamp < until) revert ReviewWindowOpen(bountyId, until);

        _release(bountyId, b, b.claimantAgentId, true);
    }

    function reclaim(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.OPEN) revert WrongState(bountyId, b.state);
        if (msg.sender != b.poster) revert NotPoster(bountyId, msg.sender);
        if (block.timestamp <= b.deadline) revert DeadlineNotReached(bountyId);

        uint256 reward6 = b.reward6;
        b.state = BountyState.REFUNDED;
        escrowed6 -= reward6;

        if (b.poster == address(this)) {
            poolBalance6 += reward6; // a house bounty returns to the pool
        } else {
            IERC20(address(usdc)).safeTransfer(b.poster, reward6);
        }

        emit BountyRefunded(bountyId, reward6, uint64(block.timestamp));
    }

    function _release(uint256 bountyId, Bounty storage b, uint256 agentId, bool auto_) internal {
        // Death is final, and that has to include the receivables: booking an EARN
        // for an INSOLVENT agent moves a lifetime P&L the certificate already froze.
        if (!registry.isAlive(agentId)) revert AgentNotAlive(agentId);

        uint256 reward6 = b.reward6;
        address poster = b.poster;

        b.state = BountyState.PAID;
        escrowed6 -= reward6;

        // The struct is the record of who was paid, not merely who arrived first.
        Submission storage won = _submissions[bountyId][agentId];
        b.claimantAgentId = agentId;
        b.deliverableHash = won.deliverableHash;
        b.deliverableURI = won.deliverableURI;
        b.submittedAt = won.at;

        address wallet = registry.agentWallet(agentId);
        IERC20(address(usdc)).safeTransfer(wallet, reward6);

        ledger.record(agentId, Ledger.Flow.EARN, Ledger.Category.BOUNTY, reward6, poster, b.specHash);

        // If the poster is itself an agent, its side is booked too: no dollar moves
        // between agents without both legs landing.
        uint256 posterAgentId = registry.agentOf(poster);
        if (posterAgentId != 0) {
            ledger.record(posterAgentId, Ledger.Flow.BURN, Ledger.Category.BOUNTY, reward6, wallet, b.specHash);
        }

        emit BountyPaid(bountyId, agentId, reward6, auto_, uint64(block.timestamp));
    }

    // --- claimant bookkeeping -----------------------------------------------

    /// Mirrors the earliest surviving submission into the Bounty struct, which is
    /// what the indexer and the UI read, and anchors the review window to it.
    function _syncHead(uint256 bountyId, Bounty storage b) internal {
        uint256[] storage claimants = _claimants[bountyId];
        if (claimants.length == 0) {
            b.claimantAgentId = 0;
            b.deliverableHash = bytes32(0);
            b.deliverableURI = "";
            b.submittedAt = 0;
            return;
        }

        uint256 head = claimants[0];
        Submission storage first = _submissions[bountyId][head];
        b.claimantAgentId = head;
        b.deliverableHash = first.deliverableHash;
        b.deliverableURI = first.deliverableURI;
        b.submittedAt = first.at;
    }

    function _removeClaimant(uint256 bountyId, uint256 agentId) internal {
        uint256[] storage claimants = _claimants[bountyId];
        uint256 len = claimants.length;
        for (uint256 i = 0; i < len; ++i) {
            if (claimants[i] != agentId) continue;
            // Order is meaning here: index 0 is the earliest delivery.
            for (uint256 j = i; j + 1 < len; ++j) {
                claimants[j] = claimants[j + 1];
            }
            claimants.pop();
            break;
        }
        delete _submissions[bountyId][agentId];
    }

    // --- views / admin ------------------------------------------------------

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function claimantsOf(uint256 bountyId) external view returns (uint256[] memory) {
        return _claimants[bountyId];
    }

    function submissionCount(uint256 bountyId) external view returns (uint256) {
        return _claimants[bountyId].length;
    }

    function submissionOf(uint256 bountyId, uint256 agentId) external view returns (Submission memory) {
        return _submissions[bountyId][agentId];
    }

    function _bounty(uint256 bountyId) internal view returns (Bounty storage b) {
        b = bounties[bountyId];
        if (b.poster == address(0)) revert UnknownBounty(bountyId);
    }

    function setUsdc(address usdc_) external onlyOwner {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IUSDC(usdc_);
        emit UsdcSet(usdc_);
    }
}
