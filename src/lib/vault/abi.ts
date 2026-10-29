import { parseAbi } from "viem";

export const vaultAbi = parseAbi([
  "function token() view returns (address)",
  "function underwriter() view returns (address)",
  "function maxAdvance() view returns (uint256)",
  "function poolAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function reserve() view returns (uint256)",
  "function outstandingPrincipal() view returns (uint256)",
  "function idleCash() view returns (uint256)",
  "function collectorOf(address seller) view returns (address)",
  "function advances(address seller) view returns (uint256 principal, uint256 fee, uint256 repaidPrincipal, uint256 repaidFee, uint8 status)",
  "function owed(address seller) view returns (uint256)",
  "function registerSeller(address seller) returns (address collector)",
  "function advance(address seller, uint256 amount, uint256 fee)",
  "function flagDefault(address seller)",
  "function deposit(uint256 amount) returns (uint256 minted)",
  "function fundReserve(uint256 amount)",
  "error NothingToSweep()",
  "error SellerAlreadyRegistered()",
  "error SellerNotRegistered()",
  "error AdvanceExists()",
  "error NoActiveAdvance()",
  "error ExceedsMaxAdvance()",
  "error InsufficientIdleCash()",
  "error InvalidFee()",
  "error NotUnderwriter()",
]);

export const collectorAbi = parseAbi([
  "function sweep() returns (uint256 amount)",
  "error NothingToSweep()",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

/** Mirrors `ReceivableVault.Status`. */
export const STATUS = ["None", "Active", "Repaid", "Defaulted"] as const;
export type AdvanceStatus = (typeof STATUS)[number];
