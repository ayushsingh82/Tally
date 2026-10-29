import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import { collectorAbi, STATUS, vaultAbi, type AdvanceStatus } from "./abi";

export interface Position {
  seller: Address;
  collector: Address | null;
  advance: {
    principal: bigint;
    fee: bigint;
    repaidPrincipal: bigint;
    repaidFee: bigint;
    status: AdvanceStatus;
  };
  owed: bigint;
}

export interface PoolState {
  poolAssets: bigint;
  totalShares: bigint;
  reserve: bigint;
  outstandingPrincipal: bigint;
  idleCash: bigint;
  maxAdvance: bigint;
}

/** What the service layer needs from the chain; lets tests swap in a fake. */
export interface VaultPort {
  pool(): Promise<PoolState>;
  position(seller: Address): Promise<Position>;
  collectorOf(seller: Address): Promise<Address | null>;
  registerSeller(seller: Address): Promise<{ collector: Address; hash: Hex }>;
  advance(seller: Address, amount: bigint, fee: bigint): Promise<Hex>;
  /** Returns null when the collector held nothing to sweep. */
  sweep(collector: Address): Promise<Hex | null>;
  flagDefault(seller: Address): Promise<Hex>;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export class VaultClient implements VaultPort {
  constructor(
    private readonly publicClient: PublicClient<Transport, Chain>,
    private readonly walletClient: WalletClient<Transport, Chain, Account>,
    readonly vault: Address,
  ) {}

  private read<F extends string>(functionName: F, args?: readonly unknown[]) {
    return this.publicClient.readContract({
      address: this.vault,
      abi: vaultAbi,
      functionName,
      args,
    } as never) as Promise<never>;
  }

  async pool(): Promise<PoolState> {
    const [poolAssets, totalShares, reserve, outstandingPrincipal, idleCash, maxAdvance] = (await Promise.all([
      this.read("poolAssets"),
      this.read("totalShares"),
      this.read("reserve"),
      this.read("outstandingPrincipal"),
      this.read("idleCash"),
      this.read("maxAdvance"),
    ])) as bigint[];
    return { poolAssets, totalShares, reserve, outstandingPrincipal, idleCash, maxAdvance };
  }

  async collectorOf(seller: Address): Promise<Address | null> {
    const c = (await this.read("collectorOf", [seller])) as Address;
    return c === ZERO ? null : c;
  }

  async position(seller: Address): Promise<Position> {
    const [collector, adv, owed] = await Promise.all([
      this.collectorOf(seller),
      this.read("advances", [seller]) as Promise<readonly [bigint, bigint, bigint, bigint, number]>,
      this.read("owed", [seller]) as Promise<bigint>,
    ]);
    return {
      seller,
      collector,
      advance: {
        principal: adv[0],
        fee: adv[1],
        repaidPrincipal: adv[2],
        repaidFee: adv[3],
        status: STATUS[adv[4]] ?? "None",
      },
      owed,
    };
  }

  private async send(address: Address, abi: typeof vaultAbi | typeof collectorAbi, functionName: string, args: unknown[]) {
    // Simulate first so reverts surface as readable custom errors before spending gas.
    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account,
      address,
      abi,
      functionName,
      args,
    } as never);
    const hash = await this.walletClient.writeContract(request as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted on-chain (${hash})`);
    return hash;
  }

  async registerSeller(seller: Address) {
    const hash = await this.send(this.vault, vaultAbi, "registerSeller", [seller]);
    const collector = await this.collectorOf(seller);
    if (!collector) throw new Error("registerSeller succeeded but no collector was recorded");
    return { collector, hash };
  }

  advance(seller: Address, amount: bigint, fee: bigint) {
    return this.send(this.vault, vaultAbi, "advance", [seller, amount, fee]);
  }

  async sweep(collector: Address): Promise<Hex | null> {
    try {
      return await this.send(collector, collectorAbi, "sweep", []);
    } catch (e) {
      if (isNothingToSweep(e)) return null;
      throw e;
    }
  }

  flagDefault(seller: Address) {
    return this.send(this.vault, vaultAbi, "flagDefault", [seller]);
  }
}

export function isNothingToSweep(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ""}` : "";
  return msg.includes("NothingToSweep");
}
