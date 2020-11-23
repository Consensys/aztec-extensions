pragma solidity >=0.5.0 <0.7.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@aztec/protocol/contracts/libs/MetaDataUtils.sol";
import "./IZkCondition.sol";

// Check each note has view access granted the the required accounts
contract ZkConditionViewAccess is IZkCondition, Ownable {
    // Accounts that must be granted view access
    address[] requiredViewAccounts;

    event SetRequiredViewAccounts(
        address sender,
        address[] requiredViewAccounts
    );

    constructor(address[] memory _requiredViewAccounts) public {
        requiredViewAccounts = _requiredViewAccounts;
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
    ) external {}

    function canReceiveNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {
        // copy the calldata to memory
        bytes memory noteMetaData = _metadata;

        // get accounts that have been granted view access
        bytes32 noteMetaDataLength;
        bytes32 numAddressesBytes32;
        uint256 numAddresses = 0;
        assembly {
            noteMetaDataLength := mload(noteMetaData)
            numAddressesBytes32 := mload(add(noteMetaData, 0xe1))
        }
        if (uint256(noteMetaDataLength) > 0x61) {
            numAddresses = uint256(numAddressesBytes32);
        }

        // for each of the required view accounts
        for (uint256 i = 0; i < requiredViewAccounts.length; i += 1) {
            bool hasRequiredViewAccount = false;
            // for each of the accounts granted view access in the note's metadata
            for (uint256 m = 0; i < numAddresses; m += 1) {
                // check if the note's view account matches the required view account
                address extractedViewAccount =
                    MetaDataUtils.extractAddress(noteMetaData, m);
                if (extractedViewAccount == requiredViewAccounts[i]) {
                    hasRequiredViewAccount = true;
                    // break out of the loop over the note's view accounts and check the next required view account
                    break;
                }
            }
            require(
                hasRequiredViewAccount == true,
                "View access has not been granted to one of the required view accounts"
            );
        }
    }

    function setRequiredViewAccounts(address[] memory _requiredViewAccounts)
        public
        onlyOwner()
    {
        requiredViewAccounts = _requiredViewAccounts;
        emit SetRequiredViewAccounts(msg.sender, _requiredViewAccounts);
    }
}
