const XDEX = artifacts.require("XDEX");

module.exports = async function (deployer) {
    return deployer.deploy(XDEX);
};