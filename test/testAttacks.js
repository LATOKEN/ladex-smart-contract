const {Utils} = require("./utils/common");
const {DepositUtils} = require("./utils/deposit");
const {WithdrawUtils} = require("./utils/withdraw");
const {OrderUtils} = require("./utils/order");
const LADEX = artifacts.require("LADEX");
const toBN = require("web3-utils").toBN;

contract("LADEX", accounts => {
    let depositNonce = 0;
    const pairs = [];
    const traders = [accounts[1], accounts[2], accounts[3]];

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

    it("should reject doublespending withdrawal", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            await DepositUtils.deposit(ladex, quote, traders[0], await Utils.toWei("1", "ether", quote), depositNonce++);
            await DepositUtils.deposit(ladex, base, traders[1], await Utils.toWei("1", "ether", base), depositNonce++);

            const withdrawAmount = await Utils.toWei("1", "ether", quote);
            const blockToWait = await WithdrawUtils.askForWithdraw(
                ladex, traders[0], quote.address, withdrawAmount, depositNonce
            );

            const size = await Utils.toWei("1", "ether", base);
            const cost = await Utils.toWei("1", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);
            await OrderUtils.publishBatch(ladex, batch);

            await Utils.waitUntilBlock(blockToWait);
            await Utils.assertVMThrows(
                async () => await WithdrawUtils.completeWithdraw(ladex, traders[0], quote.address, withdrawAmount, depositNonce),
                "Withdrawal must be rejected since these tokens were sold"
            );
            await WithdrawUtils.cancelWithdraw(ladex, traders[0], depositNonce++);

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("should reject nonce reuse", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            await DepositUtils.deposit(ladex, quote, traders[0], await Utils.toWei("10", "ether", quote), depositNonce++);
            await DepositUtils.deposit(ladex, base, traders[1], await Utils.toWei("10", "ether", base), depositNonce++);
            await DepositUtils.deposit(ladex, quote, traders[2], await Utils.toWei("10", "ether", quote), depositNonce++);

            const size = await Utils.toWei("1", "ether", base);
            const cost = await Utils.toWei("1", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            let nonce = (await Utils.getNonceForBlock(ladex,await web3.eth.getBlockNumber() + 2)).toNumber();
            const reusedNonce = nonce;

            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            let trade = await OrderUtils.makeTrade(order1, order2);
            let batch = OrderUtils.makeBatch([trade]);
            await OrderUtils.publishBatch(ladex, batch);

            const order3 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, reusedNonce, traders[2]);
            const order4 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            trade = await OrderUtils.makeTrade(order3, order4);
            batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "Trade must be rejected since nonce was reused by another trader"
            );

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("should reject deposit from bad dummy token", async () => {
        const ladex = await LADEX.deployed();
        const BAD = await artifacts.require("BAD").deployed();

        await Utils.registerToken(ladex, BAD);

        const amount = toBN("10").pow(toBN("20")); // 100 BAD
        await BAD.setBalance(accounts[0], amount);

        await DepositUtils.approveToken(BAD, accounts[0], ladex.address, amount);
        await Utils.assertVMThrows(
            async () => await ladex.depositToken(depositNonce++, BAD.address, amount),
            "Deposit with no real balance transfer must be rejected"
        );
    });

    it("should reject withdrawal that was refused by token contract", async () => {
        const ladex = await LADEX.deployed();
        const BAD = await artifacts.require("BAD").deployed();

        await DepositUtils.deposit(ladex, BAD, accounts[0], toBN("10").pow(toBN("19")), depositNonce++);
        {
            const amount = toBN("10").pow(toBN("19")); // 10 BAD
            const blockToWait = await WithdrawUtils.askForWithdraw(ladex, accounts[0], BAD.address, amount, depositNonce);
            await Utils.waitUntilBlock(blockToWait);
            await Utils.assertVMThrows(
                async () => await ladex.withdraw(depositNonce, accounts[0], BAD.address, amount),
                "Transfer rejected by contract, but withdrawal is ok"
            );
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], depositNonce++);
        }
        {
            const amount = toBN("10").pow(toBN("18")); // 1 BAD
            const blockToWait = await WithdrawUtils.askForWithdraw(ladex, accounts[0], BAD.address, amount, depositNonce);
            await Utils.waitUntilBlock(blockToWait);
            await Utils.assertVMThrows(
                async () => await ladex.withdraw(depositNonce, accounts[0], BAD.address, amount),
                "Contract did not transfer money correctly, but withdrawal is ok"
            );
            await WithdrawUtils.cancelWithdraw(ladex, accounts[0], depositNonce++);
        }
    });
});
