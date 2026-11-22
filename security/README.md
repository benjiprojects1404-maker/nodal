# Nodal security checks

Automated checks of Nodal's two on-chain contracts. This is **not** an independent audit. It is the evidence we can
publish ourselves, so anyone can re-run it and get the same result.

| Contract | Address (chain 1404) | Source |
|---|---|---|
| NodalRouter | `0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672` | [`NodalRouter.sol`](../NodalRouter.sol) |
| NodalReefAdapter | `0x4b60D344eDA7E3D859739B5AbC1176d756E22d56` | [`adapters/reef/NodalReefAdapter.sol`](../adapters/reef/NodalReefAdapter.sol) |

Last run: **22 November 2026**, on the source files unchanged since deployment (30 Sep 2026):

```
1480631fea6e778cf4ba3f6abc5b580e0e02c45b689e248e16080fa6f583d227  NodalRouter.sol
5bed02a02568c072fdf6119fb2225c7daf985baf47c69c5207fb8d50f58c2169  adapters/reef/NodalReefAdapter.sol
```

## Summary

| Check | Result |
|---|---|
| Slither 0.11.6, 102 detectors | **No high, medium or low findings.** Informational only (below). |
| Foundry fuzz tests, 10,000 runs each | **17 / 17 pass** |
| Foundry invariant tests, 1,000 runs × 100 calls | **3 / 3 pass** (100,000 random calls each) |
| Do the tests catch real bugs? | Yes: each protection below was deliberately broken and at least one test failed every time |

## Slither

Raw output: [`slither-NodalRouter.txt`](slither-NodalRouter.txt), [`slither-NodalReefAdapter.txt`](slither-NodalReefAdapter.txt).

What it reports, and why it's fine:

| Detector | Where | Why it's acceptable |
|---|---|---|
| low-level-calls | NodalRouter `_settleNativeOut` | Sending native BDAG needs `.call{value:}`; both results are checked with `require`. |
| low-level-calls | NodalReefAdapter `_call` | Used so tokens that return nothing (non-standard ERC-20s) still work; the result is checked. |
| naming-convention | `WBDAG()` | Matches Reef's router interface name. Style only. |

Seven lines in NodalRouter carry a `// slither-disable-next-line` comment. Each has the reason written next to it in
the source:

| Detector silenced | Line | Reason |
|---|---|---|
| calls-loop | `quoteAll` | View function used for quoting only, never in a transaction. |
| unused-return (×3) | the three swap functions | Output is measured by the router's own balance change, deliberately not trusted from the DEX's return value. A fuzz test proves this (below). |
| arbitrary-send-eth (×2) | `_settleNativeOut` | Pays the owner-set treasury, and the caller their own proceeds. |
| arbitrary-send-eth, low-level-calls | `rescueBDAG` | Owner-only (2-of-3 multisig), for BDAG sent to the contract by mistake. |

Re-run:

```bash
pip install slither-analyzer==0.11.6
npm install            # brings in @openzeppelin/contracts 5.0.2
slither NodalRouter.sol --solc-remaps "@openzeppelin/contracts@5.0.2/=node_modules/@openzeppelin/contracts/" --filter-paths node_modules
```

## Fuzz and invariant tests

Tests: [`test/foundry/NodalRouter.t.sol`](../test/foundry/NodalRouter.t.sol). Full output: [`fuzz-results.txt`](fuzz-results.txt).

Each fuzz test runs 10,000 times with random amounts, prices and fee settings:

- **Fee maths, all three swap types** (token→token, BDAG→token, token→BDAG): the user gets exactly
  `output − fee`, the treasury gets exactly `fee = output × feeBps / 10000`, and nothing is left in the router,
  including leftover approvals to the DEX.
- **0% fee:** the treasury is never paid or called. Tested with a token that rejects zero-amount transfers and a
  treasury that rejects BDAG; both still swap fine.
- **Fee cap:** any fee above 1% (100 bps) is refused.
- **Admin:** every owner-only function refuses any other address.
- **Slippage floor:** a swap that would pay less than the user's minimum reverts, and the user keeps their tokens.
- **Per-trade caps** (tokens and native BDAG): over the cap reverts, at or under it goes through.
- **Pause:** blocks swaps but quotes still work.
- **Quote = execution:** what `quoteAll` shows is exactly what the swap pays.
- **A dishonest DEX** that reports one amount but delivers less: Nodal pays out only what really arrived, and the
  user's slippage floor stops the trade.
- **A DEX that tries to re-enter Nodal mid-swap:** refused by the reentrancy guard.
- **A broken source** is skipped by `quoteAll` instead of breaking every quote.

Invariant tests (1,000 runs × 100 random calls, mixing all swap types and fee changes from 0% to 1%):

- NodalRouter **never holds** any tokens or BDAG between transactions.
- The treasury **only ever receives fees**.
- The fee **never exceeds** the 1% cap.

### Checking the tests catch bugs

Each protection was removed from a copy of the contract to check a test fails:

| Protection removed | Caught by |
|---|---|
| `if (fee > 0)` before paying the treasury (token) | `test_zeroFee_treasuryGetsNothing_andNoZeroTransfer` |
| `if (fee > 0)` before paying the treasury (BDAG) | `test_zeroFee_nativeOut_noFeeCall` |
| `nonReentrant` on a swap | `test_reentrancyFromSourceBlocked` |
| 1% fee cap | `testFuzz_feeCannotExceedCap` |
| slippage check | `testFuzz_slippageFloor`, `test_shortChangingRouter_stoppedBySlippageFloor` |
| per-trade cap check | `testFuzz_perTradeCap`, `testFuzz_nativeCap` |

Re-run (Foundry, forge 1.x):

```bash
git submodule update --init      # forge-std
npm install
forge test                       # 1,000 runs per fuzz test
FOUNDRY_PROFILE=ci forge test    # 10,000 runs, as published
```

## What this does not cover

- The tests use mock DEXs, not Reef's live pools; behaviour against Reef was checked on chain at launch (see the
  earlier [security review](https://benjiprojects1404-services.pages.dev/security-review/)).
- Automated tools find known patterns. They don't replace an independent audit, which is planned before the beta
  limits are raised.
