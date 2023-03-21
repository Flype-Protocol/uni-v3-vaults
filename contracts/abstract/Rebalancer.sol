// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {
    IERC20,
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev DO NOT ADD STATE VARIABLES - APPEND THEM TO FlypeMaxiVaultV1Storage
/// @dev DO NOT ADD BASE CONTRACTS WITH STATE VARS - APPEND THEM TO FlypeMaxiVaultV1Storage
abstract contract Rebalancer {
    using Address for address payable;
    using SafeERC20 for IERC20;

    // solhint-disable-next-line var-name-mixedcase
    address payable public immutable REBALANCER;

    address private constant _ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    constructor(address payable _rebalancer) {
        REBALANCER = _rebalancer;
    }

    modifier onlyRebalancer(uint256 _amount, address _paymentToken) {
        require(msg.sender == REBALANCER, "onlyRebalancer");
        _;
        if (_paymentToken == _ETH) _safeTransferETH(REBALANCER, _amount);
        else IERC20(_paymentToken).safeTransfer(REBALANCER, _amount);
    }

    function _safeTransferETH(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        require(success, "ETH transfer failed");
    }
}
