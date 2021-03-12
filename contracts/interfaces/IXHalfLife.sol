pragma solidity 0.5.17;

interface IXHalfLife {
    function createStream(
        address token,
        address recipient,
        uint256 depositAmount,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio,
        bool cancelable
    ) external returns (uint256);

    function createEtherStream(
        address recipient,
        uint256 startBlock,
        uint256 kBlock,
        uint256 unlockRatio,
        bool cancelable
    ) external payable returns (uint256);

    function hasStream(uint256 streamId) external view returns (bool);

    function getStream(uint256 streamId)
        external
        view
        returns (
            address sender,
            address recipient,
            address token,
            uint256 depositAmount,
            uint256 startBlock,
            uint256 kBlock,
            uint256 remaining,
            uint256 withdrawable,
            uint256 unlockRatio,
            uint256 lastRewardBlock,
            bool cancelable
        );

    function balanceOf(uint256 streamId)
        external
        view
        returns (uint256 withdrawable, uint256 remaining);

    function withdrawFromStream(uint256 streamId, uint256 amount)
        external
        returns (bool);

    function cancelStream(uint256 streamId) external returns (bool);

    function singleFundStream(uint256 streamId, uint256 amount)
        external
        payable
        returns (bool);

    function lazyFundStream(
        uint256 streamId,
        uint256 amount,
        uint256 blockHeightDiff
    ) external payable returns (bool);

    function getVersion() external pure returns (bytes32);
}
