// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import {IFlypeMaxiRouter} from "./interfaces/IFlypeMaxiRouter.sol";
import {IFlypeMaxiVault} from "./interfaces/IFlypeMaxiVault.sol";
import {
    IUniswapV3Pool
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {
    IERC20,
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {
    IUniswapV3SwapCallback
} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {
    IUniswapV3Factory
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract FlypeMaxiRouter is
    IFlypeMaxiRouter,
    IUniswapV3SwapCallback,
    Initializable,
    PausableUpgradeable,
    OwnableUpgradeable
{
    using Address for address payable;
    using SafeERC20 for IERC20;

    IWETH public immutable weth;
    IUniswapV3Factory public immutable factory;

    // address internal immutable _blacklistedRouter;

    constructor(
        IUniswapV3Factory _factory,
        IWETH _weth // address _blacklisted
    ) {
        weth = _weth;
        factory = _factory;
        // _blacklistedRouter = _blacklisted;
    }

    function initialize() external initializer {
        __Pausable_init();
        __Ownable_init();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Uniswap v3 callback fn, called back on pool.swap
    // solhint-disable-next-line code-complexity
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata
    ) external override {
        IUniswapV3Pool pool = IUniswapV3Pool(msg.sender);
        address token0 = pool.token0();
        address token1 = pool.token1();
        uint24 fee = pool.fee();

        require(
            msg.sender == factory.getPool(token0, token1, fee),
            "invalid uniswap pool"
        );

        if (amount0Delta > 0)
            IERC20(token0).safeTransfer(msg.sender, uint256(amount0Delta));
        else if (amount1Delta > 0)
            IERC20(token1).safeTransfer(msg.sender, uint256(amount1Delta));
    }

    /// @notice addLiquidity adds liquidity to FlypeMaxi vault of interest (mints MXI-UNI LP tokens)
    /// @param vault address of FlypeMaxi vault to add liquidity to
    /// @param amount0Max the maximum amount of token0 msg.sender willing to input
    /// @param amount1Max the maximum amount of token1 msg.sender willing to input
    /// @param amount0Min the minimum amount of token0 actually input (slippage protection)
    /// @param amount1Min the minimum amount of token1 actually input (slippage protection)
    /// @param receiver account to receive minted MXI-UNI tokens
    /// @return amount0 amount of token0 transferred from msg.sender to mint `mintAmount`
    /// @return amount1 amount of token1 transferred from msg.sender to mint `mintAmount`
    /// @return mintAmount amount of MXI-UNI tokens minted and transferred to `receiver`
    // solhint-disable-next-line function-max-lines
    function addLiquidity(
        IFlypeMaxiVault vault,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver
    )
        external
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        IERC20 token0 = vault.token0(); // get token0 from the vault
        IERC20 token1 = vault.token1(); // get token1 from the vault

        // Get mint amounts from vault contract and check min amounts
        (uint256 amount0In, uint256 amount1In, uint256 _mintAmount) =
            vault.getMintAmounts(amount0Max, amount1Max);
        require(
            amount0In >= amount0Min && amount1In >= amount1Min,
            "below min amounts"
        );

        // transfer tokens from user to the router contract
        if (amount0In > 0) {
            token0.safeTransferFrom(msg.sender, address(this), amount0In);
        }
        if (amount1In > 0) {
            token1.safeTransferFrom(msg.sender, address(this), amount1In);
        }

        return _deposit(vault, amount0In, amount1In, _mintAmount, receiver);
    }

    /// @notice addLiquidityETH same as addLiquidity but expects ETH transfers (instead of WETH)
    // solhint-disable-next-line code-complexity, function-max-lines
    function addLiquidityETH(
        IFlypeMaxiVault vault,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver
    )
        external
        payable
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        IERC20 token0 = vault.token0();
        IERC20 token1 = vault.token1();

        (uint256 amount0In, uint256 amount1In, uint256 _mintAmount) =
            vault.getMintAmounts(amount0Max, amount1Max);
        require(
            amount0In >= amount0Min && amount1In >= amount1Min,
            "below min amounts"
        );

        if (_isToken0Weth(address(token0), address(token1))) {
            require(
                amount0Max == msg.value,
                "mismatching amount of ETH forwarded"
            );
            if (amount0In > 0) {
                weth.deposit{value: amount0In}();
            }
            if (amount1In > 0) {
                token1.safeTransferFrom(msg.sender, address(this), amount1In);
            }
        } else {
            require(
                amount1Max == msg.value,
                "mismatching amount of ETH forwarded"
            );
            if (amount1In > 0) {
                weth.deposit{value: amount1In}();
            }
            if (amount0In > 0) {
                token0.safeTransferFrom(msg.sender, address(this), amount0In);
            }
        }

        (amount0, amount1, mintAmount) = _deposit(
            vault,
            amount0In,
            amount1In,
            _mintAmount,
            receiver
        );

        if (_isToken0Weth(address(token0), address(token1))) {
            if (amount0Max > amount0In) {
                payable(msg.sender).sendValue(amount0Max - amount0In);
            }
        } else {
            if (amount1Max > amount1In) {
                payable(msg.sender).sendValue(amount1Max - amount1In);
            }
        }
    }

    /// @notice rebalanceAndAddLiquidity accomplishes same task as addLiquidity/addLiquidityETH
    /// but msg.sender rebalances their holdings (performs a swap) before adding liquidity.
    /// @param vault address of FlypeMaxi vault to add liquidity to
    /// @param amount0In the amount of token0 msg.sender forwards to router
    /// @param amount1In the amount of token1 msg.sender forwards to router
    /// @param zeroForOne Which token to swap (true = token0, false = token1)
    /// @param swapAmount the amount of token to swap
    /// @param swapThreshold the slippage parameter of the swap as a min or max sqrtPriceX96
    /// @param amount0Min the minimum amount of token0 actually deposited (slippage protection)
    /// @param amount1Min the minimum amount of token1 actually deposited (slippage protection)
    /// @param receiver account to receive minted MXI-UNI tokens
    /// @return amount0 amount of token0 actually deposited into vault
    /// @return amount1 amount of token1 actually deposited into vault
    /// @return mintAmount amount of MXI-UNI tokens minted and transferred to `receiver`
    /// @dev because router performs a swap on behalf of msg.sender and slippage is possible
    /// some value unused in mint can be returned to msg.sender in token0 and token1 make sure
    /// to consult return values or measure balance changes after a rebalanceAndAddLiquidity call.
    // solhint-disable-next-line function-max-lines

    function rebalanceAndAddLiquidity(
        IFlypeMaxiVault vault,
        uint256 amount0In,
        uint256 amount1In,
        bool zeroForOne,
        uint256 swapAmount,
        uint160 swapThreshold,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver
    )
        external
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        (uint256 amount0Use, uint256 amount1Use, uint256 _mintAmount) =
            _prepareRebalanceDeposit(
                vault,
                amount0In,
                amount1In,
                zeroForOne,
                swapAmount,
                swapThreshold
            );
        require(
            amount0Use >= amount0Min && amount1Use >= amount1Min,
            "below min amounts"
        );

        return _deposit(vault, amount0Use, amount1Use, _mintAmount, receiver);
    }

    /// @notice rebalanceAndAddLiquidityETH same as rebalanceAndAddLiquidity
    /// except this function expects ETH transfer (instead of WETH)
    // solhint-disable-next-line function-max-lines, code-complexity
    function rebalanceAndAddLiquidityETH(
        IFlypeMaxiVault vault,
        uint256 amount0In,
        uint256 amount1In,
        bool zeroForOne,
        uint256 swapAmount,
        uint160 swapThreshold,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver
    )
        external
        payable
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        (uint256 amount0Use, uint256 amount1Use, uint256 _mintAmount) =
            _prepareAndRebalanceDepositETH(
                vault,
                amount0In,
                amount1In,
                zeroForOne,
                swapAmount,
                swapThreshold
            );
        require(
            amount0Use >= amount0Min && amount1Use >= amount1Min,
            "below min amounts"
        );

        (amount0, amount1, mintAmount) = _deposit(
            vault,
            amount0Use,
            amount1Use,
            _mintAmount,
            receiver
        );

        uint256 leftoverBalance =
            IERC20(address(weth)).balanceOf(address(this));
        if (leftoverBalance > 0) {
            weth.withdraw(leftoverBalance);
            payable(msg.sender).sendValue(leftoverBalance);
        }
    }

    /// @notice removeLiquidity removes liquidity from a FlypeMaxi vault and burns MXI-UNI LP tokens
    /// @param burnAmount The number of MXI-UNI tokens to burn
    /// @param amount0Min Minimum amount of token0 received after burn (slippage protection)
    /// @param amount1Min Minimum amount of token1 received after burn (slippage protection)
    /// @param receiver The account to receive the underlying amounts of token0 and token1
    /// @return amount0 actual amount of token0 transferred to receiver for burning `burnAmount`
    /// @return amount1 actual amount of token1 transferred to receiver for burning `burnAmount`
    /// @return liquidityBurned amount of liquidity removed from the underlying Uniswap V3 position
    function removeLiquidity(
        IFlypeMaxiVault vault,
        uint256 burnAmount,
        uint256 amount0Min,
        uint256 amount1Min,
        address receiver
    )
        external
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        )
    {
        IERC20(address(vault)).safeTransferFrom(
            msg.sender,
            address(this),
            burnAmount
        );
        (amount0, amount1, liquidityBurned) = vault.burn(burnAmount, receiver);
        require(
            amount0 >= amount0Min && amount1 >= amount1Min,
            "received below minimum"
        );
    }

    /// @notice removeLiquidityETH same as removeLiquidity
    /// except this function unwraps WETH and sends ETH to receiver account
    // solhint-disable-next-line code-complexity, function-max-lines
    function removeLiquidityETH(
        IFlypeMaxiVault vault,
        uint256 burnAmount,
        uint256 amount0Min,
        uint256 amount1Min,
        address payable receiver
    )
        external
        override
        whenNotPaused
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidityBurned
        )
    {
        IERC20 token0 = vault.token0();
        IERC20 token1 = vault.token1();

        bool wethToken0 = _isToken0Weth(address(token0), address(token1));

        IERC20(address(vault)).safeTransferFrom(
            msg.sender,
            address(this),
            burnAmount
        );
        (amount0, amount1, liquidityBurned) = vault.burn(
            burnAmount,
            address(this)
        );
        require(
            amount0 >= amount0Min && amount1 >= amount1Min,
            "received below minimum"
        );

        if (wethToken0) {
            if (amount0 > 0) {
                weth.withdraw(amount0);
                receiver.sendValue(amount0);
            }
            if (amount1 > 0) {
                token1.safeTransfer(receiver, amount1);
            }
        } else {
            if (amount1 > 0) {
                weth.withdraw(amount1);
                receiver.sendValue(amount1);
            }
            if (amount0 > 0) {
                token0.safeTransfer(receiver, amount0);
            }
        }
    }

    function _deposit(
        IFlypeMaxiVault vault,
        uint256 amount0In,
        uint256 amount1In,
        uint256 _mintAmount,
        address receiver
    )
        internal
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 mintAmount
        )
    {
        // Allow tokens transfer from router to vault
        if (amount0In > 0) {
            vault.token0().safeIncreaseAllowance(address(vault), amount0In);
        }
        if (amount1In > 0) {
            vault.token1().safeIncreaseAllowance(address(vault), amount1In);
        }

        // mint the liquidity position with the vault contract
        (amount0, amount1, ) = vault.mint(_mintAmount, receiver);
        require(
            amount0 == amount0In && amount1 == amount1In,
            "unexpected amounts deposited"
        );
        mintAmount = _mintAmount;
    }

    // solhint-disable-next-line function-max-lines
    function _prepareRebalanceDeposit(
        IFlypeMaxiVault vault,
        uint256 amount0In,
        uint256 amount1In,
        bool zeroForOne,
        uint256 swapAmount,
        uint160 swapThreshold
    )
        internal
        returns (
            uint256 amount0Use,
            uint256 amount1Use,
            uint256 mintAmount
        )
    {
        IERC20 token0 = vault.token0();
        IERC20 token1 = vault.token1();
        if (amount0In > 0) {
            token0.safeTransferFrom(msg.sender, address(this), amount0In);
        }
        if (amount1In > 0) {
            token1.safeTransferFrom(msg.sender, address(this), amount1In);
        }

        _swap(vault, zeroForOne, int256(swapAmount), swapThreshold);

        uint256 amount0Max = token0.balanceOf(address(this));
        uint256 amount1Max = token1.balanceOf(address(this));

        (amount0Use, amount1Use, mintAmount) = _getAmountsAndRefund(
            vault,
            amount0Max,
            amount1Max
        );
    }

    // solhint-disable-next-line code-complexity, function-max-lines
    function _prepareAndRebalanceDepositETH(
        IFlypeMaxiVault vault,
        uint256 amount0In,
        uint256 amount1In,
        bool zeroForOne,
        uint256 swapAmount,
        uint160 swapThreshold
    )
        internal
        returns (
            uint256 amount0Use,
            uint256 amount1Use,
            uint256 mintAmount
        )
    {
        IERC20 token0 = vault.token0();
        IERC20 token1 = vault.token1();
        bool wethToken0 = _isToken0Weth(address(token0), address(token1));

        if (amount0In > 0) {
            if (wethToken0) {
                require(
                    amount0In == msg.value,
                    "mismatching amount of ETH forwarded"
                );
                weth.deposit{value: amount0In}();
            } else {
                token0.safeTransferFrom(msg.sender, address(this), amount0In);
            }
        }

        if (amount1In > 0) {
            if (wethToken0) {
                token1.safeTransferFrom(msg.sender, address(this), amount1In);
            } else {
                require(
                    amount1In == msg.value,
                    "mismatching amount of ETH forwarded"
                );
                weth.deposit{value: amount1In}();
            }
        }

        _swap(vault, zeroForOne, int256(swapAmount), swapThreshold);

        uint256 amount0Max = token0.balanceOf(address(this));
        uint256 amount1Max = token1.balanceOf(address(this));

        (amount0Use, amount1Use, mintAmount) = _getAmountsAndRefundExceptETH(
            vault,
            amount0Max,
            amount1Max,
            wethToken0
        );
    }

    function _swap(
        IFlypeMaxiVault vault,
        bool zeroForOne,
        int256 swapAmount,
        uint160 swapThreshold
    ) internal {
        vault.pool().swap(
            address(this),
            zeroForOne,
            swapAmount,
            swapThreshold,
            ""
        );
    }

    function _getAmountsAndRefund(
        IFlypeMaxiVault vault,
        uint256 amount0Max,
        uint256 amount1Max
    )
        internal
        returns (
            uint256 amount0In,
            uint256 amount1In,
            uint256 mintAmount
        )
    {
        (amount0In, amount1In, mintAmount) = vault.getMintAmounts(
            amount0Max,
            amount1Max
        );
        if (amount0Max > amount0In) {
            vault.token0().safeTransfer(msg.sender, amount0Max - amount0In);
        }
        if (amount1Max > amount1In) {
            vault.token1().safeTransfer(msg.sender, amount1Max - amount1In);
        }
    }

    function _getAmountsAndRefundExceptETH(
        IFlypeMaxiVault vault,
        uint256 amount0Max,
        uint256 amount1Max,
        bool wethToken0
    )
        internal
        returns (
            uint256 amount0In,
            uint256 amount1In,
            uint256 mintAmount
        )
    {
        (amount0In, amount1In, mintAmount) = vault.getMintAmounts(
            amount0Max,
            amount1Max
        );

        if (amount0Max > amount0In && !wethToken0) {
            vault.token0().safeTransfer(msg.sender, amount0Max - amount0In);
        } else if (amount1Max > amount1In && wethToken0) {
            vault.token1().safeTransfer(msg.sender, amount1Max - amount1In);
        }
    }

    function _isToken0Weth(address token0, address token1)
        internal
        view
        returns (bool wethToken0)
    {
        if (token0 == address(weth)) {
            wethToken0 = true;
        } else if (token1 == address(weth)) {
            wethToken0 = false;
        } else {
            revert("one vault token must be WETH");
        }
    }
}
