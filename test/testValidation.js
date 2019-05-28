const {Utils} = require("./utils/common");
const {DepositUtils} = require("./utils/deposit");
const {OrderUtils} = require("./utils/order");
const {WithdrawUtils} = require("./utils/withdraw");
const LADEX = artifacts.require("LADEX");
const toBN = require("web3-utils").toBN;

contract("LADEX", accounts => {
    let depositNonce = 0;
    const pairs = [];
    const traders = [accounts[1], accounts[2]];

    it("should fail on unregistered token", async () => {
        const ladex = await LADEX.deployed();
        for (const currency of await Utils.getAllCurrencies()) {
            await Utils.assertVMThrows(
                async () => await ladex.getTokenIndex.call(currency.address),
                "getTokenIndex must with not registered"
            );
            await Utils.assertVMThrows(
                async () => await ladex.getTokenScaleFactor.call(currency.address),
                "getTokenScaleFactor index must with not registered"
            );
        }
    });

    it("should fail on scale factor overflow", async () => {
        const ladex = await LADEX.deployed();

        const BDC = await artifacts.require("BDC").deployed();
        const index = await BDC.index.call();

        await Utils.assertVMThrows(
            async () => {
                await ladex.registerToken(BDC.address, index, toBN("10"), {
                    from: await ladex.maintainer.call()
                });
            },
            "Register token should fail with bad decimals"
        );
        await Utils.registerToken(ladex, BDC, index, 23);

        let amount = toBN("10").pow(toBN("77"));
        await BDC.setBalance(accounts[0], amount);
        await DepositUtils.deposit(ladex, BDC, accounts[0], amount, depositNonce++);

        amount = toBN("10").pow(toBN("76"));
        await BDC.setBalance(accounts[0], amount);
        await Utils.assertVMThrows(
            async () => await DepositUtils.deposit(ladex, BDC, accounts[0], amount, depositNonce++),
            "deposit must fail with sum not aligned to scale factor"
        )
    });

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

    it("should reject bad orders", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "1", depositNonce);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0.0005", "ether", quote);

            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce - 1, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to bad nonce (maker)"
                );
            }
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce - 6, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to bad nonce (taker)"
                );
            }
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to same order nonce"
                );
            }
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, base, size, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to same currency"
                );
            }
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("should reject bad amounts", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "1", depositNonce);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0.0005", "ether", quote);

            const canHaveBadBase = !toBN(await Utils.tokenDecimals(base)).eq(toBN(await Utils.ladexDecimals(base)));
            const canHaveBadQuote = !toBN(await Utils.tokenDecimals(quote)).eq(toBN(await Utils.ladexDecimals(quote)));
            if (canHaveBadBase)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size.div(toBN('2')).add(toBN('1')), quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned buy currency (maker)"
                );
            }
            if (canHaveBadBase)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size.add(toBN('1')), fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned sell currency (taker)"
                );
            }
            if (canHaveBadQuote)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost.add(toBN('1')), fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned sell currency (maker)"
                );
            }
            if (canHaveBadQuote)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost.div(toBN('2')).add(toBN('1')), base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned buy currency (taker)"
                );
            }
            if (canHaveBadQuote)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee.add(toBN('1')), quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned sell fee (maker)"
                );
            }
            if (canHaveBadQuote)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee.add(toBN('1')), quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned buy fee (maker)"
                );
            }
            if (canHaveBadQuote)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee.add(toBN('1')), quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned buy fee (taker)"
                );
            }
            if (canHaveBadQuote)
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee.add(toBN('1')), quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to unaligned sell fee (taker)"
                );
            }
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("should reject bad match", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "1", depositNonce);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0.0005", "ether", quote);

            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size.add(await Utils.minimalGoodAmount(base)), quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to price mismatch"
                );
            }
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });
});
