"use server";

import { isAddress, type Address } from "viem";
import { z, ZodError } from "zod";
import { getContainer } from "@/lib/container";
import { poolOverview, sellerView, type SellerInfo } from "@/lib/dashboard";
import { shortAddr } from "@/lib/format";
import { toCsv } from "@/lib/receipts";
import { createOrder, flagDefault, requestAdvance, ServiceError } from "@/lib/service";
import { isAuthed, passcodeConfigured, signIn, signOut } from "@/lib/session";

/**
 * Server Functions are reachable by direct POST, so every one authorizes itself. They talk to the
 * real vault and gateway, so everything except the session calls requires a valid passcode session.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ctx() {
  const { deps, env, hspConfigured } = await getContainer();
  const seen = new Set<string>();
  const sellers: SellerInfo[] = [];
  for (const m of deps.store.listMandates()) {
    const k = m.seller.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    sellers.push({ address: m.seller as Address, name: shortAddr(m.seller, 8, 4), blurb: "Registered seller", expect: "" });
  }
  return { deps, sellers, vault: env.VAULT_ADDRESS, token: env.HSP_TOKEN_ADDRESS, hspConfigured };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

async function run<T>(fn: (c: Ctx) => Promise<T>): Promise<Result<T>> {
  try {
    if (!(await isAuthed())) throw new ServiceError(401, "UNAUTHORIZED", "Sign in to continue.");
    return { ok: true, data: await fn(await ctx()) };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => i.message).join("; ") };
    if (e instanceof Error) return { ok: false, error: e.message };
    return { ok: false, error: "Something went wrong" };
  }
}

const knownSeller = (c: Ctx) =>
  z.string().refine((s) => isAddress(s) && c.sellers.some((d) => d.address.toLowerCase() === s.toLowerCase()), "Unknown seller");

// ---------------------------------------------------------------- session (no sign-in needed)

export async function getSession() {
  return { authed: await isAuthed(), passcodeSet: passcodeConfigured() };
}

export async function signInAction(passcode: string): Promise<Result<true>> {
  const r = await signIn(String(passcode ?? ""));
  return r.ok ? { ok: true, data: true } : { ok: false, error: r.error };
}

export async function signOutAction(): Promise<Result<true>> {
  await signOut();
  return { ok: true, data: true };
}

// ---------------------------------------------------------------- data

export async function listSellers() {
  return run(async (c) => c.sellers);
}

export async function getSellerDashboard(seller: string) {
  return run(async (c) => sellerView(c.deps, knownSeller(c).parse(seller) as Address));
}

export async function getPoolDashboard() {
  return run(async (c) => ({
    ...(await poolOverview(c.deps, c.sellers)),
    chain: { vault: c.vault, token: c.token },
    hspConfigured: c.hspConfigured,
  }));
}

export async function getActivity() {
  return run(async (c) => c.deps.receipts.list().sort((a, b) => b.ts - a.ts));
}

export async function exportReceiptsCsv() {
  return run(async (c) => toCsv(c.deps.receipts.list().sort((a, b) => a.ts - b.ts)));
}

// ---------------------------------------------------------------- actions

export async function previewAdvance(seller: string, requestedUsd?: number) {
  return run(async (c) => requestAdvance(c.deps, { seller: knownSeller(c).parse(seller), requestedUsd, dryRun: true }));
}

export async function takeAdvance(seller: string, requestedUsd?: number) {
  return run(async (c) => requestAdvance(c.deps, { seller: knownSeller(c).parse(seller), requestedUsd }));
}

export async function markDefault(seller: string) {
  return run(async (c) => flagDefault(c.deps, { seller: knownSeller(c).parse(seller), reason: "Marked by the operator" }));
}

/** Registers a seller on-chain and creates their reusable HSP order. Needs HSP credentials. */
export async function registerSeller(seller: string, totalUsd: string, expiryDays: number) {
  return run(async (c) => createOrder(c.deps, { seller, totalUsd, expiryDays }));
}
