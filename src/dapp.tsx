"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getActivity,
  getPoolDashboard,
  getSellerDashboard,
  getSession,
  listSellers,
  signInAction,
  signOutAction,
  type Result,
} from "@/app/actions";

type Ok<T> = T extends { ok: true; data: infer D } ? D : never;
export type Sellers = Ok<Awaited<ReturnType<typeof listSellers>>>;
export type SellerDash = Ok<Awaited<ReturnType<typeof getSellerDashboard>>>;
export type PoolDash = Ok<Awaited<ReturnType<typeof getPoolDashboard>>>;
export type Activity = Ok<Awaited<ReturnType<typeof getActivity>>>;
export type Message = { kind: "ok" | "error"; text: string };

interface Dapp {
  /** False until the first session check returns, so pages can show a skeleton first. */
  checked: boolean;
  authed: boolean;
  passcodeSet: boolean;
  /** True once the first batch of data has been requested for an authorized session. */
  loaded: boolean;
  sellers: Sellers;
  seller: string;
  selectSeller: (address: string) => void;
  dash: SellerDash | null;
  pool: PoolDash | null;
  activity: Activity;
  message: Message | null;
  busy: boolean;
  /** Runs a server action, shows its outcome, then refreshes everything once. */
  run: <T>(fn: () => Promise<Result<T>>, okText?: (d: T) => string | void) => Promise<T | undefined>;
  signIn: (passcode: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  dismiss: () => void;
}

const Ctx = createContext<Dapp | null>(null);

export function useDapp(): Dapp {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDapp must be used inside <DappProvider>");
  return v;
}

/** One shared copy of the dashboard state, loaded once and refreshed after each action. */
export function DappProvider({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [passcodeSet, setPasscodeSet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sellers, setSellers] = useState<Sellers>([]);
  const [seller, setSeller] = useState("");
  const [dash, setDash] = useState<SellerDash | null>(null);
  const [pool, setPool] = useState<PoolDash | null>(null);
  const [activity, setActivity] = useState<Activity>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const sellerRef = useRef("");

  /** Reloads sellers, the selected seller, the pool and the activity log together. */
  const refresh = useCallback(async (preferred?: string) => {
    const [sl, p, a] = await Promise.all([listSellers(), getPoolDashboard(), getActivity()]);
    if (sl.ok) setSellers(sl.data);
    if (p.ok) setPool(p.data);
    if (a.ok) setActivity(a.data);

    const list = sl.ok ? sl.data : [];
    const keep = preferred && list.some((s) => s.address === preferred) ? preferred : (list[0]?.address ?? "");
    sellerRef.current = keep;
    setSeller(keep);
    if (!keep) {
      setDash(null);
    } else {
      const d = await getSellerDashboard(keep);
      if (sellerRef.current === keep && d.ok) setDash(d.data);
      if (!d.ok) setMessage({ kind: "error", text: d.error });
    }
    const failed = [sl, p, a].find((r) => !r.ok);
    if (failed && !failed.ok) setMessage({ kind: "error", text: failed.error });
    setLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getSession();
      setChecked(true);
      setAuthed(s.authed);
      setPasscodeSet(s.passcodeSet);
      if (s.authed) await refresh();
    })();
  }, [refresh]);

  const selectSeller = useCallback((address: string) => {
    sellerRef.current = address;
    setSeller(address);
    setDash(null);
    setMessage(null);
    void getSellerDashboard(address).then((d) => {
      if (sellerRef.current !== address) return;
      if (d.ok) setDash(d.data);
      else setMessage({ kind: "error", text: d.error });
    });
  }, []);

  const run: Dapp["run"] = useCallback(
    async (fn, okText) => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await fn();
        if (!r.ok) {
          setMessage({ kind: "error", text: r.error });
          return undefined;
        }
        const text = okText?.(r.data);
        if (text) setMessage({ kind: "ok", text });
        await refresh(sellerRef.current);
        return r.data;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const signIn = useCallback(
    async (passcode: string) => {
      const r = await signInAction(passcode);
      if (!r.ok) return r.error;
      setAuthed(true);
      await refresh();
      return null;
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await signOutAction();
    setAuthed(false);
    setLoaded(false);
    setDash(null);
    setPool(null);
    setSellers([]);
    setActivity([]);
  }, []);

  const dismiss = useCallback(() => setMessage(null), []);

  const value = useMemo<Dapp>(
    () => ({ checked, authed, passcodeSet, loaded, sellers, seller, selectSeller, dash, pool, activity, message, busy, run, signIn, signOut, dismiss }),
    [checked, authed, passcodeSet, loaded, sellers, seller, selectSeller, dash, pool, activity, message, busy, run, signIn, signOut, dismiss],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
