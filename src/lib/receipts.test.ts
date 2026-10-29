import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileReceiptLog, MemoryReceiptLog, toCsv } from "./receipts";

const SELLER = "0x00000000000000000000000000000000000000a1";

describe("MemoryReceiptLog", () => {
  it("stamps id and time, and filters by seller case-insensitively", () => {
    const log = new MemoryReceiptLog(() => 1_700_000_000_000);
    const r = log.append({ type: "advance", seller: SELLER, amountUnits: "120000000" });
    expect(r.ts).toBe(1_700_000_000_000);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    log.append({ type: "default", seller: "0xother" });
    expect(log.list({ seller: SELLER.toUpperCase().replace("0X", "0x") })).toHaveLength(1);
    expect(log.list()).toHaveLength(2);
  });
});

describe("FileReceiptLog", () => {
  it("appends JSON lines and reloads them", () => {
    const dir = mkdtempSync(join(tmpdir(), "receipts-"));
    const path = join(dir, "nested", "r.jsonl");
    try {
      const a = new FileReceiptLog(path);
      a.append({ type: "advance", seller: SELLER });
      a.append({ type: "collection", seller: SELLER, txHash: "0xabc" });
      expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);

      const b = new FileReceiptLog(path);
      expect(b.list().map((r) => r.type)).toEqual(["advance", "collection"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("toCsv", () => {
  it("renders a header, USD amounts and joined notes", () => {
    const log = new MemoryReceiptLog(() => Date.UTC(2026, 9, 29));
    log.append({
      type: "advance",
      seller: SELLER,
      txHash: "0xabc",
      amountUnits: "120000000",
      feeUnits: "9600000",
      screening: "passed",
      rationale: ["Approved $120", "Score 80/100"],
    });
    const lines = toCsv(log.list()).trim().split("\n");
    expect(lines[0]).toBe("id,time_utc,type,seller,cart_mandate_id,tx_hash,amount_usd,fee_usd,screening,note");
    expect(lines[1]).toContain('"2026-10-29T00:00:00.000Z"');
    expect(lines[1]).toContain('"120.00","9.60","passed"');
    expect(lines[1]).toContain("Approved $120 | Score 80/100");
  });

  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    const log = new MemoryReceiptLog();
    log.append({ type: "default", seller: SELLER, note: '=HYPERLINK("http://evil")' });
    log.append({ type: "default", seller: SELLER, note: 'said "stop"' });
    const csv = toCsv(log.list());
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"said ""stop"""');
  });
});
