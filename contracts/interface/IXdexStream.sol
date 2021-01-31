pragma solidity 0.5.17;

interface IXdexStream {
    function hasStream(address who) external view returns (bool, bool);

    function getStreamId(address who, uint256 streamType)
        external
        view
        returns (uint256 streamId);

    function createStream(
        address recipient,
        uint256 depositAmount,
        uint256 streamType,
        uint256 startBlock
    ) external returns (uint256 streamId);

    function fundsToStream(uint256 streamId, uint256 amount)
        external
        returns (bool result);

    function setCore(address _core) external;
}
