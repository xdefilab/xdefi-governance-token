pragma solidity 0.5.17;

import "./interface/IXConfig.sol";
import "FarmPool.sol";

interface IFarmCreator {
    function deploy(
        address _rewardToken,
        address _halflife,
        uint256 _startBlock,
        uint256 _stopBlock,
        address _controller
    ) external returns (address);
}

contract FarmFactory {
    IXConfig public xconfig;
    IFarmCreator public creator;

    event LOG_NEW_FPOOL(address indexed caller, address indexed fpool);
    event SET_CREATOR(address indexed creator, address indexed creatorNew);

    constructor(address _config, address _creator) public {
        xconfig = IXConfig(_config);
        creator = IFarmCreator(_creator);
    }

    function deploy(
        address _rewardToken,
        address _halflife,
        uint256 _startBlock,
        uint256 _stopBlock,
        address _controller
    ) external returns (FarmPool) {
        address fpool =
            creator.deploy(
                _rewardToken,
                _halflife,
                _startBlock,
                _stopBlock,
                _controller
            );

        emit LOG_NEW_FPOOL(msg.sender, fpool);

        return FarmPool(fpool);
    }

    function setCreator(address _creator) external {
        require(msg.sender == xconfig.getCore(), "ERR_NOT_AUTH");
        require(_creator != address(0), "ERR_ZERO_ADDR");

        emit SET_CREATOR(address(creator), _creator);
        creator = IXPoolCreator(_creator);
    }
}
