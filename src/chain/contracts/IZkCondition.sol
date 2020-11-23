pragma solidity >=0.5.0 <0.7.0;

interface IZkCondition {
    function canTransfer(
        uint24 _proofId,
        bytes calldata _proofOutput,
        address publicOwner,
        int256 publicValue,
        address _sender
    ) external;

    function canSendNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external;

    function canReceiveNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external;
}
