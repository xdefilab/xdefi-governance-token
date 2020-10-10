const XHalfLife = artifacts.require("XHalfLife");
const XStream = artifacts.require("XStream");

var XDEX_KOVAN = "0x7042758327753f684568528d5eAb0CD2839c6698";
module.exports = async function (deployer) {
    deployer.deploy(XHalfLife, XDEX_KOVAN).then(function () {
        return deployer.deploy(XStream, XDEX_KOVAN, XHalfLife.address);
    });
};