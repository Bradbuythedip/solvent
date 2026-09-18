// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Six-decimal stand-in for the Arc USDC precompile. Test-only: on Arc the real
 * token lives at 0x3600...0000 and is also the gas asset.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    mapping(address => bool) public frozen;

    function mint(address to, uint256 amount6) external {
        _mint(to, amount6);
    }

    /// Stands in for the real token's blacklist: a frozen account cannot move value.
    function setFrozen(address account, bool value) external {
        frozen[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!frozen[from] && !frozen[to], "USDC: frozen");
        super._update(from, to, value);
    }
}
