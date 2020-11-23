pragma solidity >=0.5.0 <0.7.0;

import "./IZkCondition.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";

contract ZkConditionSuspend is IZkCondition, Ownable {
    bool suspended;

    event Suspend(address owner);
    event Resume(address owner);

    constructor(bool _suspended) public {
        suspended = _suspended;
    }

    function canTransfer(
        uint24 _proofId,
        bytes calldata _proofOutput,
        address publicOwner,
        int256 publicValue,
        address _sender
    ) external {
        require(suspended == false, "all transfers are suspended");
    }

    function canSendNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {}

    function canReceiveNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {}

    function suspend() public onlyOwner() {
        require(suspended == false, "Already suspended");
        suspended = true;
        emit Suspend(msg.sender);
    }

    function resume() public onlyOwner() {
        require(suspended == true, "Already resumed");
        suspended = false;
        emit Resume(msg.sender);
    }
}
