pragma solidity >=0.5.0 <0.7.0;

import "./IZkCondition.sol";

// A fairly simple implementation that checks notes can only be owned by approved accounts.
contract ZkConditionApprovedAccounts is IZkCondition {
    event ApprovedAccount(address account, address sender);
    event RejectedAccount(address account, address sender);
    event AddApprover(address approver, address sender);
    event RemoveApprover(address approver, address sender);

    // Account that have been approved to own notes
    mapping(address => bool) approvedAccounts;
    // Accounts that can approve or reject other accounts
    mapping(address => bool) approvers;

    modifier onlyApprovers() {
        require(approvers[msg.sender] == true, "not an approver");
        _;
    }

    constructor(address[] memory _approvers) public {
        approvers[msg.sender] = true;
        approvedAccounts[msg.sender] = true;
        for (uint256 i = 0; i < _approvers.length; i += 1) {
            approvers[_approvers[i]] = true;
            approvedAccounts[_approvers[i]] = true;
        }
        // This is required for zero value notes
        approvers[address(0)] = true;
        approvedAccounts[address(0)] = true;
    }

    function canTransfer(
        uint24 _proofId,
        bytes calldata _proofOutput,
        address publicOwner,
        int256 publicValue,
        address _sender
    ) external {}

    function canSendNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {
        require(
            approvedAccounts[_owner] == true,
            "Account not approved to send notes"
        );
    }

    function canReceiveNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {
        require(
            approvedAccounts[_owner] == true,
            "Account not approved to receive notes"
        );
    }

    function approve(address account) public onlyApprovers() {
        require(account != address(0), "invalid approve account address");
        require(approvedAccounts[account] == false, "Already approved");
        approvedAccounts[account] = true;
        emit ApprovedAccount(account, msg.sender);
    }

    function reject(address account) public onlyApprovers() {
        require(account != address(0), "invalid reject account address");
        require(approvedAccounts[account] == true, "Already rejected");
        approvedAccounts[account] = false;
        emit RejectedAccount(account, msg.sender);
    }

    function addApprover(address approver) public onlyApprovers() {
        require(approver != address(0), "invalid approver address");
        require(approvers[approver] == false, "Already an approver");
        approvers[approver] = true;
        emit AddApprover(approver, msg.sender);
    }

    function removeApprover(address approver) public onlyApprovers() {
        require(approver != address(0), "invalid approver address");
        require(approvers[approver] == true, "Already rejected");
        approvers[approver] = false;
        emit RemoveApprover(approver, msg.sender);
    }
}
