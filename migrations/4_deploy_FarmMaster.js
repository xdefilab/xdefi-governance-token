const XDEX = artifacts.require("XDEX");
const FarmMaster = artifacts.require("FarmMaster");

module.exports = async function (deployer, network) {
    const xdex = await XDEX.deployed();

    return deployer.deploy(FarmMaster, xdex.address, "21012070");
};