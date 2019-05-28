const {Utils} = require("./utils/common");
const {DepositUtils} = require("./utils/deposit");
const LADEX = artifacts.require("LADEX");
const toBN = require("web3-utils").toBN;

contract("LADEX", accounts => {
    let nonce = 0;

    it("should reject deposit if coin is not registered", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        await Utils.setupTokenBalances(tokens, accounts, "1000000");

        await Utils.assertVMThrows(async () => {
            await DepositUtils.depositETH(ladex, accounts[0], await Utils.toWei("1", "ether"), 0);
        }, "ETH deposit must fail");

        for (const token of tokens) {
            const amount = await Utils.toWei("1", "ether", token);
            await DepositUtils.approveToken(token, accounts[0], ladex.address, amount);
            await Utils.assertVMThrows(async () => {
                await DepositUtils.depositToken(ladex, token, accounts[0], amount, nonce);
            }, "Token deposit must fail");
        }
    });

    it("should register ETH and coins", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        await Utils.registerEthereum(ladex);
        await Utils.registerTokens(ladex, tokens);
    });

    it("should accept deposits", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
        }
    });

    it("should fail on not aligned amounts", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const decimals = await Utils.tokenDecimals(currency);
            const ladexDecimals = await Utils.ladexDecimals(currency);
            let amount = toBN("10").pow(decimals.sub(ladexDecimals));
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            amount = amount.sub(toBN("1"));
            if (!amount.eq(toBN("0"))) {
                await Utils.assertVMThrows(
                    async () => await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++),
                    "deposit must fail on not aligned amount"
                )
            }
        }
    });

    it("should fail without approval", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        for (const token of tokens) {
            const amount = await Utils.toWei("1", "ether", token);
            await Utils.assertVMThrows(async () => {
                await DepositUtils.depositToken(ladex, token, accounts[0], amount, nonce++);
            }, "deposit must fail if allowance is not set");

        }
    });

    it("should fail on nonce reuse", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();
        let nonce = 1; // use old nonce
        for (const token of tokens) {
            const amount = await Utils.toWei("1", "ether", token);
            await DepositUtils.approveToken(token, accounts[0], ladex.address, amount);
            await Utils.assertVMThrows(async () => {
                await DepositUtils.depositToken(ladex, token, accounts[0], amount, nonce);
            }, "deposit must fail on nonce reuse");
        }
    });
});
