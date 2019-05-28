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

    it("should register ETH and coins", async () => {
        const ladex = await LADEX.deployed();
        const tokens = await Utils.getDeployedTokens();

        await Utils.registerEthereum(ladex);
        await Utils.registerTokens(ladex, tokens);

        for (const token of tokens) pairs.push([token, Utils.ETHCurrency()]);
        for (const token of tokens) {
            if (token !== tokens[0]) pairs.push([token, tokens[0]]);
        }
    });

    it("should reject deposit with overflow", async () => {
        const ladex = await LADEX.deployed();

        for (const token of await Utils.getDeployedTokens()) {
            const scaler = toBN("10").pow((await Utils.tokenDecimals(token)).sub(await token.ladexDecimals.call()));
            const tooMuch = (await ladex.MAX_SCALED_BALANCE.call()).add(toBN("1")).mul(scaler);
            await token.setBalance(accounts[0], tooMuch);

            const notTooMuch = (await ladex.MAX_SCALED_BALANCE.call()).mul(scaler);
            await DepositUtils.deposit(ladex, token, accounts[0], notTooMuch, depositNonce++);

            await Utils.assertVMThrows(
                async () => await DepositUtils.deposit(ladex, token, accounts[0], scaler, depositNonce++),
                "deposit must fail because maximum allowed sum is reached"
            );

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [token], [accounts[0]], depositNonce);
        }
    });

    it("should reject trades with maker overflow", async () => {
        const ladex = await LADEX.deployed();

        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            const scaler = toBN("10").pow((await Utils.tokenDecimals(base)).sub(await base.ladexDecimals.call()));
            let size = (await ladex.MAX_SCALED_BALANCE.call()).add(toBN("1")).mul(scaler);
            const cost = await Utils.toWei("1", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            await base.setBalance(traders[1], size);
            await DepositUtils.deposit(ladex, quote, traders[0], cost.mul(toBN('2')), depositNonce++);
            await DepositUtils.deposit(ladex, base, traders[1], size.div(toBN('2')), depositNonce++);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            let order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            let order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            let trade = await OrderUtils.makeTrade(order1, order2);
            let batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "trade with such big cost must be rejected right away"
            );

            size = size.div(toBN('2'));
            nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            trade = await OrderUtils.makeTrade(order1, order2);
            batch = OrderUtils.makeBatch([trade]);
            const receipt = await OrderUtils.publishBatch(ladex, batch);
            assert.equal(receipt.logs.length, 2);

            await DepositUtils.deposit(ladex, base, traders[1], size, depositNonce++);

            nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            trade = await OrderUtils.makeTrade(order1, order2);
            batch = OrderUtils.makeBatch([trade]);
            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "trade leading to balance overflow must be rejected"
            );

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("should reject trades with taker overflow", async () => {
        const ladex = await LADEX.deployed();

        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            if (quote.address === Utils.ETHAddress()) continue;

            const scaler = toBN("10").pow((await Utils.tokenDecimals(quote)).sub(await quote.ladexDecimals.call()));
            const size = await Utils.toWei("1", "ether", base);
            let cost = (await ladex.MAX_SCALED_BALANCE.call()).add(toBN("1")).mul(scaler);
            const fee = await Utils.toWei("0", "ether", quote);

            await quote.setBalance(traders[0], cost);
            await DepositUtils.deposit(ladex, quote, traders[0], cost.div(toBN('2')), depositNonce++);
            await DepositUtils.deposit(ladex, base, traders[1], size.mul(toBN('2')), depositNonce++);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            let order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            let order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            let trade = await OrderUtils.makeTrade(order1, order2);
            let batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "trade with such big cost must be rejected right away"
            );

            cost = cost.div(toBN('2'));
            nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            trade = await OrderUtils.makeTrade(order1, order2);
            batch = OrderUtils.makeBatch([trade]);
            const receipt = await OrderUtils.publishBatch(ladex, batch);
            assert.equal(receipt.logs.length, 2);

            await DepositUtils.deposit(ladex, quote, traders[0], cost, depositNonce++);

            nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            trade = await OrderUtils.makeTrade(order1, order2);
            batch = OrderUtils.makeBatch([trade]);
            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "trade leading to balance overflow must be rejected"
            );

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });
});
