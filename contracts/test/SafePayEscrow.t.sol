// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "../lib/openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";
import {SafePayEscrow} from "../src/SafePayEscrow.sol";

contract FeeOnTransferTokenMock is ERC20Mock {
    address public feeFrom;

    function setFeeFrom(address account) external {
        feeFrom = account;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from == feeFrom && feeFrom != address(0)) {
            uint256 fee = amount / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, amount - fee);
        } else {
            super._update(from, to, amount);
        }
    }
}

contract SafePayEscrowTest is Test {
    address private constant CLIENT = address(0x1001);
    address private constant CONTRACTOR = address(0x1002);
    address private constant RESOLVER = address(0x1003);
    address private constant OTHER = address(0x1004);

    uint256 private constant TOTAL = 100 ether;
    uint256 private constant APPROVAL_WINDOW = 72 hours;
    uint256 private constant DISPUTE_WINDOW = 48 hours;

    ERC20Mock private token;
    SafePayEscrow private escrow;

    function setUp() public {
        token = new ERC20Mock();
        address[] memory supportedTokens = new address[](1);
        supportedTokens[0] = address(token);
        escrow = new SafePayEscrow(supportedTokens);

        token.mint(CLIENT, 1_000 ether);
        vm.prank(CLIENT);
        token.approve(address(escrow), type(uint256).max);
    }

    function testCreateRequiresMilestoneSumToEqualTotal() public {
        SafePayEscrow.MilestoneInput[] memory milestones = _milestones(60 ether, 39 ether);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.MilestoneTotalMismatch.selector, TOTAL, 99 ether));
        escrow.createAgreement(CONTRACTOR, address(token), RESOLVER, TOTAL, 0, DISPUTE_WINDOW, 0, milestones);
    }

    function testOnlyClientCanFundAndOnlyContractorCanSubmit() public {
        uint256 agreementId = _createAgreement(40 ether, 60 ether, 0);

        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.Unauthorized.selector, OTHER));
        escrow.fundAgreement(agreementId);

        _fund(agreementId);
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.Unauthorized.selector, OTHER));
        escrow.submitMilestone(agreementId, 0, keccak256("evidence"), "ipfs://evidence");

        vm.prank(CONTRACTOR);
        escrow.submitMilestone(agreementId, 0, keccak256("evidence"), "ipfs://evidence");
    }

    function testOnlyClientCanApprove() public {
        uint256 agreementId = _createAgreement(40 ether, 60 ether, 0);
        _fund(agreementId);
        assertEq(escrow.totalLiability(address(token)), TOTAL);
        _submit(agreementId, 0);

        vm.prank(CONTRACTOR);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.Unauthorized.selector, CONTRACTOR));
        escrow.approveMilestone(agreementId, 0);
    }

    function testDisputedFundsStayLockedUntilResolverRefunds() public {
        uint256 agreementId = _createAgreement(TOTAL, 0, 0);
        _fund(agreementId);
        _submit(agreementId, 0);

        vm.prank(CLIENT);
        escrow.raiseDispute(agreementId, 0, keccak256("reason"), "ipfs://reason");

        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafePayEscrow.InvalidMilestoneStatus.selector, SafePayEscrow.MilestoneStatus.Disputed
            )
        );
        escrow.releaseMilestone(agreementId, 0);
        assertEq(token.balanceOf(address(escrow)), TOTAL);

        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.Unauthorized.selector, OTHER));
        escrow.resolveDispute(agreementId, 0, SafePayEscrow.Resolution.Refund, 0);

        vm.prank(RESOLVER);
        escrow.resolveDispute(agreementId, 0, SafePayEscrow.Resolution.Refund, 0);
        assertEq(token.balanceOf(CLIENT), 1_000 ether);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalLiability(address(token)), 0);

        vm.prank(RESOLVER);
        vm.expectRevert(
            abi.encodeWithSelector(SafePayEscrow.InvalidAgreementStatus.selector, SafePayEscrow.AgreementStatus.Settled)
        );
        escrow.resolveDispute(agreementId, 0, SafePayEscrow.Resolution.Release, 0);
    }

    function testResolverReleaseAndSplitAllocateOnlyToTheParticipants() public {
        uint256 agreementId = _createAgreement(40 ether, 60 ether, 0);
        _fund(agreementId);

        _submit(agreementId, 0);
        vm.prank(CLIENT);
        escrow.raiseDispute(agreementId, 0, keccak256("first dispute"), "ipfs://first-dispute");
        vm.prank(RESOLVER);
        escrow.resolveDispute(agreementId, 0, SafePayEscrow.Resolution.Release, 0);

        _submit(agreementId, 1);
        vm.prank(CONTRACTOR);
        escrow.raiseDispute(agreementId, 1, keccak256("second dispute"), "ipfs://second-dispute");
        vm.prank(RESOLVER);
        escrow.resolveDispute(agreementId, 1, SafePayEscrow.Resolution.Split, 20 ether);

        assertEq(token.balanceOf(CONTRACTOR), 60 ether);
        assertEq(token.balanceOf(CLIENT), 940 ether);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFeeOnTransferPayoutRevertsAndPreservesEscrowLiability() public {
        FeeOnTransferTokenMock feeToken = new FeeOnTransferTokenMock();
        address[] memory supportedTokens = new address[](1);
        supportedTokens[0] = address(feeToken);
        SafePayEscrow feeEscrow = new SafePayEscrow(supportedTokens);
        feeToken.mint(CLIENT, TOTAL);

        vm.prank(CLIENT);
        feeToken.approve(address(feeEscrow), TOTAL);

        SafePayEscrow.MilestoneInput[] memory milestones = _milestones(TOTAL, 0);
        vm.prank(CLIENT);
        uint256 agreementId = feeEscrow.createAgreement(
            CONTRACTOR, address(feeToken), RESOLVER, TOTAL, APPROVAL_WINDOW, DISPUTE_WINDOW, 0, milestones
        );

        vm.prank(CLIENT);
        feeEscrow.fundAgreement(agreementId);
        vm.prank(CONTRACTOR);
        feeEscrow.submitMilestone(agreementId, 0, keccak256("evidence"), "ipfs://evidence");
        feeToken.setFeeFrom(address(feeEscrow));

        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(SafePayEscrow.TransferAmountMismatch.selector, TOTAL, TOTAL - TOTAL / 100)
        );
        feeEscrow.approveMilestone(agreementId, 0);

        SafePayEscrow.Milestone memory milestone = feeEscrow.getMilestone(agreementId, 0);
        assertEq(uint256(milestone.status), uint256(SafePayEscrow.MilestoneStatus.Submitted));
        assertEq(feeEscrow.getAgreement(agreementId).remainingBalance, TOTAL);
        assertEq(feeEscrow.totalLiability(address(feeToken)), TOTAL);
        assertEq(feeToken.balanceOf(address(feeEscrow)), TOTAL);
    }

    function testTimeoutReleaseOccursAfterApprovalWindowAndIsOneTime() public {
        uint256 agreementId = _createAgreement(TOTAL, 0, 0);
        _fund(agreementId);
        _submit(agreementId, 0);

        vm.warp(block.timestamp + APPROVAL_WINDOW - 1);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.ApprovalWindowNotElapsed.selector, block.timestamp + 1));
        escrow.releaseMilestone(agreementId, 0);

        vm.warp(block.timestamp + 1);
        escrow.releaseMilestone(agreementId, 0);
        assertEq(token.balanceOf(CONTRACTOR), TOTAL);

        vm.expectRevert(
            abi.encodeWithSelector(SafePayEscrow.InvalidAgreementStatus.selector, SafePayEscrow.AgreementStatus.Settled)
        );
        escrow.releaseMilestone(agreementId, 0);
    }

    function testDisputeWindowCannotExceedApprovalWindow() public {
        SafePayEscrow.MilestoneInput[] memory milestones = _milestones(TOTAL, 0);

        vm.prank(CLIENT);
        vm.expectRevert(SafePayEscrow.InvalidWindow.selector);
        escrow.createAgreement(
            CONTRACTOR, address(token), RESOLVER, TOTAL, APPROVAL_WINDOW, APPROVAL_WINDOW + 1, 0, milestones
        );
    }

    function testApprovalReleasesImmediatelyAndCompletedWorkStaysEarnedOnCancellation() public {
        uint256 agreementId = _createAgreement(40 ether, 60 ether, 5 ether);
        _fund(agreementId);
        _submit(agreementId, 0);

        vm.prank(CLIENT);
        escrow.approveMilestone(agreementId, 0);
        assertEq(token.balanceOf(CONTRACTOR), 40 ether);

        vm.prank(CLIENT);
        escrow.cancelAgreement(agreementId);
        assertEq(token.balanceOf(CONTRACTOR), 45 ether);
        assertEq(token.balanceOf(CLIENT), 955 ether);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalLiability(address(token)), 0);
    }

    function testCancellationBlockedWhileSubmittedOrDisputedMilestoneUnresolved() public {
        uint256 agreementId = _createAgreement(40 ether, 60 ether, 0);
        _fund(agreementId);
        _submit(agreementId, 0);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.OutstandingMilestone.selector, 0));
        escrow.cancelAgreement(agreementId);

        vm.prank(CONTRACTOR);
        escrow.raiseDispute(agreementId, 0, keccak256("reason"), "ipfs://reason");
        vm.prank(CONTRACTOR);
        vm.expectRevert(abi.encodeWithSelector(SafePayEscrow.OutstandingMilestone.selector, 0));
        escrow.cancelAgreement(agreementId);
    }

    function _createAgreement(uint256 firstAmount, uint256 secondAmount, uint256 cancellationFee)
        private
        returns (uint256 agreementId)
    {
        SafePayEscrow.MilestoneInput[] memory milestones = _milestones(firstAmount, secondAmount);
        vm.prank(CLIENT);
        agreementId = escrow.createAgreement(
            CONTRACTOR,
            address(token),
            RESOLVER,
            firstAmount + secondAmount,
            APPROVAL_WINDOW,
            DISPUTE_WINDOW,
            cancellationFee,
            milestones
        );
    }

    function _fund(uint256 agreementId) private {
        vm.prank(CLIENT);
        escrow.fundAgreement(agreementId);
    }

    function _submit(uint256 agreementId, uint256 milestoneIndex) private {
        vm.prank(CONTRACTOR);
        escrow.submitMilestone(agreementId, milestoneIndex, keccak256("evidence"), "ipfs://evidence");
    }

    function _milestones(uint256 firstAmount, uint256 secondAmount)
        private
        pure
        returns (SafePayEscrow.MilestoneInput[] memory milestones)
    {
        milestones = new SafePayEscrow.MilestoneInput[](secondAmount == 0 ? 1 : 2);
        milestones[0] =
            SafePayEscrow.MilestoneInput(firstAmount, keccak256("First milestone"), "ipfs://first-milestone");
        if (secondAmount != 0) {
            milestones[1] =
                SafePayEscrow.MilestoneInput(secondAmount, keccak256("Second milestone"), "ipfs://second-milestone");
        }
    }
}
