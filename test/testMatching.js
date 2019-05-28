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

    it("basic matching", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "1", depositNonce);
            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0.0005", "ether", quote);

            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);
            const receipt = await OrderUtils.publishBatch(ladex, batch);

            const tradeEvent = receipt.logs[0].args;
            assert.equal(tradeEvent.maker, order1.order.wallet);
            assert.equal(tradeEvent.taker, order2.order.wallet);
            assert.equal(tradeEvent.tokenMakerBuy, order1.order.tokenBuy.address);
            assert.equal(tradeEvent.tokenTakerBuy, order2.order.tokenBuy.address);
            assert.equal(tradeEvent.nonceMaker, order1.order.nonce);
            assert.equal(tradeEvent.nonceTaker, order2.order.nonce);
            assert.equal(tradeEvent.makerBuyBalance.toString(), wasBase.add(size).toString());
            assert.equal(tradeEvent.makerSellBalance.toString(), wasQuote.sub(cost).sub(fee).toString());
            assert.equal(tradeEvent.takerBuyBalance.toString(), wasQuote.add(cost).sub(fee).toString());
            assert.equal(tradeEvent.takerSellBalance.toString(), wasBase.sub(size).toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("self trade", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0]], "1", depositNonce);
            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0.0005", "ether", quote);

            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);
            const receipt = await OrderUtils.publishBatch(ladex, batch);

            assert.equal(receipt.logs.length, 2);

            const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
            const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            assert.equal(newMakerQuote.toString(), wasQuote.sub(fee.add(fee)).toString());
            assert.equal(newMakerBase.toString(), wasBase.toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0]], depositNonce);
        }
    });

    it("not enough sell balance maker", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            await DepositUtils.deposit(ladex, quote, traders[0], await Utils.toWei("0.1", "ether", quote), depositNonce++);
            await DepositUtils.deposit(ladex, base, traders[1], await Utils.toWei("1", "ether", base), depositNonce++);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "batch must fail due to not enough balance (maker)"
            );
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("not enough buy balance maker", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            await DepositUtils.deposit(ladex, base, traders[0], await Utils.toWei("1", "ether", base), depositNonce++);
            await DepositUtils.deposit(ladex, quote, traders[1], await Utils.toWei("1", "ether", quote), depositNonce++);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("1", "ether", quote);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, toBN("0"), quote, nonce++, traders[1]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "batch must fail due to not enough balance (maker)"
            );
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("not enough buy balance taker", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            await DepositUtils.deposit(ladex, quote, traders[0], await Utils.toWei("1", "ether", quote), depositNonce++);
            await DepositUtils.deposit(ladex, base, traders[1], await Utils.toWei("1", "ether", base), depositNonce++);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("1", "ether", quote);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, toBN("0"), quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[1]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "batch must fail due to not enough balance (taker)"
            );
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("not enough sell balance taker", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            await DepositUtils.deposit(ladex, base, traders[0], await Utils.toWei("1", "ether", base), depositNonce++);
            await DepositUtils.deposit(ladex, quote, traders[1], await Utils.toWei("0.1", "ether", quote), depositNonce++);

            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[1]);
            const trade = await OrderUtils.makeTrade(order1, order2);
            const batch = OrderUtils.makeBatch([trade]);

            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "batch must fail due to not enough balance (taker)"
            );
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("not enough balance self trade", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0]], "0.19", depositNonce);
            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0.1", "ether", quote);

            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to not enough balance"
                );
                depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0]], depositNonce);
            }
            {
                let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
                const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
                const trade = await OrderUtils.makeTrade(order2, order1);
                const batch = OrderUtils.makeBatch([trade]);

                await Utils.assertVMThrows(
                    async () => await OrderUtils.publishBatch(ladex, batch),
                    "batch must fail due to not enough balance"
                );
                depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0]], depositNonce);
            }
        }
    });

    it("process batch with identical trades", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "3", depositNonce);
            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            const size = await Utils.toWei("0.1", "ether", base);
            const cost = await Utils.toWei("0.1", "ether", quote);
            const fee = await Utils.toWei("0.0001", "ether", quote);

            let trades = [];
            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const N = 20;

            for (let i = 0; i < N; ++i) {
                const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[0]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[1]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                trades.push(trade);
            }
            const batch = OrderUtils.makeBatch(trades);
            const receipt = await OrderUtils.publishBatch(ladex, batch);

            assert.equal(receipt.logs.length, N + 1);
            console.log(N + " trades; " + (2 * N) + " orders; GPT: " + (receipt.receipt.gasUsed / N) + " GPO: " + receipt.receipt.gasUsed / (2 * N));

            const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
            const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);
            const newTakerBase = await Utils.getBalance(ladex, traders[1], base.address);
            const newTakerQuote = await Utils.getBalance(ladex, traders[1], quote.address);

            assert.equal(newMakerQuote.toString(), wasQuote.add(cost.sub(fee).mul(toBN(N))).toString());
            assert.equal(newMakerBase.toString(), wasBase.sub(size.mul(toBN(N))).toString());
            assert.equal(newTakerQuote.toString(), wasQuote.sub(cost.add(fee).mul(toBN(N))).toString());
            assert.equal(newTakerBase.toString(), wasBase.add(size.mul(toBN(N))).toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("process batch with buy/sell", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "10", depositNonce);
            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            const size = await Utils.toWei("0.1", "ether", base);
            const cost = await Utils.toWei("0.1", "ether", quote);
            const fee = await Utils.toWei("0.0001", "ether", quote);

            const N = 20;
            let trades = [];
            let nonce = await Utils.getFirstValidNonce(ladex);

            for (let i = 0; i < N; ++i) {
                const buyer = i % 2, seller = (i + 1) % 2;
                const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[buyer]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[seller]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                trades.push(trade);
            }
            const batch = OrderUtils.makeBatch(trades);
            const receipt = await OrderUtils.publishBatch(ladex, batch);

            assert.equal(receipt.logs.length, N + 1);
            console.log(N + " trades; " + (2 * N) + " orders; GPT: " + (receipt.receipt.gasUsed / N) + " GPO: " + receipt.receipt.gasUsed / (2 * N));

            const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
            const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);
            const newTakerBase = await Utils.getBalance(ladex, traders[1], base.address);
            const newTakerQuote = await Utils.getBalance(ladex, traders[1], quote.address);

            assert.equal(newMakerQuote.toString(), wasQuote.sub(fee.mul(toBN(N))).toString());
            assert.equal(newMakerBase.toString(), wasBase.toString());
            assert.equal(newTakerQuote.toString(), wasQuote.sub(fee.mul(toBN(N))).toString());
            assert.equal(newTakerBase.toString(), wasBase.toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("process many small batches with buy/sell", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "10", depositNonce);
            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            const size = await Utils.toWei("0.1", "ether", base);
            const cost = await Utils.toWei("0.1", "ether", quote);
            const fee = await Utils.toWei("0.0001", "ether", quote);

            const N = 20;
            for (let i = 0; i < N; ++i) {
                let nonce = await Utils.getFirstValidNonce(ladex);
                const buyer = i % 2, seller = (i + 1) % 2;
                const order1 = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce++, traders[buyer]);
                const order2 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[seller]);
                const trade = await OrderUtils.makeTrade(order1, order2);
                const batch = OrderUtils.makeBatch([trade]);
                const receipt = await OrderUtils.publishBatch(ladex, batch);

                assert.equal(receipt.logs.length, 2);
            }

            const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
            const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);
            const newTakerBase = await Utils.getBalance(ladex, traders[1], base.address);
            const newTakerQuote = await Utils.getBalance(ladex, traders[1], quote.address);

            assert.equal(newMakerQuote.toString(), wasQuote.sub(fee.mul(toBN(N))).toString());
            assert.equal(newMakerBase.toString(), wasBase.toString());
            assert.equal(newTakerQuote.toString(), wasQuote.sub(fee.mul(toBN(N))).toString());
            assert.equal(newTakerBase.toString(), wasBase.toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("nontrivial matches", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], traders, "10", depositNonce);
            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            // this is somewhat fragile logic, only valid if we execute in consecutive blocks
            let nonce = (await Utils.getFirstValidNonce(ladex)).add(await ladex.NONCES_PER_BLOCK.call()).toNumber();
            // getNonceForBlock(await web3.eth.getBlockNumber() + 1);
            const q1 = await Utils.toWei("0.6", "ether", base);
            const c1 = await Utils.toWei("0.2", "ether", quote);
            const f1 = await Utils.toWei("0.0006", "ether", quote);
            // BUY 0.6 LA for 0.2 ETH (0.333... ETH / LA) (0.0006 ETH fee)
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, q1, quote, c1, f1, quote, nonce++, traders[0]);
            const q2 = await Utils.toWei("0.3", "ether", base);
            const c2 = await Utils.toWei("0.075", "ether", quote);
            const f2 = await Utils.toWei("0.0001", "ether", quote);
            // SELL 0.3 LA for 0.075 ETH (0.25... ETH / LA) (0.0001 ETH fee)
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, c2, base, q2, f2, quote, nonce++, traders[1]);
            const trade1 = await OrderUtils.makeTrade(order1, order2);

            const q3 = await Utils.toWei("0.9", "ether", base);
            const c3 = await Utils.toWei("0.2625", "ether", quote);
            const f3 = await Utils.toWei("0.0002", "ether", quote);
            // SELL 0.9 LA for 0.2625 ETH (0.291666... ETH / LA) (0.0002 ETH fee)
            const order3 = await OrderUtils.makeSignedOrder(ladex, quote, c3, base, q3, f3, quote, nonce++, traders[1]);
            const trade2 = await OrderUtils.makeTrade(order1, order3);

            let receipt = await OrderUtils.publishBatch(ladex, OrderUtils.makeBatch([trade1, trade2]));
            assert.equal(receipt.logs.length, 3);

            let baseBalance0 = await Utils.getBalance(ladex, traders[0], base.address);
            let quoteBalance0 = await Utils.getBalance(ladex, traders[0], quote.address);
            let baseBalance1 = await Utils.getBalance(ladex, traders[1], base.address);
            let quoteBalance1 = await Utils.getBalance(ladex, traders[1], quote.address);
            let baseBalance2 = await Utils.getBalance(ladex, traders[2], base.address);
            let quoteBalance2 = await Utils.getBalance(ladex, traders[2], quote.address);
            // After that there is one order in book for 0.6 LA for 0.175 ETH (0.291666... ETH / LA) (0.0002 ETH fee)
            // First trader sold 0.6 LA in 2 trades for 0.2 ETH and paid 0.0006 ETH fee
            assert.equal(quoteBalance0.toString(), wasQuote.sub(c1.add(f1)).toString());
            assert.equal(baseBalance0.toString(), wasBase.add(q1).toString());
            assert.equal(quoteBalance1.toString(), wasQuote.add(c1.sub(f2).sub(f3)).toString());
            assert.equal(baseBalance1.toString(), wasBase.sub(q1).toString());
            assert.equal(quoteBalance2.toString(), wasQuote.toString());
            assert.equal(baseBalance2.toString(), wasBase.toString());

            const q4 = await Utils.toWei("0.3", "ether", base);
            const c4 = await Utils.toWei("0.3", "ether", quote);
            const f4 = await Utils.toWei("0.0003", "ether", quote);
            const order4 = await OrderUtils.makeSignedOrder(ladex, base, q4, quote, c4, f4, quote, nonce++, traders[2]);
            const q5 = await Utils.toWei("0.3", "ether", base);
            const c5 = await Utils.toWei("0.3", "ether", quote);
            const f5 = await Utils.toWei("0.0003", "ether", quote);
            const order5 = await OrderUtils.makeSignedOrder(ladex, base, q5, quote, c5, f5, quote, nonce++, traders[2]);
            const trade3 = await OrderUtils.makeTrade(order3, order4);
            const trade4 = await OrderUtils.makeTrade(order3, order5);
            receipt = await OrderUtils.publishBatch(ladex, OrderUtils.makeBatch([trade3, trade4]));
            assert.equal(receipt.logs.length, 3);

            baseBalance0 = await Utils.getBalance(ladex, traders[0], base.address);
            quoteBalance0 = await Utils.getBalance(ladex, traders[0], quote.address);
            baseBalance1 = await Utils.getBalance(ladex, traders[1], base.address);
            quoteBalance1 = await Utils.getBalance(ladex, traders[1], quote.address);
            baseBalance2 = await Utils.getBalance(ladex, traders[2], base.address);
            quoteBalance2 = await Utils.getBalance(ladex, traders[2], quote.address);

            assert.equal(quoteBalance0.toString(), wasQuote.sub(c1.add(f1)).toString());
            assert.equal(baseBalance0.toString(), wasBase.add(q1).toString());
            assert.equal(quoteBalance1.toString(), wasQuote.add(await Utils.toWei("0.375", "ether", quote)).sub(f2).sub(f3).toString());
            assert.equal(baseBalance1.toString(), wasBase.sub(await Utils.toWei("1.2", "ether", base)).toString());
            assert.equal(quoteBalance2.toString(), wasQuote.sub(await Utils.toWei("0.175", "ether", quote)).sub(f4).sub(f5).toString());
            assert.equal(baseBalance2.toString(), wasBase.add(await Utils.toWei("0.6", "ether", base)).toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], traders, depositNonce);
        }
    });


    it("process batch with big chain match", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "10", depositNonce);
            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            const size = await Utils.toWei("0.1", "ether", base);
            const cost = await Utils.toWei("0.1", "ether", quote);
            const fee = await Utils.toWei("0.0001", "ether", quote);

            const N = 20;
            let trades = [];
            let nonce = await Utils.getFirstValidNonce(ladex);

            let currentOrder = await OrderUtils.makeSignedOrder(ladex, base, size.div(toBN("2")), quote, cost.div(toBN("2")), toBN("0"), quote, nonce++, traders[0]);
            for (let i = 0; i < N; ++i) {
                let newOrder;
                if (i % 2 === 0) {
                    newOrder = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce, traders[1]);
                } else {
                    newOrder = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce, traders[0]);
                }
                nonce++;
                const trade = await OrderUtils.makeTrade(currentOrder, newOrder);
                trades.push(trade);
                currentOrder = newOrder;
            }
            const batch = OrderUtils.makeBatch(trades);
            const receipt = await OrderUtils.publishBatch(ladex, batch);

            assert.equal(receipt.logs.length, N + 1);
            console.log(N + " trades; " + (N + 1) + " orders; GPT: " + (receipt.receipt.gasUsed / N) + " GPO: " + receipt.receipt.gasUsed / (N + 1));

            const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
            const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);
            const newTakerBase = await Utils.getBalance(ladex, traders[1], base.address);
            const newTakerQuote = await Utils.getBalance(ladex, traders[1], quote.address);

            assert.equal(newMakerQuote.toString(), wasQuote.sub(cost.add(fee).mul(toBN(N / 2))).toString());
            assert.equal(newMakerBase.toString(), wasBase.add(size.mul(toBN(N / 2))).toString());
            assert.equal(newTakerQuote.toString(), wasQuote.add(cost.sub(fee).mul(toBN(N / 2))).toString());
            assert.equal(newTakerBase.toString(), wasBase.sub(size.mul(toBN(N / 2))).toString());

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("process batch with big chain match with nonce erasure", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "10", depositNonce);
            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            const size = await Utils.toWei("0.1", "ether", base);
            const cost = await Utils.toWei("0.1", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            const N = 10;
            // this is somewhat fragile logic, only valid if we execute in consecutive blocks
            let nonce = (await Utils.getNonceForBlock(ladex, await web3.eth.getBlockNumber() + 2)).toNumber();
            let undeleted = [[], [], []];
            let currentOrder = await OrderUtils.makeSignedOrder(ladex, base, size.div(toBN("2")), quote, cost.div(toBN("2")), toBN("0"), quote, nonce++, traders[0]);
            undeleted[1].push(nonce - 1);
            for (let idx = 0; idx < 3; ++idx) {
                let trades = [];
                for (let i = 0; i < N; ++i) {
                    let newOrder;
                    if (i % 2 === 0) {
                        newOrder = await OrderUtils.makeSignedOrder(ladex, quote, cost, base, size, fee, quote, nonce, traders[1]);
                    } else {
                        newOrder = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce, traders[0]);
                    }
                    undeleted[2].push(nonce);
                    nonce++;
                    const trade = await OrderUtils.makeTrade(currentOrder, newOrder);
                    trades.push(trade);
                    currentOrder = newOrder;
                }
                const batch = OrderUtils.makeBatch(trades);
                batch.nonces = undeleted[0].slice();
                undeleted[0] = undeleted[1].slice();
                undeleted[1] = undeleted[2].slice();
                undeleted[2] = [];
                const receipt = await OrderUtils.publishBatch(ladex, batch);

                assert.equal(receipt.logs.length, N + 1);
                if (idx === 2) {
                    console.log(N + " trades; " + (N + 1) + " orders; GPT: " + (receipt.receipt.gasUsed / N) + " GPO: " + receipt.receipt.gasUsed / (N + 1));
                }

                const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
                const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);
                const newTakerBase = await Utils.getBalance(ladex, traders[1], base.address);
                const newTakerQuote = await Utils.getBalance(ladex, traders[1], quote.address);

                assert.equal(newMakerQuote.toString(), wasQuote.sub(cost.mul(toBN((idx + 1) * N / 2))).toString());
                assert.equal(newMakerBase.toString(), wasBase.add(size.mul(toBN((idx + 1) * N / 2))).toString());
                assert.equal(newTakerQuote.toString(), wasQuote.add(cost.mul(toBN((idx + 1) * N / 2))).toString());
                assert.equal(newTakerBase.toString(), wasBase.sub(size.mul(toBN((idx + 1) * N / 2))).toString());

                nonce = (await Utils.getNonceForBlock(ladex, await web3.eth.getBlockNumber() + 2)).toNumber();
            }
            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });

    it("should automatically cancel old nonces", async () => {
        const ladex = await LADEX.deployed();
        for (const pair of pairs) {
            const base = pair[0];
            const quote = pair[1];

            depositNonce = await DepositUtils.depositEach(ladex, [base, quote], [traders[0], traders[1]], "1", depositNonce);
            const size = await Utils.toWei("0.5", "ether", base);
            const cost = await Utils.toWei("0.5", "ether", quote);
            const fee = await Utils.toWei("0", "ether", quote);

            const wasBase = await Utils.getBalance(ladex, traders[0], base.address);
            const wasQuote = await Utils.getBalance(ladex, traders[0], quote.address);

            let nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order1 = await OrderUtils.makeSignedOrder(ladex, base, size, quote, cost, fee, quote, nonce++, traders[0]);
            const order2 = await OrderUtils.makeSignedOrder(ladex, quote, cost.div(toBN("2")), base, size.div(toBN("2")), fee, quote, nonce++, traders[1]);
            let trade = await OrderUtils.makeTrade(order1, order2);
            let batch = OrderUtils.makeBatch([trade]);
            let receipt = await OrderUtils.publishBatch(ladex, batch);

            assert.equal(receipt.logs.length, 2);
            const newMakerBase = await Utils.getBalance(ladex, traders[0], base.address);
            const newMakerQuote = await Utils.getBalance(ladex, traders[0], quote.address);
            const newTakerBase = await Utils.getBalance(ladex, traders[1], base.address);
            const newTakerQuote = await Utils.getBalance(ladex, traders[1], quote.address);

            assert.equal(newMakerQuote.toString(), wasQuote.sub(cost.div(toBN("2"))).toString());
            assert.equal(newMakerBase.toString(), wasBase.add(size.div(toBN("2"))).toString());
            assert.equal(newTakerQuote.toString(), wasQuote.add(cost.div(toBN("2"))).toString());
            assert.equal(newTakerBase.toString(), wasBase.sub(size.div(toBN("2"))).toString());

            nonce = (await Utils.getFirstValidNonce(ladex)).toNumber();
            const order3 = await OrderUtils.makeSignedOrder(ladex, quote, cost.div(toBN("2")), base, size.div(toBN("2")), fee, quote, nonce++, traders[1]);
            trade = await OrderUtils.makeTrade(order1, order3);
            batch = OrderUtils.makeBatch([trade]);
            await Utils.assertVMThrows(
                async () => await OrderUtils.publishBatch(ladex, batch),
                "Batch with bad nonce must be rejected"
            );

            depositNonce = await WithdrawUtils.withdrawAll(ladex, [base, quote], [traders[0], traders[1]], depositNonce);
        }
    });
});
