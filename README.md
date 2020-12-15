# Extensions to the Aztec 1.0 Protocol

Ethereum smart contract extensions to the [AZTEC 1.0 Protocol](https://github.com/aztecProtocol/AZTEC) developed by [AZTEC](https://www.aztecprotocol.com/).

## Installation

```
npm install --ignore-scripts universal-token
npm install
```

The `ignore-scripts` option is required to install the [erc1820](https://github.com/0xjac/ERC1820) dependency of the [Universal Token](https://github.com/ConsenSys/UniversalToken) package which has a [prepack script](https://github.com/0xjac/ERC1820/blob/885549fe3e9f0fd22444f78532be3dce4ee8a5e2/package.json#L21) that runs the tests.
Unfortunately, the build expects [solc](https://github.com/ethereum/solidity) version 0.5.3 to be installed locally which is a very old version with no binaries available. To avoid this, the `ignore-scripts` option will skip the `prepack` script.

## Architecture

This project strips down the [Aztec SDK](https://docs.aztecprotocol.com/#/SDK/The%20role%20of%20the%20SDK) to just the Aztec JavaScript library [aztec.js](https://www.npmjs.com/package/aztec.js).
It uses [Ethers.js v5](https://docs.ethers.io/v5/) for all contract interactions like deploying, sending transactions, reading values and listening for events.
The project is written in TypeScript and uses thin layer on top of Ether.js for typed contract calls.
[Jest](https://jestjs.io/) is used for running various test scenarios against a local [Ganache CLI](https://github.com/trufflesuite/ganache-cli) server.

## Testing

```bash
# Compile the smart contract and TypeScript files
npm run build

# Start a local Gacnache server for testing
npm run start:chain

# Run the Jest unit tests
npm run test
```

The Jest test are located in the [./src/\_\_tests\_\_](./src/__tests__) folder.

## AZTEC

[AZTEC Introduction](./docs/AztecIntro.md) has a high level introduction to the AZTEC Protocol.

### Useful AZTEC Links

- [AZTEC Protocol repository](https://github.com/AztecProtocol/AZTEC)
- [Whitepaper](https://github.com/AztecProtocol/AZTEC/blob/master/AZTEC.pdf)
- [AZTEC Documentation](https://docs.aztecprotocol.com/)
- [AZTEC SDK starter kit](https://github.com/AztecProtocol/sdk-starter-kit)
- [AZTEC Contracts](https://github.com/AztecProtocol/AZTEC/tree/develop/packages/protocol/contracts)
- [AZTEC Mainnet contract addresses](https://github.com/AztecProtocol/AZTEC/blob/develop/packages/contract-addresses/addresses/mainnet.json)
- Developer series
  1. [An introduction to AZTEC](https://medium.com/aztec-protocol/an-introduction-to-aztec-47c70e875dc7)
  2. [Deploying AZTEC to Ganache](https://medium.com/aztec-protocol/deploying-aztec-to-ganache-dc02d538b24f)
  3. [Constructing Proofs, Signing Flows and Key Management](https://medium.com/aztec-protocol/constructing-proofs-signing-flows-and-key-management-6fceb99b2951)
  4. [Creating, Settling & Streaming Confidential Assets](https://medium.com/aztec-protocol/creating-settling-streaming-confidential-assets-256d09e4c8c5)
- [Deploy AZTEC to Ganache](https://medium.com/aztec-protocol/deploying-aztec-to-ganache-dc02d538b24f)
- [AZTEC Protocol Deep Dive](https://medium.com/aztec-protocol/confidential-transactions-have-arrived-a-dive-into-the-aztec-protocol-a1794c00c009)

### AZTEC UML Diagrams

- [AZTEC Contract Diagrams](./docs/contractDiagrams.md)
- [AZTEC Sequence Diagrams](./docs/sequenceDiagrams.md)

# AZTEC 1.0 Extensions 

## Bug Fix

There is a bug in Aztec's [ZkAssetMintableBase](https://github.com/AztecProtocol/AZTEC/blob/14a2c7ff504cb1d8f2b655a23ad01ca2b3b190af/packages/protocol/contracts/ERC1724/base/ZkAssetMintableBase.sol)
contract that prevents `confidentialTransferFrom` transactions after an `approveProof`. This is not something that will be fixed in Aztec 1.0 as it's not a problem for the mainnet Aztec contracts and it'll be fixed in Aztec 2.0.

This bug has been fixed in the [ZkAssetDirect](./src/chain/contracts/ZkAssetDirect.sol).

## Pluggable Conditions

The [ZkAssetConditional](./src/chain/contracts/ZkAssetConditional.sol) contract takes a contract that implements the `IZkCondition` interface in the constructor. This is used to validate if `confidentialMint`, `confidentialTransfer` or `confidentialTransferFrom` transactions can go ahead.

The `IZkCondition` interface defines `canTransfer` which validates against the proof output, `canSendNote` validates the input notes and `canReceiveNote` validates the output notes. If any of these checks fail then the whole confidential transaction will be failed.

```Solidity
function canTransfer(uint24 _proofId, bytes calldata _proofOutput, address publicOwner, int256 publicValue, address _sender) external;
function canSendNote(address _owner, bytes32 _hash, bytes calldata _metadata, address _sender) external;
function canReceiveNote(address _owner, bytes32 _hash, bytes calldata _metadata, address _sender) external;
```

### Suspend

[ZkConditionSuspend](./src/chain/contracts/ZkConditionSuspend.sol) is a simple implementation of `IZkCondition` that can suspend all confidential transfers.

### Account approval (whitelist)

[ZkConditionApprovedAccounts](./src/chain/contracts/ZkConditionApprovedAccounts.sol) is an implementation of `IZkCondition` that will only allow transfers between approved accounts.

### View Access

[ZkConditionViewAccess](./src/chain/contracts/ZkConditionViewAccess.sol) is an implementation of `IZkCondition` that checks an account has view access to the output notes.

### Aggregated Conditions

[ZkConditionAggregated](./src/chain/contracts/ZkConditionAggregated.sol) is an implementation of `IZkCondition` that allows multiple implementations of `IZkCondition` to be plugged in.

## Holdable, Hash-Locks

A token `hold` is like an `approve` where held tokens can not be spent by the token holder until after a hold expiration period.
The hold can be executed by a notary, which can be the recipient of the tokens, a third party or a smart contract.
The notary can execute the hold before or after the expiration period.
Additionally, a hash lock at be applied which requires the notary of the hold to present the hash preimage to execute the hold.
Held tokens can be released by the notary at any time or by the token holder after the expiration period.
A recipient does not have to get set at the time of the hold, which means it will have to be specified when the hold is executed.
    
[ZkAssetHoldable](./src/chain/contracts/ZkAssetHoldable.sol) implements the `IZkAssetHoldable` interface.

```Solidity
    /**
     @notice Called by the sender to hold input notes of a proof that the sender can not release back to themself until after the expiration date.
     @param proofId Aztec proof identifier.
     @param proofOutput Aztec JoinSplit proof output.
     @param notary account that can execute the hold.
     @param expirationDateTime UNIX epoch seconds the held amount can be released back to the sender by the sender. Past dates are allowed.
     @param lockHash optional keccak256 hash of a lock preimage. An empty hash will not enforce the hash lock when the hold is executed.
     @param holdSignature  EIP712 signature of the hold from the spender.
     @return a unique identifier for the hold.
     */
    function holdProof(
        uint24 proofId,
        bytes calldata proofOutput,
        address notary,
        uint256 expirationDateTime,
        bytes32 lockHash,
        bytes calldata holdSignature
    ) external returns (bytes32 holdId);

    /**
     @notice Called by the notary to transfer the held tokens to the recipient if the is no hold lock hash.
     @param holdId a unique identifier for the hold.
     */
    function executeHold(bytes32 holdId) external;

    /**
     @notice Called by the notary to transfer the held tokens to the recipient.
     @param holdId a unique identifier for the hold.
     @param lockPreimage the image used to generate the lock hash with a keccak256 hash
     */
    function executeHold(bytes32 holdId, bytes32 lockPreimage) external;

    /**
     @notice Called by the sender after the expiration date to release the held tokens so they have control of them again.
     @param holdId a unique identifier for the hold.
     @param releaseSignature  EIP712 signature of the release from the spender.
     */
    function releaseHold(bytes32 holdId, bytes calldata releaseSignature)
        external;

    /**
     @param holdId a unique identifier for the hold.
     @return hold status code.
     */
    function holdStatus(bytes32 holdId) external view returns (HoldStatusCode);
```


