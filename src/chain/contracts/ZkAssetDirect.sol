pragma solidity >=0.5.0 <0.7.0;

import "@aztec/protocol/contracts/ERC1724/ZkAssetAdjustable.sol";

contract ZkAssetDirect is ZkAssetAdjustable {
    constructor(address _aceAddress, uint256 _scalingFactor)
        public
        ZkAssetAdjustable(_aceAddress, address(0), _scalingFactor, 0, "")
    {}

    /**
     * @dev fixes a bug in Aztec's ZkAssetMintableBase contract that does not allow
     * confidentialTransferFrom after an approveProof.
     * See this Slack thread for more details
     * https://consensys.slack.com/archives/CH4PF4NP3/p1595598113022200?thread_ts=1595592388.018300&cid=CH4PF4NP3
     */
    function confidentialTransferFrom(
        uint24 _proofId,
        bytes memory _proofOutput
    ) public {
        bool result = supportsProof(_proofId);
        require(result == true, "expected proof to be supported");

        (
            bytes memory inputNotes,
            bytes memory outputNotes,
            address publicOwner,
            int256 publicValue
        ) = _proofOutput.extractProofOutput();

        // Nick added next line and the if statement so approveProof will work.
        bytes32 proofHash = keccak256(_proofOutput);

        if (confidentialApproved[proofHash][msg.sender] != true) {
            uint256 length = inputNotes.getLength();
            for (uint256 i = 0; i < length; i += 1) {
                (, bytes32 noteHash, ) = inputNotes.get(i).extractNote();
                require(
                    confidentialApproved[noteHash][msg.sender] == true,
                    "ZkAssetDirect sender does not have approval to spend input note"
                );
            }
        }

        if (publicValue > 0) {
            supplementTokens(uint256(publicValue));
        }

        ace.updateNoteRegistry(_proofId, _proofOutput, msg.sender);

        logInputNotes(inputNotes);
        logOutputNotes(outputNotes);

        if (publicValue < 0) {
            emit ConvertTokens(publicOwner, uint256(-publicValue));
        }
        if (publicValue > 0) {
            emit RedeemTokens(publicOwner, uint256(publicValue));
        }
    }
}
