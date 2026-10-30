import { keccak256, toHex, type Address, type Hex } from "viem";
import type { PoolState, Position, VaultPort } from "@/lib/vault/client";
import type { AdvanceStatus } from "@/lib/vault/abi";

interface Adv {
  principal: bigint;
  fee: bigint;
  repaidPrincipal: bigint;
  repaidFee: bigint;
  status: AdvanceStatus;
}

const ZERO_ADV: Adv = { principal: 0n, fee: 0n, repaidPrincipal: 0n, repaidFee: 0n, status: "None" };
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export class MemoryVaultError extends Error {}

/**
 * In-memory port of ReceivableVault.sol for tests that need a stateful vault without a chain.
 * The accounting mirrors the contract (principal-then-fee waterfall, reserve absorbs defaults
 * first), and its tests replay the same numbers as the Foundry and anvil tests.
 */
export class MemoryVault implements VaultPort {
  maxAdvance: bigint;
  poolAssets = 0n;
  totalShares = 0n;
  reserve = 0n;
  outstanding = 0n;
  /** Token balance held by the vault (idle cash + reserve). */
  cash = 0n;

  readonly shares = new Map<string, bigint>();
  readonly sellerBalance = new Map<string, bigint>();
  private readonly collectors = new Map<string, Address>();
  private readonly collectorBalance = new Map<string, bigint>();
  private readonly advances = new Map<string, Adv>();
  private txn = 0;

  constructor(maxAdvance: bigint) {
    this.maxAdvance = maxAdvance;
  }

  private hash(): Hex {
    return keccak256(toHex(`demo-tx-${++this.txn}`));
  }

  private adv(seller: string): Adv {
    return this.advances.get(seller.toLowerCase()) ?? ZERO_ADV;
  }

  get idle() {
    return this.cash > this.reserve ? this.cash - this.reserve : 0n;
  }

  // ------------------------------------------------------------ VaultPort

  async pool(): Promise<PoolState> {
    return {
      poolAssets: this.poolAssets,
      totalShares: this.totalShares,
      reserve: this.reserve,
      outstandingPrincipal: this.outstanding,
      idleCash: this.idle,
      maxAdvance: this.maxAdvance,
    };
  }

  async tokenBalance(address: Address): Promise<bigint> {
    return this.sellerBalance.get(address.toLowerCase()) ?? 0n;
  }

  async collectorOf(seller: Address): Promise<Address | null> {
    return this.collectors.get(seller.toLowerCase()) ?? null;
  }

  async position(seller: Address): Promise<Position> {
    const a = this.adv(seller);
    const owed = a.status === "Active" ? a.principal - a.repaidPrincipal + (a.fee - a.repaidFee) : 0n;
    return { seller, collector: await this.collectorOf(seller), advance: { ...a }, owed };
  }

  async registerSeller(seller: Address) {
    const key = seller.toLowerCase();
    if (this.collectors.has(key)) throw new MemoryVaultError("SellerAlreadyRegistered");
    const collector = `0x${keccak256(toHex(`collector-${key}`)).slice(26)}` as Address;
    this.collectors.set(key, collector);
    return { collector, hash: this.hash() };
  }

  async advance(seller: Address, amount: bigint, fee: bigint): Promise<Hex> {
    const key = seller.toLowerCase();
    if (!this.collectors.has(key)) throw new MemoryVaultError("SellerNotRegistered");
    if (amount === 0n) throw new MemoryVaultError("ZeroAmount");
    if (fee === 0n || fee > amount) throw new MemoryVaultError("InvalidFee");
    if (amount > this.maxAdvance) throw new MemoryVaultError("ExceedsMaxAdvance");
    if (amount > this.idle) throw new MemoryVaultError("InsufficientIdleCash");
    if (this.adv(seller).status === "Active") throw new MemoryVaultError("AdvanceExists");

    this.advances.set(key, { principal: amount, fee, repaidPrincipal: 0n, repaidFee: 0n, status: "Active" });
    this.outstanding += amount;
    this.cash -= amount;
    this.sellerBalance.set(key, (this.sellerBalance.get(key) ?? 0n) + amount);
    return this.hash();
  }

