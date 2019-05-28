const web3utils = require("web3-utils");
const {Utils} = require("./common");
const toBN = web3utils.toBN;
const truffleAssert = require("truffle-assertions");

class OrderUtils {
    static makeOrder(ladex, tokenBuy, quantity, tokenSell, cost, fee, feeToken, nonce, wallet) {
        const feeIndex = toBN(feeToken.address === tokenBuy.address ? 0 : 1);
        const encodedFee = toBN(fee).mul(toBN(2)).add(feeIndex);
        return {
            exchange: ladex.address,
            tokenBuy: tokenBuy, quantity: quantity.toString(),
            tokenSell: tokenSell, cost: cost.toString(),
            fee: encodedFee.toString(), nonce: toBN(nonce).toString(),
            wallet
        }
    }

    static async signOrder(order) {
        const hash = web3utils.soliditySha3(
            {type: "address", value: order.exchange},
            {type: "address", value: order.tokenBuy.address},
            {type: "uint256", value: order.quantity},
            {type: "address", value: order.tokenSell.address},
            {type: "uint256", value: order.cost},
            {type: "uint256", value: order.fee},
            {type: "uint256", value: order.nonce}
        );
        const signature = (await web3.eth.sign(hash, order.wallet)).substring(2);
        let v = parseInt(signature.substring(128, 130), 16);
        if (v <= 1) v += 27; // ganache produces v === 0 or 1
        return {
            v,
            r: "0x" + signature.substring(0, 64),
            s: "0x" + signature.substring(64, 128),
        };
    }

    static async makeSignedOrder(ladex, tokenBuy, quantity, tokenSell, cost, fee, feeToken, nonce, wallet) {
        const order = OrderUtils.makeOrder(
            ladex,
            tokenBuy, quantity,
            tokenSell, cost,
            fee, feeToken,
            nonce, wallet
        );
        const sig = await OrderUtils.signOrder(order);
        return {order, sig};
    }

    static async makeTrade(makerSignedOrder, takerSignedOrder) {
        const maker = makerSignedOrder.order, taker = takerSignedOrder.order;
        const makerSig = makerSignedOrder.sig, takerSig = takerSignedOrder.sig;
        return {
            values: [maker.quantity, maker.cost, maker.fee, maker.nonce, taker.quantity, taker.cost, taker.fee, taker.nonce],
            tokenIndices: [await Utils.tokenIndex(maker.tokenBuy), await Utils.tokenIndex(maker.tokenSell)],
            V: [makerSig.v, takerSig.v],
            RS: [makerSig.r, makerSig.s, takerSig.r, takerSig.s],
        };
    }

    static makeBatch(trades) {
        return {
            values: trades.reduce((a, b) => [...a, b.values], []),
            tokenIndices: trades.reduce((a, b) => [...a, b.tokenIndices], []),
            V: trades.reduce((a, b) => [...a, b.V], []),
            RS: trades.reduce((a, b) => [...a, b.RS], []),
            nonces: [],
        }
    }

    static async publishBatch(ladex, batch, from = undefined) {
        if (from === undefined) {
            from = await ladex.maintainer.call();
        }
        const receipt = await ladex.commitTradeBatch(
            batch.values,
            batch.tokenIndices,
            batch.V,
            batch.RS,
            batch.nonces,
            {from: from}
        );

        truffleAssert.eventEmitted(
            receipt, "TradeBatch", (ev) => toBN("0").eq(ev.errorCodes), "TradeBatch event must be emitted"
        );

        return receipt;
    }
}

module.exports = {OrderUtils};
