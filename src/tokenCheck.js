// Pre-sign token check, the same checks Reef runs before its swap button (reefdex.fyi, index.html):
// verified code or made by The Kitchen, admin powers, transfer tax, LP lock, and whether several
// independent BlockDAG nodes agree on the pool's state. Read live; nothing is stored.
// A "bad" finding makes Nodal's swap button ask for a second tap, the same way high price impact does.
import { Contract, Interface, ZeroAddress } from "ethers";

const REEF_PAIR_API = "https://reefdex.fyi/api/v1/pairs/"; // CORS open; 404 = no BDAG pool on Reef
const EXPLORER_API = "https://explorer.east.bdag-us.org/api/v2";

const KITCHEN_FACTORIES = [
  { addr: "0xF30f5E4f46AcAE803815B82CfEC5CD8Fc77eF394", name: "The Kitchen v2" },
  { addr: "0x0E331686ee029EfafFC3a5cFda0ee3c7006F8A98", name: "The Kitchen v1" },
];
const ERC20_STANDARD_FNS = new Set(["approve", "transfer", "transferFrom", "increaseAllowance", "decreaseAllowance", "permit", "burn", "burnFrom", "delegate", "delegateBySig"]);
const RISKY_FNS = /^(mint|_?mint|pause|unpause|blacklist|addToBlacklist|setBlacklist|block|setBot|setBots|setFee|setFees|setTax|setTaxes|updateFees|setMaxTx|setMaxWallet|setMaxTransaction|enableTrading|setTrading|excludeFrom|setExcluded|setRouter|setPair|upgradeTo|upgradeToAndCall|setImplementation|rescue|withdraw|setOwner|transferOwnership)/i;
const BURN_ADDRS = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const TAX_GETTERS = ["taxFee", "_taxFee", "buyTax", "sellTax", "_buyTax", "_sellTax", "buyFee", "sellFee", "transferTax",
  "transferFee", "totalFees", "buyTotalFees", "sellTotalFees", "_liquidityFee", "liquidityFee", "marketingFee", "taxRate", "feePercent"];
// Reef's own token and its launches, checked by hand (same list as Reef).
const TAX_IFACE = new Interface(TAX_GETTERS.map((n) => `function ${n}() view returns (uint256)`));
const NO_TAX = new Set(["0xb7a1e198767bf0fd4c1c3805b9757369e1c3f416", "0x17aee3eeda0d12e3a6a9a6078d028b88f9c91752", "0xd95c548b144682f4ef49728944505d8506861b1b"]);

const getJsonT = (u, ms = 8000) =>
  fetch(u, { signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error("HTTP " + r.status))));