  /** The collector's balance moves into the vault, then the waterfall runs (as SellerCollector.sweep). */
  async sweep(collector: Address): Promise<Hex | null> {
    const bal = this.collectorBalance.get(collector.toLowerCase()) ?? 0n;
    if (bal === 0n) return null;
    this.collectorBalance.set(collector.toLowerCase(), 0n);

    const seller = [...this.collectors.entries()].find(([, c]) => c.toLowerCase() === collector.toLowerCase())?.[0];
    if (!seller) throw new MemoryVaultError("NotCollector");

    this.cash += bal;
    const a = { ...this.adv(seller) };

    if (a.status === "Defaulted") {
      this.poolAssets += bal; // late payment after default: recovery for the pool
      return this.hash();
    }

    let toPrincipal = 0n;
    let toFee = 0n;
    if (a.status === "Active") {
      toPrincipal = min(bal, a.principal - a.repaidPrincipal);
      toFee = min(bal - toPrincipal, a.fee - a.repaidFee);
      a.repaidPrincipal += toPrincipal;
      a.repaidFee += toFee;
      this.outstanding -= toPrincipal;
      this.poolAssets += toFee;
      if (a.repaidPrincipal === a.principal && a.repaidFee === a.fee) a.status = "Repaid";
      this.advances.set(seller, a);
    }

    const toSeller = bal - toPrincipal - toFee;
    if (toSeller > 0n) {
      this.cash -= toSeller;
      this.sellerBalance.set(seller, (this.sellerBalance.get(seller) ?? 0n) + toSeller);
    }
    return this.hash();
  }

  async flagDefault(seller: Address): Promise<Hex> {
    const key = seller.toLowerCase();
    const a = { ...this.adv(seller) };
    if (a.status !== "Active") throw new MemoryVaultError("NoActiveAdvance");

    const loss = a.principal - a.repaidPrincipal;
    const covered = min(this.reserve, loss);
    a.status = "Defaulted";
    this.advances.set(key, a);
    this.outstanding -= loss;
    this.reserve -= covered;
    this.poolAssets = this.poolAssets + covered - loss;
    return this.hash();
  }

  // ------------------------------------------------ demo-only (UI actions)

  /** Simulates HSP settling a plain token transfer to the seller's collector. */
  creditCollector(collector: Address, amount: bigint) {
    const k = collector.toLowerCase();
    this.collectorBalance.set(k, (this.collectorBalance.get(k) ?? 0n) + amount);
  }

  deposit(lp: string, amount: bigint): bigint {
    if (amount <= 0n) throw new MemoryVaultError("ZeroAmount");
    let minted = amount;
    if (this.totalShares > 0n) {
      if (this.poolAssets === 0n) throw new MemoryVaultError("PoolImpaired");
      minted = (amount * this.totalShares) / this.poolAssets;
    }
    if (minted === 0n) throw new MemoryVaultError("ZeroAmount");
    const k = lp.toLowerCase();
    this.shares.set(k, (this.shares.get(k) ?? 0n) + minted);
    this.totalShares += minted;
    this.poolAssets += amount;
    this.cash += amount;
    return minted;
  }

  /** Burns `shareAmount` shares; limited by idle cash exactly like the contract. */
  withdraw(lp: string, shareAmount: bigint): bigint {
    const k = lp.toLowerCase();
    if (shareAmount <= 0n) throw new MemoryVaultError("ZeroAmount");
    if ((this.shares.get(k) ?? 0n) < shareAmount) throw new MemoryVaultError("InsufficientShares");
    const amount = (shareAmount * this.poolAssets) / this.totalShares;
    if (amount > this.idle) throw new MemoryVaultError("InsufficientIdleCash");
    this.shares.set(k, (this.shares.get(k) ?? 0n) - shareAmount);
    this.totalShares -= shareAmount;
    this.poolAssets -= amount;
    this.cash -= amount;
    return amount;
  }

  fundReserve(amount: bigint) {
    if (amount <= 0n) throw new MemoryVaultError("ZeroAmount");
    this.reserve += amount;
    this.cash += amount;
  }

  allAdvances() {
    return [...this.advances.entries()].map(([seller, a]) => ({ seller, ...a }));
  }

  lpValue(lp: string): bigint {
    const s = this.shares.get(lp.toLowerCase()) ?? 0n;
    return this.totalShares === 0n ? 0n : (s * this.poolAssets) / this.totalShares;
  }
}
