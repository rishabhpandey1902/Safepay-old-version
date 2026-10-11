// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface ISafePayTimeoutEscrow {
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
        uint8 status;
        uint256 milestoneCount;
    }

    struct Milestone {
        uint256 amount;
        bytes32 descriptionHash;
        string descriptionURI;
        uint8 status;
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

    function getAgreement(uint256 agreementId) external view returns (AgreementDetails memory);
    function getMilestone(uint256 agreementId, uint256 milestoneIndex) external view returns (Milestone memory);
    function releaseMilestone(uint256 agreementId, uint256 milestoneIndex) external;
}

contract TimeoutReleaseReceiver is IReceiver {
    uint256 public constant MAX_REPORT_AGE = 1 hours;
    uint8 private constant AGREEMENT_ACTIVE = 1;
    uint8 private constant MILESTONE_SUBMITTED = 1;

    address public immutable forwarder;
    ISafePayTimeoutEscrow public immutable escrow;
    uint256 public immutable chainSelector;

    event TimeoutReleaseExecuted(uint256 indexed agreementId, uint256 indexed milestoneIndex);
    event TimeoutReleaseSkipped(uint256 indexed agreementId, uint256 indexed milestoneIndex);

    error InvalidAddress();
    error UnauthorizedForwarder(address caller);
    error InvalidReportChain(uint256 expected, uint256 actual);
    error InvalidReportTime(uint256 scheduledTime);

    constructor(address forwarderAddress, address escrowAddress, uint256 expectedChainSelector) {
        if (
            forwarderAddress == address(0) || forwarderAddress.code.length == 0
                || escrowAddress == address(0) || escrowAddress.code.length == 0
                || expectedChainSelector == 0
        ) revert InvalidAddress();

        forwarder = forwarderAddress;
        escrow = ISafePayTimeoutEscrow(escrowAddress);
        chainSelector = expectedChainSelector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);

        (uint256 reportChain, uint256 scheduledTime, uint256 agreementId, uint256 milestoneIndex) =
            abi.decode(report, (uint256, uint256, uint256, uint256));
        if (reportChain != chainSelector) revert InvalidReportChain(chainSelector, reportChain);
        if (scheduledTime > block.timestamp || block.timestamp - scheduledTime > MAX_REPORT_AGE) {
            revert InvalidReportTime(scheduledTime);
        }

        ISafePayTimeoutEscrow.AgreementDetails memory agreement = escrow.getAgreement(agreementId);
        ISafePayTimeoutEscrow.Milestone memory milestone = escrow.getMilestone(agreementId, milestoneIndex);
        if (
            agreement.status != AGREEMENT_ACTIVE || milestone.status != MILESTONE_SUBMITTED
                || block.timestamp < milestone.approvalDeadline
        ) {
            emit TimeoutReleaseSkipped(agreementId, milestoneIndex);
            return;
        }

        emit TimeoutReleaseExecuted(agreementId, milestoneIndex);
        escrow.releaseMilestone(agreementId, milestoneIndex);
    }
}
