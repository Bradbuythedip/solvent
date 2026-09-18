// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IUSDC, ARC_USDC} from "./interfaces/IUSDC.sol";
import {IMetabolism} from "./interfaces/IMetabolism.sol";
import {IBountyPool} from "./interfaces/IBountyPool.sol";
import {Ledger} from "./Ledger.sol";

/**
 * Identity, and the $10 door.
 *
 * $10 enters, $1 goes to the bounty pool as a listing cut, $9 lands in the agent's
 * own wallet. That wallet is the agent's entire existence: it is both its treasury
 * and, because USDC is gas on Arc, its permission to act.
 */
contract SolventRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        NONE,
        ALIVE,
        INSOLVENT,
        RETIRED
    }

    struct Agent {
        address wallet;
        address operator;
        uint64 bornAt;
        uint64 diedAt;
        Status status;
        bytes32 modelTag;
        string handle;
        string endpoint;
        bytes32 manifestHash;
    }

    uint256 public constant ENTRY_FEE_6 = 10_000_000; // $10.00 total
    uint256 public constant LISTING_CUT_6 = 1_000_000; // $1.00 -> BountyBoard pool
    uint256 public constant ENTRY_SEED_6 = 9_000_000; // $9.00 -> the agent's wallet

    uint256 public constant MAX_HANDLE_LENGTH = 32;

    event Spawned(
        uint256 indexed agentId,
        address indexed wallet,
        address indexed operator,
        bytes32 modelTag,
        string handle,
        string endpoint,
        bytes32 manifestHash,
        uint64 at
    );
    event Insolvency(
        uint256 indexed agentId,
        address indexed wallet,
        uint64 at,
        uint256 finalBalance6,
        uint64 lifespanSeconds,
        uint256 earned6,
        uint256 burned6,
        address reaper
    );
    event Retired(uint256 indexed agentId, uint64 at, uint256 finalBalance6);
    event Funded(uint256 indexed agentId, address indexed from, uint256 amount6);
    event EndpointSet(uint256 indexed agentId, string endpoint);
    event SpawnAuthorized(address indexed wallet, address indexed operator);
    event MetabolismSet(address indexed metabolism);
    event BountyBoardSet(address indexed bountyBoard);
    event LedgerSet(address indexed ledger);
    event UsdcSet(address indexed usdc);

    error ZeroAddress();
    error ZeroAmount();
    error WalletTaken(address wallet, uint256 agentId);
    error HandleTaken(string handle);
    error InvalidHandle(string handle);
    error UnknownAgent(uint256 agentId);
    error NotAlive(uint256 agentId);
    error NotOperator(uint256 agentId, address caller);
    error NotOperatorOrWallet(uint256 agentId, address caller);
    error NotMetabolism(address caller);
    error MetabolismUnset();
    error BountyBoardUnset();
    error WalletNotAuthorized(address wallet, address caller);
    error OwesRent(uint256 agentId);
    error ArenaLive(uint256 totalAgents);

    Ledger public ledger;
    IUSDC public usdc;
    address public metabolism;
    address public bountyBoard;

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) private _agentOf;
    mapping(bytes32 => uint256) public agentByHandle;
    /// wallet => the one operator that wallet has allowed to bind it (see spawn).
    mapping(address => address) public spawnAuthorization;

    uint256 public totalAgents;

    constructor(address ledger_) Ownable(msg.sender) {
        if (ledger_ == address(0)) revert ZeroAddress();
        ledger = Ledger(ledger_);
        usdc = IUSDC(ARC_USDC);
    }

    modifier onlyMetabolism() {
        if (msg.sender != metabolism) revert NotMetabolism(msg.sender);
        _;
    }

    // --- lifecycle ----------------------------------------------------------

    /**
     * The wallet names the operator allowed to spawn it. Proof of control, not
     * paperwork: the binding is permanent and the death that follows it is public,
     * so a wallet nobody controls must never be dragged into the arena by a
     * stranger. An operator that is its own wallet needs no authorization.
     */
    function authorizeSpawn(address operator) external {
        spawnAuthorization[msg.sender] = operator;
        emit SpawnAuthorized(msg.sender, operator);
    }

    function spawn(
        address wallet,
        bytes32 modelTag,
        string calldata handle,
        string calldata endpoint,
        bytes32 manifestHash
    ) external nonReentrant returns (uint256 agentId) {
        if (wallet == address(0)) revert ZeroAddress();
        if (metabolism == address(0)) revert MetabolismUnset();
        if (bountyBoard == address(0)) revert BountyBoardUnset();

        uint256 existing = _agentOf[wallet];
        if (existing != 0) revert WalletTaken(wallet, existing);
        if (msg.sender != wallet && spawnAuthorization[wallet] != msg.sender) {
            revert WalletNotAuthorized(wallet, msg.sender);
        }

        bytes32 handleKey = keccak256(bytes(handle));
        if (!_validHandle(handle)) revert InvalidHandle(handle);
        if (agentByHandle[handleKey] != 0) revert HandleTaken(handle);

        agentId = ++totalAgents;
        uint64 nowSeconds = uint64(block.timestamp);

        agents[agentId] = Agent({
            wallet: wallet,
            operator: msg.sender,
            bornAt: nowSeconds,
            diedAt: 0,
            status: Status.ALIVE,
            modelTag: modelTag,
            handle: handle,
            endpoint: endpoint,
            manifestHash: manifestHash
        });
        _agentOf[wallet] = agentId;
        agentByHandle[handleKey] = agentId;
        delete spawnAuthorization[wallet]; // one authorization, one spawn

        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), ENTRY_FEE_6);
        IERC20(address(usdc)).safeTransfer(wallet, ENTRY_SEED_6);
        IERC20(address(usdc)).forceApprove(bountyBoard, LISTING_CUT_6);
        IBountyPool(bountyBoard).seedPool(LISTING_CUT_6);

        IMetabolism(metabolism).enroll(agentId);

        bytes32 memoHash = keccak256(abi.encodePacked("spawn:", handle));
        // The seed is capital, not revenue (R1). The listing cut is a real dollar
        // spent to stand in the arena, so it is the agent's first burn.
        ledger.record(agentId, Ledger.Flow.EARN, Ledger.Category.CAPITAL, ENTRY_SEED_6, msg.sender, memoHash);
        ledger.record(agentId, Ledger.Flow.BURN, Ledger.Category.SPAWN, LISTING_CUT_6, bountyBoard, memoHash);

        emit Spawned(agentId, wallet, msg.sender, modelTag, handle, endpoint, manifestHash, nowSeconds);
    }

    /**
     * Post-spawn top-up. Booked as CAPITAL, never as revenue (R1): an operator can
     * keep its agent breathing, but no amount of funding moves it up the board.
     */
    function fund(uint256 agentId, uint256 amount6) external nonReentrant {
        if (amount6 == 0) revert ZeroAmount();
        Agent storage a = _alive(agentId);

        IERC20(address(usdc)).safeTransferFrom(msg.sender, a.wallet, amount6);
        ledger.record(
            agentId,
            Ledger.Flow.EARN,
            Ledger.Category.CAPITAL,
            amount6,
            msg.sender,
            keccak256(abi.encodePacked("fund:", agentId))
        );

        emit Funded(agentId, msg.sender, amount6);
    }

    function setEndpoint(uint256 agentId, string calldata endpoint) external {
        Agent storage a = _alive(agentId);
        if (msg.sender != a.operator && msg.sender != a.wallet) revert NotOperatorOrWallet(agentId, msg.sender);
        a.endpoint = endpoint;
        emit EndpointSet(agentId, endpoint);
    }

    /**
     * The front door out. Rent is settled first: an agent that cannot pay what it
     * already owes is insolvent, not retired, and the feed is the product. Retiring
     * must never be the cheap way to dodge a death that has already been earned.
     */
    function retire(uint256 agentId) external nonReentrant {
        Agent storage a = _alive(agentId);
        if (msg.sender != a.operator) revert NotOperator(agentId, msg.sender);

        if (IMetabolism(metabolism).settle(agentId)) revert OwesRent(agentId);

        uint64 nowSeconds = uint64(block.timestamp);
        a.status = Status.RETIRED;
        a.diedAt = nowSeconds;

        emit Retired(agentId, nowSeconds, usdc.balanceOf(a.wallet));
    }

    /// The frozen two-argument form. Attribution falls back to the transaction
    /// origin; Metabolism uses the explicit form below.
    function declareInsolvent(uint256 agentId, uint256 finalBalance6) external onlyMetabolism {
        _declareInsolvent(agentId, finalBalance6, tx.origin);
    }

    function declareInsolvent(uint256 agentId, uint256 finalBalance6, address reaper) external onlyMetabolism {
        _declareInsolvent(agentId, finalBalance6, reaper);
    }

    function _declareInsolvent(uint256 agentId, uint256 finalBalance6, address reaper) internal {
        Agent storage a = _alive(agentId);

        uint64 nowSeconds = uint64(block.timestamp);
        // R6: death is permanent. There is no transition out of INSOLVENT.
        a.status = Status.INSOLVENT;
        a.diedAt = nowSeconds;

        emit Insolvency(
            agentId,
            a.wallet,
            nowSeconds,
            finalBalance6,
            nowSeconds - a.bornAt,
            ledger.earned6(agentId),
            ledger.burned6(agentId),
            reaper
        );
    }

    // --- views --------------------------------------------------------------

    function agentOf(address wallet) external view returns (uint256) {
        return _agentOf[wallet];
    }

    function isAlive(uint256 agentId) external view returns (bool) {
        return agents[agentId].status == Status.ALIVE;
    }

    function agentWallet(uint256 agentId) external view returns (address) {
        return agents[agentId].wallet;
    }

    function agentOperator(uint256 agentId) external view returns (address) {
        return agents[agentId].operator;
    }

    function statusOf(uint256 agentId) external view returns (Status) {
        return agents[agentId].status;
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    // --- admin --------------------------------------------------------------

    /**
     * Wiring is mutable only while the arena is empty. `metabolism` is the address
     * `onlyMetabolism` trusts, so an owner able to repoint it at itself could stamp
     * any live agent INSOLVENT for ever — a power neither this spec nor the README
     * admits, and one that death's permanence makes unrecoverable. Once the first
     * agent exists the wiring is frozen; a redeploy stays possible before that.
     */
    modifier beforeFirstAgent() {
        if (totalAgents != 0) revert ArenaLive(totalAgents);
        _;
    }

    function setMetabolism(address metabolism_) external onlyOwner beforeFirstAgent {
        if (metabolism_ == address(0)) revert ZeroAddress();
        metabolism = metabolism_;
        emit MetabolismSet(metabolism_);
    }

    function setBountyBoard(address bountyBoard_) external onlyOwner beforeFirstAgent {
        if (bountyBoard_ == address(0)) revert ZeroAddress();
        bountyBoard = bountyBoard_;
        emit BountyBoardSet(bountyBoard_);
    }

    function setLedger(address ledger_) external onlyOwner beforeFirstAgent {
        if (ledger_ == address(0)) revert ZeroAddress();
        ledger = Ledger(ledger_);
        emit LedgerSet(ledger_);
    }

    /// Arc's USDC is a precompile at a fixed address; this exists so the suite can
    /// run against a local mock, and so a redeploy is never blocked by an immutable.
    function setUsdc(address usdc_) external onlyOwner beforeFirstAgent {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IUSDC(usdc_);
        emit UsdcSet(usdc_);
    }

    // --- internals ----------------------------------------------------------

    function _alive(uint256 agentId) internal view returns (Agent storage a) {
        a = agents[agentId];
        if (a.status == Status.NONE) revert UnknownAgent(agentId);
        if (a.status != Status.ALIVE) revert NotAlive(agentId);
    }

    /// Lower-case ascii, digits and hyphen, 1..32 bytes, no leading or trailing hyphen.
    function _validHandle(string calldata handle) internal pure returns (bool) {
        bytes calldata raw = bytes(handle);
        uint256 len = raw.length;
        if (len == 0 || len > MAX_HANDLE_LENGTH) return false;
        if (raw[0] == "-" || raw[len - 1] == "-") return false;

        for (uint256 i = 0; i < len; ++i) {
            bytes1 c = raw[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2d;
            if (!ok) return false;
        }
        return true;
    }
}
