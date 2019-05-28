const {Utils} = require("./common");
const truffleAssert = require("truffle-assertions");
const web3utils = require("web3-utils");
const toBN = web3utils.toBN;

class WithdrawUtils {
    static async askForWithdraw(ladex, user, tokenAddress, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);
        const askReceipt = await ladex.askForWithdraw(nonce, tokenAddress, amount, {from: user});

        truffleAssert.eventEmitted(
            askReceipt, "AskWithdraw", (ev) =>
                nonce.eq(ev.nonce) &&
                tokenAddress === ev.token &&
                user === ev.user &&
                amount.eq(ev.amount),
            "AskWithdraw event must be emitted"
        );

        const block = toBN(askReceipt.logs[0].args.block);
        return block.add(toBN(await ladex.waitBlocks.call()));
    }

    static async completeWithdraw(ladex, user, tokenAddress, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);
        const withdrawReceipt = await ladex.withdraw(nonce, user, tokenAddress, amount, {from: user});

        const newInContract = await Utils.getBalance(ladex, user, tokenAddress);
        truffleAssert.eventEmitted(
            withdrawReceipt, "Withdraw", (ev) =>
                nonce.eq(ev.nonce) &&
                tokenAddress === ev.token &&
                user === ev.user &&
                amount.eq(ev.amount) &&
                newInContract.eq(ev.balance),
            "Withdraw event must be emitted"
        );
    }

    static async cancelWithdraw(ladex, user, nonce) {
        nonce = toBN(nonce);
        const cancelReceipt = await ladex.cancelWithdrawal(nonce, {from: user});
        truffleAssert.eventEmitted(
            cancelReceipt, "CancelWithdraw", (ev) => nonce.eq(ev.nonce),
            "CancelWithdraw event must be emitted"
        );
    }

    static async withdrawETH(ladex, user, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);

        const wasBalanceContract = toBN(await web3.eth.getBalance(ladex.address));
        const wasInContract = await Utils.getBalance(ladex, user, Utils.ETHAddress());

        const blockToWait = await WithdrawUtils.askForWithdraw(ladex, user, Utils.ETHAddress(), amount, nonce);
        await Utils.waitUntilBlock(blockToWait);
        await WithdrawUtils.completeWithdraw(ladex, user, Utils.ETHAddress(), amount, nonce);

        const newInContract = await Utils.getBalance(ladex, user, Utils.ETHAddress());
        const newBalanceContract = toBN(await web3.eth.getBalance(ladex.address));
        assert.equal(newBalanceContract.toString(), wasBalanceContract.sub(amount).toString());
        assert.equal(newInContract.toString(), wasInContract.sub(amount).toString());
    }

    static async withdrawToken(ladex, token, user, amount, nonce) {
        amount = toBN(amount);
        nonce = toBN(nonce);

        const wasBalanceContract = toBN(await token.balanceOf.call(ladex.address));
        const wasInContract = await Utils.getBalance(ladex, user, token.address);

        const blockToWait = await WithdrawUtils.askForWithdraw(ladex, user, token.address, amount, nonce);
        await Utils.waitUntilBlock(blockToWait);
        await WithdrawUtils.completeWithdraw(ladex, user, token.address, amount, nonce);

        const newInContract = await Utils.getBalance(ladex, user, token.address);
        const newBalanceContract = toBN(await token.balanceOf.call(ladex.address));
        assert.equal(newBalanceContract.toString(), wasBalanceContract.sub(amount).toString());
        assert.equal(newInContract.toString(), wasInContract.sub(amount).toString());
    }

    static async withdraw(ladex, token, user, amount, nonce) {
        if (token.address === Utils.ETHAddress()) {
            await WithdrawUtils.withdrawETH(ladex, user, amount, nonce);
        } else {
            await WithdrawUtils.withdrawToken(ladex, token, user, amount, nonce);
        }
    }

    static async withdrawAll(ladex, tokens, users, nonce) {
        for (const token of tokens) {
            for (const user of users) {
                await WithdrawUtils.withdraw(
                    ladex, token, user, await Utils.getBalance(ladex, user, token.address), nonce++
                );
            }
        }
        return nonce;
    }
}

module.exports = {WithdrawUtils};