/** A settled or attempted payment on a seller's reusable HSP mandate. */
export interface PaymentRecord {
  /** Amount in USD (HSP quotes totals in USD). */
  amountUsd: number;
  /** Unix ms when the payment reached its terminal state. */
  paidAt: number;
  status: "success" | "failed" | "pending";
  /** Payer wallet address, used for concentration. */
  buyer: string;
}

export interface MandateInfo {
  /** Unix ms when the reusable mandate's cart_expiry passes. */
  expiresAt: number;
  revoked?: boolean;
}

export interface UnderwriteInput {
  seller: string;
  history: PaymentRecord[];
  mandate: MandateInfo;
  /** Amount the seller asked for, in USD. Offer is capped at this when set. */
  requestedUsd?: number;
  /** Unix ms; injectable for tests. */
  now: number;
}

export interface UnderwriteConfig {
  /** Only payments newer than this count toward history. */
  windowDays: number;
  minPayments: number;
  minHistoryDays: number;
  /** Advance must be repaid inside this horizon; mandate must outlive it. */
  tenorDays: number;
  maxAdvanceUsd: number;
  /** Share of expected near-term income advanced at a perfect score. */
  baseAdvanceRate: number;
  /** Fee as share of the advance: base + riskSpread * (1 - score). */
  baseFeeRate: number;
  riskSpread: number;
  /** Above this share of failed attempts the request is declined outright. */
  maxFailureRate: number;
  /** Below this 0..100 score the request is declined. */
  minScore: number;
  /** Expected income must cover advance + fee at least this many times. */
  minCoverage: number;
}

export const DEFAULT_CONFIG: UnderwriteConfig = {
  windowDays: 30,
  minPayments: 5,
  minHistoryDays: 3,
  tenorDays: 14,
  maxAdvanceUsd: 1_000,
  baseAdvanceRate: 0.7,
  baseFeeRate: 0.04,
  riskSpread: 0.12,
  maxFailureRate: 0.25,
  minScore: 40,
  minCoverage: 1.3,
};

export interface ScoreFactors {
  /** 0..1, higher means steadier gaps between payments. */
  regularity: number;
  /** 0..1, share of attempts that succeeded (penalized harder than linear). */
  reliability: number;
  /** 0..1, lower when one buyer supplies most of the volume. */
  diversification: number;
  /** 0..1, more successful payments is deeper history. */
  depth: number;
}

export interface Scorecard {
  score: number;
  factors: ScoreFactors;
  successCount: number;
  historyDays: number;
  avgDailyUsd: number;
  topBuyerShare: number;
  /** Failed attempts / all terminal attempts in the window. */
  failureRate: number;
}

export type DeclineCode =
  | "DENYLISTED"
  | "NOT_ALLOWLISTED"
  | "MANDATE_REVOKED"
  | "MANDATE_EXPIRING"
  | "THIN_HISTORY"
  | "SHORT_HISTORY"
  | "LOW_SCORE"
  | "NO_CAPACITY";

export interface Offer {
  approved: boolean;
  declineCode?: DeclineCode;
  /** Micro-units of a 6-decimal stablecoin, as passed to the contract. */
  advanceUnits: bigint;
  feeUnits: bigint;
  advanceUsd: number;
  feeUsd: number;
  /** Effective discount: fee / advance. */
  feeRate: number;
  scorecard?: Scorecard;
  /** Human-readable reasoning, one line per fact that mattered. */
  rationale: string[];
}
