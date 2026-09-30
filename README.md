# Nodal

A DEX aggregator for BlockDAG (chain ID 1404). Nodal compares the liquidity sources registered with its router contract and sends each trade through whichever one returns the most, taking a disclosed 0.15% routing fee.

**Status: beta.** The router is live on BlockDAG mainnet with **one liquidity source, Reef** (registered 30 Sep 2026 via `NodalReefAdapter`; Reef is built by the same team as Nodal). Trades are capped at 100 BDAG and 1,000,000 NOCAP each during the beta. The website's Swap tab trades live through NodalRouter; the Bridge tab is still a labelled preview.

- Website: https://nodaldex.fyi
- Chain: BlockDAG, chain ID `1404` (`0x57c`)
- Explorer: https://explorer.bdagexplorer.com (NodalRouter is verified there)

## Deployed contracts

| What | Address |
|---|---|
| NodalRouter | `0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672` |
| Owner: 2-of-2 multisig (Trezor + Ledger) | `0x4E2401bFD24c66166fABF9Cc5cD5B6B2c5c860fc` |
| Treasury (fee recipient) | `0x8A8F4E1d70F889C5aA2579E8ff2826e4fE8B2127` |
| NodalReefAdapter (registered as source `reef`) | `0x4b60D344eDA7E3D859739B5AbC1176d756E22d56` |

