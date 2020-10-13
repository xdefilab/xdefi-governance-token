pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";

contract XDEX is ERC20, ERC20Detailed {
    address public core;

    mapping(address => bool) public minters;

    event CoreTransferred(address indexed _core, address indexed _coreNew);

    constructor() public ERC20Detailed("XDEFI Governance Token", "XDEX", 18) {
        core = msg.sender;
    }

    modifier onlyCore() {
        require(msg.sender == core, "Not Authorized, Only Core");
        _;
    }

    function setCore(address _core) public onlyCore {
        emit CoreTransferred(core, _core);
        core = _core;
    }

    function mint(address account, uint256 amount) public onlyCore {
        _mint(account, amount);
    }

    function burnForSelf(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
