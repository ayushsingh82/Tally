"use client";

import { useMemo, useState } from "react";
import { exportReceiptsCsv } from "@/app/actions";
import { useDapp } from "@/dapp";
import { shortAddr, usd } from "@/lib/format";
import { Skeleton } from "@/ui/bits";

const TYPES = ["all", "order-created", "advance", "advance-declined", "collection", "default"] as const;
const TONE: Record<string, string> = { advance: "brand", collection: "ok", default: "bad", "advance-declined": "warn" };

export default function ActivityPage() {
  const d = useDapp();
  const [filter, setFilter] = useState<(typeof TYPES)[number]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => d.activity.filter((r) => filter === "all" || r.type === filter), [d.activity, filter]);

  async function download() {
    const r = await exportReceiptsCsv();
    if (!r.ok) return;
    const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "tally-receipts.csv" }).click();
    URL.revokeObjectURL(url);
  }

  if (!d.loaded) return <Skeleton stats={false} cards={3} />;

  return (
    <>
      <div className="page-head">
        <h1>Activity &amp; audit trail</h1>
        <p>Every order, advance, decline, collection and default, with the underwriter&apos;s reasoning and the screening result at the time. Export it for your accountant.</p>
      </div>

      <section className="card">
        <div className="row between">
          <div className="row" role="tablist" aria-label="Filter by type" style={{ gap: 6 }}>
            {TYPES.map((t) => (
              <button key={t} role="tab" className="chip" aria-selected={filter === t} onClick={() => setFilter(t)}>{t === "all" ? "All" : t}</button>
            ))}
          </div>
          <button className="secondary sm" onClick={download} disabled={d.activity.length === 0}>Export CSV</button>
        </div>

        {rows.length === 0 ? (
          <p className="empty muted">Nothing here yet. Take an advance in the seller console and it will show up.</p>
        ) : (
          <ul className="feed">
            {rows.map((r) => (
              <li key={r.id}>
                <button className="feed-row" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="feed-main">
                    <span className={`tag ${TONE[r.type] ?? "mute"}`}>{r.type}</span>
                    {r.amountUnits && <strong className="num-t">{usd(r.amountUnits)}</strong>}
                    <span className="mono">{shortAddr(r.seller, 8, 4)}</span>
                  </span>
                  <span className="small muted">{new Date(r.ts).toLocaleString()}</span>
                </button>
                {open === r.id && (
                  <div className="feed-more">
                    {r.txHash && <span>Transaction <span className="mono">{r.txHash}</span></span>}
                    {r.screening && <span>Screening: <b>{r.screening}</b></span>}
                    {r.feeUnits && <span>Fee: <b>{usd(r.feeUnits)}</b></span>}
                    {r.note && <span>{r.note}</span>}
                    {r.rationale && <ul className="reasons">{r.rationale.map((l) => <li key={l}>{l}</li>)}</ul>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
