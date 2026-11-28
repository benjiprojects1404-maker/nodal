import React, { useState, useEffect, useRef, useContext, createContext } from "react";
import { FALLBACK_RPCS, loadRpcRegistry } from "./rpcRegistry.js";
import LiveSwap, { loadLiveTokens, loadFeeBps, fmtFeeBps } from "./LiveSwap.jsx";
import Ticker, { tickerCss } from "./Ticker.jsx";
import {
  ArrowDownUp,
  Check,
  ShieldCheck,
  Eye,
  SlidersHorizontal,
  Network,
  Gauge,
  Globe2,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  Lock,
  Loader2,
  Wallet,
  Copy,
  Info,
  X as XIcon,
  Sun,
  Moon,
} from "lucide-react";

/* ---------------- App views (hash routed, like reefdex.fyi) ----------------
 * One page, four views: #swap (default), #bridge, #sources, #about. Every view stays in the page
 * (hidden when not active) so search engines and the FAQ anchors still find all of it.
 * Old anchors keep working: #app → swap, #how → sources, #faq → about. */
const VIEWS = ["swap", "bridge", "sources", "about"];
const VIEW_ALIAS = { app: "swap", how: "sources", faq: "about", risks: "about", more: "about" };
const TABS = [
  { id: "swap", label: "Swap", icon: ArrowDownUp },
  { id: "bridge", label: "Bridge", icon: Globe2 },
  { id: "sources", label: "Sources", icon: Network },
  { id: "about", label: "About", icon: Info },
];
function viewFromHash() {
  if (typeof window === "undefined") return "swap";
  const h = decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
  return VIEWS.includes(h) ? h : VIEW_ALIAS[h] || "swap";
}
function useView() {
  const [view, setView] = useState(viewFromHash);
  useEffect(() => {
    const go = (first) => {
      setView(viewFromHash());
      const h = window.location.hash.slice(1);
      // An anchor inside a view (#faq, #how) scrolls to it once the view is showing; a view tab goes to the top.
      if (h && !VIEWS.includes(h)) setTimeout(() => { const el = document.getElementById(h); if (el) el.scrollIntoView({ block: "start" }); }, 0);
      else if (!first) window.scrollTo({ top: 0, behavior: "instant" });
    };
    const on = () => go(false);
    go(true);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return view;
}
const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* ---------------- Wallet connection ---------------- */

const BLOCKDAG_CHAIN_ID_DEC = 1404;
const BLOCKDAG_CHAIN_ID_HEX = "0x57c";
// Wallet "add network" prompt uses the built-in list; reads and the RPC status panel use the
// live list from /api/rpcs (see src/rpcRegistry.js), which follows bdag.community's node board.
// The listed endpoint (chainid.network, Ethereum Lists, viem) goes first so the wallet's default RPC
// matches the published chain data; the rest follow in the built-in order.
const LISTED_RPC = "https://rpc.bdagexplorer.com";
const BLOCKDAG_RPCS = [LISTED_RPC, ...FALLBACK_RPCS.filter((u) => u !== LISTED_RPC)];
const BLOCKDAG_EXPLORER = "https://explorer.east.bdag-us.org/";

const WalletContext = createContext(null);
function useWallet() {
  return useContext(WalletContext);
}

function truncateAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const TOS_STORAGE_KEY = "nodal_tos_agreed_v1";

function useWalletState() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [tosAgreed, setTosAgreed] = useState(false);
  const [showTosGate, setShowTosGate] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(TOS_STORAGE_KEY) === "1") {
        setTosAgreed(true);
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) — agreement just won't persist across visits
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum;
    const handleAccounts = (accs) => setAddress(accs && accs.length ? accs[0] : null);
    const handleChain = (cidHex) => setChainId(parseInt(cidHex, 16));
    eth.request({ method: "eth_accounts" }).then(handleAccounts).catch(() => {});
    eth.request({ method: "eth_chainId" }).then(handleChain).catch(() => {});
    if (eth.on) {
      eth.on("accountsChanged", handleAccounts);
      eth.on("chainChanged", handleChain);
    }
    return () => {
      if (eth.removeListener) {
        eth.removeListener("accountsChanged", handleAccounts);
        eth.removeListener("chainChanged", handleChain);
      }
    };
  }, []);

  const _doConnect = async () => {
    setError("");
    if (typeof window === "undefined" || !window.ethereum) {
      setError("NO_WALLET"); // the wallet popup explains, with open-in-wallet links on phones
      return;
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAddress(accounts[0] || null);
      const cidHex = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(parseInt(cidHex, 16));
    } catch (e) {
      // Cancelling in the wallet is a choice, not an error: stay quiet.
      if (e && (e.code === 4001 || e.code === "ACTION_REJECTED")) return;
      if (e && e.code === -32002) setError("A connection request is already waiting in your wallet. Open your wallet and approve it there.");
      else setError(e && e.message ? e.message : "The wallet didn't connect. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  // Every existing call site just calls wallet.connect() — gating it here means the
  // click-wrap covers wallet connection AND every trade/bridge action that falls back
  // to connect() when no wallet is attached yet, with zero changes needed elsewhere.
  const connect = () => {
    if (!tosAgreed) {
      setShowTosGate(true);
      return;
    }
    _doConnect();
  };

  const agreeToTos = () => {
    try {
      window.localStorage.setItem(TOS_STORAGE_KEY, "1");
    } catch {
      // best-effort only
    }
    setTosAgreed(true);
    setShowTosGate(false);
    _doConnect();
  };

  const declineTos = () => setShowTosGate(false);

  const switchToBlockDAG = async () => {
    if (!window.ethereum) return;
    setError("");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BLOCKDAG_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if (switchError && switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: BLOCKDAG_CHAIN_ID_HEX,
                chainName: "BlockDAG",
                nativeCurrency: { name: "BlockDAG", symbol: "BDAG", decimals: 18 },
                rpcUrls: BLOCKDAG_RPCS,
                blockExplorerUrls: [BLOCKDAG_EXPLORER],
              },
            ],
          });
        } catch {
          setError("Could not add BlockDAG network to your wallet.");
        }
      } else {
        setError("Could not switch network.");
      }
    }
  };

  const disconnect = () => setAddress(null);

  return {
    address,
    chainId,
    connecting,
    error,
    clearError: () => setError(""),
    connect,
    disconnect,
    switchToBlockDAG,
    isWrongChain: !!address && chainId !== null && chainId !== BLOCKDAG_CHAIN_ID_DEC,
    tosAgreed,
    showTosGate,
    agreeToTos,
    declineTos,
  };
}

/* ---------------- Terms of Service click-wrap gate ----------------
 * DRAFT LANGUAGE — NOT REVIEWED BY A LAWYER. This is a starting point covering
 * the categories typically expected (experimental/AS-IS, non-custodial GUI
 * framing, risk assumption, jurisdiction restriction) — have real counsel
 * review before this is load-bearing, especially the jurisdiction list and
 * governing-law line, which depend on facts about the operator this file
 * has no way to know.
 * ------------------------------------------------------------------- */

const NODAL_TOS_TEXT = `
1. Experimental software, provided AS IS. Nodal is early-stage, unaudited
software interacting with smart contracts on BlockDAG (chain ID 1404). It is
provided strictly "AS IS" and "AS AVAILABLE," with no warranty of any kind,
express or implied — including no warranty of merchantability, fitness for a
particular purpose, or non-infringement. You assume 100% of the risk of using
it, including but not limited to smart contract bugs, exploits, chain
reorganizations or forks, network outages, and total loss of funds.

2. This is a GUI, not a custodian. This website is a visual interface that
lets you interact directly with the NodalRouter smart contract and third-party
decentralized exchanges on chain 1404. We do not hold, custody, control, or
have the ability to access your funds at any point. Every transaction is
signed directly by your own wallet. We cannot reverse, cancel, or recover a
transaction once it is submitted to the network.

3. No investment, financial, or legal advice. Nothing on this site is
investment, financial, tax, or legal advice. Quoted prices, routes, and fees
are informational only and may change before your transaction confirms.

4. Fees. Nodal may charge a routing fee (set in the NodalRouter contract,
currently 0%, never above 1%) on top of whatever fee the underlying liquidity
source charges. Both are shown before you confirm any trade.

5. Jurisdiction restrictions. This software is not offered to, and may not be
used by, persons located in, resident in, or accessing it from any
jurisdiction where such use would be unlawful, or from the United States or
United Kingdom. By continuing, you certify that none of these restrictions
apply to you.

6. No warranty, limitation of liability. To the maximum extent permitted by
law, the operators of this interface are not liable for any direct, indirect,
incidental, special, or consequential damages arising from your use of this
software, including loss of funds, loss of profits, or loss of data — even if
advised of the possibility of such damages.

7. Assumption of risk; no reliance. You acknowledge that decentralized
software carries risks not present in traditional finance, that this specific
contract has not undergone a third-party security audit, and that you are
solely responsible for verifying contract addresses, transaction details, and
network conditions before signing anything.

8. Severability. If any provision of these terms is found unenforceable, the
remaining provisions continue in full force.

[Operator legal name, governing law / jurisdiction for disputes, and contact
details to be added here before this is used for real.]
`.trim();

