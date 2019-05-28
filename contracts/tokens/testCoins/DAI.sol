pragma solidity ^0.5.7;

import {TestToken} from "contracts/tokens/TestToken.sol";

contract DAI is TestToken {
    string public name = "Test DAI coin";
    string public symbol = "DAI";
    uint8 public decimals = 18;
    uint8 public ladexDecimals = 4;
    uint256 public index = 4;

    constructor() public {}
}