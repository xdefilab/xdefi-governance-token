pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";

contract MockToken is ERC20, ERC20Detailed {
    constructor(
        string memory name,
        string memory symbol,
        uint256 supply
    ) public ERC20Detailed(name, symbol, 18) {
        _mint(msg.sender, supply);
    }
}
