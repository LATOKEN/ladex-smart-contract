const LADEX = artifacts.require("LADEX");

module.exports = function (deployer) {
  deployer.deploy(LADEX, "0x0000000000000000000000000000000000000000");
};
