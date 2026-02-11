const mongoose = require("mongoose");

/**
 * Advertisement Model
 * Represents paid advertising placements on the platform
 */
const advertisementSchema = new mongoose.Schema(
  {
    // Advertiser Information
    advertiser: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Optional - if registered user
      name: { type: String, required: true },
      email: { type: String, required: true },
      company: { type: String },
      phone: String,
    },

    // Ad Content
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, maxlength: 500 },
    callToAction: { type: String, maxlength: 50, default: "Learn More" },
    targetUrl: { type: String, required: true }, // Where the ad links to

    // Media
    imageUrl: { type: String }, // Cloudinary URL
    videoUrl: { type: String }, // Cloudinary video URL or embed
    imageCloudinaryId: { type: String }, // Cloudinary public_id (optional)
    videoCloudinaryId: { type: String }, // Cloudinary public_id (optional)
    mediaFiles: [
      {
        filename: String,
        originalname: String,
        mimetype: String,
        size: Number,
        url: String,
        cloudinaryId: String, // Cloudinary public_id (optional)
        type: { type: String, enum: ["image", "video"] },
        duration: Number, // For videos - in seconds
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    videoDuration: { type: Number }, // Video length in seconds for pricing
    videoTier: {
      type: String,
      enum: ["none", "30s", "60s", "120s", "180s", "300s"], // 30s, 1min, 2min, 3min, 5min
      default: "none",
    },

    // Placement Configuration
    placement: {
      type: String,
      enum: [
        "homepage-banner",
        "homepage-sidebar",
        "talent-showcase-sponsor",
        "listing-detail-sidebar",
        "footer-banner",
      ],
      required: true,
    },
    category: { type: String }, // For category-specific ads (e.g., 'Tech', 'Arts')

    // Scheduling
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    // Pricing & Payment
    pricing: {
      plan: {
        type: String,
        enum: ["starter", "professional", "enterprise", "custom"],
        required: true,
      },
      amount: { type: Number, required: true }, // Total amount in USD
      basePlanAmount: { type: Number }, // Base plan price before video addon
      videoAddonAmount: { type: Number, default: 0 }, // Additional cost for video
      billingCycle: {
        type: String,
        enum: ["monthly", "quarterly", "one-time"],
        default: "monthly",
      },
      currency: { type: String, default: "USD" },
    },

    // Status
    status: {
      type: String,
      enum: ["pending", "approved", "active", "paused", "completed", "rejected"],
      default: "pending",
    },

    // Payment Status
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid", "refunded"],
      default: "unpaid",
    },
    paymentDetails: {
      method: String, // 'paypal', 'stripe', 'bank-transfer'
      transactionId: String,
      paidAt: Date,
    },

    // Analytics & Performance
    analytics: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 }, // Manually tracked
      lastImpressionAt: Date,
      lastClickAt: Date,
    },

    // Display Settings
    settings: {
      priority: { type: Number, default: 0 }, // Higher priority = shown first
      maxImpressions: Number, // Optional impression cap
      maxClicks: Number, // Optional click cap
      targeting: {
        countries: [String], // Show only in specific countries
        devices: [{ type: String, enum: ["mobile", "tablet", "desktop"] }],
        excludeLoggedIn: { type: Boolean, default: false },
      },
    },

    // Admin Notes
    adminNotes: String,
    rejectionReason: String,

    // Audit
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
advertisementSchema.index({ status: 1, startDate: 1, endDate: 1 });
advertisementSchema.index({ placement: 1, status: 1 });
advertisementSchema.index({ "advertiser.email": 1 });
advertisementSchema.index({ "analytics.impressions": -1 });

// Virtual for CTR (Click-Through Rate)
advertisementSchema.virtual("ctr").get(function () {
  if (!this.analytics.impressions) return 0;
  return ((this.analytics.clicks / this.analytics.impressions) * 100).toFixed(2);
});

// Instance method to check if ad should be displayed
advertisementSchema.methods.isActive = function () {
  const now = new Date();
  return (
    this.status === "active" &&
    this.startDate <= now &&
    this.endDate >= now &&
    (!this.settings.maxImpressions || this.analytics.impressions < this.settings.maxImpressions) &&
    (!this.settings.maxClicks || this.analytics.clicks < this.settings.maxClicks)
  );
};

// Instance method to record impression
advertisementSchema.methods.recordImpression = async function () {
  this.analytics.impressions += 1;
  this.analytics.lastImpressionAt = new Date();
  return this.save();
};

// Instance method to record click
advertisementSchema.methods.recordClick = async function () {
  this.analytics.clicks += 1;
  this.analytics.lastClickAt = new Date();
  return this.save();
};

// Ensure JSON output includes virtuals
advertisementSchema.set("toJSON", { virtuals: true });
advertisementSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Advertisement", advertisementSchema);
