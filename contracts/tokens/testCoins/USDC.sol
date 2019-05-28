pragma solidity ^0.5.7;

import {TestToken} from "contracts/tokens/TestToken.sol";

contract USDC is TestToken {
    string public name = "Test USD coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint8 public ladexDecimals = 6;
    uint256 public index = 2;

    constructor() public {}
}