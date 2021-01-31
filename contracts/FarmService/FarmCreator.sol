pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "FarmPool.sol";

contract FarmCreator {
    function deploy(
        address _rewardToken,
        address _halflife,
        uint256 _startBlock,
        uint256 _stopBlock,
        address _controller
    ) external returns (address) {
        FarmPool fpool =
            new FarmPool(
                _rewardToken,
                _halflife,
                _startBlock,
                _stopBlock,
                _controller
            );
        return address(fpool);
    }
}
