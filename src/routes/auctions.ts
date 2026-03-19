import { Router, Request, Response } from "express";
import {
  createAuction,
  getAuction,
  getAllAuctions,
  getAuctionBids,
  addBid,
  getHighestBid,
  computeAuctionStatus,
  computeAuctionFields,
  getWalletBalance,
  getEscrowForAuction,
  setEscrow,
  releaseEscrow,
  settleAuction,
  cancelAuction,
  getOrCreateWallet,
} from "../store.js";
import {
  isValidISODatetime,
  parseNow,
  isPositiveInteger,
  isNonNegativeInteger,
  isNonEmptyString,
} from "../validators.js";

const router = Router();

// POST /api/auctions — Create auction
router.post("/", (req: Request, res: Response) => {
  const { seller, item, startAt, endAt, startingPrice, minIncrement } = req.body;

  // Validate seller
  if (!isNonEmptyString(seller)) {
    res.status(400).json({ error: "seller is required and must be a non-empty string" });
    return;
  }

  // Validate item
  if (!isNonEmptyString(item)) {
    res.status(400).json({ error: "item is required and must be a non-empty string" });
    return;
  }

  // Validate startAt
  if (!isValidISODatetime(startAt)) {
    res.status(400).json({ error: "startAt must be a valid full ISO datetime" });
    return;
  }

  // Validate endAt
  if (!isValidISODatetime(endAt)) {
    res.status(400).json({ error: "endAt must be a valid full ISO datetime" });
    return;
  }

  // endAt must be strictly after startAt
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    res.status(400).json({ error: "endAt must be strictly after startAt" });
    return;
  }

  // Validate startingPrice
  if (!isNonNegativeInteger(startingPrice)) {
    res.status(400).json({ error: "startingPrice must be an integer >= 0" });
    return;
  }

  // Validate minIncrement
  if (!isPositiveInteger(minIncrement)) {
    res.status(400).json({ error: "minIncrement must be a positive integer" });
    return;
  }

  const auction = createAuction({ seller, item, startAt, endAt, startingPrice, minIncrement });
  const now = new Date();
  const result = computeAuctionFields(auction, now);
  res.status(201).json(result);
});

// GET /api/auctions — List auctions
router.get("/", (req: Request, res: Response) => {
  const { seller, status, now: nowQuery } = req.query;

  const nowResult = parseNow(nowQuery as string | undefined);
  if (!nowResult) {
    res.status(400).json({ error: "now must be a valid full ISO datetime" });
    return;
  }
  const now = nowResult.date;

  let auctionsList = getAllAuctions();

  // Sort by createdAt ascending
  auctionsList.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let results = auctionsList.map((a) => computeAuctionFields(a, now));

  // Filter by seller
  if (seller) {
    results = results.filter((a) => a.seller === seller);
  }

  // Filter by status
  if (status) {
    results = results.filter((a) => a.status === status);
  }

  res.json({ auctions: results });
});

// GET /api/auctions/:id — Get single auction
router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const { now: nowQuery } = req.query;

  const auction = getAuction(id);
  if (!auction) {
    res.status(404).json({ error: "Auction not found" });
    return;
  }

  const nowResult = parseNow(nowQuery as string | undefined);
  if (!nowResult) {
    res.status(400).json({ error: "now must be a valid full ISO datetime" });
    return;
  }

  const result = computeAuctionFields(auction, nowResult.date);
  res.json(result);
});