RPC endpoints are not hard-coded any more. `api/rpcs.js` (a Vercel function, served at
https://nodaldex.fyi/api/rpcs) reads the community node board at https://bdag.community/chain#nodes and returns the
endpoints it lists, marking which are healthy (on chain 1404, near the head, matching block hashes). Nodes the board
flags as the fork or retired are never used. The site's quotes and RPC status panel use that list, so a node that
shuts down drops off and a new one appears without a site update. If the list can't be loaded, the site falls back to
the built-in list in `src/rpcRegistry.js`. Handshake and Reef use the same endpoint.

## What's in the repo

| Path | Purpose |
|---|---|
| `NodalRouter.sol` | The aggregator contract: Ownable, ReentrancyGuard, Pausable, per-token deposit caps, fee hard-capped at 1% (currently 0.15%) |
| `NodalMocks.sol` | **Testing only.** Mock ERC20 and mock DEX router for exercising the router without real liquidity |
| `REMIX-TESTING-GUIDE.md` | Step-by-step guide for the testing team (deploy, mint, quote, approve, swap in Remix) |
| `SEPOLIA-VALIDATION-GUIDE.md` | Validating the router against a real Uniswap V2 deployment on Sepolia |
| `testing/nodal-remix-frontend.html` | Standalone wallet-connected page for driving a deployed router during testing (open it in a browser; paste in the contract address) |
| `src/`, `index.html`, `public/` | The marketing/app website (React + Vite), deployed to Vercel |
| `adapters/reef/` | `NodalReefAdapter.sol` lets Nodal route through Reef (Reef renames the V2 BDAG swap functions), plus its tests and `REEF-ACTIVATION-GUIDE.md` |
| `docs/diagrams/` | Routing-architecture and fee-breakdown diagrams (SVG + PNG) |

## Compiler settings (important)

- Solidity **0.8.24** (pinned, not floating)
- OpenZeppelin **5.0.2** (Remix-style versioned imports)
- EVM version **Berlin**. BlockDAG's EVM targets Berlin. Paris or Shanghai will compile fine but then fail on every call.

## Running the website locally

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

Pushes to `main` redeploy the site on Vercel.

## Admin actions (via the multisig)

Since 30 Sep 2026 (block 22931119) NodalRouter is owned by `0x4E2401bF…60fc`, a 2-of-2 multisig whose owners are
`0x306208Aa25A5BBAB22Bd9208c4178b9f2Dd929FD` (Trezor) and `0x33D599DD7C9e1C11b6DC4a48AE209D0f066CF91A` (Ledger).
It's the same `ReefAdminMultisig` contract that holds Reef's `feeToSetter`. Fees still go to the treasury wallet above.

Every owner-only call takes three steps: **submit** (first signature), **confirm** (second signature), **execute** (anyone).

### In Remix (works with both hardware wallets through MetaMask)

1. Load NodalRouter at `0xA06f…4672`. Fill in the inputs of the function you want, e.g. `pause`, then click its
   **Calldata** copy button. **Don't** click Transact; your wallet isn't the owner any more, so it would just fail.
2. Load the multisig at `0x4E2401bFD24c66166fABF9Cc5cD5B6B2c5c860fc` using this interface:

   ```solidity
   // SPDX-License-Identifier: MIT
   pragma solidity 0.8.24;
   interface NodalMultisig {
       function submitTransaction(address to, uint256 value, bytes calldata data) external returns (uint256);
       function confirmTransaction(uint256 txId) external;
       function executeTransaction(uint256 txId) external;
       function transactionCount() external view returns (uint256);
       function confirmationCount(uint256 txId) external view returns (uint256);
       function transactions(uint256 txId) external view returns (address to, uint256 value, bytes memory data, bool executed);
       function getOwners() external view returns (address[] memory);
       function required() external view returns (uint256);
   }
   ```
3. MetaMask on the **Trezor** account: `submitTransaction(0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672, 0, <pasted calldata>)`.
   The new `txId` is `transactionCount() - 1`.
4. MetaMask on the **Ledger** account: `confirmTransaction(txId)`.
5. Any account: `executeTransaction(txId)`, then check `transactions(txId)` shows `executed: true`.

### With the reef-dex script (alternative)

Run `scripts/propose-multisig-tx.js` from the `reef-dex` project, with `MS_TARGET` pointed at NodalRouter. Use the
submit step from a network whose signer is one of the two owners (`blockdagLedger` for the Ledger).

```bash
MS_CMD=submit  MS_TARGET=0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672 MS_SIG="pause()" \
  npx hardhat run scripts/propose-multisig-tx.js --network blockdagLedger
MS_CMD=confirm MS_TXID=<txId> npx hardhat run scripts/propose-multisig-tx.js --network <other owner>
MS_CMD=execute MS_TXID=<txId> npx hardhat run scripts/propose-multisig-tx.js --network blockdag
MS_CMD=status  MS_TXID=<txId> npx hardhat run scripts/propose-multisig-tx.js --network blockdag
```

The multisig does not revert if the inner call fails. It emits `ExecutionFailed` and leaves the proposal retryable,
so always check `executed: true` afterwards.

Common `MS_SIG` / `MS_ARGS` values:

| Action | `MS_SIG` | `MS_ARGS` |
|---|---|---|
| Emergency stop | `pause()` | none |
| Resume | `unpause()` | none |
| Switch a source off/on | `setSourceActive(bytes32,bool)` | `0x7265656600000000000000000000000000000000000000000000000000000000,false` |
| Add a new DEX | `registerSource(bytes32,address,string)` | `<id>,<router or adapter>,<Name>` |
| Change a trade cap | `setMaxAmountIn(address,uint256)` | `<token, or 0x000…000 for BDAG>,<amount in wei>` |
| Change the fee (max 100 = 1%) | `setFeeBps(uint16)` | `15` |
| Change fee recipient | `setTreasury(address)` | `<address>` |

**Never** submit `renounceOwnership()`. It would lock these controls forever.

## Source verification

- **NodalRouter** is verified on [explorer.bdagexplorer.com](https://explorer.bdagexplorer.com/address/0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672)
  ("partial match": identical code, only Remix's metadata fingerprint differs). Source: `verify/NodalRouter.flat.sol`
  (OpenZeppelin 5.0.2 inlined), with Solidity 0.8.24, optimizer on / 200 runs, EVM `berlin`.
- **NodalReefAdapter** can't be verified on that explorer yet. Its verifier compares runtime bytecode byte-for-byte
  and doesn't mask Solidity *immutables*. The adapter stores the Reef router address as an immutable in 8 places.
  Compiling `verify/NodalReefAdapter.sol` with the same settings gives code identical to the deployed contract once
  those 8 slots (byte offsets 278, 510, 663, 885, 1012, 1187, 1421, 1498) are masked. Every one of them holds
  `0xbd6fbA41Ab84292163A599510a12d6Bf8B7CCc76` (Reef's router), and the explorer can read that value directly via the
  adapter's public `reef()` function.

## Reporting a vulnerability

Please report security issues privately to **security@nodaldex.fyi**, not in public issues, so they can be fixed
(or the router paused) first.

## Disclaimer

Experimental software on an early-stage chain. The source is published and has been checked with Slither, but it has not had an independent third-party audit. Contract ownership is held by a 2-of-2 hardware-wallet multisig.
