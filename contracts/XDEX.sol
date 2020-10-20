pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";

contract XDEX is ERC20, ERC20Detailed {
    address public core;

    mapping(address => bool) public minters;

    event CoreTransferred(address indexed _core, address indexed _coreNew);
    event AddMinter(address indexed _minter);
    event RemoveMinter(address indexed _minter);

    constructor() public ERC20Detailed("XDEFI Governance Token", "XDEX", 18) {
        core = msg.sender;
    }

    modifier onlyCore() {
        require(msg.sender == core, "Not Authorized, Only Core");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "Not Authorized, Only Minter");
        _;
    }

    function setCore(address _core) public onlyCore {
        emit CoreTransferred(core, _core);
        core = _core;
    }

    function mint(address account, uint256 amount) public onlyMinter {
        _mint(account, amount);
    }

    function addMinter(address _minter) public onlyCore {
        minters[_minter] = true;
        emit AddMinter(_minter);
    }

    function removeMinter(address _minter) public onlyCore {
        minters[_minter] = false;
        emit RemoveMinter(_minter);
    }

    function burnForSelf(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
