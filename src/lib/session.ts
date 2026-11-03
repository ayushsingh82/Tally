import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "tally_session";
const MAX_AGE = 60 * 60 * 8;
const MIN_LEN = 12;
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;

const g = globalThis as unknown as { __tallyFails?: number[] };

const passcode = () => {
  const p = process.env.DASHBOARD_PASSCODE;
  return p && p.length >= MIN_LEN ? p : null;
};

const token = (p: string) => createHmac("sha256", p).update("tally-dashboard-session").digest("hex");
const digest = (s: string) => createHash("sha256").update(s).digest();

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export const passcodeConfigured = () => passcode() !== null;

/** True for a valid session cookie. Fails closed when no passcode is configured. */
export async function isAuthed(): Promise<boolean> {
  const p = passcode();
  if (!p) return false;
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && safeEqual(c, token(p));
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/** Checks the passcode with a small failed-attempt limit, then sets an httpOnly session cookie. */
export async function signIn(attempt: string): Promise<SignInResult> {
  const p = passcode();
  if (!p) return { ok: false, error: `Set DASHBOARD_PASSCODE (at least ${MIN_LEN} characters) to enable sign-in.` };

  const now = Date.now();
  const fails = (g.__tallyFails ??= []).filter((t) => now - t < WINDOW_MS);
  g.__tallyFails = fails;
  if (fails.length >= MAX_FAILS) return { ok: false, error: "Too many attempts. Try again in a few minutes." };

  if (!safeEqual(attempt, p)) {
    fails.push(now);
    return { ok: false, error: "Wrong passcode." };
  }
  g.__tallyFails = [];
  (await cookies()).set(COOKIE, token(p), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
