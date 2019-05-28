const {Utils} = require("./utils/common");
const {OrderUtils} = require("./utils/order");
const LADEX = artifacts.require("LADEX");
const toBN = require("web3-utils").toBN;

contract("LADEX", accounts => {
    let depositNonce = 0;
    const pairs = [];
    const traders = [accounts[1], accounts[2], accounts[3]];

    let owner, maintainer;

    it("should register coins", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        await Utils.registerEthereum(ladex);
        await Utils.registerTokens(ladex, tokens);
        await Utils.setupTokenBalances(tokens, traders, "1000000");

        for (const token of tokens) pairs.push([token, Utils.ETHCurrency()]);
        for (const token of tokens) {
            if (token !== tokens[0]) pairs.push([token, tokens[0]]);
        }
    });

    it("should not accept ether directly", async () => {
        const ladex = await LADEX.deployed();
        await Utils.assertVMThrows(
            async () => await web3.eth.sendTransaction({from: accounts[0], to: ladex.address, value: await Utils.toWei("1", "ether")}),
            "LADEX must reject direct ether sends"
        );
    });

    it("should allow owner to change owner", async () => {
        const ladex = await LADEX.deployed();

        owner = await ladex.owner.call();
        const notOwner = owner === accounts[0] ? accounts[1] : accounts[0];

        await Utils.assertVMThrows(
            async () => await ladex.setOwner(notOwner, {from: notOwner}),
            "LADEX must allow only owner to change owner"
        );

        // let's transfer ownership back
        await ladex.setOwner(notOwner, {from: owner});

        await Utils.assertVMThrows(
            async () => await ladex.setOwner(owner, {from: owner}),
            "LADEX must allow only current owner to change owner"
        );

        await ladex.setOwner(owner, {from: notOwner});
    });

    it("should allow owner to change maintainer", async () => {
        const ladex = await LADEX.deployed();

        owner = await ladex.owner.call();
        maintainer = await ladex.maintainer.call();

        assert.equal(owner, maintainer, "owner and maintainer must be equal initially");

        // make sure we change maintainer to another address
        maintainer = owner === accounts[0] ? accounts[1] : accounts[0];

        await Utils.assertVMThrows(
            async () => await ladex.setMaintainer(maintainer, {from: maintainer}),
            "LADEX must allow only owner to change maintainer"
        );

        await ladex.setMaintainer(maintainer, {from: owner});
    });

    it("should not allow owner to maintain contract", async () => {
        const ladex = await LADEX.deployed();

        owner = await ladex.owner.call();
        maintainer = await ladex.maintainer.call();

        assert.notEqual(owner, maintainer, "owner and maintainer must be different for this test");

        await Utils.assertVMThrows(
            async () => await ladex.modifyFeeAccount(owner, {from: owner}),
            "LADEX must allow only maintainer to change fee account"
        );
        await ladex.modifyFeeAccount(owner, {from: maintainer});
        await Utils.assertVMThrows(
            async () => await ladex.registerTokenDirectly(Utils.ETHAddress(), 0, 1, 9, {from: owner}),
            "LADEX must allow only maintainer to register tokens"
        );
        await Utils.assertVMThrows(
            async () => await ladex.registerToken(Utils.ETHAddress(), 0, 9, {from: owner}),
            "LADEX must allow only maintainer to register tokens"
        );

        const batch = OrderUtils.makeBatch([]);
        await Utils.assertVMThrows(
            async () => await OrderUtils.publishBatch(ladex, batch, owner),
            "LADEX must allow only maintainer to publish batches"
        );
    });
});
