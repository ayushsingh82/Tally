# Tally: Receivables Financing for Agents (HSP-backed)

Hackathon: HSK Chain Horizon Hackathon, Mumbai Edition
Track: 2 — Agent Payments & A2A Settlement (HSP)
Deadline: 2026-11-01 21:30 IST | Demo Day: 2026-11-04 | Winners: 2026-11-05

## One-liner

Agents that sell services on an HSP reusable mandate get paid today against income that arrives over time.

## Problem

An agent selling a service (API, data, compute, task work) over a reusable HSP mandate earns a little per call. Its costs (compute, API fees) are due now. Agents have uneven cash flow and no credit history, so they cannot borrow.

## Solution

The signed HSP mandate plus gateway-verified payment history is the collateral evidence. An underwriter agent reads that history, decides an advance and a discount rate, and an LP pool funds it. Future HSP payments settle into a per-seller vault, which repays the LP first and the seller after.

## Why HSP specifically

- The reusable order is a buyer-signed, bounded, expiring payment commitment.
- The payments query API gives verified payment history for the merchant (the seller).
- Settlement goes to a `pay_to` address, so it can be a vault contract that enforces the waterfall.
- A plain wallet transfer has none of these properties.

## Why it should score well

| Signal from past winners | How this idea responds |
|---|---|
| Winners had "agent" and "gateway" framing (Helm, AllScale Agentic Commerce Gateway) | Agent-native credit on top of a payment gateway |
| Finalists clustered on escrow, checkout, treasury | Financing is a different layer, not another checkout |
| Product polish mattered | Dashboard, live waterfall, explorer links |
| Mainnet deploy is mandatory | One vault contract on HSK Chain mainnet |
| HashKey Capital and RWA focus | Mandates as financeable receivables |

## Actors

| Actor | Role |
|---|---|
| Seller agent | Sells a service, receives payments through a reusable HSP order, requests advances |
| Buyer agent | Signs the reusable mandate and pays per use |
| Underwriter agent | Scores the seller from HSP payment history, sets advance amount and discount, explains the decision |
| LP | Deposits stablecoin into the pool, sets risk appetite, earns the discount |
| ReceivableVault | Holds funds, pays advances, runs the repayment waterfall, flags defaults |

## Core flow

1. Seller creates a reusable order (`POST /merchant/orders/reusable`) with `pay_to` = its vault.
2. Buyer signs the mandate (EIP-712) and starts paying through HSP.
3. Seller asks for an advance in chat.
4. Underwriter reads payment history and screens the payee, then proposes advance and discount.
5. Vault pays the advance from the LP pool to the seller.
6. Incoming HSP payments land in the vault. `settle()` repays LP principal and discount first, then releases the rest to the seller.
7. Webhooks update state (payment received, mandate revoked, default).

## Demo script

1. **Setup** — a seller agent has served a buyer for a week on a reusable mandate.
2. **Ask** — seller requests an advance. Underwriter shows its reasoning: offers 120 USDC against about 180 USDC expected income.
3. **Cash** — advance lands in the seller wallet. Show the explorer link.
4. **Repayment** — new HSP payments arrive. The waterfall repays the LP, then the seller. Dashboard updates live.
5. **Failure beat** (Q&A) — buyer revokes the mandate. Vault flags default. The first-loss reserve absorbs it.

## Hard questions and answers

| Question | Answer |
|---|---|
| What if the buyer stops paying? | Advance is capped by proven payment history, tenor is short, and a first-loss reserve sits ahead of LPs. |
| Who is the borrower? | The seller agent. The buyer has already committed under the signed mandate. |
| Is this regulated lending? | It is a prototype, not a live lending product. Production use needs legal review; HashKey offers compliance consulting to winners. |
| Why agents? | Uneven cash flow, no credit history. Underwriting from payment record fits them. |

## Folded-in compliance layer (from the runner-up idea)

The underwriter screens the payee before advancing, and every advance and settlement writes a receipt (payer, payee, amount, purpose, screening result). An audit export is available as CSV. This gives a compliance angle as a feature, not a separate project.

## Open assumptions to verify first

- Reusable orders accept a contract address as `pay_to`.
- The vault can receive plain ERC20 transfers with no callback, so `settle()` works from balance deltas.
- The payments query API returns enough history (amount, timestamps, status) for scoring.
- HSP production access (`app_key`, signing keys) for mainnet.
- Chain ID, RPC and token addresses for HSK Chain mainnet, from hashfans.io.

## Ideas considered and dropped

Other Track 2 options: metered A2A billing, policy-guarded payment agent, MCP/API monetization proxy, agent services marketplace, ZKID agent credit, payroll for agent swarms, physical machine pays and unlocks, RFQ auction for agent tasks, compliance-grade payments (folded in above).
