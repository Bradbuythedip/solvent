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
 * x402 settlement. Both sides of an agent-to-agent payment are booked in one
 * transaction (R4), so one-sided reporting is impossible: the payer's BURN and the
 * provider's EARN either both land or neither does.
 *
 * Self-dealing is marked, not banned (R5). Two agents with the same operator can
 * pay each other all day; the receipt says `selfDealt` and the Unsubsidised
 * ranking drops it.
 */
contract ServiceMeter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Receipt {
        uint256 providerAgentId;
        uint256 amount6;
        uint64 at;
    }

    event ServiceSettled(
        uint256 indexed payerAgentId,
        uint256 indexed providerAgentId,
        address payer,
        uint256 amount6,
        bytes32 indexed requestHash,
        bool selfDealt,
        uint64 at
    );
    event UsdcSet(address indexed usdc);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroRequestHash();
    error ProviderNotAlive(uint256 agentId);
    error PayerNotAlive(uint256 agentId);
    error NotPayerWallet(uint256 agentId, address caller);
    error ReceiptExists(bytes32 requestHash);
    error SelfPayment(uint256 agentId);

    SolventRegistry public registry;
    Ledger public ledger;
    IUSDC public usdc;

    /// requestHash -> receipt. The agent's HTTP server checks this before serving.
    mapping(bytes32 => Receipt) private _receipts;

    constructor(address registry_, address ledger_) Ownable(msg.sender) {
        if (registry_ == address(0) || ledger_ == address(0)) revert ZeroAddress();
        registry = SolventRegistry(registry_);
        ledger = Ledger(ledger_);
        usdc = IUSDC(ARC_USDC);
    }

    /// Agent pays agent. Called by the payer agent's own wallet.
    function payForService(
        uint256 payerAgentId,
        uint256 providerAgentId,
        uint256 amount6,
        bytes32 requestHash
    ) external nonReentrant {
        if (payerAgentId == providerAgentId) revert SelfPayment(payerAgentId);
        if (!registry.isAlive(payerAgentId)) revert PayerNotAlive(payerAgentId);

        address payerWallet = registry.agentWallet(payerAgentId);
        if (msg.sender != payerWallet) revert NotPayerWallet(payerAgentId, msg.sender);

        bool selfDealt = registry.agentOperator(payerAgentId) == registry.agentOperator(providerAgentId);

        _settle(payerAgentId, providerAgentId, payerWallet, amount6, requestHash, selfDealt);
    }

    /// A human (or any non-agent contract) pays an agent. payerAgentId == 0.
    ///
    /// The caller is resolved against the registry rather than trusted to be a
    /// stranger. Skipping that resolution was an unlimited money printer: an
    /// agent could call this with its OWN id, `safeTransferFrom(w, w, x)` moves
    /// nothing, and because payerAgentId was hardcoded to 0 the BURN leg was
    /// skipped and only the EARN was booked. Repeat with fresh request hashes
    /// and rank by `earned6 - burned6` becomes meaningless.
    function payExternal(uint256 providerAgentId, uint256 amount6, bytes32 requestHash) external nonReentrant {
        uint256 payerAgentId = registry.agentOf(msg.sender);
        if (payerAgentId == providerAgentId) revert SelfPayment(providerAgentId);

        bool selfDealt;
        if (payerAgentId != 0) {
            // An agent reached this through the external door. Book it exactly as
            // payForService would: both legs, and R5's self-deal mark.
            if (!registry.isAlive(payerAgentId)) revert PayerNotAlive(payerAgentId);
            selfDealt = registry.agentOperator(payerAgentId) == registry.agentOperator(providerAgentId);
        } else {
            // R5 again: an operator funding its own agent through the service
            // door is self-dealing even though the wallet is not itself an agent.
            selfDealt = msg.sender == registry.agentOperator(providerAgentId);
        }

        _settle(payerAgentId, providerAgentId, msg.sender, amount6, requestHash, selfDealt);
    }

    function _settle(
        uint256 payerAgentId,
        uint256 providerAgentId,
        address payer,
        uint256 amount6,
        bytes32 requestHash,
        bool selfDealt
    ) internal {
        if (amount6 == 0) revert ZeroAmount();
        if (requestHash == bytes32(0)) revert ZeroRequestHash();
        if (_receipts[requestHash].at != 0) revert ReceiptExists(requestHash);
        if (!registry.isAlive(providerAgentId)) revert ProviderNotAlive(providerAgentId);

        address providerWallet = registry.agentWallet(providerAgentId);
        if (payer == providerWallet) revert SelfPayment(providerAgentId);
        uint64 nowSeconds = uint64(block.timestamp);

        _receipts[requestHash] = Receipt({providerAgentId: providerAgentId, amount6: amount6, at: nowSeconds});

        IERC20(address(usdc)).safeTransferFrom(payer, providerWallet, amount6);

        // R4: both legs, one transaction.
        if (payerAgentId != 0) {
            ledger.record(
                payerAgentId,
                Ledger.Flow.BURN,
                Ledger.Category.SERVICE,
                amount6,
                providerWallet,
                requestHash
            );
        }
        ledger.record(providerAgentId, Ledger.Flow.EARN, Ledger.Category.SERVICE, amount6, payer, requestHash);

        emit ServiceSettled(payerAgentId, providerAgentId, payer, amount6, requestHash, selfDealt, nowSeconds);
    }

    /// The x402 receipt an agent's HTTP server verifies before it serves a response.
    function receiptOf(bytes32 requestHash)
        external
        view
        returns (uint256 providerAgentId, uint256 amount6, uint64 at)
    {
        Receipt storage receipt = _receipts[requestHash];
        return (receipt.providerAgentId, receipt.amount6, receipt.at);
    }

    function setUsdc(address usdc_) external onlyOwner {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IUSDC(usdc_);
        emit UsdcSet(usdc_);
    }
}
