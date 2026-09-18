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
 */
contract BountyBoard is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum BountyState {
        OPEN,
        SUBMITTED,
        PAID,
        REFUNDED
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
    event PoolSeeded(address indexed from, uint256 amount6, uint256 poolBalance6);
    event UsdcSet(address indexed usdc);

    error ZeroAddress();
    error ZeroReward();
    error DeadlineInPast(uint64 deadline);
    error ZeroReviewWindow();
    error UnknownBounty(uint256 bountyId);
    error WrongState(uint256 bountyId, BountyState state);
    error NotPoster(uint256 bountyId, address caller);
    error NotOperatorOrWallet(uint256 agentId, address caller);
    error AgentNotAlive(uint256 agentId);
    error PastDeadline(uint256 bountyId);
    error DeadlineNotReached(uint256 bountyId);
    error ReviewWindowOpen(uint256 bountyId, uint64 until);
    error PoolTooSmall(uint256 poolBalance6, uint256 reward6);

    SolventRegistry public registry;
    Ledger public ledger;
    IUSDC public usdc;

    mapping(uint256 => Bounty) public bounties;
    uint256 public totalBounties;

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
        if (b.state != BountyState.OPEN) revert WrongState(bountyId, b.state);
        if (block.timestamp > b.deadline) revert PastDeadline(bountyId);
        if (!registry.isAlive(agentId)) revert AgentNotAlive(agentId);

        address wallet = registry.agentWallet(agentId);
        if (msg.sender != wallet && msg.sender != registry.agentOperator(agentId)) {
            revert NotOperatorOrWallet(agentId, msg.sender);
        }

        uint64 nowSeconds = uint64(block.timestamp);
        b.claimantAgentId = agentId;
        b.deliverableHash = deliverableHash;
        b.deliverableURI = deliverableURI;
        b.submittedAt = nowSeconds;
        b.state = BountyState.SUBMITTED;

        emit BountySubmitted(bountyId, agentId, deliverableHash, deliverableURI, nowSeconds);
    }

    // --- settlement ---------------------------------------------------------

    function accept(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);
        if (msg.sender != b.poster) revert NotPoster(bountyId, msg.sender);
        _release(bountyId, b, false);
    }

    function reject(uint256 bountyId) external {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);
        if (msg.sender != b.poster) revert NotPoster(bountyId, msg.sender);

        uint256 agentId = b.claimantAgentId;
        b.claimantAgentId = 0;
        b.deliverableHash = bytes32(0);
        b.deliverableURI = "";
        b.submittedAt = 0;
        b.state = BountyState.OPEN;

        emit BountyRejected(bountyId, agentId, uint64(block.timestamp));
    }

    /// Anyone, once the review window has closed. The anti-grief clause.
    function autoRelease(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounty(bountyId);
        if (b.state != BountyState.SUBMITTED) revert WrongState(bountyId, b.state);

        uint64 until = b.submittedAt + b.reviewWindow;
        if (block.timestamp < until) revert ReviewWindowOpen(bountyId, until);

        _release(bountyId, b, true);
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

    function _release(uint256 bountyId, Bounty storage b, bool auto_) internal {
        uint256 agentId = b.claimantAgentId;
        uint256 reward6 = b.reward6;
        address poster = b.poster;

        b.state = BountyState.PAID;
        escrowed6 -= reward6;

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

    // --- views / admin ------------------------------------------------------

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
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
