export interface ScreeningLists {
  allow?: string[];
  deny: string[];
}

export type ScreenResult = { ok: true } | { ok: false; code: "DENYLISTED" | "NOT_ALLOWLISTED"; reason: string };

const norm = (a: string) => a.trim().toLowerCase();

/** Address-level screening. When an allowlist is set, only listed addresses pass. */
export function screenAddress(address: string, lists: ScreeningLists): ScreenResult {
  const a = norm(address);
  if (lists.deny.some((d) => norm(d) === a)) {
    return { ok: false, code: "DENYLISTED", reason: `${address} is on the deny list` };
  }
  if (lists.allow && lists.allow.length > 0 && !lists.allow.some((x) => norm(x) === a)) {
    return { ok: false, code: "NOT_ALLOWLISTED", reason: `${address} is not on the allow list` };
  }
  return { ok: true };
}
