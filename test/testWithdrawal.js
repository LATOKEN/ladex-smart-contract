const {Utils} = require("./utils/common");
const {DepositUtils} = require("./utils/deposit");
const {WithdrawUtils} = require("./utils/withdraw");
const LADEX = artifacts.require("LADEX");
const toBN = require("web3-utils").toBN;

contract("LADEX", accounts => {
    let nonce = 0;

    it("should register ETH and coins", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();

        await Utils.registerEthereum(ladex);
        await Utils.registerTokens(ladex, tokens);
        await Utils.setupTokenBalances(tokens, accounts, "1000000");
    });

    it("should withdraw normally", async () => {
        const ladex = await LADEX.deployed();

        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            await WithdrawUtils.withdraw(ladex, currency, accounts[0], amount, nonce++);
        }
    });

    it("should fail if ask is too big", async () => {
        const ladex = await LADEX.deployed();

        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);
            const ask_amount = amount.add(toBN("1"));
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            await Utils.assertVMThrows(async () => {
                await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, ask_amount, nonce++);
            }, "Ask withdraw passed but actually not enough funds");
        }
    });

    it("should fail on not aligned amounts", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const decimals = await Utils.tokenDecimals(currency);
            const ladexDecimals = await Utils.ladexDecimals(currency);
            const amount = toBN("10").pow(decimals.sub(ladexDecimals));

            const ask_amount = amount.sub(toBN("1"));
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            if (!ask_amount.eq(toBN("0"))) {
                await Utils.assertVMThrows(async () => {
                    await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, ask_amount, nonce++);
                }, "Ask withdraw must throw on not aligned amount");
            }
        }
    });

    it("should successfully cancel", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);

            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, amount, nonce);
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce++);

            await WithdrawUtils.withdraw(ladex, currency, accounts[0], amount, nonce++);
        }
    });

    it("should fail if already cancelled", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);

            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, amount, nonce);
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce);
            await Utils.assertVMThrows(async () => {
                await WithdrawUtils.completeWithdraw(ladex, accounts[0], currency.address, amount, nonce++);
            }, "Withdraw passed but payment was already cancelled");
        }
    });

    it("ask should fail if another withdrawal is pending", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);
            await DepositUtils.deposit(ladex, currency, accounts[0], amount.mul(toBN("2")), nonce++);
            await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, amount, nonce++);
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.withdraw(ladex, currency, accounts[0], amount, nonce++),
                "Withdrawal passed while another withdrawal is pending"
            );
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce - 2);
        }
    });

    it("should fail if ask and withdraw does not match", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);

            const blockToWait = await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, amount, nonce);
            await Utils.waitUntilBlock(blockToWait);
            for (const withdraw_amount of [
                await Utils.toWei("0", "ether", currency),
                await Utils.toWei("2", "ether", currency),
                await Utils.toWei("3", "ether", currency)
            ]) {
                await Utils.assertVMThrows(
                    async () => await WithdrawUtils.completeWithdraw(ladex, accounts[0], currency.address, withdraw_amount, nonce),
                    "Withdraw passed but asked amount was different"
                );
            }
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.completeWithdraw(ladex, accounts[1], currency.address, amount, nonce),
                "Withdraw passed but asked address was different"
            );
            const anotherAddress =
                currency.address === Utils.ETHAddress()
                    ? (await Utils.getAllCurrencies())[1].address
                    : Utils.ETHAddress();
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.completeWithdraw(ladex, accounts[0], anotherAddress, amount, nonce),
                "Withdraw passed but asked address was different"
            );
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce++);
        }
    });

    it("should fail if waited too few blocks", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            const amount = await Utils.toWei("1", "ether", currency);
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce++);
            const blockToWait = await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, amount, nonce);
            await Utils.waitUntilBlock(blockToWait.sub(toBN("2"))); // wait until -2 to get into block -1
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.completeWithdraw(ladex, accounts[0], currency.address, amount, nonce),
                "Withdraw passed but not enough blocks passed");
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce++);
        }
    });

    it("should fail on bad cancel", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce++),
                "non existing withdrawal nonce was cancelled"
            );
            const amount = await Utils.toWei("1", "ether", currency);
            await DepositUtils.deposit(ladex, currency, accounts[0], amount, nonce);
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.cancelWithdraw(ladex, accounts[0], nonce++),
                "deposit nonce was cancelled"
            );
            const blockToWait = await WithdrawUtils.askForWithdraw(ladex, accounts[0], currency.address, amount, nonce);
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.cancelWithdraw(ladex, accounts[1], nonce),
                "nonce was cancelled by another user"
            );
            await Utils.waitUntilBlock(blockToWait);
            await WithdrawUtils.completeWithdraw(ladex, accounts[0], currency.address, amount, nonce++);
        }
    });
});
