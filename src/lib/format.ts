/** Token units (6 decimals) to a display string like `$1,234.50`. */
export function usd(units: string | bigint | number, opts: { cents?: boolean } = {}): string {
  const n = typeof units === "number" ? units : Number(BigInt(units)) / 1e6;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
}

export const usdPlain = (n: number) => usd(n);

export function shortAddr(a: string, head = 6, tail = 4): string {
  return a.length <= head + tail + 2 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;

/** Block explorer link for an address on HashKey Chain testnet (133) or mainnet (177); undefined for other chains. */
export function explorerAddressUrl(address: string, chainId: number): string | undefined {
  if (chainId === 133) return `https://testnet-explorer.hskchain.net/address/${address}`;
  if (chainId === 177) return `https://hashkey.blockscout.com/address/${address}`;
  return undefined;
}
