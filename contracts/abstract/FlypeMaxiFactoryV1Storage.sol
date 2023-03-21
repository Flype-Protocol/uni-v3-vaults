//SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import {OwnableUninitialized} from "./OwnableUninitialized.sol";
import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    EnumerableSet
} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

// solhint-disable-next-line max-states-count
contract FlypeMaxiFactoryV1Storage is
    OwnableUninitialized, /* XXXX DONT MODIFY ORDERING XXXX */
    Initializable
    // APPEND ADDITIONAL BASE WITH STATE VARS BELOW:
    // XXXX DONT MODIFY ORDERING XXXX
{
    // XXXXXXXX DO NOT MODIFY ORDERING XXXXXXXX
    // solhint-disable-next-line const-name-snakecase
    string public constant version = "1.0.0";
    address public immutable factory;

    // FlypeMAXIVault deployment Address
    address public vaultImplementation;
    address public DAODeployer;
    EnumerableSet.AddressSet internal _deployers;
    mapping(address => EnumerableSet.AddressSet) internal _vaults;
    // APPPEND ADDITIONAL STATE VARS BELOW:
    uint256 public index;
    // XXXXXXXX DO NOT MODIFY ORDERING XXXXXXXX

    event UpdatevaultImplementation(
        address previousImplementation,
        address newImplementation
    );

    constructor(address _uniswapV3Factory) {
        factory = _uniswapV3Factory;
    }

    function initialize(address _implementation, address _manager_)
        external
        initializer
    {
        vaultImplementation = _implementation;
        _manager = _manager_;
    }

    function setvaultImplementation(address nextImplementation)
        external
        onlyManager
    {
        emit UpdatevaultImplementation(vaultImplementation, nextImplementation);
        vaultImplementation = nextImplementation;
    }
}
