// Turns bdag.community's public node board (https://bdag.community/api/nodes) into the
// RPC list the Nodal, Handshake and Reef sites use. Kept separate from the handler so it
// can be tested on its own.
//
// Only nodes the board lists as "canonical" or "community" are included; nodes it flags
// (the bdagscan fork, the retired blockdag.works) go into `excluded` with the reason.
// `usable` means: the board's own server-side check found it on chain 1404, near the
// agreed head, with matching recent block hashes. Sites only connect through usable nodes.

const MAX_HEAD_DELTA = 30; // blocks behind the agreed head before we stop routing reads to it
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PATH_RE = /^\/[A-Za-z0-9/_-]*$/;
// Hosts whose responses carry no CORS headers for browser requests (seen failing in DevTools on
// reefdex.fyi and handshakeotc.fyi, ~600 ms wasted per page load). They stay in the list but go last.
const BROWSER_LAST = new Set(["rpc.blockdag.engineering"]);

export function toRpcList(board) {
  if (!board || !Array.isArray(board.definitions) || !Array.isArray(board.nodes)) {
    throw new Error("unexpected node board format");
  }
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const rpcs = [];
  const excluded = [];

  for (const d of board.definitions) {
    if (!d || typeof d.host !== "string" || !HOST_RE.test(d.host)) continue;
    const path = typeof d.probePath === "string" && PATH_RE.test(d.probePath) ? d.probePath : "/";
    const url = "https://" + d.host.toLowerCase() + (path === "/" ? "" : path);
    const n = byId.get(d.id) || {};
    const label = String(d.name || d.host).slice(0, 80);

    if (d.role !== "canonical" && d.role !== "community") {
      excluded.push({ name: label, reason: d.role === "flagged" ? "fork" : d.role === "legacy" ? "retired" : String(d.role) });
      continue;
    }

    let status;
    if (n.verdict === "canonical") status = "ok";
    else if (n.verdict === "offline" || n.verdict == null) status = "offline";
    else if (n.verdict === "diverged") status = "fork";
    else status = String(n.verdict).slice(0, 20);

    const hashesOk = n.hashChecked == null || (n.hashChecked > 0 && n.hashMatched === n.hashChecked);
    const usable =
      status === "ok" &&
      n.chainId === 1404 &&
      hashesOk &&
      typeof n.headDelta === "number" &&
      n.headDelta <= MAX_HEAD_DELTA;

    if (status === "ok" && !usable) {
      const behind = typeof n.headDelta !== "number" || n.headDelta > MAX_HEAD_DELTA;
      status = behind ? "behind" : hashesOk ? "behind" : "mismatch";
    }

    rpcs.push({
      name: label,
      url,
      blurb: typeof d.blurb === "string" ? d.blurb.slice(0, 160) : "",
      canonical: d.role === "canonical",
      status,
      usable,
      latencyMs: typeof n.latencyMs === "number" ? n.latencyMs : null,
      headDelta: typeof n.headDelta === "number" ? n.headDelta : null,
    });
  }

  // Usable nodes that answer browsers first (canonical, then by the board's latency), then the rest.
  const lateHost = (r) => BROWSER_LAST.has(new URL(r.url).hostname) ? 1 : 0;
  rpcs.sort((a, b) =>
    (lateHost(a) - lateHost(b)) ||
    (b.canonical - a.canonical) ||
    (b.usable - a.usable) ||
    ((a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9))
  );

  return {
    source: "https://bdag.community/chain#nodes",
    checkedAt: typeof board.checkedAt === "string" ? board.checkedAt : null,
    rpcs,
    excluded,
  };
}

// The community gateway (rpc.community.bdag-us.org) load-balances across the community node list
// and only routes to nodes on chain 1404 that are at most a few blocks behind. When its status
// file says it's healthy it goes first; the individual nodes stay behind it as fallbacks.
export const GATEWAY_URL = "https://rpc.community.bdag-us.org";
export const GATEWAY_STATUS_URL = GATEWAY_URL + "/status.json";

export function withGateway(list, status) {
  const base = list || { source: "https://bdag.community/chain#nodes", checkedAt: null, rpcs: [], excluded: [] };
  const healthy = status && status.chain_id === 1404 && typeof status.healthy === "number" ? status.healthy : 0;
  const gateway = {
    name: "BDAG Community RPC",
    url: GATEWAY_URL,
    blurb: "Load-balanced community gateway: routes each request to a healthy, up-to-date node.",
    canonical: false,
    status: healthy > 0 ? "ok" : "offline",
    usable: healthy > 0,
    latencyMs: null,
    headDelta: healthy > 0 ? 0 : null,
  };
  const rest = base.rpcs.filter((r) => r.url !== GATEWAY_URL);
  return { ...base, rpcs: gateway.usable ? [gateway, ...rest] : [...rest, gateway] };
}

// Can a web page actually use this RPC? The node board checks nodes from a server, where CORS
// doesn't apply, so a node can look healthy there and still fail in every browser: e.g.
// rpc.east/west.bdag-us.org answer with two Access-Control-Allow-Origin values
// ("https://site, *"), which browsers reject. This repeats the browser's checks from the server:
// the preflight (OPTIONS) and the real POST must each carry exactly one allowed origin.
export const BROWSER_ORIGIN = "https://www.nodaldex.fyi";
const originOk = (v, origin) => typeof v === "string" && (v.trim() === "*" || v.trim() === origin);
const headersOk = (v) => typeof v === "string" && (v.trim() === "*" || v.toLowerCase().split(",").map((x) => x.trim()).includes("content-type"));

export async function browserCheck(url, fetchImpl = fetch, origin = BROWSER_ORIGIN, timeoutMs = 2500) {
  try {
    const pre = await fetchImpl(url, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!originOk(pre.headers.get("access-control-allow-origin"), origin)) return false;
    // A JSON POST sends a content-type header browsers don't allow by default, so the preflight must allow it.
    if (!headersOk(pre.headers.get("access-control-allow-headers"))) return false;
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok && originOk(r.headers.get("access-control-allow-origin"), origin);
  } catch (e) {
    return false;
  }
}

// Marks nodes browsers can't use: not usable (sites skip them) and last in the list.
// Nodes the board already marks unusable aren't probed.
export async function withBrowserCheck(list, check = browserCheck) {
  const results = await Promise.all(list.rpcs.map((r) => (r.usable ? check(r.url) : Promise.resolve(null))));
  const rpcs = list.rpcs.map((r, i) => (results[i] === false ? { ...r, usable: false, status: "no browser access", browserOk: false }
    : results[i] === true ? { ...r, browserOk: true } : r));
  // If every node failed, the probe itself was probably blocked (not every node broken): keep the list as it was.
  if (!rpcs.some((r) => r.usable)) return list;
  const rank = (r) => (r.browserOk === false ? 1 : 0);
  return { ...list, rpcs: rpcs.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r) };
}
