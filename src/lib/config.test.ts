import { describe, expect, it } from "vitest";
import { loadEnv } from "./config";

const good = {
  HSP_BASE_URL: "https://merchant-qa.hashkeymerchant.com",
  HSP_APP_KEY: "ak",
  HSP_APP_SECRET: "secret",
  HSP_JWT_PRIVATE_KEY: "pem",
  HSP_NETWORK: "hashkey-testnet",
  HSP_CHAIN_ID: "133",
  HSP_TOKEN_ADDRESS: "0xToken",
  CHAIN_RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  VAULT_ADDRESS: "0x" + "ab".repeat(20),
  UNDERWRITER_PRIVATE_KEY: "0x" + "11".repeat(32),
  API_TOKEN: "a-sufficiently-long-token",
};

describe("loadEnv", () => {
  it("parses a valid env, coercing numbers and applying defaults", () => {
    const e = loadEnv(good);
    expect(e.HSP_CHAIN_ID).toBe(133);
    expect(e.CHAIN_ID).toBe(31337);
    expect(e.HSP_COIN).toBe("USDC");
    expect(e.DENY_LIST).toEqual([]);
    expect(e.DATA_FILE).toBe(".data/state.json");
  });

  it("splits comma lists and trims", () => {
    expect(loadEnv({ ...good, DENY_LIST: " 0xa , 0xb ,," }).DENY_LIST).toEqual(["0xa", "0xb"]);
  });

  it("names every bad field without echoing secret values", () => {
    try {
      loadEnv({ ...good, UNDERWRITER_PRIVATE_KEY: "0xshort", API_TOKEN: "short", HSP_APP_KEY: undefined });
      throw new Error("should have thrown");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("UNDERWRITER_PRIVATE_KEY");
      expect(m).toContain("API_TOKEN");
      expect(m).toContain("HSP_APP_KEY");
      expect(m).not.toContain("0xshort");
    }
  });
});
