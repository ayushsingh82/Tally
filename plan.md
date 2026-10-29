# Plan

Scope-first plan. Dates are not fixed here; order work by the milestones and cut from the bottom if time runs short. Hard deadline: 2026-11-01 21:30 IST.

## Milestones

### M0 — De-risk assumptions (do first, blocks everything)

- [ ] Request HSP merchant access (`app_key`, HMAC secret, ES256K key). Ask in the support group: https://t.me/+M5yaRB-u4PRiNWM1
- [ ] Read `onboarding.md`, `authentication.md`, `webhook.md` on https://hashkey-merchant.github.io/docs/en/
- [ ] On QA (`https://merchant-qa.hashkeymerchant.com`): create a reusable order with `pay_to` = a contract address. Confirm it is accepted.
- [ ] Confirm the vault can receive the payment as a plain ERC20 transfer.
- [ ] Get HSK Chain mainnet chain ID, RPC, USDC/USDT addresses from https://hashfans.io/dev-onepager
- [ ] Confirm HSKSwap is not needed (it is not for this track).

Exit: a test payment settles into a contract on QA/testnet.

### M1 — Contract

`ReceivableVault.sol` (Solidity, Foundry or Hardhat).

- [ ] State: LP deposits, per-seller advance record (principal, discount, repaid, status).
- [ ] `deposit(amount)`, `withdraw(amount)` for LPs.
- [ ] `advance(seller, amount, discount)` — callable by the underwriter role only.
- [ ] `settle(seller)` — reads token balance delta, applies waterfall: LP principal+discount, then seller.
- [ ] `flagDefault(seller)` — underwriter role; draws the first-loss reserve.
- [ ] Events for every state change (feeds receipts and the dashboard).
- [ ] Tests: waterfall math, over-payment, default, reentrancy, role checks.
- [ ] Deploy to testnet, then HSK Chain mainnet. Verify source.

Design notes: keep it small and auditable. Cap advance per seller. Pausable by owner. No upgradeability.

### M2 — Backend (Next.js route handlers)

- [ ] HSP client: canonical JSON, HMAC-SHA256 headers (`X-App-Key`, `X-Signature`, `X-Timestamp`, `X-Nonce`), ES256K JWT for `merchant_authorization`.
- [ ] Create reusable order, query reusable payments.
- [ ] Webhook endpoint with HMAC verification and idempotency.
- [ ] Underwriter: score from payment history (regularity, count, buyer concentration, mandate time left), compute advance and discount, produce a plain-language rationale. Payee screening against an allow/deny list.
- [ ] Vault client (viem): call `advance`, `settle`, `flagDefault`, read state.
- [ ] Receipts: store and CSV export.

### M3 — Agents and UI

- [ ] Seller chat: "I need N USDC", shows underwriter offer, accept button.
- [ ] LP view: deposit, pool utilization, yield.
- [ ] Live dashboard: mandate, expected income, advance, repayments, waterfall progress, risk status.
- [ ] Buyer simulator: script that pays on a schedule through HSP so the demo is repeatable.
- [ ] Explorer links on every on-chain action.

### M4 — Mainnet run and demo

- [ ] One real end-to-end run on mainnet with small amounts.
- [ ] Default scenario run (revoke mandate).
- [ ] Record a backup demo video.
- [ ] Submission text, repo, deployed contract address, demo link.

## Cut order if short on time

1. Drop the default beat (keep it as Q&A talk).
2. Drop the LP page (seed the pool by script).
3. Drop CSV export.
4. Never drop: mainnet vault, one real HSP payment, live repayment.

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| HSP access delayed | Blocks M0 | Ask immediately; build against QA meanwhile |
| `pay_to` contract not accepted | Blocks design | Fallback: EOA `pay_to` plus a keeper that forwards funds to the vault |
| Vault bug | Funds loss | Small caps, tests, tiny amounts on mainnet |
| History API too thin to score | Weak underwriting | Keep the score rule-based and simple |
| Judge reads this as unregulated lending | Credibility | State prototype status clearly; mention compliance layer |

## Submission checklist

- [ ] Registered on DoraHacks before 2026-11-01 21:30 IST
- [ ] Contract deployed on HSK Chain mainnet (required for demo selection)
- [ ] HSP used for the payment flow
- [ ] Public repo with README
- [ ] Demo video
- [ ] Registered for Mumbai Demo Day if attending in person
