const express = require("express");
const auth = require("../middlewares/auth");
const {
  initiateTwoCo,
  webhookTwoCo,
  returnTwoCo,
  getTwoCoTransaction,
} = require("../controllers/checkout");

const router = express.Router();

// Initiate 2Checkout purchase (membership upgrade)
router.post("/2co/initiate", auth, initiateTwoCo);

// 2Checkout INS/Webhook endpoint (must be publicly accessible)
router.post("/2co/webhook", webhookTwoCo);

// 2Checkout return (success/cancel) endpoint
router.get("/2co/return", returnTwoCo);

// Debug: fetch a transaction
router.get("/2co/transactions/:id", auth, getTwoCoTransaction);

module.exports = router;
