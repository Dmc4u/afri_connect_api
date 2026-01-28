// models/PaypalTransaction.js
const mongoose = require("mongoose");

const paypalTransactionSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true }, // PayPal order ID
    status: { type: String, required: true }, // COMPLETED, FAILED
    payerEmail: { type: String },
    // NOTE: Not every PayPal payment maps to a membership tier (e.g. donations, ads, showcases).
    // Keep this optional, but validate when provided.
    tier: { type: String, required: false, enum: ["Free", "Starter", "Premium", "Pro", "N/A"] },
    payerId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    transaction_details: { type: Object }, // full PayPal response
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaypalTransaction", paypalTransactionSchema);
