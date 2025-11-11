const mongoose = require("mongoose");

const pricingSettingsSchema = new mongoose.Schema(
  {
    tier: {
      type: String,
      required: true,
      enum: ["Free", "Starter", "Premium", "Pro"],
      unique: true,
    },
    basePrice: {
      type: Number,
      required: true,
      default: 0,
      description: "Base price in USD",
    },
    billingPeriod: {
      type: String,
      enum: ["month", "year", "forever"],
      required: true,
      default: "month",
    },
    currency: {
      type: String,
      default: "$",
      description: "Default currency symbol",
    },
    description: {
      type: String,
      default: "",
    },
    features: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    discountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PricingSettings", pricingSettingsSchema);
