pragma solidity >=0.5.0 <0.7.0;

import "@aztec/protocol/contracts/ACE/ACE.sol";
import "@aztec/protocol/contracts/libs/NoteUtils.sol";
import {ZkAssetDirect} from "./ZkAssetDirect.sol";

contract NoteEscrow {
    // NoteUtils is needed to Get a bytes object out of a dynamic AZTEC-ABI array
    // https://github.com/AztecProtocol/AZTEC/blob/develop/packages/protocol/contracts/libs/NoteUtils.sol#L47
    using NoteUtils for bytes;

    ACE public ace;

    constructor(address _aceAddress) public {
        ace = ACE(_aceAddress);
    }

    function validateProof(uint24 _proof, bytes memory _proofData)
        public
        returns (bytes memory)
    {
        // TODO need to check the proof set the sender as the NoteEscrow address
        return ace.validateProof(_proof, address(this), _proofData);
    }

    function approveProof(
        address _assetAddress,
        uint24 _proofId,
        bytes calldata _proofOutputs,
        address _spender,
        bool _approval,
        bytes calldata _proofSignature
    ) external {
        ZkAssetDirect zkAssetDirect = ZkAssetDirect(_assetAddress);
        zkAssetDirect.approveProof(
            _proofId,
            _proofOutputs,
            _spender,
            _approval,
            _proofSignature
        );
    }

    function confidentialTransferFrom(
        address _assetAddress,
        uint24 _proofId,
        bytes calldata _proofOutput
    ) external {
        ZkAssetDirect zkAssetDirect = ZkAssetDirect(_assetAddress);
        zkAssetDirect.confidentialTransferFrom(_proofId, _proofOutput);
    }

    function transferNote(
        address _assetAddress,
        uint24 _proofId,
        bytes32 _noteHash,
        bytes memory _proofData
    ) public {
        (uint8 status, , , address noteOwner) =
            ace.getNote(_assetAddress, _noteHash);
        require(status == 1, "note has to be unspent");
        require(noteOwner == address(this), "this contract must own the note");

        ZkAssetDirect zkAssetDirect = ZkAssetDirect(_assetAddress);
        bytes memory emptySignature = "";
        zkAssetDirect.confidentialApprove(
            _noteHash,
            address(this),
            true,
            emptySignature
        );
        bytes memory proofOutputs =
            ace.validateProof(_proofId, address(this), _proofData);
        zkAssetDirect.confidentialTransferFrom(_proofId, proofOutputs.get(0));
    }
}
