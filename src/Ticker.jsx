// "Trading now": every Reef pool's price in BDAG and its 24h change, as an auto-scrolling strip.
// Data: reefdex.fyi/api/v1/tickers (each pool's price now and 24h ago, read from its own on-chain events; no price
// feed, no dollar values). Tapping a chip fills Nodal's swap form with BDAG -> that token.
import { useEffect, useRef, useState } from "react";

const TICKERS_API = "https://reefdex.fyi/api/v1/tickers";

const hue = (addr) => parseInt(String(addr).slice(2, 8), 16) % 360;

export function fmtTickPrice(v) {
  if (v === null || v === undefined || !isFinite(v) || v <= 0) return "–";
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e8 ? 0 : 2).replace(/\.?0+$/, "") + "M";
  if (v >= 1000) return (v / 1000).toFixed(v >= 1e5 ? 0 : 2).replace(/\.?0+$/, "") + "K";
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 1 : 3 });
  const z = Math.floor(-Math.log10(v)); // zeros after the decimal point
  const digits = Math.round(v * 10 ** (z + 3)).toString().slice(0, 3).replace(/0+$/, "") || "0";
  return z >= 4 ? { zeros: z, digits } : "0." + "0".repeat(z) + digits;
}

function Price({ v }) {
  const p = fmtTickPrice(v);
  return <span className="n-tk-px">{typeof p === "string" ? p : <>0.0<sub>{p.zeros}</sub>{p.digits}</>}</span>;
}

function Chip({ t, hidden }) {
  const c = t.change24hPct;
  const cls = c === null ? "flat" : c > 0.05 ? "up" : c < -0.05 ? "down" : "flat";
  const chg = c === null ? "–" : (cls === "up" ? "▲ " : cls === "down" ? "▼ " : "") + Math.abs(c).toFixed(Math.abs(c) >= 100 ? 0 : 2) + "%";
  const h = hue(t.token);
  const pick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("nodal-pick", { detail: { from: "BDAG", to: t.token } }));
    document.getElementById("app")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <a className="n-tk-chip" href={`/?from=BDAG&to=${encodeURIComponent(t.token)}#app`} onClick={pick}
      aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}
      title={`${t.name || t.symbol}: ${t.swaps24h} swaps on Reef in 24h`}>
      <span className="n-tk-dot" style={{ background: `radial-gradient(circle at 50% 22%,hsl(${h} 85% 85%),hsl(${h} 62% 48%) 62%,hsl(${h} 70% 16%))` }}>
        {(t.symbol || "?").slice(0, 1)}
      </span>
      <span className="n-tk-sym">{t.symbol}</span>
      {t.newPool && <span className="n-tk-new">NEW</span>}
      <Price v={t.priceBDAG} />
      <span className={`n-tk-chg ${cls}`}>{chg}</span>
    </a>
  );
}

