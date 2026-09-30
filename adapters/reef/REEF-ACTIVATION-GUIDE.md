# Connecting Nodal to Reef

> **Status: LIVE since 30 Sep 2026.** Adapter deployed at `0x4b60D344eDA7E3D859739B5AbC1176d756E22d56` and registered with NodalRouter as source `reef`.
> Beta caps set: 100 BDAG and 1,000,000 NOCAP per trade.
> Live-tested both ways on mainnet: 0.1 BDAG → NOCAP (block 22923850) and 5,000 NOCAP → BDAG (block 22929432). Both paid out the quoted amount, with the 0.15% fee to the treasury.

Reef is a Uniswap V2-style DEX on BlockDAG, but its router renames the two native-coin swaps:

| NodalRouter calls | Reef's router has |
|---|---|
| `getAmountsOut` | `getAmountsOut` (same) |
| `swapExactTokensForTokens` | `swapExactTokensForTokens` (same) |
| `swapExactETHForTokens` | `swapExactBDAGForTokens` |
| `swapExactTokensForETH` | `swapExactTokensForBDAG` |

If Reef's router were registered with Nodal directly, token↔token swaps would work, but every swap into or out of native BDAG would revert. `NodalReefAdapter.sol` sits in between and translates the names. You register the **adapter** with Nodal, not Reef's router. Neither NodalRouter nor Reef changes.

The adapter has no owner and no admin functions. It stores nothing and holds no funds between transactions. The Reef router address is fixed when it's deployed.

## Tested

`test/adapter.test.js` runs the real Reef contracts (Factory, Pair, Router, WBDAG) and the real `NodalRouter.sol` together on a local Berlin EVM, with the adapter in between. **10/10 passing:**

- `quoteAll` through the adapter equals Reef's own quote minus the 0.15% fee
- BDAG → NOCAP, NOCAP → BDAG, NOCAP → USDX, and multi-hop BDAG → NOCAP → USDX: user receives exactly the quoted net amount and the treasury receives exactly the fee
- Adapter and NodalRouter hold zero tokens and zero BDAG after every swap
- Slippage, expired deadlines and bad paths all revert with nothing moved
- Adapter rejects stray BDAG sent to it directly
- Control: registering Reef's router directly does break BDAG swaps

To re-run: in a Hardhat project with Reef's `contracts/` folder, add `NodalRouter.sol` (OpenZeppelin imports pointed at `@openzeppelin/contracts` 5.0.2) and `NodalReefAdapter.sol`, then run `npx hardhat test` with Solidity 0.8.24, Berlin, optimizer 200 and `bytecodeHash: "none"`.

## Addresses

| What | Address |
|---|---|
| Reef router (constructor argument) | `0xbd6fbA41Ab84292163A599510a12d6Bf8B7CCc76` |
| Reef WBDAG (use in swap paths) | `0x62ba5c4F067989a7f6644488C875bEa69Bfa1FBA` |
| NOCAP | `0x17AEE3EEDA0d12E3A6a9A6078d028B88F9C91752` |
| NodalRouter | `0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672` |
| Source ID for Reef (`bytes32("reef")`) | `0x7265656600000000000000000000000000000000000000000000000000000000` |

## Steps (Remix + MetaMask on chain 1404)

### 1. Deploy the adapter

1. In Remix, create `NodalReefAdapter.sol` and paste in the file from this folder.
2. Solidity compiler tab: version **0.8.24**. Under Advanced Configurations set **EVM version: berlin** and turn on **optimization, 200 runs**. Compile.
3. Deploy tab: Environment **Injected Provider – MetaMask**, on BlockDAG (1404).
4. Constructor argument `reefRouter`: `0xbd6fbA41Ab84292163A599510a12d6Bf8B7CCc76`. Deploy.
   Any wallet can deploy it, because the adapter has no owner.
5. Check: call `reef()` on the deployed adapter. It must return the Reef router address above. Call `WBDAG()`. It must return `0x62ba…1FBA`.
6. Save the adapter address.

### 2. Verify it on the explorer

The file has no imports, so paste it as a single file with the same settings: 0.8.24, Berlin, optimizer on with 200 runs. Constructor argument is the Reef router address.

### 3. Set a beta cap first (recommended)

From the **NodalRouter owner** wallet, before anything is live, call `setMaxAmountIn` on NodalRouter to cap trade size during beta:

- `token`: `0x0000000000000000000000000000000000000000` (native BDAG), `newCap`: e.g. `100000000000000000000` (100 BDAG in wei)
- `token`: NOCAP address, `newCap`: whatever you're comfortable with

A cap of 0 means uncapped, which is the current setting.

### 4. Register Reef as a source

From the **NodalRouter owner** wallet, call `registerSource` on NodalRouter at `0xA06f…4672`:

- `id`: `0x7265656600000000000000000000000000000000000000000000000000000000`
- `router`: **the adapter address from step 1** (not Reef's router)
- `name`: `Reef`

### 5. Read-only check

Call `quoteAll` on NodalRouter:

- `amountIn`: `1000000000000000000` (1 BDAG)
- `path`: `["0x62ba5c4F067989a7f6644488C875bEa69Bfa1FBA","0x17AEE3EEDA0d12E3A6a9A6078d028B88F9C91752"]`

You should get one entry with a non-zero net output. Compare it with the Reef site's quote for 1 BDAG → NOCAP. Nodal's gross figure should match, and the net figure should be 0.15% lower.

### 6. One tiny live swap each way

1. **BDAG → NOCAP:** call `swapExactBDAGForTokens` on NodalRouter with `sourceId` = the ID above, `minNetAmountOut` = the net from `quoteAll` minus ~1%, the same path, `deadline` = a Unix time ~10 minutes ahead, and **Value** = 0.1 BDAG.
2. **NOCAP → BDAG:** first `approve` NodalRouter on the NOCAP token for a small amount. Then call `swapExactTokensForBDAG` with the path reversed (`[NOCAP, WBDAG]`).
3. On the explorer, check the treasury `0x8A8F…2127` received the 0.15% fee each time.

If anything looks wrong, NodalRouter's owner can call `setSourceActive(id, false)` to switch Reef off instantly, or `pause()` to stop everything.

## After it's live

- Update the website's "Live DEX sources" count and liquidity-sources section to show Reef.
- Say plainly on the site that **Nodal and Reef are built by the same team**.
- While Reef is the only source, describe Nodal as routing through Reef, not "comparing" venues.
