pragma solidity >=0.5.0 <0.7.0;

import "./IZkCondition.sol";
import "./ZkAssetHoldable.sol";

contract ZkAssetConditional is ZkAssetHoldable {
    IZkCondition public zkCondition;

    event ApprovedAddress(
        address grantedAddress,
        bytes32 noteHash,
        bytes32 noteAccessID,
        uint256 blockTimestamp
    );
    event SetCondition(address condition);

    constructor(
        address _aceAddress,
        uint256 _scalingFactor,
        address _zkConditionContract
    ) public ZkAssetHoldable(_aceAddress, _scalingFactor) {
        setCondition(_zkConditionContract);
    }

    function confidentialMint(uint24 _proofId, bytes memory _proofData) public {
        super.confidentialMint(_proofId, _proofData);
        bytes memory proofOutputs =
            ace.validateProof(_proofId, msg.sender, _proofData);
        for (uint256 i = 0; i < proofOutputs.getLength(); i += 1) {
            bytes memory proofOutput = proofOutputs.get(i);
            canTransferWithConditions(_proofId, proofOutput);
        }
    }

    // Can not override as confidentialBurn is external - not public
    //    function confidentialBurn(uint24 _proofId, bytes calldata _proofData) external {
    //        super.confidentialBurn(_proofId, _proofData);
    //        bytes memory proofOutputs = ace.validateProof(_proofId, msg.sender, _proofData);
    //        canTransferWithConditions(_proofId, proofOutputs);
    //    }

    function confidentialTransfer(
        uint24 _proofId,
        bytes memory _proofData,
        bytes memory _signatures
    ) public {
        super.confidentialTransfer(_proofId, _proofData, _signatures);
        bytes memory proofOutputs =
            ace.validateProof(_proofId, msg.sender, _proofData);
        for (uint256 i = 0; i < proofOutputs.getLength(); i += 1) {
            bytes memory proofOutput = proofOutputs.get(i);
            canTransferWithConditions(_proofId, proofOutput);
        }
    }

    function confidentialTransferFrom(
        uint24 _proofId,
        bytes memory _proofOutput
    ) public {
        super.confidentialTransferFrom(_proofId, _proofOutput);
        canTransferWithConditions(_proofId, _proofOutput);
    }

    function canTransferWithConditions(uint24 _proof, bytes memory _proofOutput)
        internal
    {
        (
            bytes memory inputNotes,
            bytes memory outputNotes,
            address publicOwner,
            int256 publicValue
        ) = _proofOutput.extractProofOutput();

        // for each input note in the proof
        for (uint256 i = 0; i < inputNotes.getLength(); i += 1) {
            (address noteOwner, bytes32 noteHash, bytes memory noteMetadata) =
                inputNotes.get(i).extractNote();
            zkCondition.canSendNote(
                noteOwner,
                noteHash,
                noteMetadata,
                msg.sender
            );
        }
        // for each output note in the proof
        for (uint256 i = 0; i < outputNotes.getLength(); i += 1) {
            (address noteOwner, bytes32 noteHash, bytes memory noteMetadata) =
                outputNotes.get(i).extractNote();
            zkCondition.canReceiveNote(
                noteOwner,
                noteHash,
                noteMetadata,
                msg.sender
            );

            approveOutputNoteAddresses(noteHash, noteMetadata);
        }

        zkCondition.canTransfer(
            _proof,
            _proofOutput,
            publicOwner,
            publicValue,
            msg.sender
        );
    }

    function approveOutputNoteAddresses(
        bytes32 noteHash,
        bytes memory noteMetadata
    ) internal {
        bytes32 noteMetaDataLength;
        bytes32 numAddresses;
        assembly {
            noteMetaDataLength := mload(noteMetadata)
            numAddresses := mload(add(noteMetadata, 0xe1))
        }

        // if customData has been set, emit event for each address
        if (uint256(noteMetaDataLength) > 0x61) {
            for (uint256 i = 0; i < uint256(numAddresses); i += 1) {
                address grantedAddress =
                    MetaDataUtils.extractAddress(noteMetadata, i);
                bytes32 noteAccessID =
                    keccak256(abi.encodePacked(grantedAddress, noteHash));
                emit ApprovedAddress(
                    grantedAddress,
                    noteHash,
                    noteAccessID,
                    block.timestamp
                );
            }
        }
    }

    function setCondition(address _zkConditionContract) public {
        // address of condition contract must be passed in
        require(
            _zkConditionContract != address(0),
            "invalid condition contract address"
        );

        // check the zero-knowledge condition contract has code
        uint256 length;
        assembly {
            length := extcodesize(_zkConditionContract)
        }
        require(length > 0, "no zk condition code");

        zkCondition = IZkCondition(_zkConditionContract);

        emit SetCondition(_zkConditionContract);
    }
}
