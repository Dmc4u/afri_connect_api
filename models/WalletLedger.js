const mongoose = require("mongoose");

const walletLedgerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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

walletLedgerSchema.index({ user: 1, createdAt: -1 });
walletLedgerSchema.index({ reference: 1, type: 1 });

module.exports = mongoose.model("WalletLedger", walletLedgerSchema);
