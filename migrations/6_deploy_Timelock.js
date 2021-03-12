const Timelock = artifacts.require('TimelockHarness');

module.exports = async function (deployer) {
    const oneDay = 24 * 60 * 60;

    const SAFU = "0x7590aff8dbb3C6934b651797F22966C823D38C61";

    return deployer.deploy(Timelock, SAFU, oneDay);
};