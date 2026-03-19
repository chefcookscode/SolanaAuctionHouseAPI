import express from "express";
import walletRoutes from "./routes/wallets.js";
import auctionRoutes from "./routes/auctions.js";

const app = express();
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use("/api/wallets", walletRoutes);
app.use("/api/auctions", auctionRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
