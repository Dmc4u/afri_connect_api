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
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformWallet", platformWalletSchema);
