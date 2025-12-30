const mongoose = require("mongoose");

const featuredPlacementSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: "Listing", required: true },
    showcaseId: { type: mongoose.Schema.Types.ObjectId, ref: "TalentShowcase" }, // For talent showcase winners
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    notes: { type: String, default: "" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Simple engagement metrics
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    // Monetization metadata
    offerType: { type: String, enum: ['standard','premium','prime','growth'], default: 'standard' },
    quotedPriceClient: { type: Number }, // price the client calculated (for audit)
    priceBooked: { type: Number }, // authoritative server computed price
    currency: { type: String, default: 'USD' },
    billingMode: { type: String, enum: ['fixed','subscription'], default: 'fixed' },
    slotType: { type: String }, // e.g. standard|prime|subscription (alias for offerType if needed)
    capacitySnapshot: { type: Object }, // store occupancy ratios at booking time
    // Payment metadata
    paymentProvider: { type: String, enum: ['paypal','card','none'], default: 'none' },
    paymentOrderId: { type: String },
    paymentStatus: { type: String, enum: ['initiated','approved','captured','failed','cancelled', null], default: null },
    paidAt: { type: Date },
    amountPaid: { type: Number },
  capturing: { type: Boolean, default: false },
    // Discounts metadata
  discountPercent: { type: Number, default: 0 }, // combined percent applied
  discountBreakdown: { type: Object }, // { offPeak: number, multiWindow: number }
  // Baseline price before any discounts (no off-peak relief, no multi-window)
  originalPriceBeforeDiscounts: { type: Number }
  },
  { timestamps: true }
);

featuredPlacementSchema.index({ startAt: 1, endAt: 1, status: 1 });

module.exports = mongoose.model("FeaturedPlacement", featuredPlacementSchema);
