const mongoose = require("mongoose");

const digitalServiceTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    serviceType: {
      type: String,
      enum: ["airtime", "data", "gift-card"],
      required: true,
      index: true,
    },
    provider: {
      type: String,
      default: "reloadly",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "manual-review", "refunded"],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "refunded", "manual-review"],
      default: "unpaid",
      index: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    providerReference: {
      type: String,
      default: null,
      index: true,
    },
    recipient: {
      phone: String,
      email: String,
      countryCode: String,
      operatorId: Number,
    },
    amount: {
      value: {
        type: Number,
        min: 0,
        default: 0,
      },
      currency: {
        type: String,
        uppercase: true,
        default: "USD",
      },
    },
    pricing: {
      customerAmount: {
        value: { type: Number, min: 0, default: 0 },
        currency: { type: String, uppercase: true, default: "USD" },
      },
      providerAmount: {
        value: { type: Number, min: 0, default: 0 },
        currency: { type: String, uppercase: true, default: "USD" },
      },
      providerCostUsd: { type: Number, min: 0, default: 0 },
      platformFeeUsd: { type: Number, min: 0, default: 0 },
      providerDiscountPercent: { type: Number, min: 0, default: 0 },
      feePercent: { type: Number, min: 0, default: 0 },
      fixedFeeUsd: { type: Number, min: 0, default: 0 },
      minimumFeeUsd: { type: Number, min: 0, default: 0 },
    },
    wallet: {
      debited: { type: Number, min: 0, default: 0 },
      refunded: { type: Number, min: 0, default: 0 },
      currency: { type: String, uppercase: true, default: "USD" },
      debitLedger: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletLedger",
        default: null,
      },
      refundLedger: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletLedger",
        default: null,
      },
    },
    product: {
      id: mongoose.Schema.Types.Mixed,
      name: String,
      countryCode: String,
    },
    requestPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    failureMessage: {
      type: String,
      default: null,
    },
    reviewNote: {
      type: String,
      default: null,
    },
    resolutionNote: {
      type: String,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

digitalServiceTransactionSchema.index({ user: 1, createdAt: -1 });
digitalServiceTransactionSchema.index({ serviceType: 1, status: 1, createdAt: -1 });
digitalServiceTransactionSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("DigitalServiceTransaction", digitalServiceTransactionSchema);
