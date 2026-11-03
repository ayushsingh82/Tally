# Tally

Receivables financing for agents. An agent that sells services on an HSP reusable mandate gets paid today against income that arrives over time.

Built on [HSP](https://hashkey-merchant.github.io/docs/en/) (HashKey Merchant Platform) and HashKey Chain.

## How it works

1. A seller agent creates a reusable HSP order whose `pay_to` is its collector, controlled by the vault.
2. A buyer agent signs the mandate and pays per use through HSP.
3. The seller asks for an advance. The underwriter reads the seller's HSP payment history, screens the payee, and proposes an advance amount and discount.
4. The vault pays the advance from the liquidity pool.
5. Later HSP payments settle into the vault, which repays the pool first and the seller after.
6. If the buyer stops paying, a first-loss reserve absorbs the loss and the mandate is revoked.

## Architecture

```
Buyer agent --EIP-712 signed mandate--> HSP gateway --ERC20 transfer--> ReceivableVault (HashKey Chain)
                                             |                               ^        |
                                          webhook                            |        +--> Liquidity pool
                                             v                         advance/settle
Seller agent <--chat--> Next.js app <-- Underwriter (scores history, screens payee)
                           |
                       Dashboard, receipts, CSV export
```

| Part | Technology |
|---|---|
| Web app and API | Next.js (App Router), TypeScript, Tailwind |
| Contracts | Solidity, Foundry (`ReceivableVault`, `SellerCollector`) |
| Chain access | viem |
| Payments | HSP, x402 v2 |
| Validation | zod |

## Features

- **Vault contract:** LP deposit and withdraw, advances, repayment waterfall, first-loss reserve, default handling, roles, pause.
- **Underwriter:** rule-based scoring from payment history, advance caps, declines with written reasons, address screening with allow and deny lists.
- **HSP client:** canonical JSON, HMAC-SHA256 request signing, ES256K merchant JWT, reusable order builder, payment queries, webhook verification.
- **Webhook:** HMAC-verified and idempotent. Sweeps only on `payment-safe` or `payment-finalized`.
- **Operator dashboard:** passcode sign-in, seller registration, advance preview and take-up, pool view, activity log, CSV export.
- **Receipts:** append-only audit trail of every advance, settlement and default.

## Getting started

Requires Node 20+, npm, and [Foundry](https://book.getfoundry.sh/) for the contracts.

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm test                     # TypeScript tests
npm run typecheck
npm run lint

cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git
forge test
cd ..

npm run dev                  # http://localhost:3000
```

## Configuration

| Variable | Purpose |
|---|---|
| `CHAIN_RPC_URL`, `CHAIN_ID`, `CHAIN_NAME` | HashKey Chain network (testnet chain ID 133) |
| `VAULT_ADDRESS` | Deployed `ReceivableVault` |
| `UNDERWRITER_PRIVATE_KEY` | Role key that signs `registerSeller`, `advance`, `sweep` and `flagDefault` |
| `HSP_BASE_URL` | HSP QA, staging or production base URL |
| `HSP_MERCHANT_NAME` | Merchant name, `Tally` |
| `HSP_NETWORK`, `HSP_CHAIN_ID`, `HSP_TOKEN_ADDRESS`, `HSP_COIN` | Payment method placed on each mandate |
| `HSP_APP_KEY`, `HSP_APP_SECRET` | Merchant API credentials (HMAC signing) |
| `HSP_JWT_PRIVATE_KEY` | secp256k1 PEM for the ES256K merchant JWT |
| `DASHBOARD_PASSCODE` | Operator console passcode, 12+ characters |
| `API_TOKEN` | Bearer token for `/api` routes, 16+ characters |
| `DENY_LIST`, `ALLOW_LIST` | Optional address screening |
| `DATA_FILE`, `RECEIPTS_FILE` | Local state and receipt log paths |

Never commit real keys. `.env.local` is git-ignored.

## API

All routes return JSON. Token routes need `x-api-key: $API_TOKEN` or `Authorization: Bearer`.

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/orders` | token | `{seller, totalUsd, expiryDays?}` registers the seller's collector and creates a reusable HSP order |
| `POST /api/advance` | token | `{seller, requestedUsd?, dryRun?}` underwrites from HSP history and sends the advance |
| `GET /api/position?seller=` | token | Advance, amount owed, pool state |
| `POST /api/default` | token | `{seller, reason?}` writes off an active advance and revokes the mandate |
| `GET /api/receipts?seller=&format=csv` | token | Audit trail, optionally as CSV |
| `POST /api/webhook/hsp` | HMAC | HSP payment callback |

## Dashboard

| Page | Purpose |
|---|---|
| `/` | Landing page |
| `/how-it-works` | Money path, life of an advance, worked example |
| `/dashboard` | Overview |
| `/dashboard/seller` | Register a seller, preview and take an advance, mark a default |
| `/dashboard/pool` | Pool balance, LP funding, advances |
| `/dashboard/activity` | Audit trail with CSV export |
| `/dashboard/playground` | Underwriter sandbox |

## Scripts

```bash
# Local end-to-end run with HSP mocked and real contracts (needs anvil and forge build)
npx tsx scripts/simulate-buyer.ts
npx tsx scripts/simulate-buyer.ts --default

# Check that HSP accepts a contract as pay_to
npx tsx scripts/test-pay-to.ts --collector 0x... --dry-run
npx tsx --env-file=.env.local scripts/test-pay-to.ts --collector 0x... --poll

# Testnet
npx tsx --env-file=.env.local scripts/check-funds.ts
npx tsx --env-file=.env.local scripts/testnet-setup.ts
npx tsx --env-file=.env.local scripts/testnet-flow.ts
```

## Project layout

```
contracts/          ReceivableVault, SellerCollector, tests, deploy script
src/app/            pages, server actions, API routes
src/lib/hsp/        canonical JSON, signing, ES256K JWT, orders, payments
src/lib/underwrite/ scoring, screening, rationale
src/lib/            config, store, receipts, session, formatting
scripts/            buyer simulator, pay_to test, testnet tooling
idea.md             pitch and demo script
plan.md             build plan and status
```

## Security and limits

- Prototype. Not a live lending product; production use needs legal and compliance review.
- Credit risk is bounded by advance caps tied to proven payment history, short tenor, and a first-loss reserve.
- The vault is capped, pausable and non-upgradeable. It has not been audited, so use small amounts.
- Signing follows the HSP documentation and matches independent test vectors, but acceptance by the HSP gateway still needs to be confirmed against QA.

## Links

- HSP docs: https://hashkey-merchant.github.io/docs/en/
- HashKey Chain: https://hskchain.net/docs
- Testnet explorer: https://testnet-explorer.hskchain.net
