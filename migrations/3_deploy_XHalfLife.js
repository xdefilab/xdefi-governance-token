const XHalfLife = artifacts.require("XHalfLife");
const MockToken = artifacts.require("MockToken");

module.exports = async function (deployer, network) {
    // if (network == 'development' || network == 'coverage') {
    //     await deployer.deploy(MockToken);
    // }
    return deployer.deploy(XHalfLife);
};