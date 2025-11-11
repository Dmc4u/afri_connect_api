const mongoose = require("mongoose");

const twoCheckoutTransactionSchema = new mongoose.Schema(
  {
    // Linkages
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },

    // 2CO identifiers
    orderNumber: { type: String, index: true }, // 2CO order number
    invoiceId: { type: String }, // optional invoice/ sale id
    merchantOrderId: { type: String, index: true }, // our internal orderId we pass to 2CO

    // Status
    status: {
      type: String,
      enum: ["INITIATED", "PENDING", "AUTHORIZED", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },

    // Amount
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD", uppercase: true },

    // Customer
    customer: {
      email: String,
      name: String,
      country: String,
      city: String,
      address: String,
      zip: String,
    },

    // Security / verification
    signature: { type: String }, // provided by 2CO (return or INS)
    verification: {
      returnVerified: { type: Boolean, default: false },
      insVerified: { type: Boolean, default: false },
      verifiedAt: Date,
    },

    // Raw payloads for audit/debug
    returnPayload: mongoose.Schema.Types.Mixed,
    webhookPayload: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

module.exports = mongoose.model("TwoCheckoutTransaction", twoCheckoutTransactionSchema);
