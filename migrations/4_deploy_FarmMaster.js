const XDEX = artifacts.require("XDEX");
const FarmMaster = artifacts.require("FarmMaster");

module.exports = async function (deployer, network) {
    const xdex = await XDEX.deployed();

    //kovan and development only
    //if (network == 'development' || network == 'kovan') {
    const SAFU = "0x7590aff8dbb3C6934b651797F22966C823D38C61";
    const startBlock = 21012070;
    return deployer.deploy(FarmMaster, xdex.address, startBlock, SAFU);
    //}

};