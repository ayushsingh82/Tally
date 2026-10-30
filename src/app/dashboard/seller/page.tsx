"use client";

import { useState } from "react";
import { markDefault, previewAdvance, registerSeller, takeAdvance } from "@/app/actions";
import { useDapp } from "@/dapp";
import { shortAddr, timeAgo, usd } from "@/lib/format";
import type { AdvanceResult } from "@/lib/service";
import { FlowBar, HistoryChart, OfferCard, Skeleton, Stats, StatusTag } from "@/ui/bits";

const TONE: Record<string, string> = { advance: "brand", collection: "ok", default: "bad", "advance-declined": "warn" };

export default function SellerPage() {
  const d = useDapp();
  if (!d.loaded) return <Skeleton />;
  // Remount the form state when the seller changes, so an old offer never lingers.
  return (
    <>
      <div className="page-head">
        <h1>Seller console</h1>
        <p>
          Register a seller, preview what the underwriter would offer and why, and take the advance. Buyers repay it through
          HSP, and every payment is swept into the vault.
        </p>
      </div>
      <RegisterSeller />
      {d.dash ? <Console key={d.seller} /> : d.sellers.length === 0 ? <NoSellers /> : <Skeleton stats={false} cards={3} />}
    </>
  );
}

function NoSellers() {
  return (
    <div className="empty-art">
      <strong style={{ font: "700 20px var(--serif)" }}>No sellers yet</strong>
      <span className="muted">Register a seller above. Tally deploys their collector contract and creates their HSP order.</span>
    </div>
  );
}

