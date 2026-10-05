import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserProvider, Contract, Interface, JsonRpcProvider, ZeroAddress, decodeBytes32String, formatUnits, getAddress, parseUnits } from "ethers";
import { getReadRpcs } from "./rpcRegistry.js";
import { ArrowDownUp, AlertTriangle, Loader2, Wallet, Check, ExternalLink } from "lucide-react";

/* ---------------------------------------------------------------------------
 * Live swap: real quotes and real trades through NodalRouter on chain 1404.
 *
 * Flow: pick tokens → find a route in Reef's pools (direct pair, else via
 * WBDAG) → NodalRouter.quoteAll ranks every registered source by net output
 * (after Nodal's fee) → user signs approve (ERC20 in only) + swap.
 *
 * Safety rails mirrored from the contract so users see problems before they
 * sign: paused(), per-token maxAmountIn caps, balance check, slippage floor
 * (minNetAmountOut), deadline from chain time, price-impact warnings.
 *
 * Addresses can be overridden with VITE_* env vars (used for local testing
 * against a Hardhat node); the defaults are the live mainnet deployment.
 * ------------------------------------------------------------------------- */

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const CFG = {
  chainId: Number(env.VITE_CHAIN_ID || 1404),
  rpc: env.VITE_RPC_URL || null, // local testing override; otherwise the live list (rpcRegistry.js)
  router: env.VITE_NODAL_ROUTER || "0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672",
  // Token discovery and path finding use Reef's factory, since Reef is the live source.
  // When a second DEX is registered, extend discovery to its factory too.
  factory: env.VITE_REEF_FACTORY || "0x9603042044b6B1A1637c508F731ba01219142239",
  wbdag: env.VITE_WBDAG || "0x62ba5c4F067989a7f6644488C875bEa69Bfa1FBA",
  explorer: env.VITE_EXPLORER || "https://explorer.blockdag.engineering",
};

const NATIVE = { symbol: "BDAG", name: "BlockDAG", decimals: 18, address: null, native: true };
const DEADLINE_SECS = 1200;
const WARN_IMPACT = 3;
const HIGH_IMPACT = 10;
const MAX_IMPACT = 30;
const SLIPPAGE_PRESETS = [50, 100, 300]; // basis points

const ROUTER_ABI = [
  "function quoteAll(uint256 amountIn, address[] path) view returns (bytes32[] ids, uint256[] grossOuts, uint256[] fees, uint256[] netOuts)",
  "function sources(bytes32) view returns (address router, string name, bool active)",
  "function paused() view returns (bool)",
  "function maxAmountIn(address) view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function swapExactTokensForTokens(bytes32 sourceId, uint256 amountIn, uint256 minNetAmountOut, address[] path, uint256 deadline) returns (uint256)",
  "function swapExactBDAGForTokens(bytes32 sourceId, uint256 minNetAmountOut, address[] path, uint256 deadline) payable returns (uint256)",
  "function swapExactTokensForBDAG(bytes32 sourceId, uint256 amountIn, uint256 minNetAmountOut, address[] path, uint256 deadline) returns (uint256)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const FACTORY_ABI = [
  "function getPair(address,address) view returns (address)",
  "function allPairsLength() view returns (uint256)",
  "function allPairs(uint256) view returns (address)",
];
const PAIR_ABI = ["function token0() view returns (address)", "function token1() view returns (address)"];

/* ---------------- read-only provider with RPC failover ---------------- */

let _ro = null;
async function readProvider() {
  if (_ro) return _ro;
  const urls = CFG.rpc ? [CFG.rpc] : await getReadRpcs();
  for (const url of urls) {
    const p = new JsonRpcProvider(url, CFG.chainId, { staticNetwork: true });
    try {
      await Promise.race([p.getBlockNumber(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000))]);
      _ro = p;
      return p;
    } catch {
      p.destroy();
    }
  }
  throw new Error("Couldn't reach any BlockDAG RPC endpoint. Check your connection and try again.");
}
function resetReadProvider() {
  if (_ro) _ro.destroy();
  _ro = null;
}

/* ---------------- helpers ---------------- */

