pragma solidity >=0.5.0 <0.7.0;

// An Open Zeppelin 2.x token
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract SimpleToken is ERC20Mintable, ERC20Burnable {}
