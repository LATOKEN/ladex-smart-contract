const tokens = ["LA", "USDC", "DAI", "BDC", "BAD"]
  .map(token => artifacts.require(token));

module.exports = function (deployer, network) {
  if (network === "develop" || network === "coverage" || network === "development") {
    for (const tokenContract of tokens) {
      deployer.deploy(tokenContract);
    }
  }
};