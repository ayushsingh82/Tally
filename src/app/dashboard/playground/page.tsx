"use client";

import { useMemo, useState } from "react";
import { underwrite } from "@/lib/underwrite";
import { PRESETS, synthesize, type Scenario } from "@/lib/underwrite/synthesize";
import { Meter, OfferCard, Slider } from "@/ui/bits";

const DAY = 86_400_000;
// Everything is relative, so a fixed reference time keeps server and client renders identical.
const NOW = Date.UTC(2026, 0, 1);

export default function Playground() {
  const [sc, setSc] = useState<Scenario>(PRESETS.healthy.scenario);
  const [mandateDays, setMandateDays] = useState(PRESETS.healthy.mandateDaysLeft);
  const [poolCash, setPoolCash] = useState(PRESETS.healthy.poolCashUsd);
  const [preset, setPreset] = useState("healthy");

  const offer = useMemo(() => {
    const o = underwrite(
      { seller: "0xplayground", history: synthesize(sc, NOW), mandate: { expiresAt: NOW + mandateDays * DAY }, now: NOW },
      { deny: [] },
      { idleUsd: poolCash },
    );
    return { raw: o, view: { ...o, advanceUnits: o.advanceUnits.toString(), feeUnits: o.feeUnits.toString() } };
  }, [sc, mandateDays, poolCash]);

  const set = (patch: Partial<Scenario>) => { setPreset("custom"); setSc((s) => ({ ...s, ...patch })); };
  const f = offer.raw.scorecard?.factors;

  return (
    <>
      <div className="page-head">
        <h1>Underwriter playground</h1>
        <p>See exactly how a payment record turns into a decision. Every approval and every decline comes with its reasons, so nobody has to trust a black box. Runs entirely in your browser.</p>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <header><h3>Start from a preset</h3></header>
            <div className="row" style={{ gap: 8 }}>
              {Object.entries(PRESETS).map(([key, p]) => (
                <button key={key} className={preset === key ? "sm" : "secondary sm"} onClick={() => { setPreset(key); setSc(p.scenario); setMandateDays(p.mandateDaysLeft); setPoolCash(p.poolCashUsd); }}>
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <header><h3>The seller&apos;s payment record</h3></header>
            <div className="sliders">
              <Slider label="Successful payments" value={sc.payments} min={0} max={40} onChange={(v) => set({ payments: v })} />
              <Slider label="History span" value={sc.spanDays} min={1} max={30} fmt={(v) => `${v} days`} onChange={(v) => set({ spanDays: v })} />
              <Slider label="Average payment" value={sc.avgUsd} min={1} max={200} fmt={(v) => `$${v}`} onChange={(v) => set({ avgUsd: v })} />
              <Slider label="Irregular timing" value={sc.irregularity} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ irregularity: v })} />
              <Slider label="Distinct buyers" value={sc.buyers} min={1} max={8} onChange={(v) => set({ buyers: v })} />
              <Slider label="Failed payment attempts" value={sc.failedPct} min={0} max={60} fmt={(v) => `${v}%`} onChange={(v) => set({ failedPct: v })} />
            </div>
          </section>

          <section className="card">
            <header><h3>The deal around it</h3></header>
            <div className="sliders">
              <Slider label="Mandate days left" value={mandateDays} min={1} max={180} onChange={(v) => { setPreset("custom"); setMandateDays(v); }} />
              <Slider label="Cash available in the pool" value={poolCash} min={0} max={5000} step={50} fmt={(v) => `$${v.toLocaleString()}`} onChange={(v) => { setPreset("custom"); setPoolCash(v); }} />
            </div>
          </section>
        </div>

        <div className="stack sticky">
          <OfferCard offer={offer.view} />
          {f && (
            <section className="card">
              <header><h3>What drove the score</h3><span className="small muted">Weights: regularity 35%, reliability 25%, diversification 20%, depth 20%.</span></header>
              {([
                ["Regularity", f.regularity],
                ["Reliability", f.reliability],
                ["Diversification", f.diversification],
                ["Depth", f.depth],
              ] as const).map(([name, v]) => (
                <div key={name}>
                  <div className="row between small" style={{ marginBottom: 4 }}><span>{name}</span><span className="muted num-t">{Math.round(v * 100)}</span></div>
                  <Meter value={v * 100} />
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