export default function Ticker() {
  const [list, setList] = useState(null);
  const rail = useRef(null);
  const hold = useRef(0);
  const reduced = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    let alive = true, tries = 0, got = false;
    const load = async () => {
      try {
        const r = await fetch(TICKERS_API, { signal: AbortSignal.timeout(15000) });
        const d = r.ok ? await r.json() : null;
        if (!alive) return;
        if (!d || !Array.isArray(d.tickers)) throw new Error("no data");
        // Busiest first (24h volume), then the deepest pools.
        const l = d.tickers.filter((t) => t.priceBDAG > 0)
          .sort((a, b) => (Number(b.volume24hBDAG) - Number(a.volume24hBDAG)) || (Number(b.liquidityBDAG) - Number(a.liquidityBDAG)));
        if (!l.length) throw new Error("no data");
        setList(l); got = true;
      } catch (e) {
        // Keep the last list. If the first load failed (public nodes can be slow), try again soon.
        if (alive && !got && ++tries <= 3) setTimeout(load, 5000 * tries);
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Auto-scroll: about 35 px a second; hover, focus, touch or the wheel pause it. Native scrolling, so it swipes.
  useEffect(() => {
    const el = rail.current;
    if (!el || !list || reduced) return;
    let raf, last = performance.now(), acc = 0;
    const step = (now) => {
      const dt = Math.min(64, now - last); last = now;
      if (Date.now() > hold.current && !document.hidden) {
        acc += dt * 0.035;
        const px = Math.floor(acc); acc -= px;
        if (px) { el.scrollLeft += px; const half = el.scrollWidth / 2; if (el.scrollLeft >= half) el.scrollLeft -= half; }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const set = (ms) => () => { hold.current = Date.now() + ms; };
    const on = [["mouseenter", set(1e9)], ["mouseleave", set(0)], ["focusin", set(1e9)], ["focusout", set(1500)], ["touchstart", set(1e9)], ["touchend", set(4000)], ["wheel", set(4000)]];
    on.forEach(([e, f]) => el.addEventListener(e, f, { passive: true }));
    return () => { cancelAnimationFrame(raf); on.forEach(([e, f]) => el.removeEventListener(e, f)); };
  }, [list, reduced]);

  if (!list) return null;
  return (
    <section className="n-tk" aria-label="Reef pools: price in BDAG and 24-hour change">
      <div className="n-tk-box">
        <div className="n-tk-lead">
          <b>Trading now</b>
          <span>Reef pools · price in BDAG · 24h</span>
          <a href="https://reefdex.fyi/pairs/" target="_blank" rel="noopener">All pools →</a>
        </div>
        <div className="n-tk-rail" ref={rail}>
          <div className="n-tk-track">
            {list.map((t) => <Chip key={t.pair} t={t} />)}
            {!reduced && list.map((t) => <Chip key={t.pair + "-2"} t={t} hidden />)}
          </div>
        </div>
      </div>
    </section>
  );
}

export const tickerCss = `
.n-tk{max-width:960px;margin:18px auto 6px;padding:0 24px;position:relative;z-index:1}
.n-tk-box{background:var(--n-surface);border:1px solid var(--n-line-strong);border-radius:18px;padding:12px 0 12px 16px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:14px;position:relative;overflow:hidden}
.n-tk-box::before{content:"";position:absolute;inset:0;background:radial-gradient(circle,var(--n-line-strong) 1px,transparent 1.2px) 0 0/14px 14px;opacity:.5;pointer-events:none}
.n-tk-lead{position:relative;display:flex;flex-direction:column;gap:2px;min-width:0}
.n-tk-lead b{font:800 15px/1.2 'Bricolage Grotesque','Instrument Sans',sans-serif;color:var(--n-ink);white-space:nowrap}
.n-tk-lead span{font-size:11.5px;color:var(--n-dim2);white-space:nowrap}
.n-tk-lead a{font-size:12px;color:var(--n-cyan);text-decoration:none;white-space:nowrap}
.n-tk-lead a:hover{text-decoration:underline}
.n-tk-rail{position:relative;overflow-x:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 40px),transparent)}
.n-tk-rail::-webkit-scrollbar{display:none}
.n-tk-track{display:flex;gap:8px;width:max-content;padding:2px 24px 2px 8px}
.n-tk-chip{display:flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border:1px solid var(--n-border2);border-radius:999px;background:var(--n-raised);color:var(--n-ink);text-decoration:none;white-space:nowrap;font-size:13px;transition:border-color .15s,transform .15s}
.n-tk-chip:hover,.n-tk-chip:focus-visible{border-color:var(--n-cyan);transform:translateY(-1px);outline:none}
.n-tk-dot{width:26px;height:26px;border-radius:50%;flex:none;display:grid;place-items:center;font:800 11px/1 'Bricolage Grotesque',sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.n-tk-sym{font-weight:600}
.n-tk-px{color:var(--n-muted);font-family:'Space Mono',monospace;font-size:12px}
.n-tk-px sub{font-size:.75em}
.n-tk-chg{font-weight:600;font-variant-numeric:tabular-nums}
.n-tk-chg.up{color:var(--n-dot-ok)}.n-tk-chg.down{color:var(--n-red)}.n-tk-chg.flat{color:var(--n-dim2)}
.n-tk-new{font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:999px;background:color-mix(in srgb,var(--n-amber) 22%,transparent);color:var(--n-amber)}
@media (max-width:640px){.n-tk{padding:0 16px}.n-tk-box{grid-template-columns:minmax(0,1fr);gap:10px;padding:12px 0}.n-tk-lead{flex-direction:row;align-items:baseline;gap:8px;padding:0 16px}.n-tk-lead span{display:none}.n-tk-lead a{margin-left:auto}}
`;
