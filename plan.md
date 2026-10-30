# Plan

Core logic first, no UI. Everything is verified from the terminal with tests, scripts and `curl`. Hard deadline: 2026-11-01 21:30 IST.

## Build table

Target is **testnet for now**; mainnet is a later option (still required before submission/prizes).

| # | Step | What I build | Where | How I verify | Blocked by | Status |
|---|---|---|---|---|---|---|
| 0 | Setup | Read Next.js docs, install Foundry, viem, zod, test runner | `package.json`, `contracts/` | `forge --version`, `npm test` runs | Nothing | **Done** |
| 1 | HSP client | Canonical JSON, HMAC signing, ES256K JWT, mandate builder, create order, query payments, webhook verify | `src/lib/hsp/` | 32 unit tests, HMAC vectors cross-checked with openssl | Real keys to call QA | **Done (offline only)** |
| 2 | `pay_to` test | Script creating a reusable order on HSP QA with a contract as `pay_to` | `scripts/test-pay-to.ts` | QA returns checkout URL, test payment lands in the collector | HSP credentials | Not started |
| 3 | Vault contract | `ReceivableVault.sol` + `SellerCollector.sol`: deposit/withdraw, advance, waterfall, default, reserve, roles, pause | `contracts/` | 38 Foundry tests incl. 2 fuzz | Nothing | **Done** |
| 4 | Data fetch | Map HSP payments to the underwriter's history type; mock source until credentials | `src/lib/hsp/payments.ts` | Tests on fixture data | Real data needs credentials | Partly (client pages payments; mapping not written) |
| 5 | Underwriter | Scoring, caps, declines, rationale, address screening | `src/lib/underwrite/` | 22 unit tests | Nothing | **Done** |
| 6 | Vault client + API | viem client; `POST /api/orders`, `POST /api/advance`, `GET /api/position` | `src/lib/vault/`, `src/app/api/` | curl against dev server + anvil | Nothing | Not started |
| 7 | Webhook | `POST /api/webhook/hsp`: HMAC check, idempotency, then sweep/settle | `src/app/api/webhook/` | Signed fake payloads, duplicate delivery | Nothing | Not started (verify fn + schema exist) |
| 8 | End-to-end local | Buyer simulator pays, vault settles, receipt log | `scripts/simulate-buyer.ts` | One scripted run on anvil, mocked HSP | Nothing | Not started |
| 9 | Testnet deploy | Deploy vault to HashKey Chain testnet, verify source, one real flow on HSP QA | `contracts/script/` | Explorer links, balances match | Testnet RPC + chain ID, HSP QA credentials | Not started |
| 10 | Mainnet (later) | Same deploy on HSK mainnet (chain 177) + one small real flow on HSP production | `contracts/script/` | Explorer links, balances match | Mainnet RPC, HSP production access | Later |

### Done
- Steps 0, 1, 3, 5 (all offline: 92 tests passing, typecheck and lint clean)

### Not complete
- Step 4 (mapping), 6, 7, 8 need no outside access
- Steps 2, 9 need HSP QA credentials and a testnet RPC
- Step 10 is deferred; mainnet deployment is still a hackathon requirement for demo selection and prizes

## Order

1. **Steps 3, 5, 1 first.** They need no outside access and are the core.
2. **Steps 6 to 8**, with HSP mocked, to get a full loop working locally.
3. **Steps 2 and 9** as soon as credentials arrive. They validate the assumptions, so earlier steps are built to survive a `pay_to` change (keeper fallback: normal address plus a script that forwards funds to the vault).

UI is later and only if time remains.

## Status

| Step | Status | Evidence |
|---|---|---|
| 0, 1, 3, 5 | done, pushed | tooling, HSP client, contracts, underwriter |
| 2 `pay_to` test | script pushed, **not run against HSP** | needs HSP credentials |
| 4 data fetch, 6 vault client + API | done, pushed | `d4e7155`, `2a5c0dd` |
| 7 webhook route, 8 simulator | done, pushed | `a5d6798`, `77f2bd3` |
| 9a testnet keys | done | `.env.local`, `.secrets/` (git-ignored) |
| 9b tooling | done, uncommitted | `scripts/check-funds.ts`, `testnet-setup.ts`, `testnet-flow.ts`, rehearsed end to end on a local chain |
| 9c testnet deploy | **blocked on funds** | wallets hold 0 HSK and 0 USDC |
| 11 frontend | done, uncommitted, **real-only** | demo mode removed; passcode sign-in; reads the real vault; toasts, skeletons, 404/error pages |
| 11j real-mode UI | done, uncommitted | sign-in gate, seller registration, HSP checkout link, pool funding info |

Tests: 142 TypeScript + 38 Foundry. The in-memory vault now lives in `src/lib/testkit/` for tests only.

### Not yet verified (be honest in the demo)

- Nothing has talked to a real HSP gateway. Signing follows the docs and matches independent `openssl` vectors, but the gateway's acceptance is untested (step 2).
- Canonical JSON string escaping vs the server (e.g. `<`, `>`, `&`, non-ASCII) is untested.
- Vault has no malicious-token reentrancy test; it uses `nonReentrant` and a standard ERC20 only. Not audited.
- Only `payment-finalized` (or `payment-safe`) should trigger `sweep()`; `payment-included` can still reorg.

## Cut order if short on time

1. Drop the default scenario (keep as Q&A talk).
2. Drop CSV export and any UI.
3. Never drop: mainnet vault, one real HSP payment, working repayment waterfall.

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| HSP access delayed | Blocks steps 2 and 9 | Ask now; build with mocks meanwhile |
| `pay_to` contract not accepted | Design change | Keeper fallback described above |
| Vault bug | Funds loss | Small caps, tests, tiny amounts on mainnet |
| History API too thin to score | Weak underwriting | Keep scoring rule-based and simple |
| Read as unregulated lending | Credibility | State prototype status; compliance screening in the underwriter |

## Submission checklist

- [ ] Registered on DoraHacks before 2026-11-01 21:30 IST
- [ ] Contract deployed on HSK Chain mainnet (required for demo selection)
- [ ] HSP used for the payment flow
- [ ] Public repo with README
- [ ] Demo video
- [ ] Registered for Mumbai Demo Day if attending in person
