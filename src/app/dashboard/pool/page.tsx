"use client";

import { useDapp } from "@/dapp";
import { explorerAddressUrl, shortAddr, usd } from "@/lib/format";
import { FlowBar, Skeleton, Stats, StatusTag } from "@/ui/bits";

function AddressLink({ address, chainId }: { address: string; chainId: number }) {
  const href = explorerAddressUrl(address, chainId);
  return href ? (
    <a className="mono addr" href={href} target="_blank" rel="noreferrer" title={address}>{shortAddr(address, 10, 6)} ↗</a>
  ) : (
    <span className="mono" title={address}>{shortAddr(address, 10, 6)}</span>
  );
}

export default function PoolPage() {
  const d = useDapp();
  if (!d.pool) return <Skeleton />;

  const { pool: p, advances, chain, hspConfigured } = d.pool;
  const num = (v: string) => Number(BigInt(v)) / 1e6;

  return (
    <>
      <div className="page-head">
        <h1>Liquidity pool</h1>
        <p>Capital that funds advances. Fees earned on repaid advances raise the share price.</p>
      </div>

      <Stats
        items={[
          { label: "Pool value", value: usd(p.poolAssets), sub: "Cash plus unrepaid principal" },
          { label: "Lent out", value: usd(p.outstandingPrincipal), sub: `${p.utilizationPct.toFixed(1)}% utilization` },
          { label: "Available", value: usd(p.idleCash), sub: `Max ${usd(p.maxAdvance)} per advance` },
          { label: "Share price", value: `$${p.sharePrice.toFixed(4)}`, sub: "Rises as fees are earned" },
        ]}
      />

      <div className="split">
        <div className="stack">
          <section className="card">
            <header><h2>Where the money is</h2></header>
            <FlowBar
              total={num(p.poolAssets) + num(p.reserve)}
              segs={[
                { label: "Lent out", value: num(p.outstandingPrincipal), tone: "brand" },
                { label: "Idle", value: num(p.idleCash), tone: "tint" },
                { label: "Reserve", value: num(p.reserve), tone: "warn" },
              ]}
            />
          </section>

          <section className="card">
            <header><h2>Advances</h2><span className="small muted">Every loan the pool has made.</span></header>
            {advances.length === 0 ? (
              <p className="muted">No advances yet. Take one in the seller console.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Seller</th><th>Principal</th><th>Fee</th><th>Repaid</th><th>Status</th></tr></thead>
                  <tbody>
                    {advances.map((a) => {
                      const total = BigInt(a.principal) + BigInt(a.fee);
                      const done = BigInt(a.repaidPrincipal) + BigInt(a.repaidFee);
                      return (
                        <tr key={a.seller}>
                          <td>{a.name}</td><td>{usd(a.principal)}</td><td>{usd(a.fee)}</td>
                          <td>{total === 0n ? 0 : Number((done * 100n) / total)}%</td>
                          <td><StatusTag status={a.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <header><h2>Fund the pool</h2><span className="small muted">Liquidity providers deposit straight to the vault from their own wallet.</span></header>
            <dl className="kv">
              <dt>Network</dt><dd>{chain.name}</dd>
              <dt>Vault</dt><dd><AddressLink address={chain.vault} chainId={chain.id} /></dd>
              <dt>Token</dt><dd><AddressLink address={chain.token} chainId={chain.id} /></dd>
            </dl>
            <p className="small muted">Approve the token, then call deposit(amount) on the vault. Withdraw by burning shares, limited to idle cash.</p>
          </section>

          {!hspConfigured && (
            <section className="card">
              <header><h3>HSP is not connected</h3></header>
              <p className="small muted">Orders and live payment history need HSP merchant credentials. Until they are set, the underwriter sees an empty history and will decline.</p>
            </section>
          )}

          <section className="card">
            <header><h3>Who loses first</h3></header>
            <ol className="reasons">
              <li>The seller stops receiving payments for that mandate.</li>
              <li>The first-loss reserve ({usd(p.reserve)}) absorbs the shortfall.</li>
              <li>Only then does the pool&apos;s value fall, shared by every LP.</li>
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
