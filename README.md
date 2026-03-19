# Solana Auction House API (Web3)

Build an in-memory REST API for a Solana-style timed auction system. Model wallets with escrow tracking, time-bound auctions, deterministic bidding rules, settlement, and cancellation.

## Requirements

### Health
- **GET /api/health** -> `200` with `{ "status": "ok" }`

### Wallets
- **POST /api/wallets/deposit**
  - Body: `{ wallet, amount }`
  - `wallet`: Solana wallet address
  - `amount`: positive integer
  - Returns `201` with `{ wallet, amount, balance, createdAt }`
  - Multiple deposits to the same wallet accumulate.
- **GET /api/wallets/:wallet/balance**
  - Returns `{ wallet, balance, escrowed, available }`
  - `balance`: net funds owned (total deposits + seller earnings from settlements - amounts paid for won auctions)
  - `escrowed`: funds currently locked as the highest bidder on unsettled auctions
  - `available`: `balance - escrowed`
  - Unknown wallets: `{ wallet, balance: 0, escrowed: 0, available: 0 }`

### Auctions
- **POST /api/auctions**
  - Body:
    - `seller`: Solana wallet address
    - `item`: non-empty string
    - `startAt`: full ISO datetime
    - `endAt`: full ISO datetime, must be strictly after `startAt`
    - `startingPrice`: integer >= 0
    - `minIncrement`: positive integer
  - `startAt` and `endAt` must be full ISO datetimes with time and timezone (date-only values like `2026-03-20` are invalid).
  - Returns `201` with the auction including computed fields (`status`, `currentPrice`, `bidCount`, `highestBidder`).
- **GET /api/auctions/:id**
  - Optional query `now` as a full ISO datetime override for status/field computation.
  - Returns auction with computed fields:
    - `status`
    - `currentPrice`: highest bid amount, or `startingPrice` if no bids
    - `bidCount`: total number of bids placed
    - `highestBidder`: wallet of current highest bidder, or `null`
  - Return `404` if not found.
- **GET /api/auctions**
  - Query params: `seller?`, `status?`, `now?`
  - Filters combined with logical AND.
  - Response: `{ auctions: [...] }` with computed fields on each.
  - Sort by `createdAt` ascending.
- **POST /api/auctions/:id/bid**
  - Body: `{ bidder, amount, now? }`
  - `bidder`: Solana wallet address, must NOT be the seller.
  - `amount`: positive integer.
  - Auction must be `ACTIVE` at the given `now`.
  - First bid: `amount >= startingPrice`.
  - Subsequent bids: `amount >= currentPrice + minIncrement`.
  - Bidder must have sufficient `available` balance. If the bidder already holds the highest bid (raising), their existing escrow on this auction is released before checking availability.
  - On success:
    - If there was a different previous highest bidder, release their escrow.
    - Escrow the new bid amount from the bidder.
  - Return `200` with updated auction snapshot.
  - Return `400` for validation failures, `404` for missing auction.
- **POST /api/auctions/:id/settle**
  - Body: `{ now? }`
  - Only allowed when status is `ENDED`.
  - If bids exist: transfer the winning bid amount to the seller's balance, deducting from the winner's balance and escrow.
  - If no bids: mark as settled with no transfers.
  - Return `200` with `{ auction, winner, winningBid }` (`winner` and `winningBid` are `null` when there are no bids).
  - Return `400` if the auction is not in `ENDED` status.
- **POST /api/auctions/:id/cancel**
  - Body: `{ now? }`
  - Only allowed when status is `UPCOMING`.
  - Return `200` with the cancelled auction.
  - Return `400` if not `UPCOMING` or already cancelled.
- **GET /api/auctions/:id/bids**
  - Returns `{ bids: [...] }` sorted by `placedAt` ascending.
  - Each bid includes `bidder`, `amount`, and `placedAt`.
  - Return `404` for missing auction.

## Status Rules
- `UPCOMING`: now < `startAt`
- `ACTIVE`: `startAt` <= now < `endAt`, and not cancelled or settled
- `ENDED`: now >= `endAt`, and not settled or cancelled
- `SETTLED`: after settlement
- `CANCELLED`: after cancellation

## Constraints
- Use in-memory storage only. No database required.
- IDs can be any unique string format.
- All timestamps in responses must be ISO strings.
- Any supplied `now` must be a full ISO datetime string with both time and timezone. Date-only values like `2026-03-20` are invalid.
- Return `400` when a supplied `now` override is not a valid ISO datetime.
- Return `404` for missing auction IDs on GET, bid, settle, cancel, and bids endpoints.

## Start Command
```
npm install && npm start
```
