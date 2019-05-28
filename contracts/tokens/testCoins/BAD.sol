pragma solidity ^0.5.7;

import {TestToken} from "contracts/tokens/TestToken.sol";

contract BAD is TestToken {
    string public name = "Very bad malicious token";
    string public symbol = "BAD";
    uint8 public decimals = 18;
    uint8 public ladexDecimals = 9;
    uint256 public index = 6;

    constructor() public {}

    function transferFrom(address from, address to, uint tokens) public returns (bool success) {
        // if someone transfers 100 BAD transferFrom returns true but does not transfer money
        if (tokens == 10 ** 20) return true;
        return super.transferFrom(from, to, tokens);
    }

    function transfer(address to, uint tokens) public returns (bool success) {
        // if someone transfers 10 BAD, reject transfer
        if (tokens == 10 ** 19) return false;
        // if someone transfers 1 BAD, accept transfer, but do not transfer money
        if (tokens == 10 ** 18) return true;
        return super.transfer(to, tokens);
    }
}