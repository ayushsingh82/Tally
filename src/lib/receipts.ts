import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type ReceiptType =
  | "order-created"
  | "advance"
  | "advance-declined"
  | "collection"
  | "default";

/** One audit line per money-relevant event. Append-only; never edited. */
export interface Receipt {
  id: string;
  /** Unix ms. */
  ts: number;
  type: ReceiptType;
  seller: string;
  cartMandateId?: string;
  txHash?: string;
  /** 6-decimal token units as decimal strings. */
  amountUnits?: string;
  feeUnits?: string;
  /** Underwriter's reasoning, one line per fact, or a short free-text note. */
  rationale?: string[];
  /** Outcome of address screening at the time. */
  screening?: "passed" | "denylisted" | "not-allowlisted";
  note?: string;
}

export type NewReceipt = Omit<Receipt, "id" | "ts">;

export interface ReceiptLog {
  append(r: NewReceipt): Receipt;
  list(filter?: { seller?: string }): Receipt[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class MemoryReceiptLog implements ReceiptLog {
  protected items: Receipt[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  append(r: NewReceipt): Receipt {
    const full: Receipt = { id: randomUUID(), ts: this.now(), ...r };
    this.items.push(full);
    this.persist(full);
    return full;
  }

  list(filter: { seller?: string } = {}): Receipt[] {
    const s = filter.seller;
    return this.items.filter((r) => !s || same(r.seller, s));
  }

  protected persist(receipt: Receipt): void {
    void receipt;
  }
}

/** JSON Lines file: one receipt per line, appended, so a crash never corrupts earlier lines. */
export class FileReceiptLog extends MemoryReceiptLog {
  constructor(private readonly path: string, now?: () => number) {
    super(now);
    if (existsSync(path)) {
      this.items = readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt);
    }
  }

  protected persist(r: Receipt) {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(r) + "\n");
  }
}

const COLUMNS = ["id", "time_utc", "type", "seller", "cart_mandate_id", "tx_hash", "amount_usd", "fee_usd", "screening", "note"] as const;

const usd = (units?: string) => (units === undefined ? "" : (Number(BigInt(units)) / 1e6).toFixed(2));

/** CSV a spreadsheet or accountant can open. Cells are quoted, and leading =,+,-,@ are neutralized. */
export function toCsv(receipts: Receipt[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = receipts.map((r) =>
    [
      r.id,
      new Date(r.ts).toISOString(),
      r.type,
      r.seller,
      r.cartMandateId ?? "",
      r.txHash ?? "",
      usd(r.amountUnits),
      usd(r.feeUnits),
      r.screening ?? "",
      [r.note, ...(r.rationale ?? [])].filter(Boolean).join(" | "),
    ].map(cell).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n") + "\n";
}
