import { beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { MemoryVault } from "./memory-vault";

const U = 1_000_000n;
const A = "0x00000000000000000000000000000000000000a1" as Address;

// These replay the exact numbers asserted in the Foundry tests, so the demo cannot drift from the contract.
describe("MemoryVault mirrors ReceivableVault", () => {
  let v: MemoryVault;
  let collector: Address;
  beforeEach(async () => {
    v = new MemoryVault(1_000n * U);
    v.deposit("lp", 1_000n * U);
    collector = (await v.registerSeller(A)).collector;
  });
  const pay = async (amt: bigint) => {
    v.creditCollector(collector, amt);
    return v.sweep(collector);
  };

  it("advance does not change LP value", async () => {
    await v.advance(A, 120n * U, 12n * U);
    expect(v.poolAssets).toBe(1_000n * U);
    expect(v.idle).toBe(880n * U);
    expect((await v.position(A)).owed).toBe(132n * U);
  });

  it("repays principal first, then fee, then surplus to the seller", async () => {
    await v.advance(A, 120n * U, 12n * U);
    await pay(125n * U);
    let p = await v.position(A);
    expect(p.advance.repaidPrincipal).toBe(120n * U);
    expect(p.advance.repaidFee).toBe(5n * U);
    expect(v.poolAssets).toBe(1_005n * U);

    await pay(55n * U); // 7 to clear the fee, 48 surplus
    p = await v.position(A);
    expect(p.advance.status).toBe("Repaid");
    expect(v.poolAssets).toBe(1_012n * U);
    expect(v.sellerBalance.get(A.toLowerCase())).toBe(120n * U + 48n * U);
    expect(v.outstanding).toBe(0n);
  });

  it("defaults hit the reserve before LPs", async () => {
    v.fundReserve(30n * U);
    await v.advance(A, 120n * U, 12n * U);
    await v.flagDefault(A);
    expect(v.reserve).toBe(0n);
    expect(v.poolAssets).toBe(910n * U);
  });

  it("enforces the same limits", async () => {
    await expect(v.advance(A, 1_001n * U, 10n * U)).rejects.toThrow("ExceedsMaxAdvance");
    await expect(v.advance(A, 100n * U, 0n)).rejects.toThrow("InvalidFee");
    await v.advance(A, 100n * U, 10n * U);
    await expect(v.advance(A, 100n * U, 10n * U)).rejects.toThrow("AdvanceExists");
  });

  it("withdraw is limited by idle cash", async () => {
    await v.advance(A, 800n * U, 80n * U);
    expect(() => v.withdraw("lp", 1_000n * U)).toThrow("InsufficientIdleCash");
  });

  it("conserves tokens through a payment", async () => {
    await v.advance(A, 100n * U, 10n * U);
    const before = v.cash + (v.sellerBalance.get(A.toLowerCase()) ?? 0n);
    await pay(137n * U);
    expect(v.cash + (v.sellerBalance.get(A.toLowerCase()) ?? 0n)).toBe(before + 137n * U);
  });
});

