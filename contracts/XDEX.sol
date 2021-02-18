pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";

contract XDEX is ERC20, ERC20Detailed {
    address public core;

    event SET_CORE(address indexed core, address indexed _core);

    constructor() public ERC20Detailed("XDEFI Governance Token", "XDEX", 18) {
        core = msg.sender;
    }

    modifier onlyCore() {
        require(msg.sender == core, "Not Authorized");
        _;
    }

    function setCore(address _core) public onlyCore {
        require(_core != address(0), "ERR_ZERO_ADDRESS");
        emit SET_CORE(core, _core);
        core = _core;
    }

    function mint(address account, uint256 amount) public onlyCore {
        _mint(account, amount);
    }

    function burnForSelf(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