const lc = (a) => (a ? a.toLowerCase() : a);
const wrapped = (t) => (t.native ? CFG.wbdag : t.address);
const tokenKey = (t) => (t.native ? "native" : lc(t.address));
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function fmtUnits(v, decimals, maxFrac) {
  if (v === null || v === undefined) return "";
  const n = Number(formatUnits(v, decimals));
  if (!isFinite(n)) return "";
  if (n === 0) return "0";
  const d = maxFrac !== undefined ? maxFrac : n < 1 ? 6 : n < 1000 ? 4 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

function friendlyError(e) {
  const m = (e && (e.shortMessage || e.reason || (e.info && e.info.error && e.info.error.message) || e.message)) || "Something went wrong.";
  if (/user (rejected|denied)|ACTION_REJECTED/i.test(m) || (e && e.code === "ACTION_REJECTED")) return "Request cancelled in your wallet.";
  if (/slippage/i.test(m)) return "Price moved beyond your slippage setting, so the trade was cancelled. Nothing was spent except gas. Try again or raise slippage.";
  if (/exceeds per-tx cap/i.test(m)) return "This trade is above Nodal's beta limit for that token.";
  if (/insufficient funds/i.test(m)) return "Not enough BDAG to cover this trade plus gas.";
  if (/EnforcedPause|paused/i.test(m)) return "Nodal is paused right now. No trades can be made.";
  if (/INSUFFICIENT_LIQUIDITY|INSUFFICIENT_OUTPUT/i.test(m)) return "Not enough liquidity for that amount.";
  return m.length > 180 ? m.slice(0, 180) + "…" : m;
}

async function findPath(ro, a, b) {
  const factory = new Contract(CFG.factory, FACTORY_ABI, ro);
  const wa = wrapped(a);
  const wb = wrapped(b);
  if (lc(wa) === lc(wb)) return null;
  const direct = await factory.getPair(wa, wb);
  if (direct !== ZeroAddress) return [wa, wb];
  if (lc(wa) === lc(CFG.wbdag) || lc(wb) === lc(CFG.wbdag)) return null;
  const [p1, p2] = await Promise.all([factory.getPair(wa, CFG.wbdag), factory.getPair(CFG.wbdag, wb)]);
  if (p1 !== ZeroAddress && p2 !== ZeroAddress) return [wa, CFG.wbdag, wb];
  return null;
}

async function discoverTokens(ro) {
  const factory = new Contract(CFG.factory, FACTORY_ABI, ro);
  const n = Number(await factory.allPairsLength());
  const pairs = await Promise.all(Array.from({ length: Math.min(n, 200) }, (_, i) => factory.allPairs(i)));
  const addrs = new Set();
  await Promise.all(
    pairs.map(async (p) => {
      const c = new Contract(p, PAIR_ABI, ro);
      const [t0, t1] = await Promise.all([c.token0(), c.token1()]);
      addrs.add(lc(t0));
      addrs.add(lc(t1));
    })
  );
  addrs.delete(lc(CFG.wbdag)); // shown as native BDAG instead
  const infos = await Promise.all(
    [...addrs].map(async (a) => {
      const c = new Contract(a, ERC20_ABI, ro);
      const [symbol, name, decimals] = await Promise.all([
        c.symbol().catch(() => "???"),
        c.name().catch(() => "Unknown token"),
        c.decimals().catch(() => 18),
      ]);
      return { symbol, name, decimals: Number(decimals), address: getAddress(a), native: false };
    })
  );
  infos.sort((x, y) => x.symbol.localeCompare(y.symbol));
  return [{ ...NATIVE }, ...infos];
}

// Shared, cached token discovery (also used by the stats bar on the home page).
let _liveTokens = null;
export function loadLiveTokens() {
  if (!_liveTokens) {
    _liveTokens = readProvider()
      .then(discoverTokens)
      .catch((e) => {
        _liveTokens = null;
        resetReadProvider();
        throw e;
      });
  }
  return _liveTokens;
}

// Recent swaps through NodalRouter, newest first, read from the chain's SwapExecuted events.
const SWAP_EVENT = new Interface([
  "event SwapExecuted(address indexed user, bytes32 indexed sourceId, address tokenIn, address tokenOut, uint256 amountIn, uint256 grossAmountOut, uint256 fee, uint256 netAmountOut)",
]);
const ROUTER_FROM_BLOCK = Number(env.VITE_ROUTER_FROM_BLOCK || 21000000); // safely before NodalRouter's deployment (Sep 18, 2026)
async function loadRecentTrades(tokens, want = 5) {
  const ro = await readProvider();
  const head = await ro.getBlockNumber();
  const topic = SWAP_EVENT.getEvent("SwapExecuted").topicHash;
  const found = [];
  let span = 500000;
  for (let to = head; to > ROUTER_FROM_BLOCK && found.length < want; ) {
    const from = Math.max(ROUTER_FROM_BLOCK, to - span + 1);
    let logs;
    try {
      logs = await ro.getLogs({ address: CFG.router, topics: [topic], fromBlock: from, toBlock: to });
    } catch (e) {
      if (span > 20000) { span = Math.floor(span / 4); continue; } // RPC range limit: retry smaller
      throw e;
    }
    found.unshift(...logs);
    to = from - 1;
  }
  const latest = found.slice(-want).reverse();
  const bySym = (a) => {
    if (!a || lc(a) === lc(ZeroAddress) || lc(a) === lc(CFG.wbdag)) return NATIVE;
    return tokens.find((t) => t.address && lc(t.address) === lc(a)) || { symbol: short(a), decimals: 18 };
  };
  return Promise.all(
    latest.map(async (log) => {
      const ev = SWAP_EVENT.parseLog(log);
      const blk = await ro.getBlock(log.blockNumber).catch(() => null);
      let source;
      try { source = decodeBytes32String(ev.args.sourceId); } catch { source = "source"; }
      const tin = bySym(ev.args.tokenIn);
      const tout = bySym(ev.args.tokenOut);
      return {
        hash: log.transactionHash,
        time: blk ? Number(blk.timestamp) : null,
        source: source.charAt(0).toUpperCase() + source.slice(1),
        text: `${fmtUnits(ev.args.amountIn, tin.decimals)} ${tin.symbol} → ${fmtUnits(ev.args.netAmountOut, tout.decimals)} ${tout.symbol}`,
      };
    })
  );
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/* ---------------- component ---------------- */

export default function LiveSwap({ wallet }) {
  const { address, connect, isWrongChain, switchToBlockDAG } = wallet;

  const [tokens, setTokens] = useState([{ ...NATIVE }]);
  const [loadErr, setLoadErr] = useState("");
  const [fromKey, setFromKey] = useState("native");
  const [toKey, setToKey] = useState(null);
  const [amount, setAmount] = useState("");
  const [slipBp, setSlipBp] = useState(50);
  const [customSlip, setCustomSlip] = useState("");

  const [status, setStatus] = useState({ paused: false, feeBps: 15 });
  const [balance, setBalance] = useState(null);
  const [quote, setQuote] = useState(null); // { path, amountIn, best, all, impactPct, cap }
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState("");

  const [stage, setStage] = useState("idle"); // idle | approving | swapping | done
  const [txErr, setTxErr] = useState("");
  const [lastTx, setLastTx] = useState(null); // { hash, summary }
  const [impactArmed, setImpactArmed] = useState(false);
  const [capNow, setCapNow] = useState(null); // beta limit for the token being paid
  const [recent, setRecent] = useState({ state: "loading", items: [] });

  const quoteSeq = useRef(0);
  const sourceNames = useRef({});

  const fromToken = tokens.find((t) => tokenKey(t) === fromKey) || tokens[0];
  const toToken = toKey ? tokens.find((t) => tokenKey(t) === toKey) : null;

  // Load tokens + router status once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ro = await readProvider();
        const router = new Contract(CFG.router, ROUTER_ABI, ro);
        const [list, paused, feeBps] = await Promise.all([loadLiveTokens(), router.paused(), router.feeBps()]);
        if (!alive) return;
        setTokens(list);
        setStatus({ paused, feeBps: Number(feeBps) });
        if (!toKey && list.length > 1) setToKey(tokenKey(list[1]));
      } catch (e) {
        if (alive) setLoadErr(friendlyError(e));
        resetReadProvider();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address || !fromToken) return setBalance(null);
    try {
      const ro = await readProvider();
      const bal = fromToken.native
        ? await ro.getBalance(address)
        : await new Contract(fromToken.address, ERC20_ABI, ro).balanceOf(address);
      setBalance(bal);
    } catch {
      setBalance(null);
    }
  }, [address, fromToken]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  // Beta limit for the token being paid (shown in Route details before any quote).
  useEffect(() => {
    let alive = true;
    setCapNow(null);
    (async () => {
      try {
        const ro = await readProvider();
        const cap = await new Contract(CFG.router, ROUTER_ABI, ro).maxAmountIn(fromToken.native ? ZeroAddress : fromToken.address);
        if (alive) setCapNow(cap);
      } catch {
        /* shown as unknown */
      }
    })();
    return () => { alive = false; };
  }, [fromKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recent trades through Nodal: on load, and again after your own swap.
  const refreshRecent = useCallback(async () => {
    try {
      const items = await loadRecentTrades(tokens);
      setRecent({ state: "ok", items });
    } catch {
      setRecent((r) => ({ state: r.items.length ? "ok" : "error", items: r.items }));
    }
  }, [tokens]);
  useEffect(() => {
    if (tokens.length > 1) refreshRecent();
  }, [tokens, refreshRecent]);

  // Quote (debounced) whenever inputs change.
  useEffect(() => {
    setQuote(null);
    setQuoteErr("");
    setImpactArmed(false);
    if (!toToken || !amount || !(Number(amount) > 0)) return;
    if (tokenKey(fromToken) === tokenKey(toToken)) {
      setQuoteErr("Choose two different tokens.");
      return;
    }
    let amountIn;
    try {
      amountIn = parseUnits(amount, fromToken.decimals);
    } catch {
      setQuoteErr("That amount has too many decimal places.");
      return;
    }
    const my = ++quoteSeq.current;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const ro = await readProvider();
        const router = new Contract(CFG.router, ROUTER_ABI, ro);
        const path = await findPath(ro, fromToken, toToken);
        if (my !== quoteSeq.current) return;
        if (!path) {
          setQuoteErr(`No pool exists for ${fromToken.symbol} → ${toToken.symbol} yet.`);
          return;
        }
        const capKey = fromToken.native ? ZeroAddress : fromToken.address;
        const [res, cap, paused] = await Promise.all([router.quoteAll(amountIn, path), router.maxAmountIn(capKey), router.paused()]);
        if (my !== quoteSeq.current) return;
        const [ids, grossOuts, fees, netOuts] = res;
        const all = [];
        for (let i = 0; i < ids.length; i++) {
          if (netOuts[i] > 0n) {
            if (!sourceNames.current[ids[i]]) {
              try {
                const s = await router.sources(ids[i]);
                sourceNames.current[ids[i]] = s.name || decodeBytes32String(ids[i]);
              } catch {
                sourceNames.current[ids[i]] = ids[i].slice(0, 10);
              }
            }
            all.push({ id: ids[i], name: sourceNames.current[ids[i]], gross: grossOuts[i], fee: fees[i], net: netOuts[i] });
          }
        }
        all.sort((x, y) => (y.net > x.net ? 1 : y.net < x.net ? -1 : 0));
        if (!all.length) {
          setQuoteErr("No active source can fill this trade right now (not enough liquidity for that size).");
          return;
        }
        const best = all[0];
        // Price impact: this trade's rate vs a much smaller trade on the same source and path.
        let impactPct = null;
        let ref = 0n;
        for (const d of [10000n, 1000n, 100n]) {
          if (amountIn / d >= 1000n) {
            ref = amountIn / d;
            break;
          }
        }
        if (ref === 0n) impactPct = 0;
        else {
          const r = await router.quoteAll(ref, path);
          const idx = r[0].findIndex((x) => x === best.id);
          const refGross = idx >= 0 ? r[1][idx] : 0n;
          if (refGross > 0n) {
            const ratio = (best.gross * ref * 1000000000n) / (refGross * amountIn);
            const diff = 1000000000n - ratio;
            impactPct = diff > 0n ? Number(diff) / 10000000 : 0;
          }
        }
        if (my !== quoteSeq.current) return;
        setStatus((s) => ({ ...s, paused }));
        setQuote({ path, amountIn, best, all, impactPct, cap });
      } catch (e) {
        if (my === quoteSeq.current) setQuoteErr(friendlyError(e));
        resetReadProvider();
      } finally {
        if (my === quoteSeq.current) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, toKey, amount, tokens]);

  const flip = () => {
    if (!toToken) return;
    setFromKey(toKey);
    setToKey(fromKey);
    setAmount("");
    setLastTx(null);
    setTxErr("");
  };

  const minNet = quote ? quote.best.net - (quote.best.net * BigInt(slipBp)) / 10000n : 0n;
  const overCap = quote && quote.cap > 0n && quote.amountIn > quote.cap;
  const overBalance = quote && balance !== null && quote.amountIn > balance;
  const impact = quote ? quote.impactPct : null;
  const impactLevel = impact === null ? "unknown" : impact >= MAX_IMPACT ? "blocked" : impact >= HIGH_IMPACT ? "high" : impact >= WARN_IMPACT ? "warn" : "ok";
  const busy = stage === "approving" || stage === "swapping";

  let blocker = "";
  if (loadErr) blocker = loadErr;
  else if (status.paused) blocker = "Nodal is paused right now";
  else if (!toToken) blocker = "Choose a token to receive";
  else if (!amount || !(Number(amount) > 0)) blocker = "Enter an amount";
  else if (quoteErr) blocker = quoteErr;
  else if (quoting || !quote) blocker = "Getting quote…";
  else if (overCap) blocker = `Beta limit is ${fmtUnits(quote.cap, fromToken.decimals)} ${fromToken.symbol} per trade`;
  else if (address && !isWrongChain && overBalance) blocker = `Not enough ${fromToken.symbol}`;
  else if (impactLevel === "blocked") blocker = `Price impact too high (${impact.toFixed(1)}%). Try a smaller amount`;

  const execute = async () => {
    setTxErr("");
    setLastTx(null);
    if (!quote) return;
    if (impactLevel === "high" && !impactArmed) {
      setImpactArmed(true);
      return;
    }
    try {
      const bp = new BrowserProvider(window.ethereum);
      const signer = await bp.getSigner();
      const net = await bp.getNetwork();
      if (Number(net.chainId) !== CFG.chainId) {
        setTxErr("Your wallet is on the wrong network. Switch to BlockDAG and try again.");
        return;
      }
      const router = new Contract(CFG.router, ROUTER_ABI, signer);
      const ro = await readProvider();
      const latest = await ro.getBlock("latest");
      const deadline = BigInt(latest.timestamp) + BigInt(DEADLINE_SECS);
      const { path, amountIn, best } = quote;

      if (!fromToken.native) {
        const erc = new Contract(fromToken.address, ERC20_ABI, signer);
        const allowance = await erc.allowance(address, CFG.router);
        if (allowance < amountIn) {
          setStage("approving");
          const atx = await erc.approve(CFG.router, amountIn); // exact amount, not unlimited
          await atx.wait();
        }
      }

      setStage("swapping");
      let tx;
      if (fromToken.native) tx = await router.swapExactBDAGForTokens(best.id, minNet, path, deadline, { value: amountIn });
      else if (toToken.native) tx = await router.swapExactTokensForBDAG(best.id, amountIn, minNet, path, deadline);
      else tx = await router.swapExactTokensForTokens(best.id, amountIn, minNet, path, deadline);
      const rc = await tx.wait();

      let received = null;
      const iface = new Interface([
        "event SwapExecuted(address indexed user, bytes32 indexed sourceId, address tokenIn, address tokenOut, uint256 amountIn, uint256 grossAmountOut, uint256 fee, uint256 netAmountOut)",
      ]);
      for (const log of rc.logs) {
        if (lc(log.address) !== lc(CFG.router)) continue;
        try {
          const ev = iface.parseLog(log);
          if (ev && ev.name === "SwapExecuted") received = ev.args.netAmountOut;
        } catch {
          /* not ours */
        }
      }
      setLastTx({
        hash: rc.hash,
        summary: `Swapped ${amount} ${fromToken.symbol} for ${received !== null ? fmtUnits(received, toToken.decimals) : "≈" + fmtUnits(best.net, toToken.decimals)} ${toToken.symbol} via ${best.name}`,
      });
      setStage("done");
      setAmount("");
      refreshBalance();
      setTimeout(refreshRecent, 4000);
    } catch (e) {
      setTxErr(friendlyError(e));
      setStage("idle");
    } finally {
      setImpactArmed(false);
    }
  };

  const onMainClick = () => {
    if (!address) return connect();
    if (isWrongChain) return switchToBlockDAG();
    if (blocker || busy) return;
    execute();
  };

  let label;
  if (!address) label = (<><Wallet size={15} /> Connect wallet to trade</>);
  else if (isWrongChain) label = "Switch to BlockDAG";
  else if (stage === "approving") label = (<><Loader2 size={16} className="nodal-spin" /> Approve {fromToken.symbol} in your wallet…</>);
  else if (stage === "swapping") label = (<><Loader2 size={16} className="nodal-spin" /> Confirm the swap in your wallet…</>);
  else if (blocker) label = blocker;
  else if (impactLevel === "high" && impactArmed) label = `Tap again to swap anyway (${impact.toFixed(1)}% impact)`;
  else if (!fromToken.native) label = `Approve & swap ${fromToken.symbol}`;
  else label = "Swap";

  const mainDisabled = !!address && !isWrongChain && (busy || !!blocker);
  const danger = impactLevel === "high" && !blocker;

  const selectStyle = { fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: 999, padding: "7px 14px", color: "var(--n-cyan)", cursor: "pointer", maxWidth: 140 };
  const boxStyle = { border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 12, background: "var(--n-surface0)", padding: "12px 14px" };

  return (
    <div className="nodal-swap-grid">
    <style>{`.nodal-swap-grid{display:grid;grid-template-columns:minmax(0,480px) minmax(0,1fr);gap:20px;align-items:stretch}.nodal-swap-grid>*{box-sizing:border-box}@media (max-width:900px){.nodal-swap-grid{grid-template-columns:minmax(0,1fr)}}`}</style>
    <div className="nodal-scope nodal-panel" data-testid="live-swap" style={{ maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", background: "var(--n-surface)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 16, padding: "24px 24px 22px", boxShadow: "0 30px 60px -30px color-mix(in srgb, var(--n-black) 56%, transparent)" }}>
      <style>{`@keyframes nodal-spin-k { to { transform: rotate(360deg); } } .nodal-spin { animation: nodal-spin-k 1s linear infinite; }`}</style>

      {status.paused && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid color-mix(in srgb, var(--n-coral) 33%, transparent)", background: "color-mix(in srgb, var(--n-coral) 7%, transparent)", borderRadius: 12, padding: "10px 12px", marginBottom: 14 }}>
          <AlertTriangle size={16} color="var(--n-coral)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: 13, color: "var(--n-warm)" }}>Nodal is paused by its multisig. Trading is switched off until it's resumed.</p>
        </div>
      )}

      {/* You pay */}
      <div style={boxStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "var(--n-muted)" }}>You pay</span>
          {balance !== null && (
            <button
              onClick={() => setAmount(formatUnits(balance, fromToken.decimals))}
              title="Use full balance"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 11, color: "var(--n-faint)" }}
            >
              Balance: {fmtUnits(balance, fromToken.decimals)}
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            data-testid="amount-in"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d*\.?\d*$/.test(v)) {
                setAmount(v);
                setStage("idle");
                setTxErr("");
              }
            }}
            placeholder="0.00"
            style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, background: "transparent", border: "none", color: "var(--n-ink)", minWidth: 0, outline: "none" }}
          />
          <select data-testid="token-in" value={fromKey} onChange={(e) => { setFromKey(e.target.value); setStage("idle"); }} style={selectStyle} aria-label="Token to pay">
            {tokens.map((t) => (
              <option key={tokenKey(t)} value={tokenKey(t)}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
        <button onClick={flip} aria-label="Reverse the direction of the trade" style={{ background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--n-cyan)" }}>
          <ArrowDownUp size={16} strokeWidth={1.75} />
        </button>
      </div>

      {/* You receive */}
      <div style={boxStyle}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "var(--n-muted)" }}>You receive (after Nodal's fee)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span data-testid="amount-out" style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, color: quote ? "var(--n-ink)" : "var(--n-faint)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {quoting ? "…" : quote && toToken ? fmtUnits(quote.best.net, toToken.decimals) : "—"}
          </span>
          <select data-testid="token-out" value={toKey || ""} onChange={(e) => { setToKey(e.target.value); setStage("idle"); }} style={selectStyle} aria-label="Token to receive">
            {!toKey && <option value="">Select</option>}
            {tokens.map((t) => (
              <option key={tokenKey(t)} value={tokenKey(t)}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Slippage */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--n-muted)" }}>Max slippage</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {SLIPPAGE_PRESETS.map((bp) => (
            <button
              key={bp}
              onClick={() => { setSlipBp(bp); setCustomSlip(""); }}
              style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer", border: slipBp === bp && !customSlip ? "1px solid var(--n-cyan)" : "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", background: slipBp === bp && !customSlip ? "color-mix(in srgb, var(--n-cyan) 10%, transparent)" : "var(--n-raised)", color: slipBp === bp && !customSlip ? "var(--n-cyan)" : "var(--n-muted)" }}
            >
              {bp / 100}%
            </button>
          ))}
          <input
            value={customSlip}
            placeholder="custom"
            inputMode="decimal"
            aria-label="Custom slippage percent"
            onChange={(e) => {
              const v = e.target.value;
              setCustomSlip(v);
              const n = parseFloat(v);
              if (isFinite(n) && n > 0 && n <= 50) setSlipBp(Math.round(n * 100));
            }}
            style={{ width: 62, fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "5px 8px", borderRadius: 999, border: customSlip ? "1px solid var(--n-cyan)" : "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", background: "var(--n-raised)", color: "var(--n-ink)", outline: "none" }}
          />
        </div>
      </div>

      {/* Breakdown */}
      {quote && toToken && (
        <div data-testid="breakdown" style={{ marginTop: 14, border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 12, background: "var(--n-surface0)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label="Route" value={`${quote.best.name}${quote.path.length > 2 ? " (via BDAG)" : ""}`} />
          <Row label={`${quote.best.name} output`} value={`${fmtUnits(quote.best.gross, toToken.decimals)} ${toToken.symbol}`} />
          <Row label={`Nodal fee (${(status.feeBps / 100).toFixed(2)}%)`} value={`− ${fmtUnits(quote.best.fee, toToken.decimals)} ${toToken.symbol}`} muted />
          <div style={{ height: 1, background: "color-mix(in srgb, var(--n-white-ov) 8%, transparent)", margin: "2px 0" }} />
          <Row label="You receive" value={`${fmtUnits(quote.best.net, toToken.decimals)} ${toToken.symbol}`} bold />
          <Row label={`Minimum after ${slipBp / 100}% slippage`} value={`${fmtUnits(minNet, toToken.decimals)} ${toToken.symbol}`} />
          <Row
            label="Price impact"
            value={impact === null ? "n/a" : impact < 0.01 ? "< 0.01%" : `${impact.toFixed(2)}%`}
            color={impactLevel === "ok" ? "var(--n-cyan)" : impactLevel === "warn" ? "var(--n-amber)" : "var(--n-red)"}
          />
          {quote.all.length > 1 && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--n-dim2)" }}>Compared {quote.all.length} sources; showing the best net output.</p>
          )}
        </div>
      )}

      {(impactLevel === "warn" || impactLevel === "high") && !blocker && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: impactLevel === "high" ? "var(--n-red)" : "var(--n-amber)", display: "flex", gap: 6 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          {impactLevel === "high"
            ? "High price impact: this trade moves the pool price a lot, so you'll get noticeably less. A smaller amount gets a better rate."
            : "Moderate price impact for this size of trade."}
        </p>
      )}

      <button
        data-testid="swap-btn"
        onClick={onMainClick}
        disabled={mainDisabled}
        style={{
          width: "100%",
          marginTop: 18,
          padding: "13px 18px",
          borderRadius: 10,
          border: "none",
          background: mainDisabled ? "var(--n-line-strong)" : danger ? "linear-gradient(90deg, var(--n-red), var(--n-coral))" : "linear-gradient(90deg, var(--n-purple), var(--n-coral))",
          color: mainDisabled ? "var(--n-muted)" : "var(--n-bg)",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 15.5,
          cursor: mainDisabled ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {label}
      </button>

      {txErr && (
        <p data-testid="tx-error" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--n-red)", lineHeight: 1.5 }}>{txErr}</p>
      )}
      {lastTx && (
        <div data-testid="tx-done" style={{ marginTop: 12, fontSize: 13, color: "var(--n-green-soft)", display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}>
          <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {lastTx.summary}.{" "}
            <a href={`${CFG.explorer}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--n-cyan)" }}>
              View transaction <ExternalLink size={11} style={{ verticalAlign: -1 }} />
            </a>
          </span>
        </div>
      )}

      <p style={{ margin: "auto 0 0", paddingTop: 14, fontSize: 11.5, lineHeight: 1.55, color: "var(--n-faint)" }}>
        Trades go through NodalRouter ({short(CFG.router)}) in a single transaction: your tokens reach the DEX and the proceeds come straight back to your wallet, or the whole trade reverts. For ERC-20s you first approve exactly the amount you're swapping, never an unlimited allowance.
      </p>
    </div>
    <RouteDetails
      quote={quote}
      quoting={quoting}
      fromToken={fromToken}
      toToken={toToken}
      tokens={tokens}
      feeBps={status.feeBps}
      capNow={capNow}
      recent={recent}
    />
    </div>
  );
}

/* ---------------- Route details (right-hand panel) ---------------- */

const POOL_FEE_PCT = 0.3; // Reef: 0.30% per pool hop, already reflected in its quote

function RouteDetails({ quote, quoting, fromToken, toToken, tokens, feeBps, capNow, recent }) {
  const card = { background: "var(--n-surface)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 16, padding: "20px 22px" };
  const h = { margin: "0 0 10px", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 0.4, color: "var(--n-muted)", textTransform: "uppercase" };
  const note = { margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--n-dim2)" };
  const sym = (a) => {
    if (lc(a) === lc(CFG.wbdag)) return "BDAG";
    const t = tokens.find((x) => x.address && lc(x.address) === lc(a));
    return t ? t.symbol : short(a);
  };
  const hops = quote ? quote.path.length - 1 : 1;
  const cap = quote ? quote.cap : capNow;

  return (
    <div className="nodal-scope" data-testid="route-details" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={card}>
        <h3 style={h}>Sources checked</h3>
        {quote && toToken ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {quote.all.map((q, i) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: i === 0 ? "color-mix(in srgb, var(--n-cyan) 7%, transparent)" : "var(--n-surface0)", border: i === 0 ? "1px solid color-mix(in srgb, var(--n-cyan) 33%, transparent)" : "1px solid color-mix(in srgb, var(--n-white-ov) 6%, transparent)" }}>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--n-ink)", fontWeight: 600 }}>{q.name}</span>
                  {i === 0 && <span style={{ fontSize: 10.5, fontFamily: "'Space Mono', monospace", color: "var(--n-cyan)", border: "1px solid color-mix(in srgb, var(--n-cyan) 33%, transparent)", borderRadius: 999, padding: "1px 7px" }}>BEST</span>}
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12.5, color: "var(--n-ink)" }}>{fmtUnits(q.net, toToken.decimals)} {toToken.symbol}</span>
                </div>
              ))}
            </div>
            {quote.all.length === 1 && (
              <p style={note}>Only one source is live today ({quote.all[0].name}, built by the same team as Nodal), so there is nothing to compare yet. Every new DEX that is added appears here automatically.</p>
            )}
          </>
        ) : (
          <p style={{ ...note, marginTop: 0 }}>
            {quoting ? "Asking every source for a quote…" : "Enter an amount and Nodal asks every registered source for a quote, then routes your trade through the one that pays you the most. Today that's one source: Reef."}
          </p>
        )}
      </div>

      <div style={card}>
        <h3 style={h}>Route and fees</h3>
        {quote && toToken ? (
          <>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {quote.path.map((a, i) => (
                <React.Fragment key={a + i}>
                  {i > 0 && <span style={{ color: "var(--n-faint)" }}>→</span>}
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, color: "var(--n-cyan)", background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: 999, padding: "4px 10px" }}>{sym(a)}</span>
                </React.Fragment>
              ))}
              <span style={{ fontSize: 12, color: "var(--n-dim2)", marginLeft: 4 }}>{hops === 1 ? "direct pool" : `via BDAG, ${hops} pools`}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Row label={`${quote.best.name} pool fee (${POOL_FEE_PCT.toFixed(2)}%${hops > 1 ? ` × ${hops}` : ""})`} value="included in quote" />
              <Row label={`Nodal fee (${(feeBps / 100).toFixed(2)}%)`} value={`${fmtUnits(quote.best.fee, toToken.decimals)} ${toToken.symbol}`} />
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <Row label="Pool fee (Reef)" value={`${POOL_FEE_PCT.toFixed(2)}% per pool`} />
            <Row label="Nodal routing fee" value={`${(feeBps / 100).toFixed(2)}% of output`} />
            <p style={{ ...note, marginTop: 2 }}>Pairs without a direct pool route through BDAG, which means two pools and two pool fees. Both fees are shown before you confirm.</p>
          </div>
        )}
        <div style={{ height: 1, background: "color-mix(in srgb, var(--n-white-ov) 6%, transparent)", margin: "12px 0" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <Row
          label={`Beta limit per trade (${fromToken.symbol})`}
          value={cap === null || cap === undefined ? "…" : cap === 0n ? "no limit" : `${fmtUnits(cap, fromToken.decimals)} ${fromToken.symbol}`}
        />
        {quote && cap > 0n && (
          <Row label="This trade uses" value={(() => { const pct = Math.min(100, Number((quote.amountIn * 10000n) / cap) / 100); return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}% of the limit`; })()} />
        )}
        </div>
      </div>

      <div style={{ ...card, flex: 1 }}>
        <h3 style={h}>Recent trades through Nodal</h3>
        {recent.state === "loading" && <p style={{ ...note, marginTop: 0 }}>Reading the chain…</p>}
        {recent.state === "error" && <p style={{ ...note, marginTop: 0 }}>Couldn't load recent trades from the RPC just now.</p>}
        {recent.state === "ok" && recent.items.length === 0 && <p style={{ ...note, marginTop: 0 }}>No trades yet.</p>}
        {recent.state === "ok" && recent.items.length > 0 && (
          <div data-testid="recent-trades" style={{ display: "flex", flexDirection: "column" }}>
            {recent.items.map((t, i) => (
              <a key={t.hash + i} href={`${CFG.explorer}/tx/${t.hash}`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid color-mix(in srgb, var(--n-white-ov) 5%, transparent)" : "none", textDecoration: "none" }}>
                <span style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 12, color: "var(--n-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
                <span style={{ fontSize: 11.5, color: "var(--n-dim2)", whiteSpace: "nowrap" }}>via {t.source} · {timeAgo(t.time)}</span>
                <ExternalLink size={12} color="var(--n-faint)" style={{ flexShrink: 0 }} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, muted, bold, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 13, color: muted ? "var(--n-dim2)" : "var(--n-muted)" }}>{label}</span>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 400, color: color || (bold ? "var(--n-ink)" : muted ? "var(--n-coral)" : "var(--n-ink)"), textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
