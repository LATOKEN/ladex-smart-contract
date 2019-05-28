pragma solidity ^0.5.7;

import {ERC20Interface, ERC20WithDecimals} from "contracts/tokens/ERC20.sol";

/**
 * @title SafeMath
 * @dev Unsigned math operations with safety checks that revert on error.
 */
library SafeMath {
    /**
     * @dev Multiplies two unsigned integers, reverts on overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }
        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");
        return c;
    }

    /**
     * @dev Subtracts two unsigned integers, reverts on overflow (i.e. if subtrahend is greater than minuend).
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SafeMath: subtraction overflow");
        uint256 c = a - b;
        return c;
    }

    /**
     * @dev Adds two unsigned integers, reverts on overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");

        return c;
    }
}

/**
 * @title Contract for owning and maintaining logic.
 *
 * @notice Contract maintenance is done automatically by our backend, so we want to split private key used by software
 * from contract owner's which is held separately in secure storage
 */
contract OwnedAndMaintained {
    address public owner;
    address public maintainer;
    constructor() public {
        owner = msg.sender;
        maintainer = msg.sender;
    }
    event SetOwner(address indexed previousOwner, address indexed newOwner);
    event SetMaintainer(address indexed previousMaintainer, address indexed newMaintainer);
    modifier onlyOwner {
        require(msg.sender == owner, "method is available only for owner");
        _;
    }
    modifier onlyMaintainer {
        require(msg.sender == maintainer, "method is available only for maintainer");
        _;
    }
    function setOwner(address newOwner) external onlyOwner {
        emit SetOwner(owner, newOwner);
        owner = newOwner;
    }

    function setMaintainer(address newMaintainer) external onlyOwner {
        emit SetMaintainer(maintainer, newMaintainer);
        maintainer = newMaintainer;
    }
}

/**
 * @title LADEX main contract
 * Contract for executing trades and storing user balances
 */
contract LADEX is OwnedAndMaintained {
    using SafeMath for uint256;

    /// @dev default 0x0 address constant, serves as "ethereum token" contract address
    address public constant address0 = address(0);
    /// how many blocks user must wait before withdrawal
    uint256 public constant waitBlocks = 24;

    /// @dev helper bit masks with 64 and 256 least significant bits set
    uint256 internal constant mask64 = (1 << 64) - 1;
    uint256 internal constant mask256 = uint256(-1);

    /**
     * Information about token:
     *  + index - token unique integer identifier for internal use
     *  + scaleFactory - factor to redefine minimal amount of token that can be used in contract.
     *    All values expressed in token native "wei" are divided by that number in process of deposit or trade
     *    processing (no rounding, divisibility checks are performed)
     *    All outgoing values are multiplied by that number to get token native "wei" back
     *    NB: all externally available functions (deposit, withdraw, trade, ...) operate with token native amounts
     * @dev See also helper functions: getTokenIndex, getTokenScaleFactor, getTokenInfo
     * @notice any other code uses ONLY this safe wrapped functions not to rely on internal storage format
     */
    struct TokenInfo {
        uint256 index;
        uint256 scaleFactor;
    }

    /**
     * Mapping storing token info by address
     * @dev See also: getBalanceByTokenInfo
     */
    mapping(address => TokenInfo) public tokenInfoByAddress;
    mapping(uint256 => address) public tokenAddressByIndex;
    /**
     * This array stores addresses of all registered tokens to iterate them
     */
    address[] public registeredTokens;
    /**
     * Fee account receives all fees from trades
     */
    address public feeAccount;

    /**
     * This mapping stores information about scaled balances.
     *
     * Balances are stored by user and token index. However, since balances are actually 64 bit in width we pack them
     * in following way: element (address, x) stores 4 balances (tightly packed, 8 bytes for each balance)
     * for tokenIndices in range [4 * x, 4 * x + 3].
     * This mapping is designed for internal use (despite contents are publicly visible just in case), helper functions
     * are available to encapsulate this behaviour
     * @dev See also: getScaledBalanceByIndex, getScaledBalance, getBalanceByTokenInfo, getBalance, setBalance,
     * setDoubleBalance
     * @notice since integer overflow in balance calculation can occur any other code ONLY uses this safe wrappers
     * where all checks are performed
     */
    mapping(address => mapping(uint256 => uint256)) public scaledBalance;
    /**
     * Maximum possible scaled balance. Since we have only 64 bit balances, our scaled balance stores max 18 digits
     */
    uint256 public constant MAX_SCALED_BALANCE = 10 ** 18 - 1;

    /**
     * Structure that stores information about pending withdrawal. Since we have two-factor time locked withdrawal,
     * we need to store information about request to verify it after time lock is released.
     * Where:
     *  + user - address of user's wallet, that requested and signed withdrawal
     *  + token - address of token to withdraw or 0x00 (for ETH)
     *  + amount - total requested amount for withdraw
     *  + block - number of block when withdrawal requested
     */
    struct PendingWithdrawal {
        address user;
        address token;
        uint256 amount;
        uint256 block;
    }

    /**
     * List of all used nonce for payments, where payment may be either deposit or withdrawal.
     * @notice payment nonces are generated as random 256bit value on client-side.
     */
    mapping(uint256 => uint8) public paymentNonce;
    /**
     * Mapping from nonce to pending withdrawal
     */
    mapping(uint256 => PendingWithdrawal) public pendingWithdrawal;
    /**
     * User can execute only one withdrawal at the same time, that is why we need special mapping to prevent
     * such operations
     */
    mapping(address => uint8) public withdrawalIsAlreadyPending;

    /**
     * Possible status of payment (deposit or withdraw):
     *  + PAYMENT_NONE - there is no used payment (nonce is free), default value
     *  + PAYMENT_PENDING - user requested withdrawal and waiting for time lock (withdrawal only)
     *  + PAYMENT_COMPLETED - withdrawal or deposit has been executed
     *  + PAYMENT_CANCELLED - user cancelled withdrawal (see pendingWithdrawal function)
     */
    uint8 public constant PAYMENT_NONE = uint8(0x00);
    uint8 public constant PAYMENT_PENDING = uint8(0x01);
    uint8 public constant PAYMENT_COMPLETED = uint8(0x02);
    uint8 public constant PAYMENT_CANCELLED = uint8(0x03);

    /**
     * Mapping from order nonce to filled amount. This value ranges from 0 to scaled order quantity. If value is 0
     * then order with such nonce is not yet placed or is already deleted. If value is greater than zero than order has
     * been partially filled or fully matched.
     * @dev 8 least significant bytes for each nonce store actual filled amount and all remaining part is dedicated to
     * user address (to resolve conflict if different users somehow managed to sign same nonce and it got committed to
     * contract by backend). Also refer to comments below for order nonce calculation scheme
     */
    mapping(uint256 => uint256) public orderFilled;

    /**
     * We allocate nonces as unique identifiers of orders. However, to prevent storing order in blockchain state
     * eternally we have to do some cleanup. Therefore we adapt nonces to be also the expiry date of order.
     * Each block since deployment expires constant number of nonces defined below.
     * Any order with nonce less than (currentBlock - deploymentBlock) * NONCES_PER_BLOCK is counted as cancelled,
     * attempt to match such an order will fail with ERR_GLOBAL_NONCE.
     * @dev See also: getFirstValidNonce
     */
    uint256 public constant NONCES_PER_BLOCK = 1000 * 1000 * 1000;
    uint256 public deploymentBlock;

    /**
     * This function returns first order nonce that is not expired and can still be matched in current block.
     * @notice If you are using this to calculate nonce for your order please make sure there is enough room to account
     * for order processing, block mining and other possible delays
     */
    function getFirstValidNonce() public view returns (uint256) {
        return (block.number.sub(deploymentBlock)) * NONCES_PER_BLOCK;
    }

    /**
     * While processing trade we can meet following errors:
     *  + ERR_NONE - there is no error and everything is ok
     *  + ERR_BALANCE - one of users don't have enough balance for trade execution
     *  + ERR_CURRENCY - attempt to match orders where base currency equals to quote.
     *  + ERR_MISMATCHED - these orders can't be matched (buy order price should be lower than sell order price)
     *  + ERR_SIGNATURE - invalid signature provided for order.
     *  + ERR_INVALID_NONCE - attempt to match orders with equal nonces or to overwrite existing order
     *  + ERR_EXPIRED_NONCE - order is already expired and is implicitly cancelled
     *  + ERR_SCALE - order values (quantity or cost) overflow does not match currency scale
     * These errors are reported for diagnostic purposes and ideally should never happen if backend functions correctly
     */
    uint8 public constant ERR_NONE = uint8(0x00);
    uint8 public constant ERR_BALANCE = uint8(0x01);
    uint8 public constant ERR_CURRENCY = uint8(0x02);
    uint8 public constant ERR_MISMATCHED = uint8(0x04);
    uint8 public constant ERR_SIGNATURE = uint8(0x05);
    uint8 public constant ERR_INVALID_NONCE = uint8(0x06);
    uint8 public constant ERR_EXPIRED_NONCE = uint8(0x07);
    uint8 public constant ERR_SCALE = uint8(0x08);

    // This is diagnostic event for backend to monitor gas usage and occurred errors
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

    constructor(address initialFeeAccount) public {
        deploymentBlock = block.number;
        feeAccount = initialFeeAccount;
    }

    function modifyFeeAccount(address newFeeAccount) external onlyMaintainer {
        feeAccount = newFeeAccount;
    }

    /**
     * Checks if all conditions for withdrawal are met.
     * Payment status is pending, same withdrawal user, token, amount and withdrawal is executed after waitBlocks.
     * @param nonce Payment identifier
     * @param user Address of user who wants to withdraw
     * @param token Address of token contract
     * @param amount Amount of token (in native token "wei") to withdraw
     */
    modifier withdrawIsAvailable(uint256 nonce, address user, address token, uint256 amount) {
        require(paymentNonce[nonce] == PAYMENT_PENDING);
        require(pendingWithdrawal[nonce].user == user);
        require(pendingWithdrawal[nonce].token == token);
        require(pendingWithdrawal[nonce].amount == amount);
        require(pendingWithdrawal[nonce].block > 0 && block.number.sub(pendingWithdrawal[nonce].block) >= waitBlocks);
        _;
    }

    /**
     * Checks that deposit/withdrawal nonce wasn't used before.
     * @param nonce Payment identifier
     */
    modifier checkNonce(uint256 nonce) {
        require(paymentNonce[nonce] == PAYMENT_NONE, "This nonce is already used");
        _;
    }

    /**
     * @param token Address of token contract
     * @return Token internal index
     * @dev internally stored starting from 1, 0 is used to indicate that token isn't registered
     */
    function getTokenIndex(address token) public view returns (uint256) {
        require(tokenInfoByAddress[token].index > 0, "token is not registered");
        return tokenInfoByAddress[token].index - 1;
    }

    /**
     * @param token Address of token contract
     * @return Token internal scale factor
     */
    function getTokenScaleFactor(address token) public view returns (uint256) {
        require(tokenInfoByAddress[token].index > 0, "token is not registered");
        return tokenInfoByAddress[token].scaleFactor;
    }

    /**
     * @param token Address of token contract
     * @return TokenInfo structure
     */
    function getTokenInfo(address token) internal view returns (TokenInfo memory) {
        require(tokenInfoByAddress[token].index > 0, "token is not registered");
        return tokenInfoByAddress[token];
    }

    /**
     * Register token, setting tokenIndex and scaleFactor
     * @param token Address of token contract
     * @param index Desired token index (must not be already used)
     * @param scaleFactor Internal scale factor (see documentation for TokenInfo structure)
     * @param decimals Decimals that will be displayed in TokenRegister event
     * @notice This method can be used to register token contract that has no decimals() function available.
     * Otherwise maintainer should use registerToken method that provides more safety
     */
    function registerTokenDirectly(address token, uint256 index, uint256 scaleFactor, uint8 decimals) public onlyMaintainer {
        require(tokenInfoByAddress[token].index == 0, "token is already registered");
        for (uint256 i; i < registeredTokens.length; ++i) {
            require(getTokenIndex(registeredTokens[i]) != index, "token with this index already exists");
        }
        tokenAddressByIndex[index] = token;
        registeredTokens.push(token);
        tokenInfoByAddress[token].index = index + 1;
        tokenInfoByAddress[token].scaleFactor = scaleFactor;
        emit TokenRegister(token, index, decimals);
    }

    /**
     * Register token, setting tokenIndex and scaleFactor
     * Maintainer specifies desired decimals and scaleFactor is calculated automatically
     * @param token Address of token contract
     * @param index Desired token index (must not be already used)
     * @param decimals Decimals that will be displayed in TokenRegister event
     * @notice It's assumed that maintainer always knows "real" decimals of a contract on backend if it's not specified
     * by contract
     */
    function registerToken(address token, uint256 index, uint8 decimals) external onlyMaintainer {
        uint8 tokenDecimals = 18;
        if (token != address0) {
            tokenDecimals = ERC20WithDecimals(token).decimals();
        }
        require(decimals <= tokenDecimals, "decimals in LADEX cannot exceed token decimals");
        require(tokenDecimals - decimals <= 77, "scaleFactor would be too high, check decimals");
        uint256 scaleFactor = uint256(10) ** uint256(tokenDecimals - decimals);
        registerTokenDirectly(token, index, scaleFactor, decimals);
    }

    /**
     * @param user Address of user wallet
     * @param tokenIndex Internal index of token
     * @return scaled balance (refer to scaledBalance mapping documentation for more)
     */
    function getScaledBalanceByIndex(address user, uint256 tokenIndex) public view returns (uint256) {
        return ((scaledBalance[user][tokenIndex / 4]) >> ((tokenIndex % 4) * 64)) & mask64;
    }

    /**
     * @param user Address of user wallet
     * @param tokenInfo Internal structure with token information
     * @return balance in token-native "wei"
     */
    function getBalanceByTokenInfo(address user, TokenInfo memory tokenInfo) internal view returns (uint256) {
        return getScaledBalanceByIndex(user, tokenInfo.index - 1).mul(tokenInfo.scaleFactor);
    }

    /**
     * @param user Address of user wallet
     * @param token Address of token contract
     * @return balance in token-native "wei"
     */
    function getBalance(address user, address token) public view returns (uint256) {
        return getBalanceByTokenInfo(user, getTokenInfo(token));
    }

    /**
     * Updates balance for user
     * @param user Address of user wallet
     * @param tokenIndex Internal index of token
     * @param newBalance Balance to update in scaled form (refer to scaledBalance mapping documentation for more)
     * @notice Performs the overflow check
     */
    function setBalance(address user, uint256 tokenIndex, uint256 newBalance) internal {
        require(newBalance <= MAX_SCALED_BALANCE);
        uint256 totalTokens = scaledBalance[user][tokenIndex / 4];
        totalTokens &= mask256 ^ (mask64 << ((tokenIndex % 4) * 64));
        // zero out old balance
        totalTokens |= (newBalance << ((tokenIndex & 3) * 64));
        // place new balance in place of zeros
        scaledBalance[user][tokenIndex / 4] = totalTokens;
    }

    /**
     * Sets two balances simultaneously
     * @param user Address of user wallet
     * @param tokenIndex0 Internal index of first token
     * @param tokenIndex1 Internal index of second token
     * @param newBalance0 First balance to update in scaled form (refer to scaledBalance mapping documentation for more)
     * @param newBalance1 Second balance to update in scaled form (refer to scaledBalance mapping documentation for more)
     * @notice performs the overflow check
     * @notice Only works if (tokenIndex0 / 4) == (tokenIndex1 / 4)
     */
    function setTwoBalances(address user, uint256 tokenIndex0, uint256 tokenIndex1, uint256 newBalance0, uint256 newBalance1) internal {
        require(tokenIndex0 / 4 == tokenIndex1 / 4);
        // check MAX_SCALED_BALANCE
        require(newBalance0 <= MAX_SCALED_BALANCE);
        require(newBalance1 <= MAX_SCALED_BALANCE);
        // get current balances
        uint256 totalTokens = scaledBalance[user][tokenIndex0 / 4];
        // some magic bitwise operations
        totalTokens &= mask256 ^ ((mask64 - 1) << ((tokenIndex0 % 4) * 64));
        // zero out old balance
        totalTokens &= mask256 ^ ((mask64 - 1) << ((tokenIndex1 % 4) * 64));
        // zero out old balance
        totalTokens |= (newBalance0 << ((tokenIndex0 % 4) * 64));
        // place new balance in place of zeros
        totalTokens |= (newBalance1 << ((tokenIndex1 % 4) * 64));
        // place new balance in place of zeros
        scaledBalance[user][tokenIndex0 / 4] = totalTokens;
    }

    /**
     * Makes a deposit via transfer of approved ERC20 tokens from msg.sender
     * @param nonce Deposit identifier
     * @param token Address of token contract
     * @param amount Amount of token to deposit in token-native "wei"
     * @notice Checks nonce uniqueness
     */
    function depositToken(uint256 nonce, address token, uint256 amount) public checkNonce(nonce) {
        // get old balance
        TokenInfo memory info = getTokenInfo(token);
        uint256 oldBalance = getScaledBalanceByIndex(msg.sender, info.index - 1);
        uint256 scaledAmount = amount / info.scaleFactor;
        // check scaledAmount correctness
        require(scaledAmount * info.scaleFactor == amount);
        setBalance(msg.sender, info.index - 1, oldBalance.add(scaledAmount));
        // set status to completed
        paymentNonce[nonce] = PAYMENT_COMPLETED;

        // We assume standard ERC20 (https://eips.ethereum.org/EIPS/eip-20) so we must handle possible return false
        uint256 wasBalance = ERC20Interface(token).balanceOf(address(this));
        require(ERC20Interface(token).transferFrom(msg.sender, address(this), amount), "token contract refused transfer");
        require(ERC20Interface(token).balanceOf(address(this)) == wasBalance.add(amount), "balance was not actually transferred in token contract");

        emit Deposit(nonce, token, msg.sender, amount, getBalanceByTokenInfo(msg.sender, info));
    }

    /**
     * Deposits ETH from msg.sender
     * @param nonce Deposit identifier
     * @notice Checks nonce uniqueness
     */
    function deposit(uint256 nonce) public payable checkNonce(nonce) {
        // get old balance
        TokenInfo memory info = getTokenInfo(address0);
        uint256 oldBalance = getScaledBalanceByIndex(msg.sender, info.index - 1);
        uint256 scaledAmount = msg.value / info.scaleFactor;
        // check scaledAmount correctness
        require(scaledAmount * info.scaleFactor == msg.value, "deposited value must be aligned to LADEX decimals for that token");
        setBalance(msg.sender, info.index - 1, oldBalance.add(scaledAmount));
        // set status done
        paymentNonce[nonce] = PAYMENT_COMPLETED;
        emit Deposit(nonce, address0, msg.sender, msg.value, getBalanceByTokenInfo(msg.sender, info));
    }

    /**
     * Function for user to ask for withdrawal of his tokens.
     * @param nonce Withdrawal identifier
     * @param token Address of token contract
     * @param amount Amount of token to withdraw in token-native "wei"
     * @notice Two factor time locked withdrawal is performed that means that after some time (specified in waitBlocks
     * constant) user will be able to withdraw his funds directly (via calling withdraw method). Two factor process is
     * required to protect backend from double spend attempts of malicious users.
     * @notice See also: withdraw, cancelWithdraw
     */
    function askForWithdraw(uint256 nonce, address token, uint256 amount) public checkNonce(nonce) {
        // check if balance is sufficient
        require(getBalance(msg.sender, token) >= amount, "not enough balance to withdraw");
        // no pending withdrawal
        require(withdrawalIsAlreadyPending[msg.sender] == 0, "simultaneous withdrawals are not allowed");
        // amount should be with correct decimals
        TokenInfo memory info = getTokenInfo(token);
        require((amount / info.scaleFactor) * info.scaleFactor == amount, "withdrawal value must be aligned to LADEX decimals for that token");
        // set status pending
        paymentNonce[nonce] = PAYMENT_PENDING;
        // update info about withdrawal
        pendingWithdrawal[nonce].user = msg.sender;
        pendingWithdrawal[nonce].block = block.number;
        pendingWithdrawal[nonce].token = token;
        pendingWithdrawal[nonce].amount = amount;
        withdrawalIsAlreadyPending[msg.sender] = 1;
        emit AskWithdraw(nonce, token, msg.sender, amount, block.number);
    }

    /**
     * Withdraws ERC20 tokens or ETH to recipient.
     * @param nonce Withdrawal identifier
     * @param recipient Address of recipient wallet (may be contract)
     * @param token Address of token contract (or address(0) for ETH)
     * @param amount Amount of token to withdraw in token-native "wei"
     * @notice In order for this function to succeed user must call askForWithdraw first and wait enough time for time
     * lock to release.
     * @notice Warning: withdraw to contract only if you completely understand what you are doing
     */
    function withdraw(uint256 nonce, address payable recipient, address token, uint256 amount) public withdrawIsAvailable(nonce, msg.sender, token, amount) {
        TokenInfo memory info = getTokenInfo(token);
        // get current balance and scale amount
        uint256 oldBalance = getScaledBalanceByIndex(msg.sender, info.index - 1);
        uint256 scaledAmount = amount / info.scaleFactor;
        // check scaling correctness
        require(scaledAmount * info.scaleFactor == amount, "withdrawal value must be aligned to LADEX decimals for that token");
        // check that balance is sufficient
        require(oldBalance >= scaledAmount, "not enough balance to withdraw");
        setBalance(msg.sender, info.index - 1, oldBalance.sub(scaledAmount));
        // set status done
        delete pendingWithdrawal[nonce];
        paymentNonce[nonce] = PAYMENT_COMPLETED;
        delete withdrawalIsAlreadyPending[msg.sender];
        emit Withdraw(nonce, token, msg.sender, amount, getBalanceByTokenInfo(msg.sender, info));
        // send tokens
        if (token == address0) {
            recipient.transfer(amount);
            // rolls back if something is wrong
        } else {
            uint256 wasBalance = ERC20Interface(token).balanceOf(address(this));
            require(ERC20Interface(token).transfer(recipient, amount), "token contract refused transfer");
            require(ERC20Interface(token).balanceOf(address(this)) == wasBalance.sub(amount), "incorrect value was transferred by token contract");
        }
    }

    /**
     * Cancels withdrawal by nonce, sets payment status to PAYMENT_CANCELLED.
     * @param nonce Withdrawal identifier
     */
    function cancelWithdrawal(uint256 nonce) public {
        nonce = nonce;
        // withdrawal status is pending
        require(paymentNonce[nonce] == PAYMENT_PENDING, "withdrawal with this nonce is not pending");
        // gets cancelled by same user
        require(pendingWithdrawal[nonce].user == msg.sender, "withdrawals are only cancelled by creator");
        // free storage
        delete withdrawalIsAlreadyPending[msg.sender];
        delete pendingWithdrawal[nonce];
        // set status cancelled
        paymentNonce[nonce] = PAYMENT_CANCELLED;
        emit CancelWithdraw(nonce);
    }

    /**
     * @dev internal function to emit Trade event
     */
    function emitTrade(address[4] memory orderAddresses, uint256 makerBuyBalance, uint256 makerSellBalance, uint256 takerSellBalance, uint256 takerBuyBalance, uint256 nonceMaker, uint256 nonceTaker) internal {
        emit Trade(
            orderAddresses[2],
            orderAddresses[3],
            orderAddresses[0],
            orderAddresses[1],
            makerBuyBalance * getTokenScaleFactor(orderAddresses[0]),
            makerSellBalance * getTokenScaleFactor(orderAddresses[1]),
            takerBuyBalance * getTokenScaleFactor(orderAddresses[1]),
            takerSellBalance * getTokenScaleFactor(orderAddresses[0]),
            nonceMaker,
            nonceTaker
        );
    }

    /**
     * @dev Internal function that updates balances on trade.
     * @dev Checks if we can update tokens balances using setTwoBalances to optimize storage operations.
     */
    function updateTradersBalances(
        address maker, address taker, uint256 tokenBuy, uint256 tokenSell,
        uint256 makerBuyBalance, uint256 makerSellBalance, uint256 takerBuyBalance, uint256 takerSellBalance
    ) internal {
        // check that tokens indexes are in [4 * x, 4 * x + 3] and if so update double balances
        if (tokenBuy / 4 == tokenSell / 4) {
            setTwoBalances(maker, tokenBuy, tokenSell, makerBuyBalance, makerSellBalance);
            setTwoBalances(taker, tokenBuy, tokenSell, takerSellBalance, takerBuyBalance);

        } else {
            setBalance(maker, tokenBuy, makerBuyBalance);
            setBalance(maker, tokenSell, makerSellBalance);
            setBalance(taker, tokenBuy, takerSellBalance);
            setBalance(taker, tokenSell, takerBuyBalance);
        }
    }

    /**
     * @dev Internal function to decode fee in BUY currency: fee field contains buyFee if fee is even
     */
    function getBuyFee(uint256 fee) pure internal returns (uint256) {
        return (fee % 2 == 0) ? (fee / 2) : 0;
    }

    /**
     * @dev Internal function to decode fee in SELL currency: fee field contains sellFee if fee is odd
     */
    function getSellFee(uint256 fee) pure internal returns (uint256) {
        return (fee % 2 == 1) ? (fee / 2) : 0;
    }

    /**
     * Updates fee account balances on trade
     * @dev Checks if we can update tokens balances using setTwoBalances to optimize storage operations.
     */
    function updateFeeAccountBalances(uint256 tokenBuy, uint256 tokenSell, uint256 makerFee, uint256 takerFee) internal {
        // check if setTwoBalances if applicable
        if (tokenBuy / 4 == tokenSell / 4) {
            // check that both fees are not zero otherwise it's easier to use setBalance
            if (getBuyFee(makerFee) > 0 || getSellFee(makerFee) > 0 || getBuyFee(takerFee) > 0 || getSellFee(takerFee) > 0) {
                setTwoBalances(
                    feeAccount, tokenBuy, tokenSell,
                    getScaledBalanceByIndex(feeAccount, tokenBuy).add(getBuyFee(makerFee)).add(getSellFee(takerFee)),
                    getScaledBalanceByIndex(feeAccount, tokenSell).add(getBuyFee(takerFee)).add(getSellFee(makerFee))
                );
            }
        } else {
            if (getBuyFee(makerFee) > 0 || getSellFee(takerFee) > 0) {
                setBalance(
                    feeAccount, tokenBuy,
                    getScaledBalanceByIndex(feeAccount, tokenBuy).add(getBuyFee(makerFee)).add(getSellFee(takerFee))
                );
            }
            if (getBuyFee(takerFee) > 0 || getSellFee(makerFee) > 0) {
                setBalance(
                    feeAccount, tokenSell,
                    getScaledBalanceByIndex(feeAccount, tokenSell).add(getBuyFee(takerFee)).add(getSellFee(makerFee))
                );
            }
        }
    }

    /**
     * Calculates new balances and calls update balances and fees.
     */
    function executeTrade(address[4] memory orderAddresses, uint256 volumeBuy, uint256 volumeSell, uint256 makerFee, uint256 takerFee, uint256 nonceMaker, uint256 nonceTaker) internal returns (uint8) {
        /* calculate currency maker and taker balances */
        // get token indexes
        uint256 tokenIndex0 = getTokenIndex(orderAddresses[0]);
        uint256 tokenIndex1 = getTokenIndex(orderAddresses[1]);
        // get scaled balances
        uint256 makerBuyBalance = getScaledBalanceByIndex(orderAddresses[2], tokenIndex0);
        uint256 takerSellBalance = getScaledBalanceByIndex(orderAddresses[3], tokenIndex0);
        uint256 makerSellBalance = getScaledBalanceByIndex(orderAddresses[2], tokenIndex1);
        uint256 takerBuyBalance = getScaledBalanceByIndex(orderAddresses[3], tokenIndex1);
        /* if taker or maker don't have enough money, then return error */
        /* update taker and maker buy/sell balances */
        if (orderAddresses[2] != orderAddresses[3]) {
            // check enough balance for paying matched amount and fee
            if (takerSellBalance < volumeBuy.add(getSellFee(takerFee)) ||
                makerSellBalance < volumeSell.add(getSellFee(makerFee))
            ) {
                return ERR_BALANCE;
            }
            if (makerBuyBalance.add(volumeBuy) < getBuyFee(makerFee) ||
                takerBuyBalance.add(volumeSell) < getBuyFee(takerFee)
            ) {
                return ERR_BALANCE;
            }
            // update balances
            //makerBuyBalance += volumeBuy - getBuyFee(makerFee);
            makerBuyBalance = makerBuyBalance.add(volumeBuy).sub(getBuyFee(makerFee));

            //makerSellBalance -= volumeSell + getSellFee(makerFee);
            makerSellBalance = makerSellBalance.sub(volumeSell).sub(getSellFee(makerFee));

            //takerBuyBalance += volumeSell - getBuyFee(takerFee);
            takerBuyBalance = takerBuyBalance.add(volumeSell).sub(getBuyFee(takerFee));

            //takerSellBalance -= volumeBuy + getSellFee(takerFee);
            takerSellBalance = takerSellBalance.sub(volumeBuy).sub(getSellFee(takerFee));
        } else {
            // makerBuyBalance == takerSellBalance && takerBuyBalance == makerSellBalance
            // check that balances are enough for paying fee
            if (makerBuyBalance < getBuyFee(makerFee).add(getSellFee(takerFee))) {
                return ERR_BALANCE;
            }
            if (takerBuyBalance < getBuyFee(takerFee).add(getSellFee(makerFee))) {
                return ERR_BALANCE;
            }
            // no value is transferred in self-trade only fees are taken
            // update balances as makerBuyBalance == takerSellBalance && takerBuyBalance == makerSellBalance

            //makerBuyBalance -= getBuyFee(makerFee) + getSellFee(takerFee);
            makerBuyBalance = makerBuyBalance.sub(getBuyFee(makerFee)).sub(getSellFee(takerFee));
            takerSellBalance = makerBuyBalance;

            //takerBuyBalance -= getBuyFee(takerFee) + getSellFee(makerFee);
            takerBuyBalance = takerBuyBalance.sub(getBuyFee(takerFee)).sub(getSellFee(makerFee));
            makerSellBalance = takerBuyBalance;
        }
        /* save just updated balances to storage */
        updateTradersBalances({
            maker : orderAddresses[2],
            taker : orderAddresses[3],
            tokenBuy : tokenIndex0,
            tokenSell : tokenIndex1,
            makerBuyBalance : makerBuyBalance,
            makerSellBalance : makerSellBalance,
            takerBuyBalance : takerBuyBalance,
            takerSellBalance : takerSellBalance
            });
        /* give fees to fee account */
        updateFeeAccountBalances({
            tokenBuy : tokenIndex0,
            tokenSell : tokenIndex1,
            makerFee : makerFee,
            takerFee : takerFee
            });
        /* message with balance change */
        emitTrade(
            orderAddresses,
            makerBuyBalance,
            makerSellBalance,
            takerSellBalance,
            takerBuyBalance,
            nonceMaker,
            nonceTaker
        );
        return ERR_NONE;
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * Prepares balances for update, updates orders filled quantities.
     * Calculates amounts matched in current trade for orders: volumeBuy for tokenBuy and volumeSell for tokenSell.
     */
    function matchOrdersAndExecuteTrade(uint256[8] memory orderValues, address[4] memory orderAddresses) internal returns (uint8) {
        // get partially matched quantities for orders
        uint256 filledMakerEncoded = orderFilled[orderValues[3]];
        uint256 filledTakerEncoded = orderFilled[orderValues[7]];
        // here we want decode filled quantity, but stack is too shallow :(
        // checks that nonces are unique for all trades
        if ((filledMakerEncoded != 0 && address(filledMakerEncoded >> 64) != orderAddresses[2]) ||
            (filledTakerEncoded != 0 && address(filledTakerEncoded >> 64) != orderAddresses[3])
        ) {
            return ERR_INVALID_NONCE;
        }
        // volumeSell which maker will sell and volumeBuy which he will buy
        uint256 volumeTokenSell = 0;
        uint256 volumeTokenBuy = 0;
        // we are always paying fee in quote currency, so we know that base currency is opposite one
        // calculate volumeTokenBuy, volumeTokenSell subtracting filled values from order values
        if (orderValues[2] % 2 == 0) {
            // tokenBuy is quote, tokenSell is base
            volumeTokenSell = min(orderValues[1].sub(filledMakerEncoded & mask64), orderValues[4].sub(filledTakerEncoded & mask64));
            // volumes are proportional to orderValues[0] / orderValues[1]
            volumeTokenBuy = volumeTokenSell * orderValues[0] / orderValues[1];
        } else {
            // tokenBuy is base, tokenSell is quote
            volumeTokenBuy = min(orderValues[0].sub(filledMakerEncoded & mask64), orderValues[5].sub(filledTakerEncoded & mask64));
            // volumes are proportional to orderValues[1] / orderValues[0]
            volumeTokenSell = volumeTokenBuy * orderValues[1] / orderValues[0];
        }
        // set fee if order is matched for first time, otherwise set it to zero
        orderValues[2] = (filledMakerEncoded & mask64) > 0 ? orderValues[2] % 2 : orderValues[2];
        orderValues[6] = (filledTakerEncoded & mask64) > 0 ? orderValues[6] % 2 : orderValues[6];
        uint8 result = executeTrade({
            orderAddresses : orderAddresses,
            volumeBuy : volumeTokenBuy,
            volumeSell : volumeTokenSell,
            makerFee : orderValues[2],
            takerFee : orderValues[6],
            nonceMaker : orderValues[3],
            nonceTaker : orderValues[7]
            });
        // updates orderFilled with volumes according to bytes order
        if (orderValues[2] % 2 == 0) {
            // tokenBuy is quote, tokenSell is base
            orderFilled[orderValues[3]] = (uint256(orderAddresses[2]) << 64) | (filledMakerEncoded % (1 << 64)).add(volumeTokenSell);
            orderFilled[orderValues[7]] = (uint256(orderAddresses[3]) << 64) | (filledTakerEncoded % (1 << 64)).add(volumeTokenSell);
        } else {
            // tokenBuy is base, tokenSell is quote
            orderFilled[orderValues[3]] = (uint256(orderAddresses[2]) << 64) | (filledMakerEncoded % (1 << 64)).add(volumeTokenBuy);
            orderFilled[orderValues[7]] = (uint256(orderAddresses[3]) << 64) | (filledTakerEncoded % (1 << 64)).add(volumeTokenBuy);
        }
        return result;
    }

    function validateAmount(uint256 amount, uint256 scaleFactor) internal pure returns (bool) {
        if (amount % scaleFactor != 0) return false;
        if (amount / scaleFactor > MAX_SCALED_BALANCE) return false;
        return true;
    }

    /**
     * Internal function that checks if scale factors matches tokens trade quantities.
     * @dev The condition for valid quantity is (quantity % scaleFactor == 0) and (feeQuantity % scaleFactor == 0)
     * also scaled amounts are checked to not exceed MAX_SCALED_AMOUNT
     */
    function checkOrderValues(uint256[8] memory orderValues, uint256 scaleFactorTokenBuy, uint256 scaleFactorTokenSell) internal pure returns (bool) {
        if (!validateAmount(orderValues[0], scaleFactorTokenBuy)) {
            return false;
        }
        if (!validateAmount(orderValues[1], scaleFactorTokenSell)) return false;
        if (!validateAmount(getBuyFee(orderValues[2]), scaleFactorTokenBuy)) return false;
        if (!validateAmount(getSellFee(orderValues[2]), scaleFactorTokenSell)) return false;
        if (!validateAmount(orderValues[4], scaleFactorTokenSell)) return false;
        if (!validateAmount(orderValues[5], scaleFactorTokenBuy)) return false;
        if (!validateAmount(getBuyFee(orderValues[6]), scaleFactorTokenSell)) return false;
        if (!validateAmount(getSellFee(orderValues[6]), scaleFactorTokenBuy)) return false;
        return true;
    }

    /**
     * Validates trade and calls executing methods.
     * @notice maker and taker addresses are recovered from signature. If signature is not valid it will likely cause
     * not enough balance error
     * @return Error code (see documentation for error codes above)
     */
    function validateAndExecuteTrade(uint256[8] memory orderValues, uint8[2] memory tokenIndices, uint8[2] memory vOrder, bytes32[4] memory rsOrder) internal {
        /* orderValues
             [0] makerBuyAmount
             [1] makerSellAmount
             [2] makerFee
             [3] makerNonce
             [4] takerBuyAmount
             [5] takerSellAmount
             [6] takerFee
             [7] takerNonce
           tokenIndices
             [0] tokenBuyIndex
             [1] tokenSellIndex
            order signature in format <v, r, s>
            vOrder
             [0] v from maker signature
             [1] v from taker signature
            rsOrder
             [0] r from maker signature
             [1] s from maker signature
             [2] r from taker signature
             [3] s from taker signature
           */
        // check that nonces in matched orders are inequal and return ERR_NONCE if failed
        require(orderValues[3] != orderValues[7], "Orders have same nonce");
        address[4] memory orderAddresses;
        /*
         * orderAddresses contains:
         * [0] tokenBuy
         * [1] tokenSell
         * [2] maker
         * [3] taker
         */
        orderAddresses[0] = tokenAddressByIndex[tokenIndices[0]];
        orderAddresses[1] = tokenAddressByIndex[tokenIndices[1]];
        // check that tokens in matched orders are inequal and return ERR_CURRENCY if failed
        require(orderAddresses[0] != orderAddresses[1], "Cannot execute trade between same currencies");
        // check buy price condition which is always maker price
        // makerBuyAmount / makerSellAmount (price sell) <= takerSellAmount / takerBuyAmount (price buy)
        require(orderValues[0] * orderValues[4] <= orderValues[5] * orderValues[1], "Bad match");
        // check global nonce using block.number, used when deleting expired orders
        require(orderValues[3] >= getFirstValidNonce(), "Maker has expired nonce");
        require(orderValues[7] >= getFirstValidNonce(), "Taker has expired nonce");
        // ecrecover to get maker address
        bytes32 signedHash = keccak256(abi.encodePacked(
                address(this),
                orderAddresses[0],
                orderValues[0],
                orderAddresses[1],
                orderValues[1],
                orderValues[2],
                orderValues[3]
            ));

        address maker = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", signedHash)), vOrder[0], rsOrder[0], rsOrder[1]);

        // ecrecover to get taker address
        signedHash = keccak256(abi.encodePacked(
                address(this),
                orderAddresses[1],
                orderValues[4],
                orderAddresses[0],
                orderValues[5],
                orderValues[6],
                orderValues[7]
            ));
        address taker = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", signedHash)), vOrder[1], rsOrder[2], rsOrder[3]);


        uint256 scaleFactorTokenBuy = getTokenScaleFactor(orderAddresses[0]);
        uint256 scaleFactorTokenSell = getTokenScaleFactor(orderAddresses[1]);
        // check scale factors
        require(checkOrderValues(orderValues, scaleFactorTokenBuy, scaleFactorTokenSell), "One of orders has incorrect values");
        // update orders quantities according to their scales
        orderValues[0] /= scaleFactorTokenBuy;
        orderValues[1] /= scaleFactorTokenSell;
        // orderValues[2] is 2 * makerFee + bit (bit is 0 if tokenSell is quote currency on exchange and 1 if is base currency), same for orderValues[6]
        orderValues[2] = ((orderValues[2] / 2) / (orderValues[2] % 2 == 0 ? scaleFactorTokenBuy : scaleFactorTokenSell)) * 2 + (orderValues[2] % 2);
        orderValues[4] /= scaleFactorTokenSell;
        orderValues[5] /= scaleFactorTokenBuy;
        orderValues[6] = ((orderValues[6] / 2) / (orderValues[6] % 2 == 0 ? scaleFactorTokenSell : scaleFactorTokenBuy)) * 2 + (orderValues[6] % 2);

        // execute trade
        orderAddresses[2] = maker;
        orderAddresses[3] = taker;
        require(matchOrdersAndExecuteTrade(orderValues, orderAddresses) == ERR_NONE, "One of traders has not enough balance to execute trade");
    }

    /**
     * Executes batch of trades and deletes expired orders nonces to free storage.
     * @dev please note that error codes are provided for debug purposes only, transaction will rollback on any
     * unsuccessful error code
     */
    function commitTradeBatch(uint256[8][] calldata ordersValues, uint8[2][] calldata tokenIndices, uint8[2][] calldata vOrders, bytes32[4][] calldata rsOrders, uint256[] calldata nonces) external onlyMaintainer {
        uint256 startGas = gasleft();
        for (uint256 i; i < ordersValues.length; ++i) {
            validateAndExecuteTrade(ordersValues[i], tokenIndices[i], vOrders[i], rsOrders[i]);
        }
        for (uint256 i; i < nonces.length; ++i) {
            if (nonces[i] < getFirstValidNonce()) {
                delete orderFilled[nonces[i]];
            }
        }
        emit TradeBatch(tx.gasprice, startGas - gasleft(), 0);
        // Spends some additional gas but not more than 2-3k
    }

    function() payable external {
        revert();
    }
}
