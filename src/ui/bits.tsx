import type { ReactNode } from "react";
import type { AdvanceResult } from "@/lib/service";
import { usd } from "@/lib/format";
import type { PaymentRecord } from "@/lib/underwrite/types";

export type Status = "None" | "Active" | "Repaid" | "Defaulted";

const STATUS: Record<Status, [string, string]> = {
  None: ["mute", "No advance"],
  Active: ["warn", "Active"],
  Repaid: ["ok", "Repaid"],
  Defaulted: ["bad", "Written off"],
};

export function StatusTag({ status }: { status: Status }) {
  const [tone, label] = STATUS[status];
  return <span className={`tag ${tone}`}>{label}</span>;
}

export function Stats({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="stats">
      {items.map((s) => (
        <div className="stat" key={s.label}>
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">{s.label}</span>
          {s.sub && <span className="stat-sub">{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}

export interface Seg {
  label: string;
  value: number;
  tone: "brand" | "accent" | "ink" | "tint" | "warn" | "ok";
}

/** Stacked bar with a legend, used for the pool split and for repayment progress. */
export function FlowBar({ segs, total, format = (n: number) => usd(n) }: { segs: Seg[]; total: number; format?: (n: number) => string }) {
  const t = total > 0 ? total : 1;
  return (
    <>
      <div className="flow-bar" role="img" aria-label={segs.map((s) => `${s.label} ${format(s.value)}`).join(", ")}>
        {segs.map((s) => (
          <span key={s.label} className={`c-${s.tone}`} style={{ width: `${Math.min(100, (s.value / t) * 100)}%` }} />
        ))}
      </div>
      <ul className="flow-legend">
        {segs.map((s) => (
          <li key={s.label}><i className={`c-${s.tone}`} />{s.label} {format(s.value)}</li>
        ))}
      </ul>
    </>
  );
}

export function Meter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`meter ${v >= 70 ? "ok" : v >= 40 ? "warn" : "bad"}`} role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

const DECLINE: Record<string, string> = {
  THIN_HISTORY: "Not enough payment history yet",
  SHORT_HISTORY: "History is too recent",
  LOW_SCORE: "Payment record is too weak",
  MANDATE_REVOKED: "The buyer's mandate was revoked",
  MANDATE_EXPIRING: "The mandate expires too soon",
  DENYLISTED: "Seller is on the deny list",
  NOT_ALLOWLISTED: "Seller is not on the allow list",
  NO_CAPACITY: "The pool has no cash to lend",
};

export function OfferCard({ offer }: { offer: AdvanceResult["offer"] }) {
  const card = offer.scorecard;
  const ok = offer.approved;
  return (
    <div className={`card detail ${ok ? "ok" : "bad"}`}>
      <div className="row between">
        <span className={`stamp ${ok ? "ok" : "bad"}`}>{ok ? "Approved" : "Declined"}</span>
        {offer.declineCode && <span className="small muted">{DECLINE[offer.declineCode] ?? offer.declineCode}</span>}
      </div>
      {ok && (
        <dl className="facts" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div><dt>You receive</dt><dd>{usd(offer.advanceUnits)}</dd></div>
          <div><dt>Fee</dt><dd>{usd(offer.feeUnits)}</dd></div>
          <div><dt>You repay</dt><dd>{usd(BigInt(offer.advanceUnits) + BigInt(offer.feeUnits))}</dd></div>
        </dl>
      )}
      {card && (
        <div>
          <div className="row between small muted" style={{ marginBottom: 6 }}><span>Underwriting score</span><span className="num-t">{card.score} / 100</span></div>
          <Meter value={card.score} />
        </div>
      )}
      <ul className="reasons">{offer.rationale.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

const DAY = 86_400_000;

/** 30 daily bars of successful volume, with a red dot on days that had failed attempts. */
export function HistoryChart({ history, now }: { history: PaymentRecord[]; now: number }) {
  const days = Array.from({ length: 30 }, (_, i) => ({ total: 0, failed: 0, key: i }));
  for (const p of history) {
    const idx = 29 - Math.floor((now - p.paidAt) / DAY);
    if (idx < 0 || idx > 29) continue;
    if (p.status === "success") days[idx].total += p.amountUsd;
    else if (p.status === "failed") days[idx].failed += 1;
  }
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div>
      <div className="chart" role="img" aria-label="Daily successful payment volume over the last 30 days">
        {days.map((d) => (
          <div key={d.key} className={d.total ? "" : "zero"} style={{ height: d.total ? `${Math.max(6, (d.total / max) * 100)}%` : "2%" }}>
            {d.failed > 0 && <i />}
          </div>
        ))}
      </div>
      <div className="chart-key"><span>30 days ago</span><span>● failed attempt</span><span>today</span></div>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, fmt = String, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; fmt?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label>
      <span className="slider-top"><span>{label}</span><b>{fmt(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Skeleton({ stats = true, cards = 2 }: { stats?: boolean; cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {stats && <div className="skel skel-stats" />}
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="skel skel-card" />
      ))}
    </div>
  );
}
