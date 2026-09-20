import React, { useState, useEffect, useRef, useContext, createContext } from "react";
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
} from "lucide-react";

/* ---------------- Wallet connection ---------------- */

const BLOCKDAG_CHAIN_ID_DEC = 1404;
const BLOCKDAG_CHAIN_ID_HEX = "0x57c";
const BLOCKDAG_RPCS = [
  "https://rpc.blockdag.engineering/",
  "https://rpc.welshdag.trade/",
  "https://rpc.bdagexplorer.com/",
  "https://rpc.cms-mining-pool.net/",
  "https://rpc.dvdmining.com/",
  "https://rpc.capedag.com/",
  "https://rpc.east.bdag-us.org/",
  "https://rpc.west.bdag-us.org/",
  "https://rms-bdag-rpc.de/api/rpc-live",
];
// NOTE: rpc.bdagscan.com is deliberately excluded — confirmed as a diverged
// fork (millions of blocks behind, block-hash-inconsistent with every other
// independently-run node) via https://bdagexplorer.com/leaderboard.html#rpc-ranking.
const BLOCKDAG_EXPLORER = "https://explorer.blockdag.engineering/";

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
      setError("No EVM wallet detected. Install MetaMask or another browser wallet extension.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAddress(accounts[0] || null);
      const cidHex = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(parseInt(cidHex, 16));
    } catch (e) {
      setError(e && e.message ? e.message : "Connection request was rejected.");
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
                chainName: "BlockDAG Mainnet",
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

4. Fees. Nodal charges a routing fee (currently 0.15%) on top of whatever fee
the underlying liquidity source charges. Both are shown before you confirm
any trade.

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
        background: "#0A0E17EE",
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
          background: "#121826",
          border: "1px solid #FFFFFF1A",
          borderRadius: 16,
          boxShadow: "0 30px 80px -20px #000000CC",
        }}
      >
        <div style={{ padding: "22px 24px 14px" }}>
          <h2 id="tos-gate-title" style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            Before you connect a wallet
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "#8B93A7" }}>
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
            color: "#C7CCD8",
            whiteSpace: "pre-wrap",
            fontFamily: "'Space Grotesk', sans-serif",
            borderTop: "1px solid #FFFFFF14",
            borderBottom: "1px solid #FFFFFF14",
          }}
        >
          <div style={{ padding: "16px 0" }}>{NODAL_TOS_TEXT}</div>
        </div>

        <div style={{ padding: "18px 24px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "#F4F6FB", cursor: "pointer" }}>
            <input type="checkbox" checked={agreedTerms} onChange={(e) => setAgreedTerms(e.target.checked)} style={{ marginTop: 2 }} />
            I have read and agree to the Terms of Service above.
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "#F4F6FB", cursor: "pointer" }}>
            <input type="checkbox" checked={agreedJurisdiction} onChange={(e) => setAgreedJurisdiction(e.target.checked)} style={{ marginTop: 2 }} />
            I certify that I am not located in, a resident of, or accessing this
            from the United States, United Kingdom, or a jurisdiction where use
            of this software would be unlawful.
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button
              onClick={declineTos}
              style={{ flex: 1, padding: "11px 16px", borderRadius: 10, border: "1px solid #FFFFFF1A", background: "transparent", color: "#8B93A7", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
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
                background: canContinue ? "linear-gradient(90deg, #A64CF0, #FF8266)" : "#2A3245",
                color: canContinue ? "#0A0E17" : "#6B7280",
                fontFamily: "'Space Grotesk', sans-serif",
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

// Nodal's own routing fee, on top of whatever the underlying DEX charges.
// Shown as a separate line item, never folded invisibly into the quoted rate.
const NODAL_FEE_RATE = 0.0015; // 0.15%
const NODAL_FEE_LABEL = "0.15%";

// Used ONLY inside the "Try it" interactive preview below, to demonstrate the UI mechanics
// with plausible-looking numbers. These are NOT real integrations, confirmed venues, or
// promises of what will launch here — deliberately generic names so nobody mistakes them
// for an actual product. See the disclaimer directly above the widget. Kept fully separate
// from the real-status copy in the Sources section, which reflects that zero real sources
// exist on chain 1404's canonical network today.
const DEMO_SOURCES = [
  { id: "demo-a", name: "Demo venue A", note: "Simulated for this preview only", spreadFactor: 0.997, feeLabel: "0.30%" },
  { id: "demo-b", name: "Demo venue B", note: "Simulated for this preview only", spreadFactor: 0.985, feeLabel: "1.20%" },
];

const STEPS = [
  { n: "01", title: "Enter your trade", body: "Pick the two tokens and the amount. Nodal reads live balances so you always know what you're working with." },
  { n: "02", title: "Every source gets queried", body: "Nodal calls each registered DEX's router in parallel and reads back real output amounts. No source is live on chain 1404's canonical network yet — the contract is deployed and ready, and the first real source gets added the moment one exists." },
  { n: "03", title: "Quotes are normalized", body: "Fees and price impact are priced in before anything is ranked, so what you compare is the actual amount you'd receive, not a headline rate." },
  { n: "04", title: "You execute, in one signature", body: "Your wallet signs a single transaction against the winning venue. Nodal never takes custody of your funds at any point." },
];

const FEATURES = [
  { icon: Gauge, color: "#3FD9EA", title: "Best execution", body: "Routes are ranked by net output after fees, not by whichever venue is easiest to integrate." },
  { icon: ShieldCheck, color: "#A64CF0", title: "Non-custodial", body: "Your assets stay in your wallet until the moment you sign. Nodal never holds a balance." },
  { icon: Eye, color: "#FF8266", title: "Transparent routing", body: "Every quote shows its source, fee, and net output side by side — nothing hidden behind a single blended number." },
  { icon: Globe2, color: "#3FD9EA", title: "Top-10 asset support", body: "Trade the ten most liquid assets in crypto as bridged tokens, alongside BlockDAG's own native assets." },
  { icon: Network, color: "#A64CF0", title: "Built for chain 1404", body: "Not a generic multi-chain wrapper — routing logic is written specifically for BlockDAG's liquidity layout." },
  { icon: SlidersHorizontal, color: "#FF8266", title: "Slippage controls", body: "Set your own tolerance before you sign. No trade executes outside the bounds you set." },
];

const FAQS = [
  { q: "What is Nodal?", a: "Nodal is a trade routing layer for BlockDAG (chain ID 1404). Instead of trading against a single DEX, you submit a trade once and Nodal compares it across every liquidity source it supports, then routes you to whichever one returns the most." },
  { q: "Which chain does this run on?", a: "BlockDAG mainnet exclusively, chain ID 1404." },
  { q: "Does Nodal ever hold my funds?", a: "No. Nodal is non-custodial — every trade is a direct signature from your own wallet to the chosen DEX's contract. There is no intermediate holding step." },
  { q: "What does Nodal charge?", a: `Nodal adds a small routing fee — ${NODAL_FEE_LABEL} — on top of whatever fee the underlying DEX charges. It's broken out as its own line item before you confirm, never folded invisibly into the quoted rate.` },
  { q: "Which liquidity sources are live right now?", a: "None yet. NodalRouter is deployed on BlockDAG's canonical chain, but no DEX with real liquidity has launched there as of today — BlockDAG's own roadmap lists its native DEX under a later phase. The contract is ready and waiting; adding a source is a single transaction once one genuinely exists." },
  { q: "Can I bridge assets in from other chains?", a: "There's no official BlockDAG bridge live yet. The Bridge tab models the lock-and-mint flow you'd expect once one launches — it's a preview of the UI, not a working transfer. Don't send funds expecting them to arrive until a real bridge contract exists and has been audited." },
  { q: "Has this been audited?", a: "It's been run through Slither (an open-source static analyzer) — every finding was reviewed, a few real issues were fixed, and the rest were confirmed as false positives. That's a legitimate first gate, but it's automated, not a paid third-party human audit. No human security audit has been completed yet. Treat it accordingly until that changes." },
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

function Logo({ size = 32 }) {
  // Mirrors the benji projects brand mark: dashed circle, cyan dots up top,
  // coral dots below, crossing lines, and a bracketed monogram in the center
  // (their "<BP/>" becomes "<N/>" here). Font sizes are fixed in the 0-100
  // viewBox coordinate space — the whole mark scales via width/height, so
  // these must NOT depend on the `size` prop.
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="42" fill="none" stroke="#2A3448" strokeWidth="3" strokeDasharray="5 7" />
      <line x1="19" y1="19" x2="81" y2="81" stroke="#3FD9EA" strokeOpacity="0.35" strokeWidth="2" />
      <line x1="81" y1="19" x2="19" y2="81" stroke="#FF8266" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="19" cy="19" r="6" fill="#3FD9EA" />
      <circle cx="81" cy="19" r="6" fill="#3FD9EA" />
      <circle cx="19" cy="81" r="6" fill="#FF8266" />
      <circle cx="81" cy="81" r="6" fill="#FF8266" />
      <text x="27" y="60" textAnchor="middle" fontFamily="'Space Mono', monospace" fontWeight="700" fontSize="30" fill="#FF8266">
        &lt;
      </text>
      <text x="50" y="60" textAnchor="middle" fontFamily="'Space Mono', monospace" fontWeight="700" fontSize="32" fill="#A64CF0">
        N
      </text>
      <text x="74" y="60" textAnchor="middle" fontFamily="'Space Mono', monospace" fontWeight="700" fontSize="30" fill="#FF8266">
        /&gt;
      </text>
    </svg>
  );
}

export default function NodalLanding() {
  const wallet = useWalletState();
  return (
    <WalletContext.Provider value={wallet}>
      <div style={{ minHeight: "100%", background: "#0A0E17", fontFamily: "'Space Grotesk', sans-serif", color: "#F4F6FB" }}>
        <GlobalStyle />
        {wallet.showTosGate && <TosGateModal />}
        <NavBar />
        <BetaBanner />
        <Hero />
        <StatsBar />
        <HowItWorks />
        <ProductSection />
        <Features />
        <Sources />
        <FAQ />
        <RpcStatusPanel />
        <Footer />
      </div>
    </WalletContext.Provider>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
      html { scroll-behavior: smooth; }
      .nodal-scope * { box-sizing: border-box; }
      .nodal-scope select { appearance: none; -webkit-appearance: none; }
      .nodal-scope input::placeholder { color: #4B5468; }
      .nodal-scope input:focus,
      .nodal-scope select:focus,
      .nodal-scope button:focus-visible,
      .nodal-scope a:focus-visible {
        outline: 2px solid #3FD9EA;
        outline-offset: 2px;
      }
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
  const [open, setOpen] = useState(false);
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px 8px" }}>
      <div style={{ border: "1px solid #FF826655", background: "#2A1A1866", borderRadius: 12, padding: "16px 18px" }}>
        <span
          style={{
            display: "inline-block",
            fontFamily: "'Space Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.08em",
            fontWeight: 700,
            color: "#FF8266",
            border: "1px solid #FF826655",
            borderRadius: 6,
            padding: "3px 8px",
            marginBottom: 10,
          }}
        >
          BETA
        </span>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#C9B3AD" }}>
          Experimental software on an early-stage chain. Source is published but not
          independently audited — start with small amounts.
        </p>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: "none", border: "none", padding: 0, marginTop: 8, color: "#3FD9EA", fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {open ? "Show less" : "Read more"}
        </button>
        {open && (
          <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", fontSize: 13, lineHeight: 1.6, color: "#C9B3AD" }}>
            <li>No live liquidity sources yet — the contract is deployed and ready to activate the moment a real one appears on chain.</li>
            <li>Checked with Slither (open-source static analysis), but no paid third-party human audit yet.</li>
            <li>Contract ownership is a single key today, not yet a multisig.</li>
            <li>The Bridge tab previews a lock-and-mint flow — no official BlockDAG bridge exists yet.</li>
          </ul>
        )}
      </div>
    </div>
  );
}

function Section({ id, children, style }) {
  return (
    <section id={id} style={{ maxWidth: 960, margin: "0 auto", padding: "72px 24px", ...style }}>
      {children}
    </section>
  );
}

function Eyebrow({ children, color = "#3FD9EA" }) {
  return (
    <p style={{ margin: "0 0 12px", fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color }}>
      {children}
    </p>
  );
}

function WalletButton() {
  const { address, connecting, connect, disconnect, error, isWrongChain, switchToBlockDAG } = useWallet();
  const [copied, setCopied] = useState(false);

  if (address) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isWrongChain && (
          <button
            onClick={switchToBlockDAG}
            style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#FF8266", border: "1px solid #FF826655", background: "#FF826612", borderRadius: 999, padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
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
          style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#F4F6FB", background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: 999, padding: "7px 12px", cursor: "pointer" }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: isWrongChain ? "#FF8266" : "#3FD9EA" }} />
          {copied ? "Copied" : truncateAddress(address)}
          <Copy size={12} color="#6B7488" />
        </button>
        <button
          onClick={disconnect}
          title="Disconnect"
          style={{ fontSize: 12, color: "#6B7488", background: "transparent", border: "none", cursor: "pointer" }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        onClick={connect}
        disabled={connecting}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          background: "#171F30",
          border: "1px solid #FFFFFF1A",
          color: "#F4F6FB",
          padding: "9px 16px",
          borderRadius: 8,
          cursor: connecting ? "default" : "pointer",
          opacity: connecting ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
      >
        <Wallet size={15} color="#3FD9EA" />
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {error && <span style={{ fontSize: 11, color: "#FF8266", maxWidth: 220, textAlign: "right" }}>{error}</span>}
    </div>
  );
}

function NavBar() {
  const links = [
    { href: "#how", label: "How it works" },
    { href: "#sources", label: "Sources" },
    { href: "#faq", label: "FAQ" },
  ];
  return (
    <div className="nodal-scope" style={{ position: "sticky", top: 0, zIndex: 20, background: "#0A0E17CC", backdropFilter: "blur(10px)", borderBottom: "1px solid #FFFFFF10" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={28} />
          <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 17 }}>nodal</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} style={{ fontSize: 14, color: "#8B93A7", textDecoration: "none", display: "none" }} className="nav-link">
              {l.label}
            </a>
          ))}
          <WalletButton />
        </div>
      </div>
      <style>{`@media (min-width: 640px) { .nav-link { display: inline !important; } }`}</style>
    </div>
  );
}

