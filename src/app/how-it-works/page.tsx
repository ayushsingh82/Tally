import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/ui/SiteChrome";

export const metadata: Metadata = { title: "How it works" };

const FLOW = [
  ["Open", "The seller registers. The vault deploys a tiny collector contract just for them, and Tally creates a reusable HSP order whose pay_to is that collector."],
  ["Pay", "A buyer agent signs the mandate (EIP-712) and pays through the HSP gateway, which settles a plain token transfer into the collector."],
  ["Score", "When the seller asks for cash, the underwriter reads the seller's verified payment history, screens the address and sizes an offer."],
  ["Advance", "If the seller accepts, the vault sends the advance from the pool and records the loan on-chain with its fee."],
  ["Notify", "As each later payment reaches payment-safe or payment-finalized, HSP calls our signed webhook. Duplicates are ignored."],
  ["Sweep", "Anyone can call sweep() on the collector. It forwards the balance to the vault, which runs the waterfall in one transaction."],
  ["Settle", "Principal returns to the pool, then the fee to liquidity providers, then any surplus to the seller. The advance closes itself."],
];

const STATUS: [string, string, string][] = [
  ["ReceivableVault and SellerCollector contracts", "Real", "38 Foundry tests, including fuzzing, and a run on a local chain."],
  ["HSP request signing, mandate builder, webhook check", "Real code", "Matches the published spec and independent HMAC vectors."],
  ["Underwriter and screening", "Real", "Pure code, shared by the server and the playground."],
  ["Live HSP gateway calls", "Not yet", "Needs merchant credentials."],
  ["Deployment on HSK Chain", "Not yet", "Testnet first, mainnet later."],
];

export default function HowItWorks() {
  return (
    <Page>
      <section className="band" style={{ borderTop: 0 }}>
        <div className="wrap">
          <span className="lab">Under the hood</span>
          <h2>How Tally works.</h2>
          <p className="muted" style={{ maxWidth: 680, fontSize: 19, marginBottom: 36 }}>
            The key idea is small: make the payee address a contract that already knows who to repay first.
          </p>

          <div className="card">
            <h3>The money path</h3>
            <div className="diagram">
              <div className="node off"><b>Buyer agent</b><span>Signs the mandate</span></div>
              <span className="arrow">→</span>
              <div className="node off"><b>HSP gateway</b><span>Verifies and settles</span></div>
              <span className="arrow">→</span>
              <div className="node"><b>Seller collector</b><span>The pay_to address</span></div>
              <span className="arrow">→</span>
              <div className="node hot"><b>Vault</b><span>Runs the waterfall</span></div>
            </div>
            <div className="arrow" style={{ transform: "none" }}>↓</div>
            <div className="diagram three-up">
              <div className="node"><b>Liquidity pool</b><span>Principal, then fee</span></div>
              <div className="node"><b>Seller wallet</b><span>The surplus</span></div>
              <div className="node"><b>Reserve</b><span>Absorbs losses first</span></div>
            </div>
            <div className="diagram two-up" style={{ borderTop: "1.5px dashed var(--ink)", paddingTop: 14 }}>
              <div className="node off"><b>Underwriter</b><span>Reads history, screens, sizes the offer, calls advance()</span></div>
              <div className="node off"><b>Webhook handler</b><span>Verifies HSP&apos;s signature, dedupes, triggers sweep()</span></div>
            </div>
            <p className="small muted">Solid boxes are on-chain. Dashed boxes are off-chain.</p>
          </div>
        </div>
      </section>

      <section className="band tint">
        <div className="wrap">
          <span className="lab">The life of an advance</span>
          <h2>Seven steps, one waterfall.</h2>
          <ol className="flow-list">
            {FLOW.map(([name, body], i) => (
              <li key={name}><span className="big">{i + 1}</span><div><h3>{name}</h3><p>{body}</p></div></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <span className="lab">A worked example</span>
          <h2>$120 out, $132 back.</h2>
          <p className="muted" style={{ marginBottom: 18 }}>A seller takes $120 with a $12 fee, so it owes $132. The pool starts at $1,000.</p>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Event</th><th>Principal repaid</th><th>Fee repaid</th><th>Seller gets</th><th>Pool value</th></tr></thead>
                <tbody>
                  <tr><td>Advance sent</td><td>$0</td><td>$0</td><td>$120</td><td>$1,000</td></tr>
                  <tr><td>Buyer pays $125</td><td>$120</td><td>$5</td><td>$0</td><td>$1,005</td></tr>
                  <tr><td>Buyer pays $55</td><td>$120</td><td>$12</td><td>$48</td><td>$1,012</td></tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">The same numbers the contract&apos;s tests assert. Liquidity providers earned $12 and the seller kept the $48 surplus.</p>
          </div>
        </div>
      </section>

      <section className="band tint">
        <div className="wrap">
          <span className="lab">What is real</span>
          <h2>A prototype should be honest about itself.</h2>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Part</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>
                  {STATUS.map(([what, status, note]) => (
                    <tr key={what}>
                      <td style={{ whiteSpace: "normal" }}>{what}</td>
                      <td><span className={`tag ${status === "Not yet" ? "warn" : "ok"}`}>{status}</span></td>
                      <td style={{ whiteSpace: "normal" }} className="muted">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <h2>Poke the underwriter.</h2>
          <div className="cta" style={{ justifyContent: "center" }}>
            <Link className="btn lg" href="/dashboard/playground">Underwriter playground</Link>
            <Link className="btn lg ghost" href="/dashboard">Dashboard</Link>
          </div>
        </div>
      </section>
    </Page>
  );
}
