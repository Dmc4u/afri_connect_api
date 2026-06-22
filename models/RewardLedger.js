const mongoose = require("mongoose");

const rewardLedgerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true },
    bucket: { type: String, enum: ["engagement", "referral"], required: true },
    status: {
      type: String,
      enum: ["pending", "available", "reversed", "redeemed"],
      default: "pending",
      index: true,
    },
    sourceType: { type: String, required: true },
    sourceKey: { type: String, required: true, unique: true },
    description: { type: String, trim: true, default: "" },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing", default: null },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    availableAt: { type: Date, required: true },
    reversedAt: { type: Date, default: null },
    redeemedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

rewardLedgerSchema.index({ user: 1, createdAt: -1 });
module.exports = mongoose.model("RewardLedger", rewardLedgerSchema);