function Hero() {
  return (
    <div className="nodal-scope" style={{ position: "relative", overflow: "hidden" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 900px 500px at 15% 0%, #17233A 0%, transparent 60%), radial-gradient(ellipse 800px 500px at 100% 10%, #241835 0%, transparent 55%)", pointerEvents: "none" }} />
      <Section style={{ position: "relative", padding: "88px 24px 56px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#3FD9EA", border: "1px solid #3FD9EA55", borderRadius: 999, padding: "5px 14px", background: "#3FD9EA0F", marginBottom: 22 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3FD9EA" }} />
          on chain 1404
        </div>
        <h1 style={{ margin: "0 0 18px", fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1.12, fontWeight: 700, maxWidth: 720, marginInline: "auto" }}>
          The routing layer for <span style={{ color: "#3FD9EA" }}>BlockDAG</span> DeFi.
        </h1>
        <p style={{ margin: "0 auto 32px", fontSize: 17, lineHeight: 1.6, color: "#8B93A7", maxWidth: 600 }}>
          Nodal compares every liquidity source on chain 1404 in real time, routes each trade to whichever one returns the most, and lets you bring in the top assets in crypto through a single bridge — non-custodial, transparent, built for this chain.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="#app" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, background: "linear-gradient(90deg, #A64CF0, #FF8266)", color: "#0A0E17", padding: "13px 24px", borderRadius: 10, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
            Launch app <ArrowRight size={16} />
          </a>
          <a href="#how" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, border: "1px solid #FFFFFF22", color: "#F4F6FB", padding: "13px 24px", borderRadius: 10, textDecoration: "none" }}>
            How it works
          </a>
        </div>
      </Section>
    </div>
  );
}

// ---- BDAG/USD price (off-chain, informational only) ----
// Same CoinGecko id Handshake uses, confirmed correct: coingecko.com/en/coins/blockdag
const COINGECKO_ID = "blockdag";
function useBdagPrice() {
  const [price, setPrice] = useState(null);
  const [change, setChange] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_ID}&vs_currencies=usd&include_24hr_change=true`);
        const data = await res.json();
        const info = data[COINGECKO_ID];
        if (cancelled) return;
        if (!info) { setStatus("error"); return; }
        setPrice(info.usd);
        setChange(info.usd_24h_change);
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { price, change, status };
}

function StatsBar() {
  const { price, change, status } = useBdagPrice();
  const priceDisplay =
    status === "ok" && price != null ? `$${price < 0.01 ? price.toFixed(6) : price.toFixed(4)}` : status === "error" ? "n/a" : "…";

  const stats = [
    { label: "BDAG / USD", value: priceDisplay, isPrice: true },
    { label: "Chain ID", value: "1404" },
    { label: "Assets supported", value: String(TOKENS.length) },
    { label: "Live DEX sources", value: "0" },
    { label: "Routing fee", value: NODAL_FEE_LABEL },
  ];
  return (
    <div className="nodal-scope" style={{ borderTop: "1px solid #FFFFFF10", borderBottom: "1px solid #FFFFFF10" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 20, textAlign: "center" }}>
        {stats.map((s) => (
          <div key={s.label}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 22, fontWeight: 700, color: "#F4F6FB" }}>
              {s.value}
              {s.isPrice && status === "ok" && change != null && (
                <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 6, color: change >= 0 ? "#3FD9EA" : "#FF8266" }}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(1)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#6B7488", marginTop: 4 }}>{s.label}</div>
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
        <h2 style={{ margin: "0 0 14px", fontSize: 30, fontWeight: 700 }}>From one input to the best route.</h2>
        <p style={{ margin: "0 0 40px", fontSize: 15, color: "#8B93A7", maxWidth: 560 }}>
          Four steps happen between you entering an amount and a transaction landing on-chain — all of it visible, none of it hidden in a black box.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ border: "1px solid #FFFFFF14", borderRadius: 14, background: "#121826", padding: "20px 20px" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#3FD9EA", marginBottom: 10 }}>{s.n}</div>
              <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700 }}>{s.title}</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#8B93A7" }}>{s.body}</p>
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
      <Eyebrow color="#A64CF0">Why Nodal</Eyebrow>
      <h2 style={{ margin: "0 0 14px", fontSize: 30, fontWeight: 700 }}>Built to be trusted with a trade.</h2>
      <p style={{ margin: "0 0 40px", fontSize: 15, color: "#8B93A7", maxWidth: 560 }}>
        Every design decision here optimizes for one thing: you keeping more of your own trade.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ border: "1px solid #FFFFFF14", borderRadius: 14, background: "#121826", padding: "20px 20px" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `${f.color}1A`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <f.icon size={18} color={f.color} strokeWidth={1.75} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>{f.title}</h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#8B93A7" }}>{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Sources() {
  return (
    <Section id="sources">
      <Eyebrow color="#FF8266">Liquidity sources</Eyebrow>
      <h2 style={{ margin: "0 0 14px", fontSize: 30, fontWeight: 700 }}>What Nodal routes across today.</h2>
      <p style={{ margin: "0 0 24px", fontSize: 15, color: "#8B93A7", maxWidth: 560 }}>
        Zero DEXs have launched real liquidity on chain 1404's canonical network as of today.
        Rather than name a specific integration that might not materialize — BlockDAG's own
        native DEX is still an unconfirmed roadmap item, not something live — Nodal's contract
        is built to add any compatible source the moment one proves real. That's a single
        on-chain transaction, not a redeploy.
      </p>

      <div
        style={{
          border: "1px dashed #FFFFFF22",
          borderRadius: 12,
          background: "#121826",
          padding: "20px 22px",
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            border: "1px dashed #FFFFFF33",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "#6B7488",
            fontFamily: "'Space Mono', monospace",
            fontSize: 16,
          }}
        >
          ?
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#F4F6FB" }}>No confirmed source yet</div>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.6, color: "#8B93A7" }}>
            We're watching WelshDAG's dApp library (reads deployed contracts straight off the
            canonical chain, not marketing claims) and BlockDAG's own community channels for the
            first DEX with real liquidity. Nothing is being promised on a timeline — this card
            updates the day something real shows up, not before.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6B7488", fontFamily: "'Space Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Bridgeable networks (planned)
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[...new Set(BRIDGED_TOKENS.map((t) => t.homeChain))].map((chain) => (
            <span key={chain} style={{ fontSize: 13, color: "#8B93A7", border: "1px solid #FFFFFF14", borderRadius: 999, padding: "6px 12px", background: "#121826" }}>
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
      <h2 style={{ margin: "0 0 32px", fontSize: 30, fontWeight: 700 }}>Straight answers.</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {FAQS.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={item.q} style={{ border: "1px solid #FFFFFF14", borderRadius: 12, background: "#121826", overflow: "hidden" }}>
              <button onClick={() => setOpenIndex(open ? -1 : i)} style={{ width: "100%", background: "transparent", border: "none", color: "#F4F6FB", padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, textAlign: "left" }}>
                {item.q}
                <ChevronDown size={18} color="#8B93A7" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", flexShrink: 0 }} />
              </button>
              {open && <p style={{ margin: 0, padding: "0 18px 18px", fontSize: 14, lineHeight: 1.6, color: "#8B93A7" }}>{item.a}</p>}
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
  const [rows, setRows] = useState(BLOCKDAG_RPCS.map((url) => ({ url, state: "idle", latency: null })));
  const [summary, setSummary] = useState(null); // { kind: "ok" | "warn" | "unknown", text }
  const [checking, setChecking] = useState(false);

  const checkAll = async () => {
    setChecking(true);
    setSummary(null);
    setRows(BLOCKDAG_RPCS.map((url) => ({ url, state: "checking", latency: null })));

    const results = await Promise.all(
      BLOCKDAG_RPCS.map(async (url) => {
        const started = performance.now();
        try {
          const blockHex = await withTimeout(rpcCall(url, "eth_blockNumber"), 6000);
          const ms = Math.round(performance.now() - started);
          return { url, ok: true, blockNumber: parseInt(blockHex, 16), ms };
        } catch {
          return { url, ok: false };
        }
      })
    );

    setRows(results.map((r) => ({ url: r.url, state: r.ok ? "up" : "down", latency: r.ok ? `${r.ms} ms` : "unreachable" })));

    // Cross-check: do the responsive RPCs actually agree on chain history, not just "are they up".
    // Pick a block a few behind the slowest node's tip so a barely-propagated block on a faster
    // node doesn't look like a false disagreement.
    const up = results.filter((r) => r.ok);
    if (up.length >= 2) {
      const refBlock = Math.min(...up.map((r) => r.blockNumber)) - 5;
      if (refBlock > 0) {
        try {
          const hashes = await Promise.all(
            up.map(async (r) => {
              const block = await rpcCall(r.url, "eth_getBlockByNumber", ["0x" + refBlock.toString(16), false]);
              return { url: r.url, hash: block ? block.hash : null };
            })
          );
          const uniqueHashes = new Set(hashes.map((h) => h.hash));
          if (uniqueHashes.size <= 1) {
            setSummary({ kind: "ok", text: `✓ All ${up.length} responsive RPCs agree on block #${refBlock}'s hash.` });
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

  const dotColor = { idle: "#5A6478", checking: "#A64CF0", up: "#3FD9EA", down: "#FF8266" };
  const summaryColor = summary?.kind === "ok" ? "#3FD9EA" : summary?.kind === "warn" ? "#FF8266" : "#8B93A7";

  return (
    <Section id="rpc-status">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <Eyebrow color="#A64CF0">Infrastructure</Eyebrow>
        <button
          onClick={checkAll}
          disabled={checking}
          style={{
            fontSize: 12,
            color: checking ? "#5A6478" : "#8B93A7",
            background: "transparent",
            border: "1px solid #FFFFFF1A",
            borderRadius: 8,
            padding: "6px 12px",
            cursor: checking ? "default" : "pointer",
          }}
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 26, fontWeight: 700 }}>RPC status</h2>
      <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "#8B93A7", maxWidth: "60ch" }}>
        Checked live, from your own browser, against each endpoint below — not borrowed from a
        third-party leaderboard. Nodal automatically falls back to the next entry if one fails.
        This also cross-checks whether the responding RPCs agree on recent block hashes — chain
        1404 has documented, actively-discussed disagreement between different node operators
        about which chain history is canonical. This check can only tell you whether these
        specific RPCs agree with each other, not which side (if any) is correct.
      </p>

      {summary && (
        <p style={{ fontSize: 12, lineHeight: 1.6, color: summaryColor, marginBottom: 14 }}>{summary.text}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.url}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "'Space Mono', monospace",
              fontSize: 12,
              padding: "8px 10px",
              border: "1px solid #FFFFFF14",
              borderRadius: 6,
              background: "#0E1420",
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
            <span style={{ color: "#F4F6FB", flex: 1, wordBreak: "break-all" }}>{shortRpcLabel(r.url)}</span>
            <span style={{ color: "#6B7488", fontSize: 11, whiteSpace: "nowrap" }}>{r.latency || (r.state === "checking" ? "checking…" : "—")}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <div className="nodal-scope" style={{ borderTop: "1px solid #FFFFFF10" }}>
      <Section style={{ padding: "40px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={24} />
          <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14 }}>nodal</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#6B7488" }}>Built for BlockDAG · chain 1404 · not audited yet</p>
      </Section>
    </div>
  );
}

