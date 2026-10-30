import Link from "next/link";
import { Page } from "@/ui/SiteChrome";

const FAQ = [
  ["What if the buyer stops paying?", "The advance is sized well below expected income and runs for a short window. A first-loss reserve absorbs any shortfall before liquidity providers do, and the underwriter can write the advance off and revoke the mandate."],
  ["Who is the borrower?", "The seller agent. The buyer has already committed to pay under a signed mandate, and that commitment is what the advance is measured against."],
  ["Why HSP and not a plain wallet transfer?", "A reusable HSP order is a buyer-signed, bounded, expiring payment commitment, and the gateway provides verified payment history. A bare transfer carries neither."],
  ["Is this regulated lending?", "This is a hackathon prototype, not a live lending product. Real use would need legal and compliance review, which is why screening and a full audit trail are built in from the start."],
  ["Why agents?", "Agents have uneven cash flow and no credit history, but a precise, machine-readable payment record. That is exactly what underwriting needs."],
];

export default function Landing() {
  return (
    <Page>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">HSK Chain Horizon Hackathon · Agent Payments</span>
            <h1>Get paid <em>today</em> for work billed over time.</h1>
            <p className="lead">
              Tally advances stablecoin to AI agents against the payments they are already owed through HSP reusable
              mandates. Each payment repays the pool first, automatically, on-chain.
            </p>
            <div className="cta">
              <Link className="btn lg" href="/dashboard">Open the dashboard</Link>
              <Link className="btn lg ghost" href="/how-it-works">See how it works</Link>
            </div>
          </div>

          <div className="receipt-stage">
            <div className="receipt" aria-label="Example advance receipt">
              <div className="hd">FLOAT<br />ADVANCE / ATLAS AGENT</div>
              <div className="ln"><span>Cash sent today</span><span>$192.95</span></div>
              <div className="ln"><span>Buyer payment 1</span><span>$100.00</span></div>
              <div className="st ok">PRINCIPAL REPAID</div>
              <div className="ln"><span>Buyer payment 2</span><span>$101.59</span></div>
              <div className="st ok">FEE $8.64 TO LPs</div>
              <div className="ln"><span>Surplus to seller</span><span>$0.00</span></div>
              <div className="ft">THE POOL IS PAID FIRST</div>
            </div>
          </div>
        </div>
      </section>

      <section className="band tint" id="problem">
        <div className="wrap">
          <span className="lab">The problem</span>
          <h2>Agents are paid in drips and billed in lumps.</h2>
          <div className="three">
            <div><span className="num">01</span><h3>Income arrives slowly</h3><p>A few dollars per call. Real money, but it trickles in.</p></div>
            <div><span className="num">02</span><h3>Costs are due now</h3><p>Compute, API fees and data are billed up front, before buyers have paid.</p></div>
            <div><span className="num">03</span><h3>No credit history</h3><p>Banks do not lend to software. Yet an agent&apos;s on-chain payment record is a better credit file than most people have.</p></div>
          </div>
        </div>
      </section>

      <section className="band" id="how">
        <div className="wrap">
          <span className="lab">How it works</span>
          <h2>Mandate, score, advance, repay.</h2>
          <div className="steps4">
            <div><span className="big">1</span><h3>Open</h3><p>The seller creates an HSP reusable order. Its pay-to address is the seller&apos;s own collector contract.</p></div>
            <div><span className="big">2</span><h3>Get paid</h3><p>Buyer agents pay through HSP. Every payment settles on-chain into the collector.</p></div>
            <div><span className="big">3</span><h3>Score</h3><p>An underwriter reads the verified history, screens the seller and offers cash, with reasons.</p></div>
            <div><span className="big">4</span><h3>Repay</h3><p>Each payment is swept into the vault, which repays the pool before the seller sees a cent.</p></div>
          </div>
          <div className="verdict">
            <div>
              <span className="stamp ok">Money in</span>
              <p>Principal back to the pool, then the fee to liquidity providers, then any surplus to the seller.</p>
            </div>
            <div>
              <span className="stamp bad">Money lost</span>
              <p>A first-loss reserve absorbs it. Only after the reserve is gone do liquidity providers share a loss.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band dark">
        <div className="wrap">
          <span className="lab">Why on-chain</span>
          <h2>The order of repayment is code, not a promise.</h2>
          <div className="three">
            <div><span className="num">THE GATEWAY</span><h3>Verifies.</h3><p>HSP checks each signed payment and reports a verified history.</p></div>
            <div><span className="num">THE UNDERWRITER</span><h3>Decides.</h3><p>Plain rules with a written reason for every approval and every decline.</p></div>
            <div><span className="num">THE VAULT</span><h3>Enforces.</h3><p>A contract runs the waterfall. Nobody has to remember to repay.</p></div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <span className="lab">The prototype</span>
          <h2>Working code, tested end to end.</h2>
          <div className="facts-row">
            <div><b>38</b><span className="lab">contract tests</span></div>
            <div><b>140+</b><span className="lab">app tests</span></div>
            <div><b>4</b><span className="lab">risk controls</span></div>
            <div><b>100%</b><span className="lab">of decisions logged</span></div>
          </div>
          <p className="muted" style={{ marginTop: 18, maxWidth: 720 }}>
            A Solidity vault, a TypeScript HSP client and underwriter, signed webhooks, an audit trail with CSV export, and
            this dashboard. Testnet first, mainnet later.
          </p>
        </div>
      </section>

      <section className="band tint" id="trust">
        <div className="wrap">
          <span className="lab">Trust model</span>
          <h2>We say what the chain can&apos;t prove.</h2>
          <div className="limits">
            <div>
              <span className="lab">The chain proves</span>
              <p>The order of repayment, the size of every advance and every payment, permanently and publicly.</p>
            </div>
            <div>
              <span className="lab">The chain cannot prove</span>
              <p>That a buyer will keep paying. That is why advances are sized conservatively, why a reserve takes losses first, and why this prototype has not been audited.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <span className="lab">Questions</span>
          <h2>The ones you should ask.</h2>
          {FAQ.map(([q, a]) => (
            <details className="q" key={q}><summary>{q}</summary><p>{a}</p></details>
          ))}
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <h2>Follow an advance from cash to repaid.</h2>
          <Link className="btn lg" href="/dashboard">Open the dashboard</Link>
        </div>
      </section>
    </Page>
  );
}
