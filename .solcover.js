module.exports = {
	//norpc: true,
	// testCommand: 'truffle test test/testMatching.js --network coverage',
	testCommand: 'truffle test --network coverage',
	skipFiles: [
		'Migrations.sol',
		'DepositProxy.sol',
		'tokens/ERC20.sol',
		'tokens/TestToken.sol',
		'tokens/testCoins/LA.sol',
		'tokens/testCoins/USDC.sol',
		'tokens/testCoins/DAI.sol',
		'tokens/testCoins/BDC.sol',
		'tokens/testCoins/BAD.sol',
	]
};
