const FarmMaster = artifacts.require("FarmMaster");

var XDEX_KOVAN = "0xbFbA4038948274984bDb7d11dE488d69F2403f09";
var XStream_KOVAN = "0x7042758327753f684568528d5eAb0CD2839c6698";
module.exports = async function (deployer) {
    deployer.deploy(FarmMaster, XDEX_KOVAN, XStream_KOVAN, "21012070", '0x54bE6dF7b1C9fEE57aF2E8255Bf319da65E4c0C0');
};