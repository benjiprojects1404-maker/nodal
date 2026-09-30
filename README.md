# Nodal

A DEX aggregator for BlockDAG (chain ID 1404). Nodal compares the liquidity sources registered with its router contract and sends each trade through whichever one returns the most, taking a disclosed 0.15% routing fee.

**Status: beta.** The router is live on BlockDAG mainnet with **one liquidity source, Reef** (registered 30 Sep 2026 via `NodalReefAdapter`; Reef is built by the same team as Nodal). Trades are capped at 100 BDAG and 1,000,000 NOCAP each during the beta. The website's swap and bridge widgets are still labelled previews and don't send transactions; live trades currently go through the contract directly.

- Website: https://nodal-gamma-seven.vercel.app
- Chain: BlockDAG, chain ID `1404` (`0x57c`)
- Explorer: https://explorer.blockdag.engineering/

## Deployed contracts

| What | Address |
|---|---|
| NodalRouter | `0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672` |
| Treasury (fee recipient) | `0x8A8F4E1d70F889C5aA2579E8ff2826e4fE8B2127` |
| NodalReefAdapter (registered as source `reef`) | `0x4b60D344eDA7E3D859739B5AbC1176d756E22d56` |

Build on the community / canonical side of chain 1404 only. `rpc.bdagscan.com` / `bdagscan.com` serve a diverged fork and are deliberately excluded everywhere in this repo. See https://bdagexplorer.com/leaderboard.html#rpc-ranking for live status.

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

## Adding a liquidity source

When a new DEX has real liquidity, the contract owner registers its router address with one `registerSource(id, router, name)` transaction.

## Disclaimer

Experimental software on an early-stage chain. The source is published and has been checked with Slither, but it has not had an independent third-party audit. Contract ownership is currently a single key, not a multisig.
