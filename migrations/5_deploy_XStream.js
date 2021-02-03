const XDEX = artifacts.require("XDEX");
const XHalfLife = artifacts.require("XHalfLife");
const XdexStream = artifacts.require("XdexStream");
const FarmMaster = artifacts.require("FarmMaster");

module.exports = async function (deployer, network) {
    const xdex = await XDEX.deployed();
    const halflife = await XHalfLife.deployed();
    const farm = await FarmMaster.deployed();

    const stream = await deployer.deploy(XdexStream, xdex.address, halflife.address, farm.address);

    //set up in farm
    await farm.setStream(stream.address);

    if (network == 'development' || network == 'coverage') {
        await xdex.setCore(farm.address);
    }
};