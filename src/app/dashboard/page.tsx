"use client";

import Link from "next/link";
import { useDapp } from "@/dapp";
import { shortAddr, usd } from "@/lib/format";
import { FlowBar, Meter, Skeleton, StatusTag } from "@/ui/bits";

const TONE: Record<string, string> = { advance: "brand", collection: "ok", default: "bad", "advance-declined": "warn" };

export default function Overview() {
  const { pool, activity, loaded } = useDapp();
  if (!loaded || !pool) return <Skeleton cards={3} />;

  const p = pool.pool;
  const num = (v: string) => Number(BigInt(v)) / 1e6;
  const has = (t: string) => activity.some((r) => r.type === t);
  const steps = [
    { done: has("advance"), title: "Take an advance", sub: "Preview an offer, then accept it", href: "/dashboard/seller", cta: "Open seller" },
    { done: has("collection"), title: "Repay it with buyer payments", sub: "Watch the waterfall repay the pool first", href: "/dashboard/seller", cta: "Play buyer" },
    { done: p.sharePrice > 1, title: "See the pool earn a fee", sub: "The share price rises above $1.0000", href: "/dashboard/pool", cta: "View pool" },
    { done: has("default"), title: "Try a default", sub: "See the reserve absorb a loss first", href: "/dashboard/seller", cta: "Open seller" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <section className="hero-card">
        <div>
          <span className="lab">Tally · overview</span>
          <h1>Cash now, repaid first.</h1>
          <p className="muted">Advances against HSP payment mandates. Every payment repays the pool before the seller sees a cent.</p>
        </div>
        <div className="hero-actions">
          <Link className="btn" href="/dashboard/seller">Seller console</Link>
          <Link className="btn ghost" href="/dashboard/pool">View the pool</Link>
        </div>
        <div className="flow-wrap">
          <span className="lab">Where the pool&apos;s money is</span>
          <FlowBar
            total={num(p.poolAssets) + num(p.reserve)}
            segs={[
              { label: "Lent out", value: num(p.outstandingPrincipal), tone: "brand" },
              { label: "Idle", value: num(p.idleCash), tone: "tint" },
              { label: "Reserve", value: num(p.reserve), tone: "warn" },
            ]}
          />
        </div>
      </section>

      <div className="kpi-grid">
        <div className="kpi hot"><span className="lab">Pool value</span><b>{usd(p.poolAssets, { cents: false })}</b><small>Cash plus unrepaid principal</small></div>
        <div className="kpi"><span className="lab">Lent out</span><b>{usd(p.outstandingPrincipal, { cents: false })}</b><small>{p.utilizationPct.toFixed(1)}% utilization</small></div>
        <div className="kpi"><span className="lab">Reserve</span><b>{usd(p.reserve, { cents: false })}</b><small>Takes losses first</small></div>
        <div className="kpi"><span className="lab">Share price</span><b>${p.sharePrice.toFixed(4)}</b><small>Rises as fees are earned</small></div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <header><h2>Sellers</h2><span className="small muted">Underwriting score and where each stands.</span></header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Seller</th><th>Score</th><th>Owed</th><th>Cash received</th><th>Status</th></tr></thead>
                <tbody>
                  {pool.sellers.map((s) => (
                    <tr key={s.address}>
                      <td><Link href="/dashboard/seller" style={{ color: "inherit", fontWeight: 600 }}>{s.name}</Link></td>
                      <td style={{ width: 130 }}><div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "nowrap" }}><span style={{ minWidth: 22 }}>{s.score}</span><div style={{ flex: 1 }}><Meter value={s.score} /></div></div></td>
                      <td>{usd(s.owed)}</td>
                      <td>{usd(s.cash)}</td>
                      <td><StatusTag status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <header><h2>Recent activity</h2><span className="small muted">Every decision, with its reasons, is logged.</span></header>
            {activity.length === 0 ? (
              <p className="empty muted">Nothing yet. Take an advance in the seller console.</p>
            ) : (
              <ul className="feed">
                {activity.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link href="/dashboard/activity" className="feed-row">
                      <span className="feed-main">
                        <span className={`tag ${TONE[r.type] ?? "mute"}`}>{r.type}</span>
                        {r.amountUnits && <strong className="num-t">{usd(r.amountUnits)}</strong>}
                        <span className="mono">{shortAddr(r.seller, 8, 4)}</span>
                      </span>
                      <span className="small muted">{new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <header>
              <div className="progress-line"><span>Quick start</span><span>{doneCount} / {steps.length}</span></div>
              <h3>Walk through the product</h3>
            </header>
            <Meter value={(doneCount / steps.length) * 100} />
            <ul className="checklist">
              {steps.map((s) => (
                <li key={s.title} className={s.done ? "done" : ""}>
                  <span className="check" aria-hidden="true">{s.done ? "✓" : ""}</span>
                  <span className="ck-t">{s.title}<small>{s.sub}</small></span>
                  {!s.done && <Link className="btn sm" href={s.href}>{s.cta}</Link>}
                </li>
              ))}
            </ul>
          </section>
          <Link href="/dashboard/playground" className="alert">
            <span className="lab">Curious how it decides?</span>
            <strong>Try the underwriter</strong>
            <span>Open the playground →</span>
          </Link>
        </div>
      </div>
    </>
  );
}
