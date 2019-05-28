const {Utils} = require("./common");
const truffleAssert = require("truffle-assertions");
const web3utils = require("web3-utils");
const toBN = web3utils.toBN;

class DepositUtils {
    static async depositETH(ladex, address, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);
        const wasBalance = toBN(await web3.eth.getBalance(address));
        const wasBalanceContract = toBN(await web3.eth.getBalance(ladex.address));
        const wasInContract = await Utils.getBalance(ladex, address, Utils.ETHAddress());

        let result = await ladex.deposit(nonce, {from: address, value: amount.toString()});

        truffleAssert.eventEmitted(
            result, "Deposit", (ev) =>
                nonce.eq(ev.nonce) &&
                address === ev.user &&
                amount.eq(ev.amount) &&
                wasInContract.add(amount).eq(ev.balance),
            "Deposit event must be emitted"
        );

        const newBalance = toBN(await web3.eth.getBalance(address));
        const newBalanceContract = toBN(await web3.eth.getBalance(ladex.address));
        const newInContract = await Utils.getBalance(ladex, address, Utils.ETHAddress());

        assert.isTrue(newBalance.lte(wasBalance.sub(amount))); // that might not be true if sender is mining
        assert.equal(newBalanceContract.toString(), wasBalanceContract.add(amount).toString());
        assert.equal(newInContract.toString(), wasInContract.add(amount).toString());
    }

    static async approveToken(token, owner, spender, amount) {
        const approved = await Utils.callAndSend(token.approve, [spender, amount.toString(), {from: owner}]);
        assert.isTrue(approved.value, "approve call must return true");
        truffleAssert.eventEmitted(
            approved.receipt, "Approval", (ev) =>
                owner === ev.tokenOwner &&
                spender === ev.spender &&
                amount.eq(ev.tokens),
            "Approval event must be emitted"
        );
        const allowance = await token.allowance.call(owner, spender);
        assert.equal(allowance.toString(), amount.toString(), "allowance must be set to approve amount");
    }

    static async depositToken(ladex, token, from, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);
        const wasBalance = toBN(await token.balanceOf.call(from));
        const wasBalanceContract = toBN(await token.balanceOf.call(ladex.address));
        const wasInContract = await Utils.getBalance(ladex, from, token.address);

        const deposited = await ladex.depositToken(nonce, token.address, amount, {from: from});
        truffleAssert.eventEmitted(
            deposited.receipt, "Deposit", (ev) =>
                nonce.eq(ev.nonce) &&
                from === ev.user &&
                amount.eq(ev.amount) &&
                wasInContract.add(amount).eq(ev.balance),
            "Deposit event must be emitted"
        );

        const newBalance = toBN(await token.balanceOf.call(from));
        const newBalanceContract = toBN(await token.balanceOf.call(ladex.address));
        const newInContract = await Utils.getBalance(ladex, from, token.address);

        assert.equal(newBalance.toString(), wasBalance.sub(amount).toString());
        assert.equal(newBalanceContract.toString(), wasBalanceContract.add(amount).toString());
        assert.equal(newInContract.toString(), wasInContract.add(amount).toString());

        assert.equal(newBalance.toString(), wasBalance.sub(amount).toString());
        assert.equal(newBalanceContract.toString(), wasBalanceContract.add(amount).toString());
    }

    static async deposit(ladex, token, from, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);
        if (token.address === Utils.ETHAddress()) {
            await DepositUtils.depositETH(ladex, from, amount, nonce);
        } else {
            await DepositUtils.approveToken(token, from, ladex.address, amount);
            await DepositUtils.depositToken(ladex, token, from, amount, nonce);
        }
    }

    static async depositEach(ladex, tokens, users, amount, startingNonce) {
        for (const token of tokens) {
            const wei = await Utils.toWei(amount, "ether", token);
            for (const user of users) {
                await DepositUtils.deposit(ladex, token, user, wei, startingNonce++);
            }
        }
        return startingNonce;
    }
}

module.exports = {DepositUtils};