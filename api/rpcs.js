// GET /api/rpcs: the live BlockDAG RPC list, shared by nodaldex.fyi, handshakeotc.fyi and reefdex.fyi.
// Proxies bdag.community's node board (which doesn't send CORS headers) and filters it.
// Cached at Vercel's edge for 2 minutes. Every site keeps a built-in list to fall back on.
import { toRpcList } from "./_rpcList.js";

const SOURCE = "https://bdag.community/api/nodes";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const upstream = await fetch(SOURCE, {
      headers: { accept: "application/json", "user-agent": "nodaldex.fyi rpc-list" },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error("node board returned " + upstream.status);
    const list = toRpcList(await upstream.json());
    if (!list.rpcs.some((r) => r.usable)) throw new Error("node board lists no usable RPCs");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(list);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
}
