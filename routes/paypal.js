const express = require("express");
const cfg = require("../utils/config"); // 👈 ensure config is imported
const { createPayPalOrder, capturePayPalOrder } = require("../controllers/paypal");
const auth = require("../middlewares/auth");

const router = express.Router();

// Create order → returns PayPal approval link
router.post("/create-order", auth, createPayPalOrder);

// Capture order → after approval
router.post("/capture-order", auth, capturePayPalOrder);

// ✅ Return PayPal client ID for frontend
router.get("/client-id", (req, res) => {
  // Always return the credentials - let PayPal validate them
  res.json({
    clientId: cfg.PAYPAL_CLIENT_ID,
    mode: cfg.PAYPAL_MODE || "sandbox",
    currency: "USD",
  });
});
module.exports = router;
