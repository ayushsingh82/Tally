import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface MandateRecord {
  cartMandateId: string;
  paymentRequestId: string;
  seller: string;
  /** SellerCollector address used as `pay_to`. */
  collector: string;
  /** Unix ms of the mandate's cart_expiry. */
  expiresAt: number;
  revoked: boolean;
  paymentUrl: string;
  createdAt: number;
}

export interface Store {
  getMandate(cartMandateId: string): MandateRecord | undefined;
  getMandateBySeller(seller: string): MandateRecord | undefined;
  putMandate(m: MandateRecord): void;
  /** Returns true the first time a key is seen, false on every repeat. */
  markEvent(key: string): boolean;
  /** Forgets a key so a gateway retry is processed again (used when handling failed). */
  unmarkEvent(key: string): void;
}

interface State {
  mandates: Record<string, MandateRecord>;
  events: string[];
}

const lower = (s: string) => s.toLowerCase();

export class MemoryStore implements Store {
  protected state: State = { mandates: {}, events: [] };
  private seen = new Set<string>();

  getMandate(id: string) {
    return this.state.mandates[id];
  }

  getMandateBySeller(seller: string) {
    const all = Object.values(this.state.mandates).filter((m) => lower(m.seller) === lower(seller));
    return all.sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  putMandate(m: MandateRecord) {
    this.state.mandates[m.cartMandateId] = m;
    this.persist();
  }

  markEvent(key: string) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.state.events.push(key);
    this.persist();
    return true;
  }

  unmarkEvent(key: string) {
    if (!this.seen.delete(key)) return;
    this.state.events = this.state.events.filter((k) => k !== key);
    this.persist();
  }

  protected hydrate(state: State) {
    this.state = state;
    this.seen = new Set(state.events);
  }

  protected persist() {}
}

/** JSON file store, written atomically. Fine for a single-process prototype, not for production. */
export class FileStore extends MemoryStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) this.hydrate(JSON.parse(readFileSync(path, "utf8")) as State);
  }

  protected persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }
}
