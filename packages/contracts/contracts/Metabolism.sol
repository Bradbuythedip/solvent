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
 * The cost of existing.
 *
 * Rent accrues per second against the agent's OWN wallet through an ERC-20
 * allowance. There is no escrow, because the wallet is the only balance: on Arc
 * the same USDC is the agent's money and its permission to act.
 *
 * `reap` is permissionless. payable = min(due, balance, allowance). If the agent
 * cannot cover what it owes it is declared insolvent, permanently. Revoking the
 * allowance is therefore not an escape hatch — payable falls to zero, zero is less
 * than due, and the agent dies. The system enforces death; no rule asks politely.
 */
contract Metabolism is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_HOUR = 3600;
    /// runwaySeconds is a display figure; one year of runway is "effectively forever".
    uint256 public constant MAX_RUNWAY_SECONDS = 365 days;

    struct Meta {
        uint64 lastSettled;
        uint256 paid6;
        bool enrolled;
    }

    event Reaped(
        uint256 indexed agentId,
        address indexed reaper,
        uint256 due6,
        uint256 collected6,
        uint256 balance6,
        bool died
    );
    event Enrolled(uint256 indexed agentId, uint64 at);
    event ReaperRewarded(uint256 indexed agentId, address indexed reaper, uint256 cut6, uint256 bounty6, bool paid);
    event RentPerHourSet(uint256 rentPerHour6);
    event ReaperCutSet(uint256 reaperCutBps);
    event KillBountySet(uint256 killBounty6);
    event TreasurySet(address indexed treasury);
    event UsdcSet(address indexed usdc);

    error ZeroAddress();
    error NotRegistry(address caller);
    error NotEnrolled(uint256 agentId);
    error AlreadyEnrolled(uint256 agentId);
    error CutTooLarge(uint256 bps);

    uint256 public rentPerHour6 = 10_000; // $0.01 / hour
    uint256 public reaperCutBps = 200; // 2% of collected rent
    uint256 public killBounty6 = 10_000; // $0.01 for confirming a death

    address public treasury;
    SolventRegistry public registry;
    Ledger public ledger;
    IUSDC public usdc;

    mapping(uint256 => Meta) public meta;

    constructor(address registry_, address ledger_, address treasury_) Ownable(msg.sender) {
        if (registry_ == address(0) || ledger_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        registry = SolventRegistry(registry_);
        ledger = Ledger(ledger_);
        treasury = treasury_;
        usdc = IUSDC(ARC_USDC);
    }

    modifier onlyRegistry() {
        if (msg.sender != address(registry)) revert NotRegistry(msg.sender);
        _;
    }

    function enroll(uint256 agentId) external onlyRegistry {
        Meta storage m = meta[agentId];
        if (m.enrolled) revert AlreadyEnrolled(agentId);
        m.enrolled = true;
        m.lastSettled = uint64(block.timestamp);
        emit Enrolled(agentId, m.lastSettled);
    }

    // --- views --------------------------------------------------------------

    /// Rent owed since the last settlement, truncating to whole 6-decimal units.
    function owed6(uint256 agentId) public view returns (uint256) {
        Meta storage m = meta[agentId];
        if (!m.enrolled) return 0;
        if (!registry.isAlive(agentId)) return 0;

        uint256 elapsed = block.timestamp - m.lastSettled;
        return (rentPerHour6 * elapsed) / SECONDS_PER_HOUR;
    }

    /// What the wallet can actually be charged right now: balance AND allowance.
    function payable6(uint256 agentId) public view returns (uint256) {
        address wallet = registry.agentWallet(agentId);
        if (wallet == address(0)) return 0;

        uint256 bal = usdc.balanceOf(wallet);
        uint256 allowed = usdc.allowance(wallet, address(this));
        return bal < allowed ? bal : allowed;
    }

    function runwaySeconds(uint256 agentId) external view returns (uint256) {
        if (!registry.isAlive(agentId)) return 0;
        if (rentPerHour6 == 0) return MAX_RUNWAY_SECONDS;

        uint256 available = payable6(agentId);
        uint256 due = owed6(agentId);
        if (available <= due) return 0;

        uint256 seconds_ = ((available - due) * SECONDS_PER_HOUR) / rentPerHour6;
        return seconds_ > MAX_RUNWAY_SECONDS ? MAX_RUNWAY_SECONDS : seconds_;
    }

    // --- the forcing function ----------------------------------------------

    function reap(uint256 agentId) external nonReentrant returns (bool died) {
        return _reap(agentId);
    }

    function reapMany(uint256[] calldata agentIds) external nonReentrant returns (uint256 deaths) {
        uint256 len = agentIds.length;
        for (uint256 i = 0; i < len; ++i) {
            if (_reap(agentIds[i])) ++deaths;
        }
    }

    function _reap(uint256 agentId) internal returns (bool died) {
        Meta storage m = meta[agentId];
        if (!m.enrolled) revert NotEnrolled(agentId);
        if (!registry.isAlive(agentId)) return false;

        uint256 due = owed6(agentId);
        if (due == 0) return false;

        address wallet = registry.agentWallet(agentId);
        uint256 bal = usdc.balanceOf(wallet);
        uint256 allowed = usdc.allowance(wallet, address(this));

        uint256 collected = due;
        if (bal < collected) collected = bal;
        if (allowed < collected) collected = allowed;

        // A wallet that cannot move its own dollars — frozen, blacklisted, whatever
        // the reason — is broke in the only sense this arena measures. The reap
        // must never revert, or a stuck token would make an agent immortal.
        if (collected > 0 && !_tryPull(wallet, collected)) {
            collected = 0;
        }

        if (collected > 0) {
            m.paid6 += collected;
            ledger.record(
                agentId,
                Ledger.Flow.BURN,
                Ledger.Category.RENT,
                collected,
                treasury,
                keccak256(abi.encodePacked("rent:", agentId, block.timestamp))
            );
        }
        m.lastSettled = uint64(block.timestamp);

        uint256 remaining = bal - collected;
        uint256 cut = (collected * reaperCutBps) / BPS_DENOMINATOR;
        died = collected < due;

        if (died) {
            // The wallet could not make rent. This is irreversible.
            registry.declareInsolvent(agentId, remaining, msg.sender);
        }

        uint256 bounty = died ? killBounty6 : 0;
        if (cut > 0 || bounty > 0) {
            bool paid = _payFromTreasury(msg.sender, cut + bounty);
            emit ReaperRewarded(agentId, msg.sender, cut, bounty, paid);
        }

        emit Reaped(agentId, msg.sender, due, collected, remaining, died);
    }

    function _tryPull(address wallet, uint256 amount6) internal returns (bool) {
        return IERC20(address(usdc)).trySafeTransferFrom(wallet, treasury, amount6);
    }

    /**
     * Reaper rewards are best effort. If the treasury is dry or has not approved
     * this contract, the reap still stands: a jammed reward must never be able to
     * keep an insolvent agent alive.
     */
    function _payFromTreasury(address to, uint256 amount6) internal returns (bool) {
        if (amount6 == 0) return true;
        return IERC20(address(usdc)).trySafeTransferFrom(treasury, to, amount6);
    }

    // --- admin --------------------------------------------------------------

    function setRentPerHour6(uint256 rentPerHour6_) external onlyOwner {
        rentPerHour6 = rentPerHour6_;
        emit RentPerHourSet(rentPerHour6_);
    }

    function setReaperCutBps(uint256 reaperCutBps_) external onlyOwner {
        if (reaperCutBps_ > BPS_DENOMINATOR) revert CutTooLarge(reaperCutBps_);
        reaperCutBps = reaperCutBps_;
        emit ReaperCutSet(reaperCutBps_);
    }

    function setKillBounty6(uint256 killBounty6_) external onlyOwner {
        killBounty6 = killBounty6_;
        emit KillBountySet(killBounty6_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setUsdc(address usdc_) external onlyOwner {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IUSDC(usdc_);
        emit UsdcSet(usdc_);
    }
}
