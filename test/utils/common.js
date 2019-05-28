const web3utils = require("web3-utils");
const move_decimal = require("move-decimal-point");
const toBN = web3utils.toBN;

let isGanacheCached = undefined;
let decimalsCache = {}, ladexDecimalsCache = {};
let minAmountCache = {};

class Utils {
    static ETHAddress() {
        return "0x0000000000000000000000000000000000000000";
    }

    static ETHCurrency() {
        return {address: Utils.ETHAddress(), name: "ETH"};
    }

    static async tokenDecimals(token) {
        if (decimalsCache[token.address] !== undefined) return decimalsCache[token.address];
        if (token.address === Utils.ETHAddress()) return decimalsCache[token.address] = toBN("18");
        return decimalsCache[token.address] = await token.decimals.call();
    }

    static async ladexDecimals(token) {
        if (ladexDecimalsCache[token.address] !== undefined) return ladexDecimalsCache[token.address];
        if (token.address === Utils.ETHAddress()) return ladexDecimalsCache[token.address] = toBN("9");
        return ladexDecimalsCache[token.address] = await token.ladexDecimals.call();
    }

    static async minimalGoodAmount(token) {
        if (minAmountCache[token.address] !== undefined) return minAmountCache[token.address];
        if (token.address === Utils.ETHAddress()) return minAmountCache[token.address] = toBN("10").pow(toBN("9"));
        const diff = toBN(await Utils.tokenDecimals(token)).sub(toBN(await Utils.ladexDecimals(token)));
        return minAmountCache[token.address] = toBN("10").pow(diff);
    }

    static async sendEthMine() {
        await new Promise((resolve) => {
            web3.currentProvider.send({
                jsonrpc: "2.0",
                method: "evm_mine",
            }, (err, res) => resolve());
        });
    }

    static async isGanache() {
        if (isGanacheCached === undefined) {
            try {
                await Utils.sendEthMine();
            } catch (e) {
                isGanacheCached = false;
                return isGanacheCached;
            }
            isGanacheCached = true;
        }
        return isGanacheCached;
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async waitUntilBlock(n) {
        n = toBN(n);
        do {
            const curBlock = toBN(await web3.eth.getBlockNumber());
            if (curBlock.gte(n)) break;
            if (await Utils.isGanache()) {
                await Utils.sendEthMine();
            } else {
                await Utils.sleep(1000);
            }
        } while (true);
    }

    static async getDeployedTokens() {
        const tokens = ["LA", "USDC", "DAI"]
            .map(token => artifacts.require(token));
        const result = [];
        for (const token of tokens) result.push(await token.deployed());
        return result;
    }

    static async getAllCurrencies() {
        return [Utils.ETHCurrency()].concat(await Utils.getDeployedTokens());
    }

    static async printNetworkInfo(ladex) {
        console.log("ladex=" + ladex.address);
        console.log("owner=" + (await ladex.owner.call()));
        console.log("maintainer=" + (await ladex.maintainer.call()));
        console.log("block=" + (await web3.eth.getBlockNumber()));
    }

    static async assertVMThrows(fn, message) {
        try {
            await fn();
            assert.isOk(false, message);
        } catch (e) {
            assert.isTrue(
                e.message.startsWith("Returned error: VM Exception while processing transaction"),
                "Not VM error occurred: " + e.message
            );
            // ignored, error is expected here
        }
    }

    static async getBalance(ladex, user, token) {
        return toBN(await ladex.getBalance.call(user, token));
    }

    static async toWei(amount, unit, token = undefined) {
        if (token === undefined || token === Utils.ETHAddress() || token.address === Utils.ETHAddress())
            return toBN(web3.utils.toWei(amount, unit));
        // TODO: unit is ignored (treated as "ether")
        const decimals = parseInt((await Utils.tokenDecimals(token)).toString());
        return toBN(move_decimal(amount.toString(), decimals));
    }

    static async callAndSend(method, args) {
        const value = await method.call(...args);
        const receipt = await method(...args);
        return {value, receipt};
    }

    static async setupTokenBalances(tokens, addresses, balance) {
        for (const token of tokens) {
            for (const address of addresses) {
                const amount = await Utils.toWei(balance, "ether", token);
                await token.setBalance(address, amount, {from: address});
            }
        }
    }

    static async tokenIndex(token) {
        if (token === undefined || token === Utils.ETHAddress() || token.address === Utils.ETHAddress())
            return 0;
        return await token.index.call();
    }

    static async registerEthereum(ladex) {
        console.log("registering ETH with decimals (native=18, ladex=9) at index=0");
        await ladex.registerToken(Utils.ETHAddress(), toBN("0"), 9, {from: await ladex.maintainer.call()});
    }

    static async registerToken(ladex, token, index = undefined, ladexDecimals = undefined) {
        const maintainer = await ladex.maintainer.call();
        if (index === undefined) index = await token.index.call();
        const name = await token.symbol.call();
        const decimals = await Utils.tokenDecimals(token);
        if (ladexDecimals === undefined) ladexDecimals = await token.ladexDecimals.call();
        await ladex.registerToken(token.address, index, ladexDecimals, {from: maintainer, gas: 2000000});
        console.log("Registered token " + name + " with decimals (native=" + decimals + ", ladex=" + ladexDecimals + ") at index=" + index);
    }

    static async registerTokens(ladex, tokens) {
        for (const token of tokens) {
            await Utils.registerToken(ladex, token);
        }
    }

    static async getFirstValidNonce(ladex) {
        return toBN(await ladex.getFirstValidNonce.call());
    }

    static async getNonceForBlock(ladex, block) {
        return toBN(block).sub(await ladex.deploymentBlock.call()).mul(await ladex.NONCES_PER_BLOCK.call());
    }
}

module.exports = {Utils};