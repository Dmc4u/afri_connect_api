const mongoose = require("mongoose");

const platformWalletLedgerSchema = new mongoose.Schema(
  {
    walletKey: {
      type: String,
      required: true,
      index: true,
      default: "digital-services",
    },
    type: {
      type: String,
      enum: ["credit", "debit", "refund", "adjustment"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    currency: {
      type: String,
      uppercase: true,
      default: "USD",
    },
    country: {
      type: String,
      uppercase: true,
      default: null,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reference: {
      type: String,
      required: true,
      index: true,
    },
    note: {
      type: String,
      default: "",
      maxlength: 500,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

platformWalletLedgerSchema.index({ walletKey: 1, createdAt: -1 });
platformWalletLedgerSchema.index({ walletKey: 1, currency: 1, createdAt: -1 });

module.exports = mongoose.model("PlatformWalletLedger", platformWalletLedgerSchema);
