// GET /api/rpcs: the live BlockDAG RPC list, shared by nodaldex.fyi, handshakeotc.fyi and reefdex.fyi.
// Proxies bdag.community's node board (which doesn't send CORS headers) and filters it, and puts
// the community gateway (rpc.community.bdag-us.org) first when its status file says it is healthy.
// Cached at Vercel's edge for 2 minutes. Every site keeps a built-in list to fall back on.
import { toRpcList, withGateway, GATEWAY_STATUS_URL } from "./_rpcList.js";

const SOURCE = "https://bdag.community/api/nodes";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const [boardRes, gwRes] = await Promise.allSettled([
      fetch(SOURCE, {
        headers: { accept: "application/json", "user-agent": "nodaldex.fyi rpc-list" },
        signal: AbortSignal.timeout(8000),
      }).then(async (r) => {
        if (!r.ok) throw new Error("node board returned " + r.status);
        return toRpcList(await r.json());
      }),
      fetch(GATEWAY_STATUS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) })
        .then((r) => (r.ok ? r.json() : null)),
    ]);
    const board = boardRes.status === "fulfilled" ? boardRes.value : null;
    const gwStatus = gwRes.status === "fulfilled" ? gwRes.value : null;
    const list = withGateway(board, gwStatus);
    if (!list.rpcs.some((r) => r.usable)) {
      throw new Error(boardRes.status === "rejected" ? String(boardRes.reason && boardRes.reason.message || boardRes.reason) : "node board lists no usable RPCs");
    }
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(list);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
}
