import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

export function SiteNav() {
  return (
    <header className="site-nav">
      <Link href="/" className="logo-row">
        <Logo size={48} />
        <span>Tally</span>
      </Link>
      <nav className="links" aria-label="Site">
        <Link className="l" href="/how-it-works">How it works</Link>
        <Link className="l" href="/dashboard/playground">Underwriter</Link>
        <Link className="btn" href="/dashboard">Dashboard</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap foot-grid">
        <div className="foot-brand">
          <Link href="/" className="logo-row">
            <Logo size={44} />
            <span>Tally</span>
          </Link>
          <p>Instant cash for AI agents, backed by the payments they are already owed. The pool is repaid first, on-chain.</p>
        </div>
        <nav aria-label="Product">
          <span className="lab">Product</span>
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/seller">Seller console</Link>
          <Link href="/dashboard/pool">Liquidity pool</Link>
          <Link href="/dashboard/activity">Activity</Link>
        </nav>
        <nav aria-label="Learn">
          <span className="lab">Learn</span>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/dashboard/playground">Underwriter playground</Link>
          <Link href="/#trust">Trust model</Link>
        </nav>
        <div>
          <span className="lab">Built on</span>
          <p className="foot-note">HashKey Settlement Protocol</p>
          <p className="foot-note">HSK Chain Horizon Hackathon, Track 2</p>
          <a className="foot-link" href="https://hashkey-merchant.github.io/#/" target="_blank" rel="noreferrer">HSP docs ↗</a>
        </div>
      </div>
      <div className="foot-bar">
        <div className="wrap">
          <span>© 2026 Tally</span>
          <span>Prototype. Not audited. Not affiliated with HashKey. Do not use real funds.</span>
        </div>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
