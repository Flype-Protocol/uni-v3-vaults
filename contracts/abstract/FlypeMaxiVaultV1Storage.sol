// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import {Rebalancer} from "./Rebalancer.sol";
import {OwnableUninitialized} from "./OwnableUninitialized.sol";
import {
    IUniswapV3Pool
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/// @dev Single Global upgradeable state var storage base: APPEND ONLY
/// @dev Add all inherited contracts with state vars here: APPEND ONLY
/// @dev ERC20Upgradable Includes Initialize
// solhint-disable-next-line max-states-count
abstract contract FlypeMaxiVaultV1Storage is
    ERC20Upgradeable, /* XXXX DONT MODIFY ORDERING XXXX */
    ReentrancyGuardUpgradeable,
    OwnableUninitialized,
    Rebalancer
    // APPEND ADDITIONAL BASE WITH STATE VARS BELOW:
    // XXXX DONT MODIFY ORDERING XXXX
{
    // solhint-disable-next-line const-name-snakecase
    string public constant version = "1.0.0";
    // solhint-disable-next-line const-name-snakecase
    uint16 public constant FlypeMaxiFeeBPS = 250;
    /// @dev "restricted mint enabled" toggle value must be a number
    // above 10000 to safely avoid collisions for repurposed state var
    bool public constant RESTRICTED_MINT_ENABLED = false;

    address public immutable FlypeTreasury;

    // XXXXXXXX DO NOT MODIFY ORDERING XXXXXXXX
    int24 public lowerTick;
    int24 public upperTick;

    uint16 public maxRebalancePayoutFeeBPS;
    bool public restrictedMintToggle;
    uint16 public rebalanceSwapSlippageBPS;
    uint32 public rebalanceSwapSlippageInterval;

    uint16 public managerFeeBPS;
    address public managerTreasury;

    uint256 public managerBalance0;
    uint256 public managerBalance1;
    uint256 public FlypeMaxiBalance0;
    uint256 public FlypeMaxiBalance1;

    IUniswapV3Pool public pool;
    IERC20 public token0;
    IERC20 public token1;
    // APPPEND ADDITIONAL STATE VARS BELOW:
    // XXXXXXXX DO NOT MODIFY ORDERING XXXXXXXX

    event UpdateManagerParams(
        uint16 managerFeeBPS,
        address managerTreasury,
        uint16 maxRebalancePayoutFeeBPS,
        uint16 rebalanceSwapSlippageBPS,
        uint32 rebalanceSwapSlippageInterval
    );

    // solhint-disable-next-line max-line-length
    constructor(address payable _rebalancer, address _FlypeTreasury)
        Rebalancer(_rebalancer)
    {
        FlypeTreasury = _FlypeTreasury;
    }

    /// @notice initialize storage variables on a new FlypeMaxi Vault, only called once
    /// @param _name name of Vault (immutable)
    /// @param _symbol symbol of Vault (immutable)
    /// @param _pool address of Uniswap V3 pool (immutable)
    /// @param _managerFeeBPS proportion of fees earned that go to manager treasury
    /// @param _lowerTick initial lowerTick (only changeable with executiveRebalance)
    /// @param _lowerTick initial upperTick (only changeable with executiveRebalance)
    /// @param _manager_ address of manager (ownership can be transferred)
    function initialize(
        string memory _name,
        string memory _symbol,
        address _pool,
        uint16 _managerFeeBPS,
        int24 _lowerTick,
        int24 _upperTick,
        address _manager_
    ) external initializer {
        require(_managerFeeBPS <= 10000 - FlypeMaxiFeeBPS, "mBPS");

        // these variables are immutable after initialization
        pool = IUniswapV3Pool(_pool);
        token0 = IERC20(pool.token0());
        token1 = IERC20(pool.token1());

        // these variables can be udpated by the manager
        _manager = _manager_;
        managerFeeBPS = _managerFeeBPS;
        managerTreasury = _manager_; // default: treasury is admin
        rebalanceSwapSlippageInterval = 5 minutes; // default: last five minutes;
        rebalanceSwapSlippageBPS = 500; // default: 5% slippage
        maxRebalancePayoutFeeBPS = 200; // default: only rebalance if tx fee is lt 2% reinvested

        lowerTick = _lowerTick;
        upperTick = _upperTick;

        // e.g. "Uniswap V3 USDC/DAI LP" and "MXI-UNI"
        __ERC20_init(_name, _symbol);
        __ReentrancyGuard_init();
    }

    /// @notice change configurable parameters, only manager can call
    /// @param newManagerFeeBPS Basis Points of fees earned credited to manager (negative to ignore)
    /// @param newManagerTreasury address that collects manager fees (Zero address to ignore)
    /// @param newRebalanceBPS threshold fees earned for rebalances (negative to ignore)
    /// @param newSlippageBPS frontrun protection parameter (negative to ignore)
    /// @param newSlippageInterval frontrun protection parameter (negative to ignore)
    // solhint-disable-next-line code-complexity
    function updateManagerParams(
        int16 newManagerFeeBPS,
        address newManagerTreasury,
        int16 newRebalanceBPS,
        int16 newSlippageBPS,
        int32 newSlippageInterval
    ) external onlyManager {
        require(newRebalanceBPS <= 10000, "BPS");
        require(newSlippageBPS <= 10000, "BPS");
        require(newManagerFeeBPS <= 10000 - int16(FlypeMaxiFeeBPS), "mBPS");
        if (newManagerFeeBPS >= 0) managerFeeBPS = uint16(newManagerFeeBPS);
        if (newRebalanceBPS >= 0)
            maxRebalancePayoutFeeBPS = uint16(newRebalanceBPS);
        if (newSlippageBPS >= 0)
            rebalanceSwapSlippageBPS = uint16(newSlippageBPS);
        if (newSlippageInterval >= 0)
            rebalanceSwapSlippageInterval = uint32(newSlippageInterval);
        if (address(0) != newManagerTreasury)
            managerTreasury = newManagerTreasury;
        emit UpdateManagerParams(
            managerFeeBPS,
            managerTreasury,
            maxRebalancePayoutFeeBPS,
            rebalanceSwapSlippageBPS,
            rebalanceSwapSlippageInterval
        );
    }

    function toggleRestrictMint() external onlyManager {
        restrictedMintToggle = !restrictedMintToggle;
    }

    function renounceOwnership() public virtual override onlyManager {
        managerTreasury = address(0);
        managerFeeBPS = 0;
        managerBalance0 = 0;
        managerBalance1 = 0;
        super.renounceOwnership();
    }

    function getPositionID() external view returns (bytes32 positionID) {
        return _getPositionID();
    }

    function _getPositionID() internal view returns (bytes32 positionID) {
        return keccak256(abi.encodePacked(address(this), lowerTick, upperTick));
    }
}
