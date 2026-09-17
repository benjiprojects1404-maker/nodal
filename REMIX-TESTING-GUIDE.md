# Nodal — Remix Deployment & Testing Guide

This is the handoff doc for testing `NodalRouter.sol` in Remix. Everything in
this package has been verified as of today: clean compile with the exact
production import paths, a clean Slither static-analysis pass, and a live
end-to-end test on a real local EVM (deploy → mint → quote → approve → swap →
balance/event verification, plus admin guardrails) — 8 for 8 passing, twice,
identically.

**What this guide does NOT solve:** BlockDAG Native Swap's real router
contract address is still unconfirmed. Nothing here is blocked by that — the
mock contracts below let your team test the entire flow without it — but
routing to *real* BlockDAG liquidity still needs that address before it means
anything in production.

---

## Files you need

- `NodalRouter.sol` — the aggregator contract.
- `NodalMocks.sol` — a mock ERC20 and a mock DEX router, for testing without
  needing BlockDAG's real DEX yet. **Testing only — never deploy this to
  mainnet.**

## 1. Remix setup

1. Go to [remix.ethereum.org](https://remix.ethereum.org/).
2. Create a new workspace, add both `.sol` files.
3. **Compiler tab:**
   - Version: exactly **0.8.24** (not "auto", not the newest available).
   - Advanced Configurations → **EVM Version: berlin**. This comes from a
     documented note in the Handshake OTC Escrow project (a comment left by
     an independent dev review, not something BlockDAG's own docs state
     outright) — worth an independent confirmation before mainnet, but
     credible enough to act on now. The risk it describes is real either
     way: compiling with a newer default (which emits the Shanghai-era
     `PUSH0` opcode) can deploy without any error and then silently fail on
     every call. What IS independently confirmed: both `NodalRouter.sol` and
     `NodalMocks.sol` compile clean under `--evm-version berlin`, so setting
     this costs nothing regardless.
   - Enable the optimizer, 200 runs (matches what was tested).
4. Compile both files. You should get zero errors. If Remix complains it
   can't resolve `@openzeppelin/contracts@5.0.2/...` imports, give it a
   moment — Remix auto-fetches these from npm on first compile; it needs an
   internet connection to do so once.

## 2. Deploy order (Remix VM / "Injected Provider" testnet — not mainnet yet)

Use Remix's **Remix VM (Prague)** environment for this first pass — no real
funds, no wallet needed, instant transactions.

1. **Deploy `MockERC20`** — constructor args: `"Mock BDAG"`, `"mBDAG"`, `18`.
   Copy the deployed address.
2. **Deploy `MockERC20` again** — this time `"Mock USDT"`, `"mUSDT"`, `6`.
   (Deliberately different decimals from step 1 — this is what actually
   exercises the decimal-conversion logic, not just the happy path.)
3. **Deploy `MockDexRouter`** — no constructor args.
4. **Deploy `NodalRouter`** — constructor arg: an address to act as the fee
   treasury (any account in the Remix VM's account dropdown works for
   testing; use a real multisig-controlled address before mainnet).

## 3. Wire up the mock liquidity

All calls below go through the **deployed contract's function list** in
Remix's left panel, under each contract instance.

1. On `MockDexRouter`, call **`setRate(mBDAG_address, mUSDT_address, rate)`**.
   To model "1 BDAG = 50 USDT" with an 18-decimal input and 6-decimal output,
   `rate` = `50 * 10^6` = `50000000`. (The rate has to absorb the decimal
   difference yourself — the mock doesn't do that for you.)
2. On the **mBDAG** token, call **`mint(yourAddress, 1000000000000000000000)`**
   (1000 mBDAG) to give your test account something to trade.
3. On the **mUSDT** token, call **`mint(mockRouterAddress, 1000000000000)`**
   (1,000,000 mUSDT) so the mock router has something to pay out.
4. On `NodalRouter`, call **`registerSource(id, mockRouterAddress, "Mock DEX")`**.
   `id` is any `bytes32` value you choose — in Remix you can type a short
   string and it'll accept it, or use a keccak256 hash of a name. Keep note
   of whatever you use; you'll need it again below.

## 4. Run a quote and a swap

1. On the **mBDAG** token, call **`approve(nodalRouterAddress, amountIn)`** —
   e.g. `10000000000000000000` (10 mBDAG) — from the same account you minted
   to.
2. On `NodalRouter`, call **`quoteAll(amountIn, [mBDAG_address, mUSDT_address])`**
   (view function, free). You should get back your source id, a gross
   output, a fee (0.15% of gross), and a net output.
3. Call **`swapExactTokensForTokens(sourceId, amountIn, minNetOut, [mBDAG, mUSDT], deadline)`**
   — set `minNetOut` to the net figure `quoteAll` just gave you (or slightly
   below, to allow for rounding), and `deadline` to a Unix timestamp a few
   minutes in the future (`Math.floor(Date.now()/1000) + 600` if you're
   computing it in a browser console).
4. Check the **mUSDT balance** of your test account and of the treasury
   address — both should have moved by the expected amounts. Check the
   transaction logs for a `SwapExecuted` event.

## 5. Things worth deliberately trying to break

Your team testing this should try to make it fail, not just confirm the
happy path:

- Set `minNetOut` higher than what `quoteAll` returned, and confirm the swap
  **reverts with "slippage"** rather than silently underpaying.
- Try calling `setFeeBps` from an account that isn't the deployer — should
  revert (owner-only).
- Try calling `setFeeBps(200)` (2%) as the owner — should revert, since
  `MAX_FEE_BPS` hard-caps it at 100 (1%).
- Try `quoteAll` for a token pair with no rate set on the mock router — it
  should come back with a zero quote for that source, not revert the whole
  call.
- Try the native-BDAG paths (`swapExactBDAGForTokens` / `swapExactTokensForBDAG`)
  by sending value with the transaction in Remix's "value" field before
  clicking the function.

## 6. Before this goes anywhere near real funds

- [ ] Confirm BlockDAG Native Swap's actual router address and ABI, and
      register it in place of the mock.
- [ ] Move contract ownership to a multisig rather than a single deployer key.
- [ ] Get a paid third-party audit — Slither and this testing pass are a
      real first gate, not a substitute for one.
- [ ] Re-run this whole guide once more against whatever real router address
      you register, on a small amount, before opening it up further.