function TosGateModal() {
  const { agreeToTos, declineTos } = useWallet();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedJurisdiction, setAgreedJurisdiction] = useState(false);
  const canContinue = agreedTerms && agreedJurisdiction;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tos-gate-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "color-mix(in srgb, var(--n-bg) 93%, transparent)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--n-surface)",
          border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)",
          borderRadius: 16,
          boxShadow: "0 30px 80px -20px color-mix(in srgb, var(--n-black) 80%, transparent)",
        }}
      >
        <div style={{ padding: "22px 24px 14px" }}>
          <h2 id="tos-gate-title" style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif" }}>
            Before you connect a wallet
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--n-muted)" }}>
            Please read and accept the terms below. This gate only needs to happen once.
          </p>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 24px",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--n-soft)",
            whiteSpace: "pre-wrap",
            fontFamily: "'Instrument Sans', sans-serif",
            borderTop: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)",
          }}
        >
          <div style={{ padding: "16px 0" }}>{NODAL_TOS_TEXT}</div>
        </div>

        <div style={{ padding: "18px 24px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--n-ink)", cursor: "pointer" }}>
            <input type="checkbox" checked={agreedTerms} onChange={(e) => setAgreedTerms(e.target.checked)} style={{ marginTop: 2 }} />
            I have read and agree to the Terms of Service above.
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--n-ink)", cursor: "pointer" }}>
            <input type="checkbox" checked={agreedJurisdiction} onChange={(e) => setAgreedJurisdiction(e.target.checked)} style={{ marginTop: 2 }} />
            I certify that I am not located in, a resident of, or accessing this
            from the United States, United Kingdom, or a jurisdiction where use
            of this software would be unlawful.
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button
              onClick={declineTos}
              style={{ flex: 1, padding: "11px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", background: "transparent", color: "var(--n-muted)", fontFamily: "'Instrument Sans', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={agreeToTos}
              disabled={!canContinue}
              style={{
                flex: 2,
                padding: "11px 16px",
                borderRadius: 10,
                border: "none",
                background: canContinue ? "linear-gradient(90deg, var(--n-purple), var(--n-coral))" : "var(--n-line-strong)",
                color: canContinue ? "var(--n-bg)" : "var(--n-dim2)",
                fontFamily: "'Instrument Sans', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                cursor: canContinue ? "pointer" : "default",
              }}
            >
              Agree &amp; Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Token universe ---------------- */

const NATIVE_TOKENS = [
  { symbol: "BDAG", name: "BlockDAG", price: 0.012, native: true },
  { symbol: "BDUSD", name: "BlockDAG Dollar", price: 1.0, native: true },
];

// Top-10 assets by market cap, represented as bridged/wrapped tokens on chain 1404.
// Prices are illustrative placeholders for the demo, not live market data.
const BRIDGED_TOKENS = [
  { symbol: "WBTC", name: "Wrapped Bitcoin", price: 78000, native: false, homeChain: "Bitcoin" },
  { symbol: "WETH", name: "Wrapped Ether", price: 3800, native: false, homeChain: "Ethereum" },
  { symbol: "USDT", name: "Tether USD", price: 1.0, native: false, homeChain: "Ethereum" },
  { symbol: "USDC", name: "USD Coin", price: 1.0, native: false, homeChain: "Ethereum" },
  { symbol: "WBNB", name: "Wrapped BNB", price: 620, native: false, homeChain: "BNB Chain" },
  { symbol: "WSOL", name: "Wrapped SOL", price: 145, native: false, homeChain: "Solana" },
  { symbol: "WXRP", name: "Wrapped XRP", price: 0.55, native: false, homeChain: "XRP Ledger" },
  { symbol: "WADA", name: "Wrapped Cardano", price: 0.38, native: false, homeChain: "Cardano" },
  { symbol: "AVAX", name: "Avalanche", price: 18, native: false, homeChain: "Avalanche" },
  { symbol: "LINK", name: "Chainlink", price: 13, native: false, homeChain: "Ethereum" },
];

const TOKENS = [...NATIVE_TOKENS, ...BRIDGED_TOKENS];

// Nodal's own routing fee is read live from NodalRouter (loadFeeBps), never hard-coded: the multisig
// can change it (hard-capped at 1% in the contract). It's 0% while Reef is the only source.


// Live, on-chain liquidity sources registered with NodalRouter (shown in the Sources section).
const NODAL_ROUTER_ADDRESS = "0xA06f8a856896aA1836f04F758C1E5Ac5dbe24672";
const LIVE_SOURCES = [
  {
    name: "Reef",
    kind: "AMM DEX (Uniswap V2-style)",
    adapter: "0x4b60D344eDA7E3D859739B5AbC1176d756E22d56",
    router: "0xbd6fbA41Ab84292163A599510a12d6Bf8B7CCc76",
    since: "30 Sep 2026",
  },
];

const STEPS = [
  { n: "01", title: "Enter your trade", body: "Pick the two tokens and the amount. Nodal reads live balances so you always know what you're working with." },
  { n: "02", title: "Every source gets queried", body: "Nodal calls each registered DEX's router in parallel and reads back real output amounts. Today that's one source, Reef; each new DEX is added with a single on-chain transaction as it launches." },
  { n: "03", title: "Quotes are normalized", body: "Fees and price impact are priced in before anything is ranked, so what you compare is the actual amount you'd receive, not a headline rate." },
  { n: "04", title: "You execute, in one transaction", body: "Your wallet signs one swap through NodalRouter (plus a one-time approval of the exact amount for tokens). Funds pass through in that single transaction and nothing is held afterwards." },
];

const FEATURES = [
  { icon: Gauge, color: "var(--n-cyan)", title: "Best execution", body: "Routes are ranked by net output after fees, not by whichever venue is easiest to integrate." },
  { icon: ShieldCheck, color: "var(--n-purple)", title: "Non-custodial", body: "Your assets stay in your wallet until you sign. Each swap settles in one transaction, and Nodal never holds a balance between trades." },
  { icon: Eye, color: "var(--n-coral)", title: "Transparent routing", body: "Every quote shows its source, fee, and net output side by side — nothing hidden behind a single blended number." },
  { icon: Globe2, color: "var(--n-cyan)", title: "Top-10 asset support (planned)", body: "Once a BlockDAG bridge is live, the ten most liquid assets in crypto can be traded as bridged tokens alongside BlockDAG's own." },
  { icon: Network, color: "var(--n-purple)", title: "Built for chain 1404", body: "Not a generic multi-chain wrapper — routing logic is written specifically for BlockDAG's liquidity layout." },
  { icon: SlidersHorizontal, color: "var(--n-coral)", title: "Slippage controls", body: "Set your own tolerance before you sign. No trade executes outside the bounds you set." },
];

const FAQS = [
  { q: "What is Nodal?", a: "Nodal is a trade routing layer for BlockDAG (chain ID 1404). Instead of trading against a single DEX, you submit a trade once and Nodal compares it across every liquidity source it supports, then routes you to whichever one returns the most." },
  { q: "Which chain does this run on?", a: "BlockDAG mainnet exclusively, chain ID 1404." },
  { q: "Does Nodal ever hold my funds?", a: "Not between trades. When you swap, your tokens pass through the NodalRouter contract to the chosen DEX and the proceeds come straight back to your wallet, all inside one transaction. If anything fails, including the price moving past your slippage limit, the whole transaction reverts and nothing moves. For tokens (not BDAG) you first approve NodalRouter for exactly the amount you're swapping, never an unlimited allowance." },
  { q: "What does Nodal charge?", a: "Nothing at the moment. While Reef is the only liquidity source, Nodal's routing fee is 0%, so swapping through Nodal costs the same as swapping on Reef directly (you pay only Reef's 0.30% pool fee). Once a second DEX is live and there are real prices to compare, a small fee may be switched on. It's set in the contract, can never go above 1%, needs 2 of 3 multisig keys to change, and is always shown as its own line before you confirm." },
  { q: "Which liquidity sources are live right now?", a: "One: Reef, an AMM DEX on chain 1404. Reef is built by the same team as Nodal — we say so up front because Nodal's job is to route you to the best price, and with a single source there is nothing to compare yet. More sources are added, with one on-chain transaction each, as other DEXs launch real liquidity." },
  { q: "Can I bridge assets in from other chains?", a: "There's no official BlockDAG bridge live yet. The Bridge tab models the lock-and-mint flow you'd expect once one launches — it's a preview of the UI, not a working transfer. Don't send funds expecting them to arrive until a real bridge contract exists and has been audited." },
  { q: "Has this been audited?", a: (<>Not by an independent auditor yet. On 2 October 2026 NodalRouter and its Reef adapter had an AI-assisted security review: read line by line, run through Slither, tested with attacks, and matched to their published source on chain. It found no critical, high or medium issues in Nodal. <a href="https://benjiprojects1404-services.pages.dev/security-review/" target="_blank" rel="noopener" style={{ color: "var(--n-cyan)" }}>Read the review</a>. The Slither results and 20 fuzz and invariant tests (100,000+ random trades) are published with the code: <a href="https://github.com/benjiprojects1404-maker/nodal/tree/main/security" target="_blank" rel="noopener" style={{ color: "var(--n-cyan)" }}>security report on GitHub</a>. That review isn't an audit and can't rule out bugs, so treat Nodal as beta software until an independent audit is done.</>) },
  { q: "I found a bug or security issue. Where do I report it?", a: "Anything that could put funds at risk: email security@nodaldex.fyi privately, not in a public issue or chat, so it can be fixed (or the router paused) first. Everything else, like wrong numbers or confusing wording, can go to the team or into an issue on the project's GitHub." },
];

function formatAmount(n) {
  if (!isFinite(n)) return "0.00";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function GraphMark({ size = 20, spinning = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={spinning ? { animation: "nodal-spin 2.6s linear infinite" } : undefined}>
      <circle cx="50" cy="50" r="42" fill="none" stroke="#2A3448" strokeWidth="3" strokeDasharray="5 7" />
      <line x1="19" y1="19" x2="81" y2="81" stroke="#3FD9EA" strokeOpacity="0.4" strokeWidth="2" />
      <line x1="81" y1="19" x2="19" y2="81" stroke="#FF8266" strokeOpacity="0.4" strokeWidth="2" />
      <circle cx="19" cy="19" r="6" fill="#3FD9EA" />
      <circle cx="81" cy="19" r="6" fill="#3FD9EA" />
      <circle cx="19" cy="81" r="6" fill="#FF8266" />
      <circle cx="81" cy="81" r="6" fill="#FF8266" />
    </svg>
  );
}

function Logo({ size = 28 }) {
  // Reef-style wordmark: heavy rounded grotesque, lowercase, with one accent dot (here a node
  // sitting in the "o"), the same way reef.dex carries one coloured dot. `size` is the text size in px.
  return (
    <span className="n-wordmark" role="img" aria-label="nodal" style={{ fontSize: size }}>
      n<span className="n-o" aria-hidden="true">o</span>dal
    </span>
  );
}

export default function NodalLanding() {
  const wallet = useWalletState();
  const view = useView();
  return (
    <WalletContext.Provider value={wallet}>
      <div className="n-app" data-view={view} style={{ position: "relative", minHeight: "100%", background: "var(--n-bg)", fontFamily: "'Instrument Sans', sans-serif", color: "var(--n-ink)" }}>
        <GlobalStyle />
        {/* Glow runs from the very top, behind the header, so the header reads as one block. */}
        <div aria-hidden="true" className="nodal-scope" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 760, background: "radial-gradient(ellipse 1000px 620px at 15% 0%, var(--n-raised2) 0%, transparent 62%), radial-gradient(ellipse 900px 620px at 100% 6%, var(--n-purpledeep) 0%, transparent 58%)", pointerEvents: "none", zIndex: 0 }} />
        {wallet.showTosGate && <TosGateModal />}
        <WalletNotice />
        <AppHeader view={view} />
        <main className="n-views">
          <div className="n-view" hidden={view !== "swap"}>
            <Ticker />
            <SwapView />
          </div>
          <div className="n-view" hidden={view !== "bridge"}>
            <BridgeView />
          </div>
          <div className="n-view" hidden={view !== "sources"}>
            <Sources />
            <HowItWorks />
          </div>
          <div className="n-view" hidden={view !== "about"}>
            <Hero />
            <StatsBar />
            <BetaBanner />
            <Features />
            <FAQ />
          </div>
        </main>
        <RpcStatusPanel />
        <Footer />
        <BottomNav view={view} />
      </div>
    </WalletContext.Provider>
  );
}

/* ---------------- App header, logo menu and phone bottom nav ---------------- */

const MENU = [
  { title: "Resources", links: [
    { href: "/overview.pdf", label: "Overview brief (PDF)", ext: true },
    { href: "https://benjiprojects1404-services.pages.dev/security-review/", label: "Security review", ext: true },
    { href: "https://github.com/benjiprojects1404-maker/nodal/tree/main/security", label: "Slither & fuzz test reports", ext: true },
    { href: "/rpcs", label: "Public RPC list" },
    { href: "mailto:security@nodaldex.fyi", label: "Report a security issue" },
  ] },
  { title: "Also on BlockDAG", links: [
    { href: "https://reefdex.fyi", label: "Reef DEX", ext: true },
    { href: "https://handshakeotc.fyi", label: "Handshake OTC", ext: true },
  ] },
  { title: "Learn", links: [
    { href: "#how", label: "How routing works" },
    { href: "#risks", label: "Beta notes & risks" },
    { href: "#faq", label: "FAQ" },
  ] },
];
const SOCIALS = [
  { href: "https://x.com/benji107", label: "X", d: "M4 4l16 16M20 4 4 20" },
  { href: "https://t.me/undercurrentworks", label: "Telegram", d: "m21 4-18 7 6 2 2 6 3-4 5 4 2-15Z" },
  { href: "https://github.com/benjiprojects1404-maker/nodal", label: "GitHub", d: "M9 19c-4 1.5-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" },
];

function AppHeader({ view }) {
  const { address, disconnect } = useWallet();
  const [menu, setMenu] = useState(false);
  const box = useRef(null);
  useEffect(() => { setMenu(false); }, [view]);
  useEffect(() => {
    if (!menu) return;
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(false); };
    const key = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("touchstart", off, { passive: true });
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("touchstart", off); document.removeEventListener("keydown", key); };
  }, [menu]);
  return (
    <header className="nodal-scope n-top">
      <div className="n-topwrap">
        <div className="n-brand" ref={box}>
          <button type="button" className="n-brandbtn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" aria-label="Nodal menu">
            <Logo size={26} />
            <ChevronDown size={16} className="n-chev" />
          </button>
          {menu && (
            <div className="n-menu" role="menu">
              {MENU.map((g) => (
                <div className="n-mgrp" key={g.title}>
                  <b>{g.title}</b>
                  {g.links.map((l) => (
                    <a key={l.label} href={l.href} role="menuitem" onClick={() => setMenu(false)} {...(l.ext ? { target: "_blank", rel: "noopener" } : {})}>{l.label}</a>
                  ))}
                </div>
              ))}
              {address && (
                <div className="n-mgrp">
                  <b>Wallet</b>
                  <button type="button" role="menuitem" onClick={() => { disconnect(); setMenu(false); }}>Disconnect {truncateAddress(address)}</button>
                </div>
              )}
              <div className="n-msoc">
                {SOCIALS.map((s) => (
                  <a key={s.label} href={s.href} target="_blank" rel="noopener" aria-label={s.label}><svg viewBox="0 0 24 24"><path d={s.d} /></svg></a>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="n-beta">Beta</span>
        <nav className="n-tabs" aria-label="Sections">
          {TABS.map((t) => (
            <a key={t.id} href={"#" + t.id} className={view === t.id ? "on" : ""} aria-current={view === t.id ? "page" : undefined}>{t.label}</a>
          ))}
        </nav>
        <div className="n-spacer" />
        <RpcBadge />
        <ThemeButton />
        <WalletButton />
      </div>
    </header>
  );
}

function BottomNav({ view }) {
  return (
    <nav className="nodal-scope n-bottomnav" aria-label="Sections">
      {TABS.map((t) => (
        <a key={t.id} href={"#" + t.id} className={view === t.id ? "on" : ""} aria-current={view === t.id ? "page" : undefined}>
          <t.icon size={20} strokeWidth={1.8} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

/* Wallet messages as a popup, so they show on every view (and on phones, where the header has no room). */
function WalletNotice() {
  const { error, clearError } = useWallet();
  useEffect(() => {
    if (!error) return;
    const key = (e) => { if (e.key === "Escape") clearError(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [error]);
  if (!error) return null;
  const noWallet = error === "NO_WALLET";
  const here = typeof window !== "undefined" ? window.location.host + window.location.pathname : "www.nodaldex.fyi/";
  const url = typeof window !== "undefined" ? window.location.href : "https://www.nodaldex.fyi/";
  return (
    <div className="nodal-scope n-modal" role="dialog" aria-modal="true" aria-labelledby="n-wn-title" onClick={(e) => { if (e.target === e.currentTarget) clearError(); }}>
      <div className="n-modalbox">
        <button type="button" className="n-modalx" onClick={clearError} aria-label="Close"><XIcon size={18} /></button>
        <h2 id="n-wn-title">{noWallet ? "No wallet found" : "Wallet"}</h2>
        {noWallet ? (
          isMobile() ? (
            <>
              <p>Phone browsers can't reach a wallet app directly. Open Nodal inside your wallet's own browser instead:</p>
              <div className="n-modalbtns">
                <a href={"https://metamask.app.link/dapp/" + here}>Open in MetaMask</a>
                <a href={"https://link.trustwallet.com/open_url?coin_id=60&url=" + encodeURIComponent(url)}>Open in Trust Wallet</a>
              </div>
              <p className="n-modalnote">Using another wallet? Open its browser and go to nodaldex.fyi.</p>
            </>
          ) : (
            <p>Nodal needs an EVM browser wallet such as MetaMask, Rabby or Trust Wallet. Install one, refresh this page, then press Connect wallet again.</p>
          )
        ) : (
          <p>{error}</p>
        )}
      </div>
    </div>
  );
}

function SwapView() {
  const wallet = useWallet();
  return (
    <Section id="app" style={{ paddingTop: 16 }}>
      <LiveSwap wallet={wallet} />
    </Section>
  );
}

function BridgeView() {
  return (
    <Section id="bridge-view" style={{ paddingTop: 20 }}>
      <div className="n-sechead">
        <h2>Bridge</h2>
        <p>Bring the top assets in crypto onto chain 1404. No BlockDAG bridge exists yet, so this is a preview of how it will work.</p>
      </div>
      <BridgeTool />
    </Section>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      :root{--n-bg:#050f14;--n-surface0:#0a181d;--n-surface:#0e1f24;--n-raised:#12262c;--n-raised2:#163038;--n-purpledeep:#2a2118;--n-line-strong:#26414a;--n-border2:#34535c;--n-faint:#5f858d;--n-dim2:#7fa3ab;--n-muted:#8fb3ba;--n-soft:#c4dade;--n-warm:#d8c3a8;--n-ink:#e7f3f5;--n-white-ov:#FFFFFF;--n-black:#000000;--n-cyan:#c5966c;--n-coral:#c9733f;--n-purple:#e0a85f;--n-amber:#F2B84B;--n-red:#FF8A8A;--n-green-soft:#9FE8C9;--n-green:#1D8F76;--n-warmdeep:#2A1A18;--n-dot-ok:#3fbf83;--n-dot-warn:#F2B84B;--n-dot-bad:#ff6b6b;color-scheme:dark} :root[data-theme="light"]{--n-bg:#e6f4f6;--n-surface0:#f5fcfd;--n-surface:#f5fcfd;--n-raised:#eaf6f8;--n-raised2:#dcedf0;--n-purpledeep:#f3e7d3;--n-line-strong:#bcd3d8;--n-border2:#a4c0c6;--n-faint:#6a8a91;--n-dim2:#3f5e65;--n-muted:#33525a;--n-soft:#25434a;--n-warm:#7A4A3A;--n-ink:#0b1f24;--n-white-ov:#0b1f24;--n-black:#1A2236;--n-cyan:#8a5a22;--n-coral:#b4551f;--n-purple:#a8681c;--n-amber:#A86F0A;--n-red:#C92F2F;--n-green-soft:#127A5E;--n-green:#1D8F76;--n-warmdeep:#F6E3DC;--n-dot-ok:#1a9b5f;--n-dot-warn:#c98a0a;--n-dot-bad:#c92f2f;color-scheme:light}
      .nodal-scope h1,.nodal-scope h2{font-family:'Bricolage Grotesque','Instrument Sans',sans-serif;font-weight:800;letter-spacing:-0.01em}
      .n-wordmark{font-family:'Bricolage Grotesque','Instrument Sans',sans-serif;font-weight:800;letter-spacing:-0.02em;line-height:1;color:var(--n-ink);display:inline-block;white-space:nowrap;flex:none}
      .n-o{position:relative;display:inline-block}
      ${tickerCss}
      .n-o::after{content:"";position:absolute;left:50%;top:58%;width:.3em;height:.3em;margin:-.15em 0 0 -.15em;border-radius:50%;background:var(--n-cyan)}
      html, body { scroll-behavior: smooth; background: var(--n-bg); margin: 0; padding: 0; min-height: 100%; }
      body { overflow-x: hidden; }
      html { scrollbar-color: var(--n-line-strong) var(--n-bg); scrollbar-width: thin; }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: var(--n-bg); }
      ::-webkit-scrollbar-thumb { background: var(--n-line-strong); border-radius: 6px; }
      ::-webkit-scrollbar-thumb:hover { background: var(--n-border2); }
      .nodal-scope * { box-sizing: border-box; }
      .nodal-scope select { appearance: none; -webkit-appearance: none; }
      .nodal-scope input::placeholder { color: var(--n-border2); }
      .nodal-scope input:focus,
      .nodal-scope select:focus,
      .nodal-scope button:focus-visible,
      .nodal-scope a:focus-visible {
        outline: 2px solid var(--n-cyan);
        outline-offset: 2px;
      }
      /* App layout (Nov 2026): header with logo menu + tabs, one view at a time, bottom nav on phones. */
      .n-top{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--n-bg) 82%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid color-mix(in srgb,var(--n-white-ov) 6%,transparent)}
      .n-topwrap{max-width:960px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:12px}
      .n-theme{flex:none;width:34px;height:34px;display:grid;place-items:center;border-radius:999px;border:1px solid var(--n-line-strong);background:transparent;color:var(--n-muted);cursor:pointer;padding:0}
      .n-theme:hover{color:var(--n-ink);border-color:var(--n-border2)}
      .n-brand{position:relative;flex:none}
      .n-brandbtn{display:flex;align-items:center;gap:4px;background:none;border:0;padding:4px 6px 4px 0;cursor:pointer;color:var(--n-ink)}
      .n-chev{color:var(--n-muted);transition:transform .2s}
      .n-brandbtn[aria-expanded="true"] .n-chev{transform:rotate(180deg)}
      .n-menu{position:absolute;top:calc(100% + 10px);left:0;width:270px;max-height:calc(100vh - 90px);overflow:auto;background:var(--n-surface);border:1px solid var(--n-line-strong);border-radius:14px;padding:8px;box-shadow:0 24px 48px -16px rgba(0,0,0,.6);z-index:60}
      .n-mgrp{padding:6px 4px 8px;border-bottom:1px solid color-mix(in srgb,var(--n-white-ov) 6%,transparent)}
      .n-mgrp b{display:block;font:700 11px/1 'Space Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--n-dim2);padding:6px 8px 6px}
      .n-mgrp a,.n-mgrp button{display:block;width:100%;text-align:left;background:none;border:0;font:500 14px/1.3 'Instrument Sans',sans-serif;color:var(--n-soft);text-decoration:none;padding:8px;border-radius:8px;cursor:pointer}
      .n-mgrp a:hover,.n-mgrp button:hover{background:var(--n-raised);color:var(--n-ink)}
      .n-msoc{display:flex;gap:8px;padding:10px 8px 4px}
      .n-msoc a{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--n-line-strong);color:var(--n-muted)}
      .n-msoc a:hover{color:var(--n-ink);border-color:var(--n-cyan)}
      .n-msoc svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .n-beta{flex:none;font:700 10px/1 'Space Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--n-coral);border:1px solid color-mix(in srgb,var(--n-coral) 40%,transparent);border-radius:999px;padding:4px 8px}
      .n-tabs{display:flex;gap:4px;background:var(--n-surface0);border:1px solid color-mix(in srgb,var(--n-white-ov) 8%,transparent);border-radius:12px;padding:4px;margin-left:6px}
      .n-tabs a{font:600 14px/1 'Instrument Sans',sans-serif;color:var(--n-muted);text-decoration:none;padding:8px 14px;border-radius:8px}
      .n-tabs a:hover{color:var(--n-ink)}
      .n-tabs a.on{background:var(--n-raised2);color:var(--n-ink)}
      .n-spacer{flex:1}
      .n-views{position:relative;z-index:1;min-height:60vh;padding-bottom:12px}
      .n-sechead{margin:0 0 16px}

      /* One type scale on every tab (28 Nov 2026): page title 26px, section headings 22px, card titles 16px, all in the brand font. */
      .n-views h1, .n-views h2 { font-family: 'Bricolage Grotesque','Instrument Sans',sans-serif !important; font-weight: 800 !important; letter-spacing: -0.01em; }
      .n-views h2 { font-size: 22px !important; }
      .n-views li { font-size: 14px !important; }
      .n-sechead h2 { margin: 0 0 6px; }
      .n-sechead h2{margin:0 0 6px;font-size:22px}
      .n-sechead p{margin:0;font-size:15px;line-height:1.55;color:var(--n-muted);max-width:620px}
      .n-bottomnav{display:none}
      .n-modal{position:fixed;inset:0;z-index:110;background:color-mix(in srgb,var(--n-bg) 80%,transparent);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px}
      .n-modalbox{position:relative;width:100%;max-width:420px;background:var(--n-surface);border:1px solid var(--n-line-strong);border-radius:16px;padding:22px 22px 20px}
      .n-modalbox h2{margin:0 0 10px;font-size:18px}
      .n-modalbox p{margin:0 0 12px;font-size:14px;line-height:1.55;color:var(--n-soft)}
      .n-modalbox .n-modalnote{font-size:12.5px;color:var(--n-dim2);margin:0}
      .n-modalx{position:absolute;top:12px;right:12px;background:none;border:0;color:var(--n-muted);cursor:pointer;padding:4px}
      .n-modalbtns{display:grid;gap:8px;margin:0 0 12px}
      .n-modalbtns a{display:block;text-align:center;padding:12px;border-radius:10px;background:linear-gradient(90deg,var(--n-purple),var(--n-coral));color:var(--n-bg);font-weight:700;text-decoration:none}
      @media (max-width:760px){
        .n-topwrap{padding:10px 16px;gap:8px}
        .n-tabs,.n-beta,.n-disc{display:none !important}
        .n-bottomnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;background:color-mix(in srgb,var(--n-bg) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid color-mix(in srgb,var(--n-white-ov) 8%,transparent);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
        .n-bottomnav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;color:var(--n-dim2);text-decoration:none;font-size:12px;font-weight:600}
        .n-bottomnav a.on{color:var(--n-cyan)}
        .n-app{padding-bottom:72px}
        .n-sec{padding-left:16px !important;padding-right:16px !important}
        .n-walletbtn{padding:8px 12px !important;font-size:13px !important}
        .n-addr{padding:7px 10px !important;font-size:12px !important}
        .n-rpc{padding:6px 9px !important}
        .n-theme{width:32px;height:32px}
        .n-menu{position:fixed;top:58px;left:12px;right:12px;width:auto}
        .n-app .nodal-panel{padding:18px 16px 16px !important}
      }
      @media (max-width:360px){ .n-walletbtn svg{display:none} }
      @keyframes nodal-spin { to { transform: rotate(360deg); } }
      @keyframes panel-rise {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes route-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .nodal-panel, .route-card, .graph-mark { animation: none !important; }
      }
    `}</style>
  );
}

function BetaBanner() {
  return (
    <div id="risks" className="n-sec" style={{ position: "relative", maxWidth: 960, margin: "0 auto", padding: "20px 24px 4px", scrollMarginTop: 80 }}>
      <div style={{ border: "1px solid color-mix(in srgb, var(--n-coral) 33%, transparent)", background: "color-mix(in srgb, var(--n-warmdeep) 40%, transparent)", borderRadius: 14, padding: "16px 18px" }}>
        <span style={{ display: "inline-block", fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "0.08em", fontWeight: 700, color: "var(--n-coral)", border: "1px solid color-mix(in srgb, var(--n-coral) 33%, transparent)", borderRadius: 6, padding: "3px 8px", marginBottom: 10 }}>
          BETA
        </span>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--n-warm)" }}>
          Experimental software on an early-stage chain. Source is published but not
          independently audited — start with small amounts.
        </p>
        <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", fontSize: 13, lineHeight: 1.6, color: "var(--n-warm)" }}>
          <li>One live liquidity source today (Reef, built by the same team as Nodal). Each trade has a beta limit, shown in Route details before you swap.</li>
          <li>AI-assisted security review completed 2 Oct 2026 (<a href="https://benjiprojects1404-services.pages.dev/security-review/" target="_blank" rel="noopener" style={{ color: "var(--n-cyan)" }}>read it</a>), but no independent audit yet.</li>
          <li>Admin controls (pause, fees, sources, caps) are held by a 2-of-3 hardware-wallet multisig, not a single key.</li>
          <li>The Bridge tab previews a lock-and-mint flow — no official BlockDAG bridge exists yet.</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ id, children, style }) {
  return (
    <section id={id} className="n-sec" style={{ maxWidth: 960, margin: "0 auto", padding: "20px 24px", scrollMarginTop: 80, ...style }}>
      {children}
    </section>
  );
}

function Eyebrow({ children, color = "var(--n-cyan)" }) {
  return (
    <p style={{ margin: "0 0 12px", fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color }}>
      {children}
    </p>
  );
}

function WalletButton() {
  const { address, connecting, connect, disconnect, isWrongChain, switchToBlockDAG } = useWallet();
  const [copied, setCopied] = useState(false);

  if (address) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isWrongChain && (
          <button
            onClick={switchToBlockDAG}
            style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "var(--n-coral)", border: "1px solid color-mix(in srgb, var(--n-coral) 33%, transparent)", background: "color-mix(in srgb, var(--n-coral) 7%, transparent)", borderRadius: 999, padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Switch to 1404
          </button>
        )}
        <button
          onClick={() => {
            navigator.clipboard?.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copy address"
          className="n-addr"
          style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "'Space Mono', monospace", fontSize: 13, color: "var(--n-ink)", background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: 999, padding: "7px 12px", cursor: "pointer" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: isWrongChain ? "var(--n-coral)" : "var(--n-cyan)" }} />
          {copied ? "Copied" : truncateAddress(address)}
          <Copy size={12} color="var(--n-dim2)" />
        </button>
        <button
          onClick={disconnect}
          title="Disconnect"
          className="n-disc"
          style={{ fontSize: 12, color: "var(--n-dim2)", background: "transparent", border: "none", cursor: "pointer" }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        className="n-walletbtn"
        onClick={connect}
        disabled={connecting}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "'Instrument Sans', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          background: "var(--n-raised)",
          border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)",
          color: "var(--n-ink)",
          padding: "9px 16px",
          borderRadius: 8,
          cursor: connecting ? "default" : "pointer",
          opacity: connecting ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
      >
        <Wallet size={15} color="var(--n-cyan)" />
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    </div>
  );
}

function Hero() {
  return (
    <div className="nodal-scope" style={{ position: "relative", overflow: "hidden" }}>
      <Section style={{ position: "relative", padding: "20px 24px 12px", boxSizing: "content-box" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "'Space Mono', monospace", fontSize: 12, color: "var(--n-cyan)", border: "1px solid color-mix(in srgb, var(--n-cyan) 33%, transparent)", borderRadius: 999, padding: "5px 14px", background: "color-mix(in srgb, var(--n-cyan) 6%, transparent)", marginBottom: 16 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--n-cyan)" }} />
          on chain 1404
        </div>
        <h1 style={{ margin: "0 0 10px", fontSize: 26, lineHeight: 1.2, fontWeight: 800, maxWidth: 720 }}>
          The routing layer for <span style={{ color: "var(--n-cyan)" }}>BlockDAG</span> DeFi.
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--n-muted)", maxWidth: 680 }}>
          Nodal quotes every liquidity source registered on chain 1404 and routes each trade to whichever one returns the most. Once a bridge goes live, it will let you bring in the top assets in crypto too — non-custodial, transparent, built for this chain.
        </p>
      </Section>
    </div>
  );
}

function StatsBar() {
  // Real numbers only: tokens with a live pool are read from the chain. No dollar price is shown,
  // because the community chain's BDAG has no established outside market price.
  const [tokenCount, setTokenCount] = useState(null);
  const [feeBps, setFeeBps] = useState(null);
  useEffect(() => {
    let alive = true;
    loadLiveTokens().then((l) => alive && setTokenCount(l.length)).catch(() => alive && setTokenCount(-1));
    loadFeeBps().then((f) => alive && setFeeBps(f)).catch(() => alive && setFeeBps(-1));
    return () => { alive = false; };
  }, []);

  const stats = [
    { label: "Chain ID", value: "1404" },
    { label: "Tokens you can swap", value: tokenCount === null ? "…" : tokenCount < 0 ? "–" : String(tokenCount) },
    { label: "Live DEX sources", value: String(LIVE_SOURCES.length) },
    { label: "Routing fee", value: feeBps === null ? "…" : feeBps < 0 ? "–" : fmtFeeBps(feeBps) },
    { label: "Keys per admin action", value: "2 of 3" },
  ];
  return (
    <div className="nodal-scope n-sec" style={{ maxWidth: 960, margin: "0 auto", padding: "4px 24px" }}>
      <div style={{ border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 14, background: "var(--n-surface)", padding: "16px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, textAlign: "center" }}>
        {stats.map((s) => (
          <div key={s.label}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 22, fontWeight: 700, color: "var(--n-ink)" }}>
              {s.value}
            </div>
            <div style={{ fontSize: 12, color: "var(--n-dim2)", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <Section id="how" className="nodal-scope">
      <div className="nodal-scope">
        <Eyebrow>How it works</Eyebrow>
        <h2 style={{ margin: "0 0 14px", fontSize: 22, fontWeight: 700 }}>From one input to the best route.</h2>
        <p style={{ margin: "0 0 20px", fontSize: 15, color: "var(--n-muted)", maxWidth: 760 }}>
          Four steps happen between you entering an amount and a transaction landing on-chain — all of it visible, none of it hidden in a black box.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 14, background: "var(--n-surface)", padding: "20px 20px" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "var(--n-cyan)", marginBottom: 10 }}>{s.n}</div>
              <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>{s.title}</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--n-muted)" }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Features() {
  return (
    <Section>
      <Eyebrow color="var(--n-purple)">Why Nodal</Eyebrow>
      <h2 style={{ margin: "0 0 14px", fontSize: 22, fontWeight: 700 }}>Built to be trusted with a trade.</h2>
      <p style={{ margin: "0 0 20px", fontSize: 15, color: "var(--n-muted)", maxWidth: 560 }}>
        Every design decision here optimizes for one thing: you keeping more of your own trade.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 14, background: "var(--n-surface)", padding: "20px 20px" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `color-mix(in srgb, ${f.color} 10%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <f.icon size={18} color={f.color} strokeWidth={1.75} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>{f.title}</h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--n-muted)" }}>{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Sources() {
  return (
    <Section id="sources">
      <Eyebrow color="var(--n-coral)">Liquidity sources</Eyebrow>
      <h2 style={{ margin: "0 0 14px", fontSize: 22, fontWeight: 700 }}>What Nodal routes across today.</h2>
      <p style={{ margin: "0 0 24px", fontSize: 15, color: "var(--n-muted)", maxWidth: 560 }}>
        Every source below is registered on-chain with NodalRouter and quoted live. New DEXs are
        added with a single transaction once they have real liquidity — no redeploy.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {LIVE_SOURCES.map((src) => (
          <div
            key={src.name}
            style={{ border: "1px solid color-mix(in srgb, var(--n-cyan) 20%, transparent)", borderRadius: 12, background: "var(--n-surface)", padding: "20px 22px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--n-ink)" }}>{src.name}</span>
              <span style={{ fontSize: 11, fontFamily: "'Space Mono', monospace", color: "var(--n-cyan)", border: "1px solid color-mix(in srgb, var(--n-cyan) 33%, transparent)", borderRadius: 999, padding: "2px 9px" }}>
                LIVE
              </span>
              <span style={{ fontSize: 13, color: "var(--n-muted)" }}>{src.kind} · since {src.since}</span>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--n-warm)" }}>
              Disclosure: Reef and Nodal are built by the same team. While Reef is the only source,
              Nodal routes through it rather than comparing venues.
            </p>
            <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.8, color: "var(--n-dim2)", fontFamily: "'Space Mono', monospace", wordBreak: "break-all" }}>
              <div>Nodal adapter: {src.adapter}</div>
              <div>Reef router: {src.router}</div>
              <div>NodalRouter: {NODAL_ROUTER_ADDRESS}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28 }}>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--n-dim2)", fontFamily: "'Space Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Bridgeable networks (planned)
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[...new Set(BRIDGED_TOKENS.map((t) => t.homeChain))].map((chain) => (
            <span key={chain} style={{ fontSize: 13, color: "var(--n-muted)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 999, padding: "6px 12px", background: "var(--n-surface)" }}>
              {chain}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FAQ() {
  const [openIndex, setOpenIndex] = useState(0);
  return (
    <Section id="faq">
      <Eyebrow>FAQ</Eyebrow>
      <h2 style={{ margin: "0 0 16px", fontSize: 22, fontWeight: 700 }}>Straight answers.</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {FAQS.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={item.q} style={{ border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 12, background: "var(--n-surface)", overflow: "hidden" }}>
              <button onClick={() => setOpenIndex(open ? -1 : i)} style={{ width: "100%", background: "transparent", border: "none", color: "var(--n-ink)", padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 600, textAlign: "left" }}>
                {item.q}
                <ChevronDown size={18} color="var(--n-muted)" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", flexShrink: 0 }} />
              </button>
              {open && <p style={{ margin: 0, padding: "0 18px 18px", fontSize: 14, lineHeight: 1.6, color: "var(--n-muted)" }}>{item.a}</p>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------------- Live RPC status panel ---------------- */

function shortRpcLabel(url) {
  return url.replace(/^https?:\/\//, "");
}

async function rpcCall(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), ms))]);
}

function RpcStatusPanel() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null); // { live, checkedAt, excluded }
  const [summary, setSummary] = useState(null); // { kind: "ok" | "warn" | "unknown", text }
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);

  // Opened from the RPC status button in the nav bar; Esc or the backdrop closes it.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("nodal-open-rpc", onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("nodal-open-rpc", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  // Tell the nav-bar button how the latest check went, so its dot can show it.
  useEffect(() => {
    const up = rows.filter((r) => r.state === "up").length;
    const pending = rows.some((r) => r.state === "checking");
    const state = summary?.kind === "warn" ? "warn" : up ? "up" : pending || !rows.length ? "checking" : "down";
    window.__nodalRpcState = { state, up };
    window.dispatchEvent(new CustomEvent("nodal-rpc-status", { detail: { state, up } }));
  }, [rows, summary]);

  const checkAll = async (refresh = false) => {
    setChecking(true);
    setSummary(null);

    // 1. Which endpoints exist: the live list from bdag.community's node board, or our built-in list.
    const reg = await loadRpcRegistry({ refresh });
    const entries = reg
      ? reg.rpcs.map((r) => ({ url: r.url, feed: r.status, usable: r.usable, blurb: r.blurb }))
      : FALLBACK_RPCS.map((url) => ({ url, feed: null, usable: true, blurb: "" }));
    setMeta({ live: !!reg, checkedAt: reg?.checkedAt || null, excluded: reg?.excluded || [] });
    setRows(entries.map((e) => ({ ...e, state: "checking", latency: null })));

    // 2. Check each one live from this browser (that's the connection Nodal itself uses for reads).
    const results = await Promise.all(
      entries.map(async (e) => {
        const started = performance.now();
        try {
          const blockHex = await withTimeout(rpcCall(e.url, "eth_blockNumber"), 6000);
          const ms = Math.round(performance.now() - started);
          return { ...e, ok: true, blockNumber: parseInt(blockHex, 16), ms };
        } catch {
          return { ...e, ok: false };
        }
      })
    );

    setRows(
      results.map((r) => {
        if (r.feed === "fork") return { ...r, state: "down", latency: "different chain — not used" };
        if (r.feed === "mismatch") return { ...r, state: "down", latency: "block hashes don't match — not used" };
        if (r.feed === "behind") return { ...r, state: "down", latency: "behind the chain head — not used" };
        if (r.ok) return { ...r, state: "up", latency: `${r.ms} ms` };
        if (r.feed === "ok") return { ...r, state: "blocked", latency: "online, but not from browsers" };
        return { ...r, state: "down", latency: r.feed === "offline" ? "offline" : "unreachable" };
      })
    );

    // 3. Cross-check: do the responsive RPCs actually agree on chain history, not just "are they up".
    // Pick a block a few behind the slowest node's tip so a barely-propagated block on a faster
    // node doesn't look like a false disagreement.
    // Leave out nodes the node board already flags (behind, fork, mismatched): they're known-bad
    // and would only drag the reference block down.
    const up = results.filter((r) => r.ok && (r.feed == null || r.feed === "ok"));
    if (up.length >= 2) {
      const refBlock = Math.min(...up.map((r) => r.blockNumber)) - 5;
      if (refBlock > 0) {
        try {
          const settled = await Promise.allSettled(
            up.map(async (r) => {
              const block = await withTimeout(rpcCall(r.url, "eth_getBlockByNumber", ["0x" + refBlock.toString(16), false]), 8000);
              return { url: r.url, hash: block ? block.hash : null };
            })
          );
          // Compare the nodes that answered; a slow node shouldn't sink the whole check.
          const hashes = settled.filter((x) => x.status === "fulfilled" && x.value.hash).map((x) => x.value);
          if (hashes.length < 2) throw new Error("not enough answers");
          const uniqueHashes = new Set(hashes.map((h) => h.hash));
          if (uniqueHashes.size <= 1) {
            setSummary({ kind: "ok", text: `✓ All ${hashes.length} responsive RPCs agree on block #${refBlock}'s hash.` });
          } else {
            const groups = {};
            hashes.forEach((h) => {
              (groups[h.hash] = groups[h.hash] || []).push(shortRpcLabel(h.url));
            });
            const groupList = Object.entries(groups)
              .map(([hash, urls]) => `${urls.join(", ")} → ${hash ? hash.slice(0, 10) + "…" : "no block"}`)
              .join(" | ");
            setSummary({ kind: "warn", text: `⚠ These RPCs do NOT agree on block #${refBlock} — they may be serving different chain forks: ${groupList}` });
          }
        } catch {
          setSummary({ kind: "unknown", text: "Could not complete the block-hash cross-check this time." });
        }
      }
    }

    setChecking(false);
  };

  useEffect(() => {
    checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dotColor = { idle: "var(--n-faint)", checking: "var(--n-faint)", up: "var(--n-dot-ok)", blocked: "var(--n-dot-warn)", down: "var(--n-dot-bad)" };
  const summaryColor = summary?.kind === "ok" ? "var(--n-dot-ok)" : summary?.kind === "warn" ? "var(--n-dot-warn)" : "var(--n-muted)";
  const checkedLabel = meta?.checkedAt
    ? new Date(meta.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="RPC status"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "color-mix(in srgb, var(--n-black) 55%, transparent)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
    <div style={{ width: "min(640px, 100%)", maxHeight: "86vh", overflowY: "auto", background: "var(--n-surface)", border: "1px solid var(--n-line-strong)", borderRadius: 16, padding: "22px 24px", boxShadow: "0 30px 80px color-mix(in srgb, var(--n-black) 45%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <Eyebrow color="var(--n-purple)">Infrastructure</Eyebrow>
        <button
          onClick={() => checkAll(true)}
          disabled={checking}
          style={{
            fontSize: 12,
            color: checking ? "var(--n-faint)" : "var(--n-muted)",
            background: "transparent",
            border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)",
            borderRadius: 8,
            padding: "6px 12px",
            cursor: checking ? "default" : "pointer",
          }}
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 26, fontWeight: 700 }}>RPC status</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.6, color: "var(--n-muted)", maxWidth: "60ch" }}>
        The list of public endpoints comes from the community's{" "}
        <a href="https://bdag.community/chain#nodes" target="_blank" rel="noopener noreferrer" style={{ color: "var(--n-muted)", textDecoration: "underline" }}>node board</a>,
        so nodes that shut down drop off and new ones appear without a site update. Each one is then
        checked live from your own browser, which is the connection Nodal uses for quotes; it
        automatically falls back to the next healthy entry if one fails. It also cross-checks
        whether the responding RPCs agree on recent block hashes, because chain 1404 has had
        operators serving different chain histories. That tells you whether these RPCs agree with
        each other, not which side (if any) is correct.
      </p>
      <p style={{ margin: "0 0 18px", fontSize: 12, lineHeight: 1.6, color: "var(--n-dim2)" }}>
        {meta == null
          ? "Loading the endpoint list…"
          : meta.live
          ? `Endpoint list: live from bdag.community${checkedLabel ? ` (checked ${checkedLabel})` : ""}.`
          : "Couldn't load the live endpoint list just now, so this shows Nodal's built-in list."}
        {meta?.excluded?.length
          ? ` Never used: ${meta.excluded.map((x) => `${x.name} (${x.reason})`).join(", ")}.`
          : ""}
      </p>

      {summary && (
        <p style={{ fontSize: 12, lineHeight: 1.6, color: summaryColor, marginBottom: 14 }}>{summary.text}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.url}
            title={r.blurb || undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "'Space Mono', monospace",
              fontSize: 12,
              padding: "8px 10px",
              border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)",
              borderRadius: 6,
              background: "var(--n-surface0)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: dotColor[r.state],
                boxShadow: r.state === "up" ? `0 0 6px ${dotColor.up}` : "none",
              }}
            />
            <span style={{ color: "var(--n-ink)", flex: 1, wordBreak: "break-all" }}>{shortRpcLabel(r.url)}</span>
            <span style={{ color: "var(--n-dim2)", fontSize: 11, textAlign: "right" }}>{r.latency || (r.state === "checking" ? "checking…" : "—")}</span>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}

// Light / dark switch (28 Nov 2026). index.html applies the saved choice (or the device setting) before React starts.
function ThemeButton() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => {
      let saved = null;
      try { saved = localStorage.getItem("theme"); } catch (e) {}
      if (saved !== "light" && saved !== "dark") { const t = mq.matches ? "light" : "dark"; document.documentElement.dataset.theme = t; setTheme(t); }
    };
    if (mq.addEventListener) mq.addEventListener("change", follow);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", follow); };
  }, []);
  const light = theme === "light";
  const flip = () => {
    const next = light ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    setTheme(next);
  };
  return (
    <button type="button" className="n-theme" onClick={flip} title={light ? "Dark mode" : "Light mode"} aria-label={light ? "Switch to dark mode" : "Switch to light mode"}>
      {light ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
    </button>
  );
}

function RpcBadge() {
  const [st, setSt] = useState(() => (typeof window !== "undefined" && window.__nodalRpcState) || { state: "checking", up: 0 });
  useEffect(() => {
    const on = (e) => setSt(e.detail);
    window.addEventListener("nodal-rpc-status", on);
    return () => window.removeEventListener("nodal-rpc-status", on);
  }, []);
  const dot = { checking: "var(--n-faint)", up: "var(--n-dot-ok)", warn: "var(--n-dot-warn)", down: "var(--n-dot-bad)" }[st.state];
  const title = st.state === "up" ? `${st.up} RPC${st.up === 1 ? "" : "s"} online` : st.state === "warn" ? "RPCs disagree on recent blocks: open for details" : st.state === "down" ? "No RPC reachable right now" : "Checking RPCs…";
  return (
    <button
      type="button"
      title={title}
      aria-haspopup="dialog"
      aria-label={"RPC status: " + title}
      className="n-rpc"
      onClick={() => window.dispatchEvent(new Event("nodal-open-rpc"))}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "'Instrument Sans', sans-serif", fontSize: 12, color: "var(--n-muted)", padding: "6px 11px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--n-white-ov) 12%, transparent)", background: "transparent", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: st.state === "up" ? "0 0 6px var(--n-dot-ok)" : "none" }} />
      RPC
    </button>
  );
}

function Footer() {
  return (
    <div className="nodal-scope" style={{ borderTop: "1px solid color-mix(in srgb, var(--n-white-ov) 6%, transparent)" }}>
      <Section style={{ padding: "24px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={22} />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--n-dim2)" }}>Built for BlockDAG · chain 1404 · not independently audited · <a href="https://benjiprojects1404-services.pages.dev/security-review/" target="_blank" rel="noopener" style={{ color: "var(--n-muted)" }}>security review</a> · security reports: <a href="mailto:security@nodaldex.fyi" style={{ color: "var(--n-muted)" }}>security@nodaldex.fyi</a> · <a href="/overview.pdf" target="_blank" rel="noopener" style={{ color: "var(--n-muted)" }}>overview brief (PDF)</a> · <a href="/rpcs" style={{ color: "var(--n-muted)" }}>public RPC list</a> · built by <a href="https://benjiprojects1404-services.pages.dev" target="_blank" rel="noopener" style={{ color: "var(--n-muted)" }}>Undercurrent Works</a></p>
        <p style={{ margin: 0, flexBasis: "100%", fontSize: 12.5, color: "var(--n-dim2)" }}>Chain ID 1404 appears in public chain lists such as chainid.network and viem. Two separate networks use this ID, so check which RPC your wallet is on before you sign.</p>
      </Section>
    </div>
  );
}

/* ---------------- Product: tabs, swap, bridge ---------------- */


function BridgeTool() {
  const { address, connect } = useWallet();
  const [asset, setAsset] = useState("WETH");
  const [amount, setAmount] = useState("1");
  const [stage, setStage] = useState("idle"); // idle | locking | minting | done
  const timeoutRef = useRef(null);

  useEffect(() => () => { clearTimeout(timeoutRef.current); }, []);

  const selected = BRIDGED_TOKENS.find((t) => t.symbol === asset);
  const feeRate = 0.001;
  const amt = parseFloat(amount) || 0;
  const received = amt * (1 - feeRate);

  const startBridge = () => {
    if (!amt || amt <= 0) return;
    setStage("locking");
    timeoutRef.current = setTimeout(() => {
      setStage("minting");
      timeoutRef.current = setTimeout(() => setStage("done"), 1300);
    }, 1300);
  };

  const reset = () => setStage("idle");
  const busy = stage === "locking" || stage === "minting";

  return (
    <div className="nodal-scope nodal-panel" style={{ maxWidth: 480, background: "var(--n-surface)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 16, padding: "24px 24px 22px", boxShadow: "0 30px 60px -30px color-mix(in srgb, var(--n-black) 56%, transparent)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid color-mix(in srgb, var(--n-coral) 33%, transparent)", background: "color-mix(in srgb, var(--n-coral) 7%, transparent)", borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
        <AlertTriangle size={16} color="var(--n-coral)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--n-warm)" }}>
          No official BlockDAG bridge is live yet. This models the lock-and-mint flow for demonstration only — don't send real funds expecting them to arrive.
        </p>
      </div>

      <div style={{ border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 12, background: "var(--n-surface0)", padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "var(--n-muted)" }}>Bridging from {selected.homeChain}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy || stage === "done"}
            placeholder="0.00"
            style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, background: "transparent", border: "none", color: "var(--n-ink)", minWidth: 0 }}
          />
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            disabled={busy || stage === "done"}
            style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: 999, padding: "7px 14px", color: "var(--n-cyan)", cursor: "pointer" }}
          >
            {BRIDGED_TOKENS.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
        <div style={{ background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--n-cyan)" }}>
          <ArrowDownUp size={16} strokeWidth={1.75} />
        </div>
      </div>

      <div style={{ border: "1px solid color-mix(in srgb, var(--n-white-ov) 8%, transparent)", borderRadius: 12, background: "var(--n-surface0)", padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "var(--n-muted)" }}>Receiving on chain 1404</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, color: "var(--n-ink)" }}>
            {formatAmount(received)}
          </span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "var(--n-raised)", border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", borderRadius: 999, padding: "7px 14px", color: "var(--n-cyan)" }}>
            {asset}
          </span>
        </div>
      </div>

      <p style={{ margin: "10px 2px 0", fontSize: 12, color: "var(--n-dim2)" }}>Bridge fee {(feeRate * 100).toFixed(2)}% · destination BlockDAG, chain 1404</p>

      {stage !== "done" ? (
        <button
          onClick={address ? startBridge : connect}
          disabled={busy || (!!address && (!amt || amt <= 0))}
          style={{
            width: "100%",
            marginTop: 20,
            padding: "13px 18px",
            borderRadius: 10,
            border: "none",
            background: address && (!amt || amt <= 0) ? "var(--n-line-strong)" : "linear-gradient(90deg, var(--n-purple), var(--n-coral))",
            color: address && (!amt || amt <= 0) ? "var(--n-dim2)" : "var(--n-bg)",
            fontFamily: "'Instrument Sans', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            cursor: busy ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            opacity: busy ? 0.85 : 1,
          }}
        >
          {stage === "locking" && (<><Loader2 size={18} style={{ animation: "nodal-spin 1s linear infinite" }} /> Locking {asset} on {selected.homeChain}</>)}
          {stage === "minting" && (<><Loader2 size={18} style={{ animation: "nodal-spin 1s linear infinite" }} /> Minting wrapped {asset} on BlockDAG</>)}
          {stage === "idle" && address && (<><Lock size={16} /> Bridge assets</>)}
          {stage === "idle" && !address && (<><Wallet size={15} /> Connect wallet to bridge</>)}
        </button>
      ) : (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ width: "100%", padding: "12px 18px", borderRadius: 10, border: "none", background: "var(--n-green)", color: "var(--n-ink)", fontFamily: "'Instrument Sans', sans-serif", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Check size={17} /> Bridged — funds available on BlockDAG
          </div>
          <button onClick={reset} style={{ width: "100%", padding: "10px 18px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--n-white-ov) 10%, transparent)", background: "transparent", color: "var(--n-muted)", fontFamily: "'Instrument Sans', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            Bridge more
          </button>
        </div>
      )}
    </div>
  );
}


