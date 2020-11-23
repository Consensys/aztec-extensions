pragma solidity >=0.5.0 <0.7.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "./IZkCondition.sol";

/**
 * @title  On-chain zero-knowledge condition implementation that aggregates other zk condition contracts.
 */

contract ZkConditionAggregated is IZkCondition, Ownable {
    IZkCondition[] public conditions;

    event AddCondition(address condition);
    event RemoveCondition(uint256 index, address condition);

    /// @notice Constructor that adds the initial regulator services
    constructor(address[] memory _conditions) public {
        setConditions(_conditions);
    }

    function canTransfer(
        uint24 _proofId,
        bytes calldata _proofOutput,
        address publicOwner,
        int256 publicValue,
        address _sender
    ) external {
        for (uint8 i = 0; i < conditions.length; i++) {
            conditions[i].canTransfer(
                _proofId,
                _proofOutput,
                publicOwner,
                publicValue,
                _sender
            );
        }
    }

    function canSendNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {
        for (uint8 i = 0; i < conditions.length; i++) {
            conditions[i].canSendNote(_owner, _hash, _metadata, _sender);
        }
    }

    function canReceiveNote(
        address _owner,
        bytes32 _hash,
        bytes calldata _metadata,
        address _sender
    ) external {
        for (uint8 i = 0; i < conditions.length; i++) {
            conditions[i].canReceiveNote(_owner, _hash, _metadata, _sender);
        }
    }

    /**
     * @notice Adds new regulator token services to the a list of services that need to be checked
     * @param _conditions array of contract addresses that implement the regulator service contract
     */
    function setConditions(address[] memory _conditions) public onlyOwner() {
        for (uint8 i = 0; i < _conditions.length; i++) {
            addCondition(_conditions[i]);
        }
    }

    /**
     * @notice Adds a new zero-knowledge condition.
     *         Emits an AddCondition event if successful
     * @param _zkConditionContractAddress address of the new zero-knowledge condition contract
     */
    function addCondition(address _zkConditionContractAddress)
        public
        onlyOwner()
    {
        // address of condition contract must be passed in
        require(
            _zkConditionContractAddress != address(0),
            "invalid condition contract address"
        );

        // check the zero-knowledge condition contract has code
        uint256 length;
        assembly {
            length := extcodesize(_zkConditionContractAddress)
        }
        require(length > 0, "no zk condition code");

        // Add the condition to the list of conditions
        conditions.push(IZkCondition(_zkConditionContractAddress));

        // emit an event for the new condition being added
        emit AddCondition(_zkConditionContractAddress);
    }

    /**
     * @notice Removes a new zero-knowledge condition.
     *         Emits an RemoveCondition event if successful
     * @param index location of the new zero-knowledge condition contract
     */
    function removeCondition(uint256 index) public onlyOwner() {
        require(
            index < conditions.length,
            "index out of conditions array range"
        );

        // emit event before the condition is removed
        emit RemoveCondition(index, address(conditions[index]));
        conditions[index] = conditions[conditions.length - 1];
        conditions.pop();
    }
}
