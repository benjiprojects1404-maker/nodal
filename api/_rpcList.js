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
