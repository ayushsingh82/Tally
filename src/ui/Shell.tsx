"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useDapp } from "@/dapp";
import { usd } from "@/lib/format";
import { Logo } from "./Logo";
import { StatusTag } from "./bits";

const GROUPS = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", sub: "Pool and progress", n: "01" },
      { href: "/dashboard/seller", label: "Seller", sub: "Advance and repay", n: "02" },
      { href: "/dashboard/pool", label: "Pool", sub: "Liquidity and loans", n: "03" },
    ],
  },
  { title: "Records", items: [{ href: "/dashboard/activity", label: "Activity", sub: "Audit trail, CSV", n: "04" }] },
  { title: "Tools", items: [{ href: "/dashboard/playground", label: "Underwriter", sub: "Try a decision", n: "05" }] },
];
const ALL = GROUPS.flatMap((g) => g.items);

function Toast() {
  const { message, dismiss } = useDapp();
  useEffect(() => {
    if (message?.kind !== "ok") return;
    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
  }, [message, dismiss]);
  if (!message) return null;
  return (
    <div className={`toast ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
      <p>{message.text}</p>
      <button aria-label="Dismiss message" onClick={dismiss}>×</button>
    </div>
  );
}

function SignIn() {
  const d = useDapp();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(await d.signIn(value));
    setPending(false);
  }

  return (
    <form className="card signin" onSubmit={submit}>
      <header>
        <span className="lab">Operator console</span>
        <h1>Sign in</h1>
        <p className="muted">This console can move real funds, so it needs the operator passcode.</p>
      </header>
      {!d.passcodeSet && (
        <p className="err-text">No passcode is configured. Set DASHBOARD_PASSCODE (at least 12 characters) on the server, then restart.</p>
      )}
      <label>
        Passcode
        <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      {error && <p className="err-text" role="alert">{error}</p>}
      <button disabled={pending || !value || !d.passcodeSet}>{pending ? "Checking…" : "Sign in"}</button>
    </form>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const d = useDapp();
  const path = usePathname();
  const needsSeller = path.startsWith("/dashboard/seller");
  const current = ALL.find((i) => (i.href === "/dashboard" ? path === i.href : path.startsWith(i.href)));
  const p = d.pool?.pool;
  const util = p?.utilizationPct ?? 0;
  const defaults = d.pool?.advances.filter((a) => a.status === "Defaulted").length ?? 0;
  const gate = d.checked && !d.authed && path !== "/dashboard/playground";

  return (
    <div className="shell">
      <Toast />
      <aside className="side">
        <Link href="/" className="brand">
          <Logo size={48} />
          <span>Tally</span>
        </Link>

        <nav aria-label="Dashboard">
          {GROUPS.map((g) => (
            <div key={g.title} style={{ display: "contents" }}>
              <span className="nav-group">{g.title}</span>
              {g.items.map((item) => {
                const active = item.href === "/dashboard" ? path === item.href : path.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
                    <span className="nav-n">{item.n}</span>
                    <span className="nav-t">{item.label}<small>{item.sub}</small></span>
                    {item.label === "Pool" && defaults > 0 && <span className="badge" title="Written-off advances">{defaults}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="side-card" aria-label="Pool status">
          <span className="lab">Liquidity pool</span>
          {p ? (
            <>
              <div className="row-s"><span className="muted">Pool</span><strong>{usd(p.poolAssets, { cents: false })}</strong></div>
              <div className="meter" role="meter" aria-label="Pool utilization" aria-valuenow={Math.round(util)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${Math.min(100, util)}%` }} />
              </div>
              <div className="row-s small muted"><span>{util.toFixed(0)}% lent out</span><span>{usd(p.idleCash, { cents: false })} free</span></div>
            </>
          ) : (
            <span className="small muted">{gate ? "Sign in to view" : "Loading…"}</span>
          )}
        </div>

        <div className="side-foot">
          <p className="lab">Settlement</p>
          <p className="side-line">HSP reusable mandates</p>
          <Link href="/how-it-works" className="side-line">How it works</Link>
          <Link href="/" className="side-line">Back to the site</Link>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <span>Tally / dashboard</span>
            <b>{current?.label ?? "Dashboard"}</b>
          </div>
          <div className="top-actions">
            {needsSeller && d.sellers.length > 0 && (
              <label className="picker">
                <span className="lab">Seller</span>
                <select value={d.seller} onChange={(e) => d.selectSeller(e.target.value)} aria-label="Choose seller">
                  {d.sellers.map((s) => (
                    <option key={s.address} value={s.address}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
            {needsSeller && d.dash && <StatusTag status={d.dash.position.status} />}
            {d.authed && <button className="secondary sm" onClick={d.signOut}>Sign out</button>}
          </div>
        </header>

        <main className="content">
          {gate ? (
            <SignIn />
          ) : (
            // Always render the page; each page shows its own loading state.
            children
          )}
          <p className="foot">
            The chain proves the record was not changed. It cannot prove a payer will keep paying, so the pool sizes advances
            conservatively and a reserve takes losses first. Prototype, not audited.
          </p>
        </main>
      </div>
    </div>
  );
}