// POST /api/auctions/:id/bid — Place a bid
router.post("/:id/bid", (req: Request, res: Response) => {
  const { id } = req.params;
  const { bidder, amount, now: nowBody } = req.body;

  // Validate auction exists
  const auction = getAuction(id);
  if (!auction) {
    res.status(404).json({ error: "Auction not found" });
    return;
  }

  // Parse now
  const nowResult = parseNow(nowBody);
  if (!nowResult) {
    res.status(400).json({ error: "now must be a valid full ISO datetime" });
    return;
  }
  const now = nowResult.date;

  // Validate bidder
  if (!isNonEmptyString(bidder)) {
    res.status(400).json({ error: "bidder is required and must be a non-empty string" });
    return;
  }

  // Validate amount
  if (!isPositiveInteger(amount)) {
    res.status(400).json({ error: "amount must be a positive integer" });
    return;
  }

  // Bidder must not be the seller
  if (bidder === auction.seller) {
    res.status(400).json({ error: "Bidder cannot be the seller" });
    return;
  }

  // Auction must be ACTIVE
  const status = computeAuctionStatus(auction, now);
  if (status !== "ACTIVE") {
    res.status(400).json({ error: `Auction is not ACTIVE (current status: ${status})` });
    return;
  }

  // Check bid amounts
  const highestBid = getHighestBid(id);
  if (!highestBid) {
    // First bid must be >= startingPrice
    if (amount < auction.startingPrice) {
      res.status(400).json({ error: `First bid must be >= startingPrice (${auction.startingPrice})` });
      return;
    }
  } else {
    // Subsequent bids must be >= currentPrice + minIncrement
    const minRequired = highestBid.amount + auction.minIncrement;
    if (amount < minRequired) {
      res.status(400).json({
        error: `Bid must be >= ${minRequired} (currentPrice ${highestBid.amount} + minIncrement ${auction.minIncrement})`,
      });
      return;
    }
  }

  // Check bidder's available balance
  // If the bidder already holds the highest bid (raising), release their existing escrow first
  const existingEscrow = getEscrowForAuction(bidder, id);
  const walletInfo = getWalletBalance(bidder);
  const effectiveAvailable = walletInfo.available + existingEscrow;

  if (amount > effectiveAvailable) {
    res.status(400).json({ error: "Insufficient available balance" });
    return;
  }

  // Release previous highest bidder's escrow if it's a different bidder
  if (highestBid && highestBid.bidder !== bidder) {
    releaseEscrow(highestBid.bidder, id);
  }

  // Release bidder's own escrow on this auction (if raising)
  if (existingEscrow > 0) {
    releaseEscrow(bidder, id);
  }

  // Escrow the new bid amount
  setEscrow(bidder, id, amount);

  // Record the bid
  addBid(id, bidder, amount, now.toISOString());

  // Return updated auction
  const result = computeAuctionFields(auction, now);
  res.status(200).json(result);
});

// POST /api/auctions/:id/settle — Settle auction
router.post("/:id/settle", (req: Request, res: Response) => {
  const { id } = req.params;
  const { now: nowBody } = req.body || {};

  const auction = getAuction(id);
  if (!auction) {
    res.status(404).json({ error: "Auction not found" });
    return;
  }

  const nowResult = parseNow(nowBody);
  if (!nowResult) {
    res.status(400).json({ error: "now must be a valid full ISO datetime" });
    return;
  }
  const now = nowResult.date;

  const status = computeAuctionStatus(auction, now);
  if (status !== "ENDED") {
    res.status(400).json({ error: `Auction cannot be settled (current status: ${status})` });
    return;
  }

  settleAuction(auction);

  const highestBid = getHighestBid(id);
  const result = computeAuctionFields(auction, now);

  res.status(200).json({
    auction: result,
    winner: highestBid ? highestBid.bidder : null,
    winningBid: highestBid ? highestBid.amount : null,
  });
});

// POST /api/auctions/:id/cancel — Cancel auction
router.post("/:id/cancel", (req: Request, res: Response) => {
  const { id } = req.params;
  const { now: nowBody } = req.body || {};

  const auction = getAuction(id);
  if (!auction) {
    res.status(404).json({ error: "Auction not found" });
    return;
  }

  const nowResult = parseNow(nowBody);
  if (!nowResult) {
    res.status(400).json({ error: "now must be a valid full ISO datetime" });
    return;
  }
  const now = nowResult.date;

  const status = computeAuctionStatus(auction, now);
  if (status !== "UPCOMING") {
    res.status(400).json({ error: `Auction cannot be cancelled (current status: ${status})` });
    return;
  }

  cancelAuction(auction);

  const result = computeAuctionFields(auction, now);
  res.status(200).json(result);
});

// GET /api/auctions/:id/bids — List bids for an auction
router.get("/:id/bids", (req: Request, res: Response) => {
  const { id } = req.params;

  const auction = getAuction(id);
  if (!auction) {
    res.status(404).json({ error: "Auction not found" });
    return;
  }

  const auctionBids = getAuctionBids(id) || [];

  // Sort by placedAt ascending
  const sortedBids = [...auctionBids].sort(
    (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime()
  );

  res.json({
    bids: sortedBids.map((b) => ({
      bidder: b.bidder,
      amount: b.amount,
      placedAt: b.placedAt,
    })),
  });
});

export default router;
