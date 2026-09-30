// Live RPC list for chain 1404, from /api/rpcs (which follows bdag.community's node board).
// If that can't be loaded (local dev, outage), everything falls back to FALLBACK_RPCS.

export const RPC_REGISTRY_URL = "/api/rpcs";

// Built-in list: used when the live list can't be loaded, and for the "add network" wallet prompt.
// Last reviewed 1 Oct 2026 against bdag.community/chain#nodes.
export const FALLBACK_RPCS = [
  "https://rpc.blockdag.engineering",
  "https://rpc.capedag.com",
  "https://rms-bdag-rpc.de/api/rpc-live",
  "https://rpc.dvdmining.com",
  "https://rpc.cms-mining-pool.net",
  "https://rpc.england.bdag-us.org",
  "https://rpc.dagcore.net",
  "https://rpc.escrowhubs.io",
  "https://rpc.brazil.bdag-us.org",
  "https://rpc.bdagexplorer.com",
];

let _pending = null;

function isValidList(j) {
  return j && Array.isArray(j.rpcs) && j.rpcs.every((r) => r && typeof r.url === "string" && r.url.startsWith("https://"));
}

/** Resolves to the live list ({ rpcs, excluded, checkedAt, source }) or null if unavailable. */
export function loadRpcRegistry({ refresh = false } = {}) {
  if (_pending && !refresh) return _pending;
  _pending = (async () => {
    try {
      const res = await Promise.race([
        fetch(RPC_REGISTRY_URL, { headers: { accept: "application/json" } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);
      if (!res.ok) return null;
      const j = await res.json();
      return isValidList(j) ? j : null;
    } catch {
      return null;
    }
  })();
  return _pending;
}

/** URLs to use for reads, best first: usable live nodes, or the built-in list. */
export async function getReadRpcs() {
  const reg = await loadRpcRegistry();
  const live = reg ? reg.rpcs.filter((r) => r.usable).map((r) => r.url) : [];
  return live.length ? live : FALLBACK_RPCS;
}
