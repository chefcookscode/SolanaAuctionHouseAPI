import { Router, Request, Response } from "express";
import { deposit, getWalletBalance } from "../store.js";
import { isPositiveInteger, isNonEmptyString } from "../validators.js";

const router = Router();

// POST /api/wallets/deposit
router.post("/deposit", (req: Request, res: Response) => {
  const { wallet, amount } = req.body;

  if (!isNonEmptyString(wallet)) {
    res.status(400).json({ error: "wallet is required and must be a non-empty string" });
    return;
  }

  if (!isPositiveInteger(amount)) {
    res.status(400).json({ error: "amount must be a positive integer" });
    return;
  }

  const result = deposit(wallet, amount);
  res.status(201).json(result);
});

// GET /api/wallets/:wallet/balance
router.get("/:wallet/balance", (req: Request, res: Response) => {
  const { wallet } = req.params;
  const result = getWalletBalance(wallet);
  res.json(result);
});

export default router;
