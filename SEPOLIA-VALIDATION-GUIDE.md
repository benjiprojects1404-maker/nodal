# Validating NodalRouter Against Real Uniswap V2 (Sepolia)

Everything we've tested so far proves `NodalRouter` works correctly against
`MockDexRouter` — a router **we wrote ourselves**, which only proves the
contract does what we assumed a real DEX does. This guide validates it
against Uniswap V2's actual, independently-built, publicly-deployed router —
closer to a real dry run than anything a mock can give you, and it doesn't
depend on BlockDAG Native Swap's address being confirmed yet.

Uniswap V2 is a reasonable stand-in specifically because BlockDAG DEXs are
very likely to be V2-style forks — this is the most common pattern for new
EVM chains. If it works cleanly here, that's real signal.

**Real addresses used below** (Sepolia testnet, chain ID `11155111`),
cross-checked against Uniswap's own docs and Sepolia Etherscan:

| Contract | Address |
|---|---|
| Uniswap V2 Router02 | `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3` |
| Uniswap V2 Factory | `0xF62c03E08ada871A0bEb309762E260a7a6a880E6` |
| WETH9 | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |

---

## 1. Prerequisites

1. MetaMask (or another wallet) with a Sepolia account, switched to the
   **Sepolia** network.
2. Some Sepolia ETH — search "Sepolia ETH faucet" for a current one (these
   change often; Google Cloud's and Alchemy's faucets are usually reliable
   at the time of writing, but confirm whichever you use is still live).
   You only need a small amount — this is all testnet ETH with no real value.

## 2. Deploy `NodalRouter` to Sepolia

In Remix, switch the environment from "Remix VM" to **"Injected Provider —
MetaMask"**, confirm MetaMask is on Sepolia, then deploy `NodalRouter.sol`
exactly as before — constructor arg is a treasury address (any account you
control works for this test). This is a real transaction costing real
(testnet) gas.

## 3. Deploy a test token to trade

Deploy `MockERC20` from `NodalMocks.sol` — args `"Nodal Test Token"`, `"NTT"`,
`18`. Mint yourself a supply, e.g. `mint(yourAddress, 1000000000000000000000)`
(1,000 NTT).

## 4. Seed a real pool on real Uniswap V2

This step is what makes the test genuine — you're calling Uniswap's actual
`Router02` contract, not anything we wrote.

1. On your **NTT token**, call `approve(routerAddress, amount)` where
   `routerAddress` is Uniswap's real Router02
   (`0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`) and `amount` is however
   much NTT you want to seed as liquidity, e.g. `100000000000000000000`
   (100 NTT).
2. In Remix, load Router02 as an external contract: "Deploy & Run" → **At
   Address**, paste `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`, and use the
   standard Uniswap V2 Router02 ABI (available from Uniswap's GitHub, or
   Remix can usually pull it if you import
   `@uniswap/v2-periphery/contracts/UniswapV2Router02.sol`).
3. Call **`addLiquidityETH`**:
   - `token`: your NTT address
   - `amountTokenDesired`: `100000000000000000000` (100 NTT)
   - `amountTokenMin`: `0` (fine for a test)
   - `amountETHMin`: `0`
   - `to`: your own address
   - `deadline`: a few minutes from now (Unix timestamp)
   - **value**: send some Sepolia ETH with the transaction, e.g. `0.01` ETH

   This single call creates the real NTT/WETH pair on Uniswap's real Factory
   and funds it — a genuine pool now exists, priced by whatever ratio of
   NTT-to-ETH you just supplied.

## 5. Register the real Uniswap V2 router as a Nodal source

On `NodalRouter`, call:

```
registerSource(
  <any bytes32 id, e.g. keccak256("uniswap-v2-sepolia")>,
  0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3,
  "Uniswap V2 (Sepolia)"
)
```

## 6. Quote and swap through NodalRouter, against the real pool

1. On your **NTT token**, `approve(nodalRouterAddress, amountIn)` — e.g.
   `10000000000000000000` (10 NTT).
2. On `NodalRouter`, call:
   `quoteAll(10000000000000000000, [NTT_address, WETH_address])`.
   You should get back a real gross output priced by the actual pool you
   just seeded, plus the 0.15% fee split — not a number we invented.
3. Call `swapExactTokensForTokens(sourceId, amountIn, minNetOut, [NTT, WETH], deadline)`.
4. Check your **WETH balance** increased by the expected net amount, and the
   treasury's WETH balance increased by the fee. Both are real ERC20
   transfers on a real (test) network, settled by Uniswap's real AMM math,
   not ours.

## What this does and doesn't prove

**Does prove:** `NodalRouter`'s core assumption — that a Uniswap V2-style
`getAmountsOut` / `swapExactTokensForTokens` interface works exactly as
expected — holds against real, independently-built code, not just our own
mock's simplified version.

**Doesn't prove:** anything about BlockDAG Native Swap specifically. If
BlockDAG's DEX turns out to deviate from the standard V2 interface in any
way, this test won't have caught that — there's still no substitute for
testing against BlockDAG's actual contract once it's confirmed.