function RegisterSeller() {
  const d = useDapp();
  const [address, setAddress] = useState("");
  const [total, setTotal] = useState("20.00");
  const [days, setDays] = useState("90");
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address) && Number(total) > 0 && Number(days) >= 1;

  return (
    <section className="card">
      <header><h2>Register a seller</h2><span className="small muted">Deploys their collector and creates a reusable HSP order paying into it.</span></header>
      <div className="row">
        <label style={{ flex: 3, minWidth: 260 }}>Seller wallet<input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></label>
        <label style={{ flex: 1, minWidth: 110 }}>Per payment (USD)<input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 90 }}>Days valid<input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <button
          disabled={d.busy || !valid}
          onClick={async () => {
            const r = await d.run(() => registerSeller(address, total, Number(days)), (x) => `Registered. Collector ${shortAddr(x.collector, 8, 6)}.`);
            if (r) {
              setAddress("");
              d.selectSeller(r.seller);
            }
          }}
        >
          Register
        </button>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Console() {
  const d = useDapp();
  const dash = d.dash!;
  const [amount, setAmount] = useState("");
  const [offer, setOffer] = useState<AdvanceResult["offer"] | null>(null);

  const p = dash.position;
  const num = (v: string) => Number(BigInt(v)) / 1e6;
  const principal = num(p.principal);
  const fee = num(p.fee);
  const owed = num(p.owed);
  const requested = amount.trim() === "" ? undefined : Number(amount);
  const badAmount = requested !== undefined && (!Number.isFinite(requested) || requested <= 0);
  const me = d.sellers.find((s) => s.address === d.seller);

  return (
    <>
      {d.sellers.length > 1 && (
        <div className="picks">
          {d.sellers.slice(0, 6).map((s) => (
            <button key={s.address} className="pick" aria-pressed={s.address === d.seller} onClick={() => d.selectSeller(s.address)}>
              <strong>{s.name}</strong>
              <span className="small muted">{s.blurb}</span>
              {s.expect && <span className="exp">Expect: {s.expect}</span>}
            </button>
          ))}
        </div>
      )}

      <Stats
        items={[
          { label: "Wallet balance", value: usd(dash.sellerBalance), sub: "Seller's token balance on-chain" },
          { label: "Still owed", value: usd(p.owed), sub: <StatusTag status={p.status} /> },
          { label: "Score", value: `${dash.scorecard.score}/100`, sub: `${dash.scorecard.successCount} paid · ${Math.round(dash.scorecard.failureRate * 100)}% failed` },
          { label: "Avg daily income", value: usd(dash.scorecard.avgDailyUsd), sub: `Top buyer ${Math.round(dash.scorecard.topBuyerShare * 100)}%` },
        ]}
      />

      <div className="grid">
        <section className="card">
          <header><h2>Request an advance</h2><span className="small muted">Preview first. Nothing moves until you take the offer.</span></header>
          <label>
            Amount in USD (optional)
            <input inputMode="decimal" placeholder="the most you can be offered" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={badAmount} />
          </label>
          <div className="row">
            <button className="secondary" disabled={d.busy || badAmount || p.status === "Active"} onClick={async () => { const r = await d.run(() => previewAdvance(d.seller, requested)); if (r) setOffer(r.offer); }}>
              Preview offer
            </button>
            {offer?.approved && (
              <button
                disabled={d.busy || p.status === "Active"}
                onClick={async () => {
                  const r = await d.run(() => takeAdvance(d.seller, requested), (x) => (x.executed ? `Advance sent: ${usd(x.offer.advanceUnits)} to the seller.` : "The offer changed and was not executed."));
                  if (r) setOffer(null);
                }}
              >
                Take {usd(offer.advanceUnits)}
              </button>
            )}
          </div>
          {p.status === "Active" && <p className="small muted">This seller already has an active advance. It must be repaid first.</p>}
          {offer && <OfferCard offer={offer} />}
        </section>

          <section className="card">
            <header><h2>How buyers pay</h2><span className="small muted">Through HSP, into this seller&apos;s collector.</span></header>
            {dash.mandate ? (
              <>
                <dl className="kv">
                  <dt>Checkout</dt><dd><a href={dash.mandate.paymentUrl} target="_blank" rel="noreferrer">Open HSP checkout ↗</a> <CopyButton text={dash.mandate.paymentUrl} /></dd>
                  <dt>Pay to</dt><dd className="mono">{p.collector ?? "—"} {p.collector && <CopyButton text={p.collector} />}</dd>
                </dl>
                <p className="small muted">Each payment HSP settles is swept into the vault automatically when its webhook reports it safe.</p>
              </>
            ) : (
              <p className="muted">No mandate yet.</p>
            )}
          </section>
      </div>

      <section className="card">
        <header><h2>Repayment progress</h2><span className="small muted">Principal is repaid first, then the fee.</span></header>
        {p.status === "None" ? (
          <p className="muted">No advance yet.</p>
        ) : (
          <>
            <FlowBar
              total={principal + fee}
              segs={[
                { label: "Principal repaid", value: num(p.repaidPrincipal), tone: "brand" },
                { label: "Fee repaid", value: num(p.repaidFee), tone: "accent" },
                { label: "Remaining", value: owed, tone: "tint" },
              ]}
            />
            <dl className="facts" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <div><dt>Principal</dt><dd>{usd(p.principal)}</dd></div>
              <div><dt>Fee</dt><dd>{usd(p.fee)}</dd></div>
              <div><dt>Repaid</dt><dd>{usd(num(p.repaidPrincipal) + num(p.repaidFee))}</dd></div>
              <div><dt>Remaining</dt><dd>{usd(owed)}</dd></div>
            </dl>
          </>
        )}
      </section>

      <div className="grid">
        <section className="card">
          <header><h2>Payment history</h2><span className="small muted">What the underwriter sees, from verified payments.</span></header>
          <HistoryChart history={dash.history} now={dash.now} />
        </section>
        <section className="card">
          <header><h2>Mandate</h2></header>
          <dl className="facts">
            <div style={{ gridColumn: "1 / -1" }}><dt>Collector (pay_to)</dt><dd className="mono">{p.collector ?? "—"}</dd></div>
            <div><dt>Mandate</dt><dd className="mono">{dash.mandate ? shortAddr(dash.mandate.cartMandateId, 12, 4) : "—"}</dd></div>
            <div><dt>Status</dt><dd>{dash.mandate?.revoked ? "Revoked" : "Active"}</dd></div>
            <div><dt>Expires</dt><dd>{dash.mandate ? new Date(dash.mandate.expiresAt).toLocaleDateString() : "—"}</dd></div>
            <div><dt>Seller</dt><dd>{me?.name ?? "—"}</dd></div>
          </dl>
        </section>
      </div>

      <section className="card">
        <header><h2>Risk controls</h2><span className="small muted">Writes off the advance and revokes the mandate. The reserve absorbs the loss first.</span></header>
        <div className="row">
          <button
            className="danger"
            disabled={d.busy || p.status !== "Active"}
            onClick={() => { if (window.confirm("Mark this advance as defaulted and revoke the mandate?")) d.run(() => markDefault(d.seller), (x) => `Written off ${usd(x.writtenOffUnits)}. The reserve absorbed it first.`); }}
          >
            Buyer stops paying
          </button>
        </div>
      </section>

      <section className="card">
        <header><h2>Activity for this seller</h2></header>
        {dash.receipts.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="feed">
            {[...dash.receipts].reverse().map((r) => (
              <li key={r.id} className="feed-row" style={{ cursor: "default" }}>
                <span className="feed-main">
                  <span className={`tag ${TONE[r.type] ?? "mute"}`}>{r.type}</span>
                  {r.amountUnits && <strong className="num-t">{usd(r.amountUnits)}</strong>}
                </span>
                <span className="mono">{r.txHash ? shortAddr(r.txHash, 10, 6) : ""} · {timeAgo(r.ts, dash.now)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