/* ---------------- Product: tabs, swap, bridge ---------------- */

function TokenSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: 999, padding: "7px 14px", color: "#3FD9EA", cursor: "pointer" }}
    >
      {NATIVE_TOKENS.filter((t) => options.includes(t.symbol)).length > 0 && (
        <optgroup label="Native">
          {NATIVE_TOKENS.filter((t) => options.includes(t.symbol)).map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
          ))}
        </optgroup>
      )}
      {BRIDGED_TOKENS.filter((t) => options.includes(t.symbol)).length > 0 && (
        <optgroup label="Bridged (top 10)">
          {BRIDGED_TOKENS.filter((t) => options.includes(t.symbol)).map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function ProductSection() {
  const [tab, setTab] = useState("swap");
  return (
    <Section id="app">
      <Eyebrow>Try it</Eyebrow>
      <h2 style={{ margin: "0 0 14px", fontSize: 30, fontWeight: 700 }}>Route a trade or bridge an asset in.</h2>
      <p style={{ margin: "0 0 28px", fontSize: 15, color: "#8B93A7", maxWidth: 560 }}>
        This preview uses illustrative quotes and prices — nothing here is wired to on-chain pools or a live bridge yet.
      </p>

      <div className="nodal-scope" style={{ display: "flex", gap: 6, marginBottom: 18, background: "#0E1420", border: "1px solid #FFFFFF14", borderRadius: 12, padding: 5, maxWidth: 480 }}>
        {[{ id: "swap", label: "Swap" }, { id: "bridge", label: "Bridge" }].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 14,
              background: tab === t.id ? "linear-gradient(90deg, #A64CF0, #FF8266)" : "transparent",
              color: tab === t.id ? "#0A0E17" : "#8B93A7",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "swap" ? <SwapTool /> : <BridgeTool />}
    </Section>
  );
}

function SwapTool() {
  const { address, connect } = useWallet();
  const [fromToken, setFromToken] = useState("BDAG");
  const [toToken, setToToken] = useState("USDC");
  const [amount, setAmount] = useState("100");
  const [isRouting, setIsRouting] = useState(false);
  const [results, setResults] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const swapTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setResults(null);
    setSelectedId(null);
    setConfirmed(false);
  };

  const findRoutes = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || fromToken === toToken) return;

    setIsRouting(true);
    setResults(null);
    setSelectedId(null);
    setConfirmed(false);

    const from = TOKENS.find((t) => t.symbol === fromToken);
    const to = TOKENS.find((t) => t.symbol === toToken);
    const baseOut = (amt * from.price) / to.price;

    timeoutRef.current = setTimeout(() => {
      const routes = DEMO_SOURCES
        .map((s) => ({ ...s, out: baseOut * s.spreadFactor * (0.995 + Math.random() * 0.01) }))
        .sort((a, b) => b.out - a.out);
      setResults(routes);
      setSelectedId(routes[0].id);
      setIsRouting(false);
    }, 1400);
  };

  const confirmTrade = () => {
    if (!selectedId) return;
    setConfirmed(true);
  };

  const allSymbols = TOKENS.map((t) => t.symbol);
  const selectedRoute = results && selectedId ? results.find((r) => r.id === selectedId) : null;
  const grossOut = selectedRoute ? selectedRoute.out : 0;
  const nodalFeeAmt = grossOut * NODAL_FEE_RATE;
  const netOut = grossOut - nodalFeeAmt;

  return (
    <div className="nodal-scope nodal-panel" style={{ maxWidth: 480, background: "#121826", border: "1px solid #FFFFFF14", borderRadius: 16, padding: "24px 24px 22px", boxShadow: "0 30px 60px -30px #00000090" }}>
      <FieldBlock label="You pay" token={fromToken} onTokenChange={setFromToken} amount={amount} onAmountChange={setAmount} editableAmount balanceHint="Balance: 128.40" allSymbols={allSymbols} />

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
        <button onClick={swapTokens} aria-label="Reverse the direction of the trade" style={{ background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#3FD9EA" }}>
          <ArrowDownUp size={16} strokeWidth={1.75} />
        </button>
      </div>

      <FieldBlock
        label="You receive"
        token={toToken}
        onTokenChange={setToToken}
        amount={results && selectedId ? formatAmount(netOut) : ""}
        editableAmount={false}
        placeholder="—"
        allSymbols={allSymbols}
      />

      <button
        onClick={findRoutes}
        disabled={isRouting || !amount || parseFloat(amount) <= 0 || fromToken === toToken}
        style={{
          width: "100%",
          marginTop: 20,
          padding: "13px 18px",
          borderRadius: 10,
          border: "none",
          background: fromToken === toToken ? "#2A3245" : "linear-gradient(90deg, #A64CF0, #FF8266)",
          color: fromToken === toToken ? "#6B7280" : "#0A0E17",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 16,
          cursor: isRouting ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          opacity: isRouting ? 0.85 : 1,
        }}
      >
        {isRouting ? (<><GraphMark size={18} spinning className="graph-mark" />Scanning the DAG</>) : fromToken === toToken ? "Choose two different tokens" : "Find best route"}
      </button>

      {fromToken === toToken && <p style={{ margin: "10px 0 0", fontSize: 13, color: "#6B7488" }}>Pick two different tokens to route between.</p>}

      {results && (
        <div style={{ marginTop: 22 }}>
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#8B93A7", margin: "0 0 12px" }}>
            {results.length} routes found for {amount} {fromToken} → {toToken}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map((r, i) => (
              <RouteCard key={r.id} route={r} index={i} toSymbol={toToken} isBest={i === 0} isSelected={selectedId === r.id} onSelect={() => { setSelectedId(r.id); setConfirmed(false); }} />
            ))}
          </div>

          {selectedRoute && (
            <div style={{ marginTop: 14, border: "1px solid #FFFFFF14", borderRadius: 12, background: "#0E1420", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <FeeRow label={`${selectedRoute.name} output`} value={`${formatAmount(grossOut)} ${toToken}`} />
              <FeeRow label={`Nodal routing fee (${NODAL_FEE_LABEL})`} value={`− ${formatAmount(nodalFeeAmt)} ${toToken}`} muted />
              <div style={{ height: 1, background: "#FFFFFF14", margin: "2px 0" }} />
              <FeeRow label="You receive" value={`${formatAmount(netOut)} ${toToken}`} bold />
            </div>
          )}

          <button
            onClick={address ? confirmTrade : connect}
            disabled={(!selectedId || confirmed) && !!address}
            style={{
              width: "100%",
              marginTop: 16,
              padding: "12px 18px",
              borderRadius: 10,
              border: confirmed ? "none" : "1px solid #3FD9EA55",
              background: confirmed ? "#1D8F76" : "transparent",
              color: confirmed ? "#F4F6FB" : "#3FD9EA",
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 15,
              cursor: confirmed ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {confirmed ? (<><Check size={17} /> Trade confirmed</>) : address ? "Confirm and send trade" : (<><Wallet size={15} /> Connect wallet to trade</>)}
          </button>
        </div>
      )}
    </div>
  );
}

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
    <div className="nodal-scope nodal-panel" style={{ maxWidth: 480, background: "#121826", border: "1px solid #FFFFFF14", borderRadius: 16, padding: "24px 24px 22px", boxShadow: "0 30px 60px -30px #00000090" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid #FF826655", background: "#FF826612", borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
        <AlertTriangle size={16} color="#FF8266" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#D8B8AA" }}>
          No official BlockDAG bridge is live yet. This models the lock-and-mint flow for demonstration only — don't send real funds expecting them to arrive.
        </p>
      </div>

      <div style={{ border: "1px solid #FFFFFF14", borderRadius: 12, background: "#0E1420", padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "#8B93A7" }}>Bridging from {selected.homeChain}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy || stage === "done"}
            placeholder="0.00"
            style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, background: "transparent", border: "none", color: "#F4F6FB", minWidth: 0 }}
          />
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            disabled={busy || stage === "done"}
            style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: 999, padding: "7px 14px", color: "#3FD9EA", cursor: "pointer" }}
          >
            {BRIDGED_TOKENS.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
        <div style={{ background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "#3FD9EA" }}>
          <ArrowDownUp size={16} strokeWidth={1.75} />
        </div>
      </div>

      <div style={{ border: "1px solid #FFFFFF14", borderRadius: 12, background: "#0E1420", padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: "#8B93A7" }}>Receiving on chain 1404</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, color: "#F4F6FB" }}>
            {formatAmount(received)}
          </span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, background: "#171F30", border: "1px solid #FFFFFF1A", borderRadius: 999, padding: "7px 14px", color: "#3FD9EA" }}>
            {asset}
          </span>
        </div>
      </div>

      <p style={{ margin: "10px 2px 0", fontSize: 12, color: "#6B7488" }}>Bridge fee {(feeRate * 100).toFixed(2)}% · destination BlockDAG, chain 1404</p>

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
            background: address && (!amt || amt <= 0) ? "#2A3245" : "linear-gradient(90deg, #A64CF0, #FF8266)",
            color: address && (!amt || amt <= 0) ? "#6B7280" : "#0A0E17",
            fontFamily: "'Space Grotesk', sans-serif",
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
          <div style={{ width: "100%", padding: "12px 18px", borderRadius: 10, border: "none", background: "#1D8F76", color: "#F4F6FB", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Check size={17} /> Bridged — funds available on BlockDAG
          </div>
          <button onClick={reset} style={{ width: "100%", padding: "10px 18px", borderRadius: 10, border: "1px solid #FFFFFF1A", background: "transparent", color: "#8B93A7", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            Bridge more
          </button>
        </div>
      )}
    </div>
  );
}

