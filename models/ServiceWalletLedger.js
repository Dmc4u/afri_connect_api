const mongoose = require("mongoose");

const serviceWalletLedgerSchema = new mongoose.Schema(
  {
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit", "refund", "commission", "adjustment"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.000001,
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
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DigitalServiceTransaction",
      default: null,
      index: true,
    },
    note: {
      type: String,
      default: "",
      maxlength: 500,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

serviceWalletLedgerSchema.index({ agent: 1, createdAt: -1 });
serviceWalletLedgerSchema.index({ agent: 1, currency: 1, createdAt: -1 });
serviceWalletLedgerSchema.index({ reference: 1, type: 1 });

module.exports = mongoose.model("ServiceWalletLedger", serviceWalletLedgerSchema);
