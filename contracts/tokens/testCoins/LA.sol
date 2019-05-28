pragma solidity ^0.5.7;

import {TestToken} from "contracts/tokens/TestToken.sol";

contract LA is TestToken {
    string public name = "Test LAT Token";
    string public symbol = "LA";
    uint8 public decimals = 18;
    uint8 public ladexDecimals = 9;
    uint256 public index = 1;

    constructor() public {}
}