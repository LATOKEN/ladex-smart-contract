const {Utils} = require("./utils/common");
const LADEX = artifacts.require("LADEX");
const toBN = require("web3-utils").toBN;

contract("LADEX", accounts => {
    it("should fail on bad decimals", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        await Utils.assertVMThrows(
            async () => {
                await ladex.registerToken(tokens[0].address, toBN("0"), toBN("20"), {
                    from: await ladex.maintainer.call()
                });
            },
            "Register token should fail with bad decimals"
        );
    });

    it("should fail on occupied index", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        await Utils.registerToken(ladex, tokens[0]);
        const index = await tokens[0].index.call();
        await Utils.assertVMThrows(
            async () => {
                await ladex.registerToken(tokens[1].address, index, toBN("0"), {
                    from: await ladex.maintainer.call(),
                    gas: 200000
                });
            },
            "Register token should fail with index reuse"
        );
    });

    it("should register ETH and coins", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        await Utils.registerEthereum(ladex);
        await Utils.registerTokens(ladex, tokens.slice(1));
    });

    it("should fail on double register", async () => {
        const ladex = await LADEX.deployed();
        await Utils.assertVMThrows(
            async () => {
                await ladex.registerToken((await Utils.getDeployedTokens())[0].address, toBN("1000"), toBN("0"), {
                    from: await ladex.maintainer.call(),
                    gas: 200000
                });
            },
            "Register token should fail on double register"
        );
    });
});
