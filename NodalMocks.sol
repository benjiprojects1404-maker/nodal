// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * NodalMocks — TESTING ONLY, do not deploy to mainnet.
 * ============================================================================
 * A fake ERC20 and a fake Uniswap V2-style router, so NodalRouter's full
 * quote -> approve -> swap flow can be exercised end-to-end in Remix's
 * JavaScript VM before BlockDAG Native Swap's real router address is
 * confirmed. The "AMM" here is a fixed exchange rate, not a real bonding
 * curve — it's just enough to prove the plumbing works, not to model real
 * market behavior.
 *
 * Suggested Remix flow:
 * 1. Deploy MockERC20 twice (e.g. "Mock BDAG" / mBDAG, "Mock USDC" / mUSDC).
 * 2. Deploy MockDexRouter.
 * 3. Call mint() on both tokens to send the router a large balance of each
 *    (so it has something to pay out on a swap), and mint yourself some of
 *    the "in" token to trade with.
 * 4. Deploy NodalRouter with a treasury address.
 * 5. Call registerSource() on NodalRouter with a made-up id (e.g. the bytes32
 *    of keccak256("mock-dex")), the MockDexRouter address, and a name.
 * 6. approve() the token you're sending to NodalRouter's address.
 * 7. Call NodalRouter.quoteAll(...) then swapExactTokensForTokens(...).
 * ============================================================================
 */

import "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Anyone can mint in this mock — it's for testing, not real value.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @notice Fixed-rate mock of a Uniswap V2-style router. Not a real AMM — the
/// "price" is whatever you set with setRate(), and never moves with volume.
contract MockDexRouter {
    /// @dev rate[tokenIn][tokenOut] = how many tokenOut units per 1e18 tokenIn units,
    /// itself expressed in 1e18 fixed point. Set both directions yourself.
    mapping(address => mapping(address => uint256)) public rate;

    event RateSet(address indexed tokenIn, address indexed tokenOut, uint256 rate1e18);

    /// @param rate1e18 e.g. 2e18 means 1 unit of tokenIn (in its own decimals) yields
    /// 2 units of tokenOut (in its own decimals), before this mock's own decimal math.
    function setRate(address tokenIn, address tokenOut, uint256 rate1e18) external {
        rate[tokenIn][tokenOut] = rate1e18;
        emit RateSet(tokenIn, tokenOut, rate1e18);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        require(path.length >= 2, "bad path");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i + 1 < path.length; i++) {
            uint256 r = rate[path[i]][path[i + 1]];
            require(r > 0, "no rate set for this pair");
            amounts[i + 1] = (amounts[i] * r) / 1e18;
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        amounts = this.getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        require(amountOut >= amountOutMin, "mock: insufficient output");

        require(MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "pull-in failed");
        require(MockERC20(path[path.length - 1]).transfer(to, amountOut), "push-out failed - mint the router more of the output token");
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external payable returns (uint256[] memory amounts) {
        amounts = this.getAmountsOut(msg.value, path);
        uint256 amountOut = amounts[amounts.length - 1];
        require(amountOut >= amountOutMin, "mock: insufficient output");
        require(MockERC20(path[path.length - 1]).transfer(to, amountOut), "push-out failed - mint the router more of the output token");
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        require(to != address(0), "to=0");
        amounts = this.getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        require(amountOut >= amountOutMin, "mock: insufficient output");

        require(MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "pull-in failed");
        (bool sent, ) = payable(to).call{value: amountOut}("");
        require(sent, "mock: fund this router with native BDAG first");
    }

    /// @notice Lets you top up this mock router with native BDAG for the
    /// swapExactTokensForETH test path.
    receive() external payable {}
}
