// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SafePayEscrow
/// @notice Holds client funds for contractor agreements and allocates them by milestone.
/// @dev Supported tokens are fixed at deployment. There is no owner or withdrawal function.
contract SafePayEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DEFAULT_APPROVAL_WINDOW = 72 hours;
    uint256 public constant MAX_WINDOW = 365 days;
    uint256 public constant MAX_MILESTONES = 50;
    uint256 public constant MAX_REFERENCE_LENGTH = 2_048;

    enum AgreementStatus {
        Draft,
        Active,
        Cancelled,
        Settled
    }

    enum MilestoneStatus {
        Pending,
        Submitted,
        Released,
        Disputed,
        Refunded,
        Split,
        Cancelled
    }

    enum Resolution {
        Release,
        Refund,
        Split
    }

    struct MilestoneInput {
        uint256 amount;
        bytes32 descriptionHash;
        string descriptionURI;
    }

    struct Milestone {
        uint256 amount;
        bytes32 descriptionHash;
        string descriptionURI;
        MilestoneStatus status;
        bytes32 evidenceHash;
        string evidenceURI;
        uint256 submittedAt;
        uint256 approvalDeadline;
        uint256 disputeDeadline;
        address disputeRaisedBy;
        bytes32 disputeReasonHash;
        string disputeReasonURI;
        uint256 contractorPayout;
        uint256 clientRefund;
    }

    struct Agreement {
        address client;
        address contractor;
        address token;
        address resolver;
        uint256 totalAmount;
        uint256 remainingBalance;
        uint256 approvalWindow;
        uint256 disputeWindow;
        uint256 clientCancellationFee;
        uint256 createdAt;
        uint256 fundedAt;
        AgreementStatus status;
        Milestone[] milestones;
    }

    struct AgreementDetails {
        address client;
        address contractor;
        address token;
        address resolver;
        uint256 totalAmount;
        uint256 remainingBalance;
        uint256 approvalWindow;
        uint256 disputeWindow;
        uint256 clientCancellationFee;
        uint256 createdAt;
        uint256 fundedAt;
        AgreementStatus status;
        uint256 milestoneCount;
    }

    error InvalidAddress();
    error InvalidToken(address token);
    error UnsupportedToken(address token);
    error InvalidAmount();
    error InvalidWindow();
    error InvalidMilestoneCount();
    error InvalidMilestoneDescription(uint256 milestoneIndex);
    error InvalidReferenceLength(uint256 length);
    error MilestoneTotalMismatch(uint256 expected, uint256 actual);
    error AgreementNotFound(uint256 agreementId);
    error MilestoneNotFound(uint256 agreementId, uint256 milestoneIndex);
    error Unauthorized(address caller);
    error InvalidAgreementStatus(AgreementStatus status);
    error InvalidMilestoneStatus(MilestoneStatus status);
    error EvidenceRequired();
    error DisputeReasonRequired();
    error ApprovalWindowNotElapsed(uint256 deadline);
    error DisputeWindowNotElapsed(uint256 deadline);
    error ApprovalWindowElapsed(uint256 deadline);
    error DisputeWindowElapsed(uint256 deadline);
    error InvalidResolutionAmount();
    error OutstandingMilestone(uint256 milestoneIndex);
    error TransferAmountMismatch(uint256 expected, uint256 received);

    /// @notice Whether a token was approved in the constructor's immutable token list.
    mapping(address token => bool supported) public supportedTokens;

    /// @notice Number of agreements created; IDs start at 1 and increase monotonically.
    uint256 public agreementCount;

    /// @notice Aggregate outstanding liabilities for each supported token.
    mapping(address token => uint256 amount) public totalLiability;

    mapping(uint256 agreementId => Agreement agreement) private _agreements;

    /// @notice Emitted after agreement terms and all milestone allocations are recorded.
    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed client,
        address indexed contractor,
        address token,
        address resolver,
        uint256 totalAmount,
        uint256 approvalWindow,
        uint256 disputeWindow,
        uint256 clientCancellationFee,
        uint256 milestoneCount
    );

    /// @notice Emitted for each ERC-20 token fixed as supported at deployment.
    event SupportedTokenConfigured(address indexed token);

    /// @notice Emitted when an agreement's funding is received in full.
    event AgreementFunded(uint256 indexed agreementId, address indexed client, uint256 amount);

    /// @notice Emitted when a milestone's terms are added to an agreement.
    event MilestoneCreated(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        uint256 amount,
        bytes32 descriptionHash,
        string descriptionURI
    );

    /// @notice Emitted when the contractor submits milestone evidence.
    event MilestoneSubmitted(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        bytes32 evidenceHash,
        string evidenceURI,
        uint256 approvalDeadline,
        uint256 disputeDeadline
    );

    /// @notice Emitted when the client explicitly approves a milestone.
    event MilestoneApproved(uint256 indexed agreementId, uint256 indexed milestoneIndex, address indexed client);

    /// @notice Emitted when a milestone allocation is paid to the contractor.
    event MilestoneReleased(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        address indexed caller,
        uint256 amount,
        bool automatic
    );

    /// @notice Emitted when either participant disputes a submitted milestone.
    event MilestoneDisputed(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        address indexed raisedBy,
        bytes32 reasonHash,
        string reasonURI
    );

    /// @notice Emitted when the resolver allocates a disputed milestone.
    event DisputeResolved(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        address indexed resolver,
        Resolution resolution,
        uint256 contractorAmount,
        uint256 clientAmount
    );

    /// @notice Emitted when cancellation closes a pending milestone.
    event MilestoneCancelled(uint256 indexed agreementId, uint256 indexed milestoneIndex);

    /// @notice Emitted when an agreement is cancelled and its remaining funds are distributed.
    event AgreementCancelled(
        uint256 indexed agreementId, address indexed cancelledBy, uint256 contractorFee, uint256 clientRefund
    );

    /// @notice Emitted when all funded agreement liabilities have been allocated.
    event AgreementSettled(uint256 indexed agreementId);

    /// @param initialSupportedTokens ERC-20 tokens approved for use; this list cannot be changed later.
    constructor(address[] memory initialSupportedTokens) {
        if (initialSupportedTokens.length == 0) revert InvalidToken(address(0));

        for (uint256 i; i < initialSupportedTokens.length; ++i) {
            address token = initialSupportedTokens[i];
            if (token == address(0) || token.code.length == 0 || supportedTokens[token]) {
                revert InvalidToken(token);
            }
            supportedTokens[token] = true;
            emit SupportedTokenConfigured(token);
        }
    }

    /// @notice Creates an unfunded agreement with fixed terms and milestone allocations.
    /// @dev Pass zero for `approvalWindow` to use the 72-hour default. No token transfer occurs here.
    /// @param contractor Address that will perform the work and receive earned milestone funds.
    /// @param token Supported ERC-20 token used for the entire agreement.
    /// @param resolver Fixed address allowed to resolve disputes for this agreement.
    /// @param totalAmount Total amount to be funded; must equal the milestone sum.
    /// @param approvalWindow Time allowed for client approval; zero selects the default.
    /// @param disputeWindow Time during which either party may dispute after submission.
    /// @param clientCancellationFee Maximum fee paid to the contractor if the client cancels.
    /// @param milestones Ordered milestone allocations and immutable description references.
    /// @return agreementId The newly created agreement identifier.
    function createAgreement(
        address contractor,
        address token,
        address resolver,
        uint256 totalAmount,
        uint256 approvalWindow,
        uint256 disputeWindow,
        uint256 clientCancellationFee,
        MilestoneInput[] calldata milestones
    ) external nonReentrant returns (uint256 agreementId) {
        if (
            contractor == address(0) || resolver == address(0) || contractor == msg.sender || resolver == msg.sender
                || resolver == contractor
        ) revert InvalidAddress();
        if (token == address(0) || token.code.length == 0) revert InvalidToken(token);
        if (!supportedTokens[token]) revert UnsupportedToken(token);
        if (totalAmount == 0 || clientCancellationFee > totalAmount) revert InvalidAmount();
        if (disputeWindow == 0) revert InvalidWindow();
        if (milestones.length == 0 || milestones.length > MAX_MILESTONES) revert InvalidMilestoneCount();

        uint256 effectiveApprovalWindow = approvalWindow == 0 ? DEFAULT_APPROVAL_WINDOW : approvalWindow;
        if (
            effectiveApprovalWindow == 0 || effectiveApprovalWindow > MAX_WINDOW
                || disputeWindow > effectiveApprovalWindow
        ) revert InvalidWindow();

        uint256 milestoneTotal;
        for (uint256 i; i < milestones.length; ++i) {
            MilestoneInput calldata input = milestones[i];
            if (input.amount == 0) revert InvalidAmount();
            if (input.descriptionHash == bytes32(0)) revert InvalidMilestoneDescription(i);
            _validateReferenceLength(bytes(input.descriptionURI).length);
            if (input.amount > type(uint256).max - milestoneTotal) revert InvalidAmount();
            milestoneTotal += input.amount;
        }
        if (milestoneTotal != totalAmount) revert MilestoneTotalMismatch(totalAmount, milestoneTotal);

        agreementId = ++agreementCount;
        Agreement storage agreement = _agreements[agreementId];
        agreement.client = msg.sender;
        agreement.contractor = contractor;
        agreement.token = token;
        agreement.resolver = resolver;
        agreement.totalAmount = totalAmount;
        agreement.approvalWindow = effectiveApprovalWindow;
        agreement.disputeWindow = disputeWindow;
        agreement.clientCancellationFee = clientCancellationFee;
        agreement.createdAt = block.timestamp;
        agreement.status = AgreementStatus.Draft;

        for (uint256 i; i < milestones.length; ++i) {
            agreement.milestones
                .push(
                    Milestone({
                        amount: milestones[i].amount,
                        descriptionHash: milestones[i].descriptionHash,
                        descriptionURI: milestones[i].descriptionURI,
                        status: MilestoneStatus.Pending,
                        evidenceHash: bytes32(0),
                        evidenceURI: "",
                        submittedAt: 0,
                        approvalDeadline: 0,
                        disputeDeadline: 0,
                        disputeRaisedBy: address(0),
                        disputeReasonHash: bytes32(0),
                        disputeReasonURI: "",
                        contractorPayout: 0,
                        clientRefund: 0
                    })
                );
            emit MilestoneCreated(
                agreementId, i, milestones[i].amount, milestones[i].descriptionHash, milestones[i].descriptionURI
            );
        }

        emit AgreementCreated(
            agreementId,
            msg.sender,
            contractor,
            token,
            resolver,
            totalAmount,
            effectiveApprovalWindow,
            disputeWindow,
            clientCancellationFee,
            milestones.length
        );
    }

    /// @notice Funds a previously created agreement with its exact milestone total.
    /// @dev Only the client can fund. Fee-on-transfer tokens are rejected by balance-delta validation.
    /// @param agreementId Agreement to fund.
    function fundAgreement(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);
        if (msg.sender != agreement.client) revert Unauthorized(msg.sender);
        if (agreement.status != AgreementStatus.Draft) revert InvalidAgreementStatus(agreement.status);

        agreement.status = AgreementStatus.Active;
        agreement.remainingBalance = agreement.totalAmount;
        agreement.fundedAt = block.timestamp;
        totalLiability[agreement.token] += agreement.totalAmount;

        IERC20 token = IERC20(agreement.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(agreement.client, address(this), agreement.totalAmount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != agreement.totalAmount) revert TransferAmountMismatch(agreement.totalAmount, received);

        emit AgreementFunded(agreementId, agreement.client, agreement.totalAmount);
    }

    /// @notice Submits evidence for a pending milestone.
    /// @dev Only the contractor may submit; a nonzero evidence hash is required.
    /// @param agreementId Agreement containing the milestone.
    /// @param milestoneIndex Index of the pending milestone.
    /// @param evidenceHash Nonzero content hash of the submitted evidence.
    /// @param evidenceURI Location of the submitted evidence, if available.
    function submitMilestone(
        uint256 agreementId,
        uint256 milestoneIndex,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external nonReentrant {
        Agreement storage agreement = _getActiveAgreement(agreementId);
        if (msg.sender != agreement.contractor) revert Unauthorized(msg.sender);
        Milestone storage milestone = _getMilestone(agreement, agreementId, milestoneIndex);
        if (milestone.status != MilestoneStatus.Pending) revert InvalidMilestoneStatus(milestone.status);
        if (evidenceHash == bytes32(0)) revert EvidenceRequired();
        _validateReferenceLength(bytes(evidenceURI).length);

        milestone.status = MilestoneStatus.Submitted;
        milestone.evidenceHash = evidenceHash;
        milestone.evidenceURI = evidenceURI;
        milestone.submittedAt = block.timestamp;
        milestone.approvalDeadline = block.timestamp + agreement.approvalWindow;
        milestone.disputeDeadline = block.timestamp + agreement.disputeWindow;

        emit MilestoneSubmitted(
            agreementId,
            milestoneIndex,
            evidenceHash,
            evidenceURI,
            milestone.approvalDeadline,
            milestone.disputeDeadline
        );
    }

    /// @notice Approves and immediately releases a submitted milestone.
    /// @dev Only the client may approve, and approval must occur before the approval deadline.
    /// @param agreementId Agreement containing the milestone.
    /// @param milestoneIndex Index of the submitted milestone.
    function approveMilestone(uint256 agreementId, uint256 milestoneIndex) external nonReentrant {
        Agreement storage agreement = _getActiveAgreement(agreementId);
        if (msg.sender != agreement.client) revert Unauthorized(msg.sender);
        Milestone storage milestone = _getMilestone(agreement, agreementId, milestoneIndex);
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneStatus(milestone.status);
        if (block.timestamp >= milestone.approvalDeadline) {
            revert ApprovalWindowElapsed(milestone.approvalDeadline);
        }

        emit MilestoneApproved(agreementId, milestoneIndex, msg.sender);
        _allocateMilestone(agreement, agreementId, milestoneIndex, milestone, MilestoneStatus.Released);
        _safeTransferExact(IERC20(agreement.token), agreement.contractor, milestone.amount);
        emit MilestoneReleased(agreementId, milestoneIndex, msg.sender, milestone.amount, false);
        _settleIfEmpty(agreement, agreementId);
    }

    /// @notice Releases a submitted milestone after its approval window has elapsed.
    /// @dev Permissionless; no caller can change the fixed recipient or amount.
    /// @param agreementId Agreement containing the milestone.
    /// @param milestoneIndex Index of the submitted milestone.
    function releaseMilestone(uint256 agreementId, uint256 milestoneIndex) external nonReentrant {
        Agreement storage agreement = _getActiveAgreement(agreementId);
        Milestone storage milestone = _getMilestone(agreement, agreementId, milestoneIndex);
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneStatus(milestone.status);
        if (block.timestamp < milestone.approvalDeadline) {
            revert ApprovalWindowNotElapsed(milestone.approvalDeadline);
        }
        _allocateMilestone(agreement, agreementId, milestoneIndex, milestone, MilestoneStatus.Released);
        _safeTransferExact(IERC20(agreement.token), agreement.contractor, milestone.amount);
        emit MilestoneReleased(agreementId, milestoneIndex, msg.sender, milestone.amount, true);
        _settleIfEmpty(agreement, agreementId);
    }

    /// @notice Cancels remaining work and distributes its balance under the agreed cancellation terms.
    /// @dev Either participant may cancel; cancellation is blocked by any unresolved submission or dispute.
    /// @param agreementId Agreement to cancel.
    function cancelAgreement(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _getActiveAgreement(agreementId);
        if (msg.sender != agreement.client && msg.sender != agreement.contractor) {
            revert Unauthorized(msg.sender);
        }

        uint256 milestoneCount = agreement.milestones.length;
        for (uint256 i; i < milestoneCount; ++i) {
            Milestone storage milestone = agreement.milestones[i];
            if (milestone.status == MilestoneStatus.Submitted || milestone.status == MilestoneStatus.Disputed) {
                revert OutstandingMilestone(i);
            }
        }

        uint256 remaining = agreement.remainingBalance;
        uint256 contractorFee;
        if (msg.sender == agreement.client) {
            contractorFee = agreement.clientCancellationFee;
            if (contractorFee > remaining) contractorFee = remaining;
        }
        uint256 clientRefund = remaining - contractorFee;

        agreement.status = AgreementStatus.Cancelled;
        agreement.remainingBalance = 0;
        totalLiability[agreement.token] -= remaining;
        for (uint256 i; i < milestoneCount; ++i) {
            Milestone storage milestone = agreement.milestones[i];
            if (milestone.status == MilestoneStatus.Pending) {
                milestone.status = MilestoneStatus.Cancelled;
                emit MilestoneCancelled(agreementId, i);
            }
        }

        if (contractorFee != 0) _safeTransferExact(IERC20(agreement.token), agreement.contractor, contractorFee);
        if (clientRefund != 0) _safeTransferExact(IERC20(agreement.token), agreement.client, clientRefund);

        emit AgreementCancelled(agreementId, msg.sender, contractorFee, clientRefund);
    }

    /// @notice Disputes a submitted milestone before its dispute deadline.
    /// @dev Either agreement participant may dispute; funds remain in escrow until resolution.
    /// @param agreementId Agreement containing the milestone.
    /// @param milestoneIndex Index of the submitted milestone.
    /// @param reasonHash Nonzero content hash of the dispute reason.
    /// @param reasonURI Location of the dispute reason, if available.
    function raiseDispute(uint256 agreementId, uint256 milestoneIndex, bytes32 reasonHash, string calldata reasonURI)
        external
        nonReentrant
    {
        Agreement storage agreement = _getActiveAgreement(agreementId);
        if (msg.sender != agreement.client && msg.sender != agreement.contractor) {
            revert Unauthorized(msg.sender);
        }
        Milestone storage milestone = _getMilestone(agreement, agreementId, milestoneIndex);
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidMilestoneStatus(milestone.status);
        if (block.timestamp >= milestone.disputeDeadline) {
            revert DisputeWindowElapsed(milestone.disputeDeadline);
        }
        if (reasonHash == bytes32(0)) revert DisputeReasonRequired();
        _validateReferenceLength(bytes(reasonURI).length);

        milestone.status = MilestoneStatus.Disputed;
        milestone.disputeRaisedBy = msg.sender;
        milestone.disputeReasonHash = reasonHash;
        milestone.disputeReasonURI = reasonURI;

        emit MilestoneDisputed(agreementId, milestoneIndex, msg.sender, reasonHash, reasonURI);
    }

    /// @notice Resolves a disputed milestone by releasing, refunding, or splitting its allocation.
    /// @dev Only the agreement's fixed resolver may call this function; no arbitrary recipient is accepted.
    /// @param agreementId Agreement containing the dispute.
    /// @param milestoneIndex Index of the disputed milestone.
    /// @param resolution Resolver's chosen allocation outcome.
    /// @param contractorAmount Contractor allocation for a split; ignored for release or refund.
    function resolveDispute(
        uint256 agreementId,
        uint256 milestoneIndex,
        Resolution resolution,
        uint256 contractorAmount
    ) external nonReentrant {
        Agreement storage agreement = _getActiveAgreement(agreementId);
        if (msg.sender != agreement.resolver) revert Unauthorized(msg.sender);
        Milestone storage milestone = _getMilestone(agreement, agreementId, milestoneIndex);
        if (milestone.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(milestone.status);

        uint256 contractorPayout;
        uint256 clientRefund;
        MilestoneStatus terminalStatus;

        if (resolution == Resolution.Release) {
            if (contractorAmount != 0) revert InvalidResolutionAmount();
            contractorPayout = milestone.amount;
            terminalStatus = MilestoneStatus.Released;
        } else if (resolution == Resolution.Refund) {
            if (contractorAmount != 0) revert InvalidResolutionAmount();
            clientRefund = milestone.amount;
            terminalStatus = MilestoneStatus.Refunded;
        } else if (resolution == Resolution.Split) {
            if (contractorAmount == 0 || contractorAmount >= milestone.amount) {
                revert InvalidResolutionAmount();
            }
            contractorPayout = contractorAmount;
            clientRefund = milestone.amount - contractorAmount;
            terminalStatus = MilestoneStatus.Split;
        } else {
            revert InvalidResolutionAmount();
        }

        milestone.contractorPayout = contractorPayout;
        milestone.clientRefund = clientRefund;
        _allocateMilestone(agreement, agreementId, milestoneIndex, milestone, terminalStatus);

        if (contractorPayout != 0) {
            _safeTransferExact(IERC20(agreement.token), agreement.contractor, contractorPayout);
        }
        if (clientRefund != 0) _safeTransferExact(IERC20(agreement.token), agreement.client, clientRefund);

        emit DisputeResolved(agreementId, milestoneIndex, msg.sender, resolution, contractorPayout, clientRefund);
        _settleIfEmpty(agreement, agreementId);
    }

    /// @notice Returns the agreement's immutable terms and current accounting state.
    /// @param agreementId Agreement to query.
    function getAgreement(uint256 agreementId) external view returns (AgreementDetails memory details) {
        Agreement storage agreement = _getAgreement(agreementId);
        details.client = agreement.client;
        details.contractor = agreement.contractor;
        details.token = agreement.token;
        details.resolver = agreement.resolver;
        details.totalAmount = agreement.totalAmount;
        details.remainingBalance = agreement.remainingBalance;
        details.approvalWindow = agreement.approvalWindow;
        details.disputeWindow = agreement.disputeWindow;
        details.clientCancellationFee = agreement.clientCancellationFee;
        details.createdAt = agreement.createdAt;
        details.fundedAt = agreement.fundedAt;
        details.status = agreement.status;
        details.milestoneCount = agreement.milestones.length;
    }

    /// @notice Returns all stored details for one milestone.
    /// @param agreementId Agreement containing the milestone.
    /// @param milestoneIndex Index of the milestone.
    function getMilestone(uint256 agreementId, uint256 milestoneIndex) external view returns (Milestone memory) {
        Agreement storage agreement = _getAgreement(agreementId);
        if (milestoneIndex >= agreement.milestones.length) {
            revert MilestoneNotFound(agreementId, milestoneIndex);
        }
        return agreement.milestones[milestoneIndex];
    }

    function _getAgreement(uint256 agreementId) private view returns (Agreement storage agreement) {
        if (agreementId == 0 || agreementId > agreementCount) revert AgreementNotFound(agreementId);
        agreement = _agreements[agreementId];
    }

    function _validateReferenceLength(uint256 length) private pure {
        if (length > MAX_REFERENCE_LENGTH) revert InvalidReferenceLength(length);
    }

    function _safeTransferExact(IERC20 token, address recipient, uint256 amount) private {
        uint256 senderBalanceBefore = token.balanceOf(address(this));
        uint256 recipientBalanceBefore = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        uint256 senderBalanceAfter = token.balanceOf(address(this));
        uint256 recipientBalanceAfter = token.balanceOf(recipient);
        uint256 senderDebit = senderBalanceBefore - senderBalanceAfter;
        uint256 recipientCredit = recipientBalanceAfter - recipientBalanceBefore;
        if (senderDebit != amount) revert TransferAmountMismatch(amount, senderDebit);
        if (recipientCredit != amount) revert TransferAmountMismatch(amount, recipientCredit);
    }

    function _getActiveAgreement(uint256 agreementId) private view returns (Agreement storage agreement) {
        agreement = _getAgreement(agreementId);
        if (agreement.status != AgreementStatus.Active) revert InvalidAgreementStatus(agreement.status);
    }

    function _getMilestone(Agreement storage agreement, uint256 agreementId, uint256 milestoneIndex)
        private
        view
        returns (Milestone storage milestone)
    {
        if (milestoneIndex >= agreement.milestones.length) {
            revert MilestoneNotFound(agreementId, milestoneIndex);
        }
        milestone = agreement.milestones[milestoneIndex];
    }

    function _allocateMilestone(
        Agreement storage agreement,
        uint256 agreementId,
        uint256 milestoneIndex,
        Milestone storage milestone,
        MilestoneStatus terminalStatus
    ) private {
        milestone.status = terminalStatus;
        agreement.remainingBalance -= milestone.amount;
        totalLiability[agreement.token] -= milestone.amount;
        emit MilestoneAllocated(agreementId, milestoneIndex, terminalStatus, milestone.amount);
    }

    /// @dev Internal accounting event is declared separately to keep allocation state observable.
    event MilestoneAllocated(
        uint256 indexed agreementId, uint256 indexed milestoneIndex, MilestoneStatus terminalStatus, uint256 amount
    );

    function _settleIfEmpty(Agreement storage agreement, uint256 agreementId) private {
        if (agreement.remainingBalance == 0) {
            agreement.status = AgreementStatus.Settled;
            emit AgreementSettled(agreementId);
        }
    }
}
