# Receivables Financing for Agents

Agents that sell services on an HSP reusable mandate get paid today against income that arrives over time.

Built for the **HSK Chain Horizon Hackathon, Mumbai Edition**, Track 2: Agent Payments & A2A Settlement (HSP).

> Status: early scaffold. The Next.js app is the default template; the contract and backend are not built yet. See [plan.md](./plan.md) for the build order and [idea.md](./idea.md) for the pitch.

## Hackathon facts

| | |
|---|---|
| Window | 2026-10-23 to 2026-11-05 |
| Submission deadline | 2026-11-01 21:30 IST (2026-11-02 00:00 Beijing) |
| Demo Day | 2026-11-04, Mumbai |
| Winners | 2026-11-05 |
| Prize (Track 2) | 2,500 / 1,500 / 1,000 USDT |
| Hard rule | Contract must be deployed on HSK Chain mainnet, or the project loses demo eligibility |
| Track rule | Agent Payments track must use HSP |

## What it does

1. A seller agent creates a reusable HSP order whose `pay_to` is its vault contract.
2. A buyer agent signs the mandate and pays per use through HSP.
3. The seller asks for an advance. An underwriter agent reads the HSP payment history, screens the payee, and proposes an advance and a discount.
4. The vault pays the advance from the LP pool.
5. Further HSP payments settle into the vault, which repays the LP first and the seller after.

Full pitch, demo script, and Q&A: [idea.md](./idea.md).

## Architecture

```
Buyer agent --EIP-712 signed mandate--> HSP gateway --ERC20 transfer--> ReceivableVault (HSK Chain)
                                             |                               ^        |
                                          webhook                            |        +--> LP pool
                                             v                         advance/settle
Seller agent <--chat--> Next.js app <-- Underwriter agent (scores history, screens payee)
                           |
                       Dashboard, receipts, CSV export
```

| Part | Tech |
|---|---|
| Web app and API | Next.js (App Router, TypeScript, Tailwind) |
| Contract | Solidity, `ReceivableVault.sol` |
| Chain access | viem |
| Payments | HashKey Merchant Platform (HSP) |

## HSP integration notes

Source: https://hashkey-merchant.github.io/docs/en/

- Base URLs: QA `https://merchant-qa.hashkeymerchant.com`, staging `https://merchant-stg.hashkeymerchant.com`, production `https://hsp.hashkey.com`.
- Merchant routes: `POST /merchant/orders`, `POST /merchant/orders/reusable`, `GET /merchant/payments`, `GET /merchant/payments/reusable`.
- Request auth: HMAC-SHA256 headers `X-App-Key`, `X-Signature`, `X-Timestamp`, `X-Nonce`.
- Mandate auth: `merchant_authorization` is an ES256K JWT.
- Payment method: x402 v2. Amounts in `details.total` are in USD; the token is chosen in `method_data`.
- Hash and sign over canonical JSON (keys sorted, no whitespace). Do not rely on language map ordering.
- Webhooks: HMAC-verified, up to 6 retries with exponential backoff, so handlers must be idempotent.
- A reusable order maps one `cart_mandate_id` to many payments. Set `cart_expiry` to cover the business lifecycle.
- Common errors: `40001` mandate expired or consumed, `40002` wrong endpoint type, `10004` duplicate `payment_request_id`.
- Supported mainnets: Ethereum, HashKey Chain, Base, Arbitrum, BNB Smart Chain. Tokens: USDC, USDT, HSK.

## Open assumptions

These decide the design and are checked first in M0 of the plan.

- Reusable orders accept a contract address as `pay_to`.
- The vault receives the payment as a plain ERC20 transfer (no callback), so `settle()` uses balance deltas.
- The payments query API returns enough history to score a seller.
- HSP production credentials are available in time.

## Getting started

Requires Node 20+ and npm.

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run dev
```

Open http://localhost:3000.

The project's `AGENTS.md` notes that this Next.js version has breaking changes. Read the guides in `node_modules/next/dist/docs/` before writing Next.js code.

### Environment variables (planned)

| Variable | Purpose |
|---|---|
| `HSP_BASE_URL` | QA, staging or production base URL |
| `HSP_APP_KEY` | Merchant app key |
| `HSP_APP_SECRET` | HMAC secret |
| `HSP_JWT_PRIVATE_KEY` | secp256k1 key for ES256K merchant JWT |
| `HSP_WEBHOOK_SECRET` | Webhook HMAC verification |
| `CHAIN_RPC_URL` | HSK Chain RPC |
| `CHAIN_ID` | HSK Chain chain ID |
| `VAULT_ADDRESS` | Deployed `ReceivableVault` |
| `UNDERWRITER_PRIVATE_KEY` | Role key allowed to call `advance` and `flagDefault` |

Never commit real keys. `.env.local` stays untracked.

## Planned layout

```
contracts/          ReceivableVault.sol, tests, deploy script
src/app/            pages: seller chat, LP view, dashboard
src/app/api/        HSP client routes, webhook, underwriter, receipts
src/lib/hsp/        canonical JSON, HMAC, ES256K JWT, order + query calls
src/lib/vault/      viem client for the contract
src/lib/underwrite/ scoring, screening, rationale
scripts/            buyer simulator, pool seeding
idea.md             pitch and demo script
plan.md             milestones and risks
```

## Risks and limits

- Prototype only. This is not a live lending product; production use needs legal and compliance review.
- Credit risk is bounded by capping advances to proven payment history, short tenor, and a first-loss reserve.
- The vault holds funds, so mainnet runs use small amounts and a capped, pausable, non-upgradeable contract.

## Links

- Hackathon: https://dorahacks.io/hackathon/hskchainindia/detail
- HSP docs: https://hashkey-merchant.github.io/#/
- HashFans dev resources: https://hashfans.io/dev-onepager
- Support group: https://t.me/+M5yaRB-u4PRiNWM1
- Japan edition winners announcement: https://x.com/HSKChain/status/2077272198910529876
