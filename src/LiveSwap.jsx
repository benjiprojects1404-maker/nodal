import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserProvider, Contract, Interface, JsonRpcProvider, ZeroAddress, decodeBytes32String, formatUnits, getAddress, parseUnits } from "ethers";
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
  rpcs: env.VITE_RPC_URL
    ? [env.VITE_RPC_URL]
    : [
        "https://rpc.blockdag.engineering/",
        "https://rpc.welshdag.trade/",
        "https://rpc.bdagexplorer.com/",
        "https://rpc.cms-mining-pool.net/",
        "https://rpc.dvdmining.com/",
        "https://rpc.capedag.com/",
        "https://rpc.east.bdag-us.org/",
        "https://rpc.west.bdag-us.org/",
        "https://rms-bdag-rpc.de/api/rpc-live",
      ],
  router: env.VITE_NODAL_ROUTER || "0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672",
  // Token discovery and path finding use Reef's factory, since Reef is the live source.
  // When a second DEX is registered, extend discovery to its factory too.
  factory: env.VITE_REEF_FACTORY || "0x9603042044b6B1A1637c508F731ba01219142239",
  wbdag: env.VITE_WBDAG || "0x62ba5c4F067989a7f6644488C875bEa69Bfa1FBA",
  explorer: env.VITE_EXPLORER || "https://explorer.bdagexplorer.com",
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
  for (const url of CFG.rpcs) {
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
        const [list, paused, feeBps] = await Promise.all([discoverTokens(ro), router.paused(), router.feeBps()]);
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

  const selectStyle = { fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: 999, padding: "7px 14px", color: "#3FD9EA", cursor: "pointer", maxWidth: 140 };
  const boxStyle = { border: "1px solid #FFFFFF14", borderRadius: 12, background: "#0E1420", padding: "12px 14px" };

  return (
    <div className="nodal-scope nodal-panel" data-testid="live-swap" style={{ maxWidth: 480, background: "#121826", border: "1px solid #FFFFFF14", borderRadius: 16, padding: "24px 24px 22px", boxShadow: "0 30px 60px -30px #00000090" }}>
      <style>{`@keyframes nodal-spin-k { to { transform: rotate(360deg); } } .nodal-spin { animation: nodal-spin-k 1s linear infinite; }`}</style>

      {status.paused && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid #FF826655", background: "#FF826612", borderRadius: 12, padding: "10px 12px", marginBottom: 14 }}>
          <AlertTriangle size={16} color="#FF8266" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: 13, color: "#D8B8AA" }}>Nodal is paused by its multisig. Trading is switched off until it's resumed.</p>
        </div>
      )}

      {/* You pay */}
      <div style={boxStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "#8B93A7" }}>You pay</span>
          {balance !== null && (
            <button
              onClick={() => setAmount(formatUnits(balance, fromToken.decimals))}
              title="Use full balance"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#5A6478" }}
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
            style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, background: "transparent", border: "none", color: "#F4F6FB", minWidth: 0, outline: "none" }}
          />
          <select data-testid="token-in" value={fromKey} onChange={(e) => { setFromKey(e.target.value); setStage("idle"); }} style={selectStyle} aria-label="Token to pay">
            {tokens.map((t) => (
              <option key={tokenKey(t)} value={tokenKey(t)}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
        <button onClick={flip} aria-label="Reverse the direction of the trade" style={{ background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3FD9EA" }}>
          <ArrowDownUp size={16} strokeWidth={1.75} />
        </button>
      </div>

      {/* You receive */}
      <div style={boxStyle}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "#8B93A7" }}>You receive (after Nodal's fee)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span data-testid="amount-out" style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, color: quote ? "#F4F6FB" : "#5A6478", overflow: "hidden", textOverflow: "ellipsis" }}>
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
        <span style={{ fontSize: 13, color: "#8B93A7" }}>Max slippage</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {SLIPPAGE_PRESETS.map((bp) => (
            <button
              key={bp}
              onClick={() => { setSlipBp(bp); setCustomSlip(""); }}
              style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer", border: slipBp === bp && !customSlip ? "1px solid #3FD9EA" : "1px solid #FFFFFF1A", background: slipBp === bp && !customSlip ? "#3FD9EA1A" : "#171F30", color: slipBp === bp && !customSlip ? "#3FD9EA" : "#8B93A7" }}
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
            style={{ width: 62, fontFamily: "'Space Mono', monospace", fontSize: 12, padding: "5px 8px", borderRadius: 999, border: customSlip ? "1px solid #3FD9EA" : "1px solid #FFFFFF1A", background: "#171F30", color: "#F4F6FB", outline: "none" }}
          />
        </div>
      </div>

      {/* Breakdown */}
      {quote && toToken && (
        <div data-testid="breakdown" style={{ marginTop: 14, border: "1px solid #FFFFFF14", borderRadius: 12, background: "#0E1420", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label="Route" value={`${quote.best.name}${quote.path.length > 2 ? " (via BDAG)" : ""}`} />
          <Row label={`${quote.best.name} output`} value={`${fmtUnits(quote.best.gross, toToken.decimals)} ${toToken.symbol}`} />
          <Row label={`Nodal fee (${(status.feeBps / 100).toFixed(2)}%)`} value={`− ${fmtUnits(quote.best.fee, toToken.decimals)} ${toToken.symbol}`} muted />
          <div style={{ height: 1, background: "#FFFFFF14", margin: "2px 0" }} />
          <Row label="You receive" value={`${fmtUnits(quote.best.net, toToken.decimals)} ${toToken.symbol}`} bold />
          <Row label={`Minimum after ${slipBp / 100}% slippage`} value={`${fmtUnits(minNet, toToken.decimals)} ${toToken.symbol}`} />
          <Row
            label="Price impact"
            value={impact === null ? "n/a" : impact < 0.01 ? "< 0.01%" : `${impact.toFixed(2)}%`}
            color={impactLevel === "ok" ? "#3FD9EA" : impactLevel === "warn" ? "#F2B84B" : "#FF6B6B"}
          />
          {quote.all.length > 1 && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B7488" }}>Compared {quote.all.length} sources; showing the best net output.</p>
          )}
        </div>
      )}

      {(impactLevel === "warn" || impactLevel === "high") && !blocker && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: impactLevel === "high" ? "#FF8A8A" : "#F2B84B", display: "flex", gap: 6 }}>
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
          background: mainDisabled ? "#2A3245" : danger ? "linear-gradient(90deg, #E5484D, #FF8266)" : "linear-gradient(90deg, #A64CF0, #FF8266)",
          color: mainDisabled ? "#8B93A7" : "#0A0E17",
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
        <p data-testid="tx-error" style={{ margin: "12px 0 0", fontSize: 13, color: "#FF8A8A", lineHeight: 1.5 }}>{txErr}</p>
      )}
      {lastTx && (
        <div data-testid="tx-done" style={{ marginTop: 12, fontSize: 13, color: "#9FE8C9", display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}>
          <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {lastTx.summary}.{" "}
            <a href={`${CFG.explorer}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#3FD9EA" }}>
              View transaction <ExternalLink size={11} style={{ verticalAlign: -1 }} />
            </a>
          </span>
        </div>
      )}

      <p style={{ margin: "14px 0 0", fontSize: 11.5, lineHeight: 1.55, color: "#5A6478" }}>
        Trades go through NodalRouter ({short(CFG.router)}) in a single transaction: your tokens reach the DEX and the proceeds come straight back to your wallet, or the whole trade reverts. For ERC-20s you first approve exactly the amount you're swapping, never an unlimited allowance.
      </p>
    </div>
  );
}

function Row({ label, value, muted, bold, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 13, color: muted ? "#6B7488" : "#8B93A7" }}>{label}</span>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 400, color: color || (bold ? "#F4F6FB" : muted ? "#FF8266" : "#F4F6FB"), textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
