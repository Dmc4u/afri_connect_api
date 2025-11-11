// models/PaypalTransaction.js
const mongoose = require("mongoose");

const paypalTransactionSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true }, // PayPal order ID
    status: { type: String, required: true }, // COMPLETED, FAILED
    payerEmail: { type: String },
    tier: { type: String, required: true, enum: ["Free", "Starter", "Premium", "Pro"] }, // Subscription tier purchased
    payerId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    transaction_details: { type: Object }, // full PayPal response
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaypalTransaction", paypalTransactionSchema);