async function nodeCall(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

// Each node reports the hash of the same recent block and the pool's reserves at it. Up to three that answer are compared.
export async function nodesAgree(pair, urls) {
  const heads = await Promise.all(urls.map((u) => nodeCall(u, "eth_blockNumber", []).then((h) => ({ u, h: parseInt(h, 16) })).catch(() => null)));
  const live = heads.filter(Boolean);
  if (live.length < 2) return null;
  const target = Math.max(...live.map((x) => x.h)) - 5;
  const at = "0x" + target.toString(16);
  const views = await Promise.all(
    live.filter((x) => x.h >= target).map(async ({ u }) => {
      try {
        const [b, r] = await Promise.all([nodeCall(u, "eth_getBlockByNumber", [at, false]), nodeCall(u, "eth_call", [{ to: pair, data: "0x0902f1ac" }, at])]);
        return b && b.hash && r ? b.hash + ":" + r.slice(0, 130) : null;
      } catch {
        return null;
      }
    })
  );
  const got = views.filter(Boolean).slice(0, 3);
  if (got.length < 2) return null;
  const counts = {};
  for (const v of got) counts[v] = (counts[v] || 0) + 1;
  return { agree: Math.max(...Object.values(counts)), of: got.length };
}

async function taxCheck(ro, a) {
  if (NO_TAX.has(a)) return null;
  const hits = await Promise.all(
    TAX_GETTERS.map(async (n) => {
      try {
        const r = await ro.call({ to: a, data: TAX_IFACE.encodeFunctionData(n) });
        if (!r || r === "0x" || r.length !== 66) return null;
        const v = BigInt(r);
        return v > 0n && v < 10n ** 6n ? { name: n, value: v } : null; // fee settings are small numbers
      } catch {
        return null;
      }
    })
  );
  return hits.find(Boolean) || null;
}

/** Returns { items: [[status, text]], partial } where status is ok | warn | bad | na. */
export async function runTokenCheck({ token, ro, rpcUrls, factory, wbdag }) {
  const a = token.address;
  const al = a.toLowerCase();
  const [pool, sc, tax] = await Promise.all([
    getJsonT(REEF_PAIR_API + al, 15000).catch(() => getJsonT(REEF_PAIR_API + al, 15000)).catch(() => undefined),
    getJsonT(`${EXPLORER_API}/smart-contracts/${a}`, 10000).catch(() => getJsonT(`${EXPLORER_API}/smart-contracts/${a}`, 15000)).catch(() => undefined),
    taxCheck(ro, al).catch(() => undefined),
  ]);
  let kitchen = null;
  for (const k of KITCHEN_FACTORIES) {
    try {
      const r = await ro.call({ to: k.addr, data: "0x5819ad16" + al.slice(2).padStart(64, "0") });
      if (r && r !== "0x" && BigInt(r) === 1n) {
        kitchen = k;
        break;
      }
    } catch {
      /* not a Kitchen factory answer */
    }
  }
  const items = [];

  // Code and admin powers
  const verified = sc === undefined ? null : !!(sc && sc.is_verified);
  if (kitchen && !verified) {
    items.push(["ok", `Made by ${kitchen.name}: standard verified token code`]);
    items.push(["ok", "No mint, pause, blocklist or fee functions"]);
  } else if (verified === null) {
    items.push(["na", "Source code: the explorer didn't answer"]);
  } else if (!verified) {
    items.push(["bad", "Source code not verified: nobody can check what it does"]);
  } else {
    const abi = sc.abi || [];
    const writes = abi.filter((x) => x.type === "function" && x.stateMutability !== "view" && x.stateMutability !== "pure").map((x) => x.name);
    const extra = writes.filter((n) => !ERC20_STANDARD_FNS.has(n));
    const risky = [...new Set(extra.filter((n) => RISKY_FNS.test(n) && !/^renounce/i.test(n)))];
    let owner = null;
    if (abi.some((x) => x.name === "owner" && x.type === "function")) {
      try {
        const r = await ro.call({ to: a, data: "0x8da5cb5b" });
        if (r && r.length === 66) owner = "0x" + r.slice(26);
      } catch {
        /* no owner */
      }
    }
    const renounced = owner && BURN_ADDRS.has(owner.toLowerCase());
    items.push(["ok", "Source code verified"]);
    if (!risky.length) items.push(["ok", extra.length ? "No mint, pause, blocklist or fee functions" : "Plain token: no admin functions"]);
    else if (renounced) items.push(["ok", `Admin functions (${risky.slice(0, 3).join(", ")}${risky.length > 3 ? "…" : ""}), but ownership renounced`]);
    else items.push(["warn", `Owner can call: ${risky.slice(0, 4).join(", ")}${risky.length > 4 ? "…" : ""}`]);
  }

  // Transfer tax
  if (tax === undefined) items.push(["na", "Transfer tax: couldn't check"]);
  else if (tax) items.push(["bad", `Transfer tax setting found (${tax.name}): you may get less than quoted, and selling can fail`]);
  else items.push(["ok", "Transfer tax 0% (no fee settings found)"]);

  // LP lock on the token's BDAG pool on Reef
  let pair = pool && pool.pair;
  if (pool && pool.token) {
    const pctL = Number(pool.lpLockedOrBurnedPct || 0);
    const lockers = (pool.lpHolders || []).filter((h) => !BURN_ADDRS.has(String(h.address).toLowerCase()) && h.pct > 0.01);
    const dates = await Promise.all(
      lockers.map(async (h) => {
        if (h.until) return Number(h.until);
        try {
          const r = await ro.call({ to: h.address, data: "0x251c1aa3" }); // unlockTime()
          return r && r.length === 66 ? Number(BigInt(r)) : null;
        } catch {
          return null;
        }
      })
    );
    const until = dates.filter((d) => d && d > Date.now() / 1000).sort((x, y) => x - y)[0];
    const day = until ? new Date(until * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
    const pctTxt = pctL >= 10 ? pctL.toFixed(0) : pctL.toFixed(1);
    if (pctL >= 50) items.push(["ok", `LP ${pctTxt}% locked or burned${day ? `, first unlock ${day}` : ""}`]);
    else if (pctL > 0) items.push(["warn", `Only ${pctTxt}% of the LP locked or burned: the rest can be pulled`]);
    else items.push(["bad", "LP not locked: the liquidity can be removed at any time"]);
  } else if (pool === null) {
    items.push(["na", "No BDAG pool on Reef, so no LP lock to check"]);
  } else {
    items.push(["na", "LP lock: couldn't check just now (full report has it)"]);
  }

  // Several nodes agree on the pool
  if (!pair && factory) {
    try {
      const f = new Contract(factory, ["function getPair(address,address) view returns (address)"], ro);
      const pa = await f.getPair(a, wbdag);
      if (pa && pa !== ZeroAddress) pair = pa;
    } catch {
      /* no pool */
    }
  }
  if (pair) {
    const n = await nodesAgree(pair, rpcUrls).catch(() => null);
    if (!n) items.push(["na", "Couldn't reach enough nodes to compare the pool"]);
    else if (n.agree === n.of) items.push(["ok", `${n.agree} of ${n.of} nodes agree on this pool`]);
    else items.push(["bad", `Nodes disagree on this pool (${n.agree} of ${n.of} match): wait before trading`]);
  }
  return { items, partial: items.some((x) => x[0] === "na") };
}

// Partial results are kept 15 s (so a retry happens soon), full results 2 minutes.
const cache = new Map();
export function tokenCheckFor(args) {
  const k = args.token.address.toLowerCase();
  const c = cache.get(k);
  if (c && Date.now() - c.at < (c.partial ? 15000 : 120000)) return c.v;
  const v = runTokenCheck(args);
  const entry = { at: Date.now(), v, partial: false };
  cache.set(k, entry);
  v.then((r) => { entry.partial = !!r.partial; }, () => cache.delete(k));
  return v;
}

export const worstOf = (items) => (items.some((x) => x[0] === "bad") ? "bad" : items.some((x) => x[0] === "warn") ? "warn" : "ok");
