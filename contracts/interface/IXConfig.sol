pragma solidity 0.5.17;

interface IXConfig {
    function getCore() external view returns (address);

    function getSAFU() external view returns (address);

    function isFarmPool(address pool) external view returns (bool);

    function getMaxExitFee() external view returns (uint256);

    function getSafuFee() external view returns (uint256);

    function getSwapProxy() external view returns (address);

    function ethAddress() external pure returns (address);

    function XDEXAddress() external pure returns (address);

    function hasPool(address[] calldata tokens, uint256[] calldata denorms)
        external
        view
        returns (bool exist, bytes32 sig);

    // add by XSwapProxy
    function addPoolSig(bytes32 sig) external;

    // remove by XSwapProxy
    function removePoolSig(bytes32 sig) external;
}
