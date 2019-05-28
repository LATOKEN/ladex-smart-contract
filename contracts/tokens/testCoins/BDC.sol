pragma solidity ^0.5.7;

import {TestToken} from "contracts/tokens/TestToken.sol";

contract BDC is TestToken {
    string public name = "BIG DECIMALS COIN";
    string public symbol = "BDC";
    uint8 public decimals = 100;
    uint8 public ladexDecimals = 10;
    uint256 public index = 8;

    constructor() public {}
}