pragma solidity >=0.5.0 <0.7.0;

import "universal-token/contracts/tokens/ERC20HoldableToken.sol";

contract HoldableToken is ERC20HoldableToken {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) public ERC20HoldableToken(name, symbol, decimals) {}
}
