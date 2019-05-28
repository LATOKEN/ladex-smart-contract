pragma solidity ^0.5.7;

import {ERC20Interface} from "contracts/tokens/ERC20.sol";

/**
 * @title LADEX deposit proxy
 * This is small contract to simplify ERC20 deposits in LADEX. For tokens that do not support approveAndCall one can
 * use this proxy to set necessary allowance and complete deposit in one transaction
 * @notice you cannot deposit ETH using this contract
 * @dev DELETEGATECALL is used meaning that external code will be executed in context of this contract. However, since
 * contract is stateless and isolated from main LADEX contract this is safe
 */
contract LADEXDepositProxy {

    constructor() public {
    }

    function depositToken(uint256 nonce, address token, uint256 amount, address ladexContract) public {
        require(ladexContract != address(0));
        // check allowance, if it's not enough, call approve on behalf of msg.sender
        if (ERC20Interface(token).allowance(msg.sender, ladexContract) < amount) {
            (bool success, bytes memory returnValue) = token.delegatecall(
                abi.encodePacked(bytes4(keccak256("approve(address,uint256)")), address(this), amount)
            );
            require(success);
            require(returnValue.length == 32); // check return value as 256 bit bool value
            bool allZero = true;
            for (uint8 i = 0; i < 32; ++i) allZero = allZero && (returnValue[i] == 0);
            require(!allZero); // check that return value is actually not false (zero)
        }

        (bool success, bytes memory returnValue) = ladexContract.delegatecall(
            abi.encodePacked(bytes4(keccak256("depositToken(uint256,address,uint256)")), nonce, token, amount)
        );
        require(success);
        require(returnValue.length == 0); // no return value
    }

    function () payable external {
        revert();
    }
}