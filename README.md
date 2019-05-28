Smart Contract
==============

### LADEX

To start tests you need to build docker image and run tests.
Or you can use truffle framework tools locally.

```bash
docker build -t test .
docker run test
```

Here are the most essential methods from interface of LADEX.

```solidity
pragma solidity ^0.5.7;

contract LADEX {
    address[] public registeredTokens;
    address public feeAccount;

    function getBalance(address user, address token) public view returns (uint256);
    function depositToken(uint256 nonce, address token, uint256 amount) public;
    function deposit(uint256 nonce) public payable checkNonce(nonce);
    function askForWithdraw(uint256 nonce, address token, uint256 amount) public;
    function withdraw(uint256 nonce, address payable recipient, address token, uint256 amount) public;
    function cancelWithdrawal(uint256 nonce) public;

    // used by maintainer to upload trade data
    function commitTradeBatch(uint256[8][] calldata ordersValues, uint8[2][] calldata tokenIndices, uint8[2][] calldata vOrders, bytes32[4][] calldata rsOrders, uint256[] calldata nonces) external;

    event SetOwner(address indexed previousOwner, address indexed newOwner);
    event SetMaintainer(address indexed previousMaintainer, address indexed newMaintainer);

    event TradeBatch(uint256 txGasPrice, uint256 gasUsed, uint256 errorCodes);
    event Trade(
        address indexed maker, address indexed taker,
        address tokenMakerBuy, address tokenTakerBuy,
        uint256 makerBuyBalance, uint256 makerSellBalance,
        uint256 takerBuyBalance, uint256 takerSellBalance,
        uint256 nonceMaker, uint256 nonceTaker
    );

    event Deposit(uint256 nonce, address indexed token, address indexed user, uint256 amount, uint256 balance);
    event AskWithdraw(uint256 nonce, address indexed token, address indexed user, uint256 amount, uint256 block);
    event CancelWithdraw(uint256 nonce);
    event Withdraw(uint256 nonce, address indexed token, address indexed user, uint256 amount, uint256 balance);
    event TokenRegister(address indexed token, uint256 index, uint8 contractDecimals);
}
```
