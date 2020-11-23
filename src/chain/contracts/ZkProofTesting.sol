pragma solidity >=0.5.0 <0.7.0;
pragma experimental ABIEncoderV2;

import "./IZkAssetHoldable.sol";
import "./ZkAssetDirect.sol";

contract ZkProofTesting is ZkAssetDirect {
    constructor(address _aceAddress, uint256 _scalingFactor)
        public
        ZkAssetDirect(_aceAddress, _scalingFactor)
    {}

    struct NoteData {
        address owner;
        bytes32 noteHash;
        bytes metadata;
    }

    function extractProofs(
        uint24 _proofId,
        address sender,
        bytes calldata _proofData
    ) external returns (bytes[] memory proofOutputs) {
        bytes memory validatedProofOutputs =
            ace.validateProof(_proofId, sender, _proofData);
        uint256 numProofs = validatedProofOutputs.getLength();
        proofOutputs = new bytes[](numProofs);

        for (uint256 i = 0; i < numProofs; i += 1) {
            proofOutputs[i] = validatedProofOutputs.get(i);
        }
    }

    function extractNotes(uint24 _proofId, bytes calldata _proofData)
        external
        view
        returns (
            uint256 inputNotesCount,
            uint256 outputNotesCount,
            NoteData[] memory inputNotesData,
            NoteData[] memory outputNotesData
        )
    {
        (
            bytes memory inputNotes,
            bytes memory outputNotes,
            address publicOwner,
            int256 publicValue
        ) = _proofData.extractProofOutput();

        inputNotesCount = inputNotes.getLength();
        outputNotesCount = outputNotes.getLength();

        inputNotesData = new NoteData[](inputNotesCount);
        outputNotesData = new NoteData[](outputNotesCount);

        for (uint256 i = 0; i < inputNotesCount; i += 1) {
            // (address owner, noteHash, ) = inputNotes.get(i).extractNote();
            (address owner, bytes32 noteHash, bytes memory metadata) =
                inputNotes.get(i).extractNote();
            inputNotesData[i].owner = owner;
            inputNotesData[i].noteHash = noteHash;
            inputNotesData[i].metadata = metadata;
        }

        for (uint256 i = 0; i < outputNotesCount; i += 1) {
            (address owner, bytes32 noteHash, bytes memory metadata) =
                outputNotes.get(i).extractNote();
            outputNotesData[i].owner = owner;
            outputNotesData[i].noteHash = noteHash;
            outputNotesData[i].metadata = metadata;
        }
    }
}
