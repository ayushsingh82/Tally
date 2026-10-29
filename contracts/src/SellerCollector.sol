// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IReceivableVault {
    function recordCollection(address seller, uint256 amount) external;
}

/// @notice Per-seller payment address. This is the `pay_to` of a seller's HSP reusable order.
/// HSP settles a plain ERC20 transfer here, with no callback, so anyone calls `sweep()`
/// afterwards to forward the balance to the vault and trigger the repayment waterfall.
contract SellerCollector {
    using SafeERC20 for IERC20;

    IReceivableVault public immutable vault;
    IERC20 public immutable token;
    address public immutable seller;

    error NothingToSweep();

    constructor(IReceivableVault vault_, IERC20 token_, address seller_) {
        vault = vault_;
        token = token_;
        seller = seller_;
    }

    function sweep() external returns (uint256 amount) {
        amount = token.balanceOf(address(this));
        if (amount == 0) revert NothingToSweep();
        token.safeTransfer(address(vault), amount);
        vault.recordCollection(seller, amount);
    }
}
