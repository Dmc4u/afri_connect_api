const mongoose = require("mongoose");

const platformWalletSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: "digital-services",
    },
    name: {
      type: String,
      default: "AfriOnet digital services funding wallet",
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      uppercase: true,
      default: "USD",
    },
    balances: [
      {
        currency: { type: String, required: true, uppercase: true, trim: true },
        country: { type: String, default: null, uppercase: true, trim: true },
        balance: { type: Number, default: 0, min: 0 },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformWallet", platformWalletSchema);