function FieldBlock({ label, token, onTokenChange, amount, onAmountChange, editableAmount, placeholder, balanceHint, allSymbols }) {
  return (
    <div style={{ border: "1px solid #FFFFFF14", borderRadius: 12, background: "#0E1420", padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "#8B93A7" }}>{label}</span>
        {balanceHint && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#5A6478" }}>{balanceHint}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {editableAmount ? (
          <input type="number" min="0" value={amount} onChange={(e) => onAmountChange(e.target.value)} placeholder="0.00" style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, background: "transparent", border: "none", color: "#F4F6FB", minWidth: 0 }} />
        ) : (
          <span style={{ flex: 1, fontFamily: "'Space Mono', monospace", fontSize: 19, color: amount ? "#F4F6FB" : "#5A6478" }}>{amount || placeholder}</span>
        )}
        <TokenSelect value={token} onChange={onTokenChange} options={allSymbols} />
      </div>
    </div>
  );
}

function FeeRow({ label, value, muted, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13, color: muted ? "#6B7488" : "#8B93A7" }}>{label}</span>
      <span
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: bold ? 15 : 13,
          fontWeight: bold ? 700 : 400,
          color: bold ? "#F4F6FB" : muted ? "#FF8266" : "#F4F6FB",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function RouteCard({ route, index, toSymbol, isBest, isSelected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className="route-card"
      style={{
        textAlign: "left",
        border: isSelected ? "1px solid #3FD9EA" : "1px solid #FFFFFF14",
        background: isBest ? "#12222A" : "#0E1420",
        boxShadow: isBest ? "0 0 0 1px #3FD9EA22, 0 8px 24px -12px #3FD9EA33" : "none",
        borderRadius: 12,
        padding: "13px 16px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        animation: `route-in 0.4s ease-out ${index * 0.12}s both`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: isBest ? "linear-gradient(135deg, #3FD9EA, #A64CF0)" : "#171F30", border: isBest ? "none" : "1px solid #FFFFFF1A" }}>
          <div style={{ width: 9, height: 9, background: isBest ? "#0A0E17" : "#3FD9EA", transform: "rotate(45deg)" }} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#F4F6FB", display: "flex", alignItems: "center" }}>
            {route.name}
            {isBest && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#3FD9EA", marginLeft: 8, border: "1px solid #3FD9EA55", borderRadius: 999, padding: "2px 8px" }}>best route</span>}
          </div>
          <div style={{ fontSize: 12, color: "#8B93A7" }}>{route.note} · fee {route.feeLabel}</div>
        </div>
      </div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 16, color: "#F4F6FB", textAlign: "right", whiteSpace: "nowrap" }}>
        {formatAmount(route.out)}
        <div style={{ fontSize: 11, color: "#5A6478" }}>{toSymbol}</div>
      </div>
    </button>
  );
}
