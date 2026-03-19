// In-memory data store for wallets, auctions, and bids

import crypto from "crypto";

export interface Deposit {
  wallet: string;
  amount: number;
  balance: number;
  createdAt: string;
}

export interface WalletData {
  balance: number; // net funds owned
  deposits: Deposit[];
}

export interface Auction {
  id: string;
  seller: string;
  item: string;
  startAt: string;
  endAt: string;
  startingPrice: number;
  minIncrement: number;
  createdAt: string;
  settled: boolean;
  cancelled: boolean;
  settlementWinner: string | null;
  settlementAmount: number | null;
}

export interface Bid {
  bidder: string;
  amount: number;
  placedAt: string;
  auctionId: string;
}

// In-memory stores
const wallets: Map<string, WalletData> = new Map();
const auctions: Map<string, Auction> = new Map();
const bids: Map<string, Bid[]> = new Map(); // auctionId -> bids
const escrows: Map<string, Map<string, number>> = new Map(); // wallet -> (auctionId -> escrowed amount)

// ---- Wallet helpers ----

export function getOrCreateWallet(wallet: string): WalletData {
  if (!wallets.has(wallet)) {
    wallets.set(wallet, { balance: 0, deposits: [] });
  }
  return wallets.get(wallet)!;
}

export function deposit(wallet: string, amount: number): Deposit {
  const w = getOrCreateWallet(wallet);
  w.balance += amount;
  const dep: Deposit = {
    wallet,
    amount,
    balance: w.balance,
    createdAt: new Date().toISOString(),
  };
  w.deposits.push(dep);
  return dep;
}

export function getWalletBalance(wallet: string): {
  wallet: string;
  balance: number;
  escrowed: number;
  available: number;
} {
  const w = wallets.get(wallet);
  const balance = w ? w.balance : 0;
  const escrowed = getEscrowedTotal(wallet);
  return {
    wallet,
    balance,
    escrowed,
    available: balance - escrowed,
  };
}

function getEscrowedTotal(wallet: string): number {
  const walletEscrows = escrows.get(wallet);
  if (!walletEscrows) return 0;
  let total = 0;
  for (const [auctionId, amount] of walletEscrows) {
    // Only count escrow for auctions that are not settled and not cancelled
    const auction = auctions.get(auctionId);
    if (auction && !auction.settled && !auction.cancelled) {
      total += amount;
    }
  }
  return total;
}

export function getEscrowForAuction(wallet: string, auctionId: string): number {
  const walletEscrows = escrows.get(wallet);
  if (!walletEscrows) return 0;
  return walletEscrows.get(auctionId) || 0;
}

export function setEscrow(wallet: string, auctionId: string, amount: number): void {
  if (!escrows.has(wallet)) {
    escrows.set(wallet, new Map());
  }
  escrows.get(wallet)!.set(auctionId, amount);
}

export function releaseEscrow(wallet: string, auctionId: string): void {
  const walletEscrows = escrows.get(wallet);
  if (walletEscrows) {
    walletEscrows.delete(auctionId);
  }
}

// ---- Auction helpers ----

export function createAuction(data: {
  seller: string;
  item: string;
  startAt: string;
  endAt: string;
  startingPrice: number;
  minIncrement: number;
}): Auction {
  const id = crypto.randomUUID();
  const auction: Auction = {
    id,
    seller: data.seller,
    item: data.item,
    startAt: data.startAt,
    endAt: data.endAt,
    startingPrice: data.startingPrice,
    minIncrement: data.minIncrement,
    createdAt: new Date().toISOString(),
    settled: false,
    cancelled: false,
    settlementWinner: null,
    settlementAmount: null,
  };
  auctions.set(id, auction);
  bids.set(id, []);
  return auction;
}

export function getAuction(id: string): Auction | undefined {
  return auctions.get(id);
}

export function getAllAuctions(): Auction[] {
  return Array.from(auctions.values());
}

export function getAuctionBids(auctionId: string): Bid[] | undefined {
  if (!auctions.has(auctionId)) return undefined;
  return bids.get(auctionId) || [];
}

export function addBid(auctionId: string, bidder: string, amount: number, placedAt: string): Bid {
  const bid: Bid = { bidder, amount, placedAt, auctionId };
  if (!bids.has(auctionId)) {
    bids.set(auctionId, []);
  }
  bids.get(auctionId)!.push(bid);
  return bid;
}

export function getHighestBid(auctionId: string): Bid | null {
  const auctionBids = bids.get(auctionId);
  if (!auctionBids || auctionBids.length === 0) return null;
  return auctionBids.reduce((max, bid) => (bid.amount > max.amount ? bid : max));
}

export function computeAuctionStatus(
  auction: Auction,
  now: Date
): "UPCOMING" | "ACTIVE" | "ENDED" | "SETTLED" | "CANCELLED" {
  if (auction.settled) return "SETTLED";
  if (auction.cancelled) return "CANCELLED";

  const startAt = new Date(auction.startAt).getTime();
  const endAt = new Date(auction.endAt).getTime();
  const nowMs = now.getTime();

  if (nowMs < startAt) return "UPCOMING";
  if (nowMs >= startAt && nowMs < endAt) return "ACTIVE";
  return "ENDED";
}

export function computeAuctionFields(
  auction: Auction,
  now: Date
): {
  id: string;
  seller: string;
  item: string;
  startAt: string;
  endAt: string;
  startingPrice: number;
  minIncrement: number;
  createdAt: string;
  status: string;
  currentPrice: number;
  bidCount: number;
  highestBidder: string | null;
} {
  const status = computeAuctionStatus(auction, now);
  const auctionBids = bids.get(auction.id) || [];
  const highest = getHighestBid(auction.id);

  return {
    id: auction.id,
    seller: auction.seller,
    item: auction.item,
    startAt: auction.startAt,
    endAt: auction.endAt,
    startingPrice: auction.startingPrice,
    minIncrement: auction.minIncrement,
    createdAt: auction.createdAt,
    status,
    currentPrice: highest ? highest.amount : auction.startingPrice,
    bidCount: auctionBids.length,
    highestBidder: highest ? highest.bidder : null,
  };
}

// Settlement
export function settleAuction(auction: Auction): void {
  const highest = getHighestBid(auction.id);

  if (highest) {
    // Transfer winning bid to seller
    const sellerWallet = getOrCreateWallet(auction.seller);
    sellerWallet.balance += highest.amount;

    // Deduct from winner's balance
    const winnerWallet = getOrCreateWallet(highest.bidder);
    winnerWallet.balance -= highest.amount;

    // Release escrow
    releaseEscrow(highest.bidder, auction.id);

    auction.settlementWinner = highest.bidder;
    auction.settlementAmount = highest.amount;
  }

  auction.settled = true;
}

// Cancellation
export function cancelAuction(auction: Auction): void {
  // Release all escrows for this auction
  const auctionBids = bids.get(auction.id) || [];
  const releasedBidders = new Set<string>();
  for (const bid of auctionBids) {
    if (!releasedBidders.has(bid.bidder)) {
      releaseEscrow(bid.bidder, auction.id);
      releasedBidders.add(bid.bidder);
    }
  }
  auction.cancelled = true;
}
