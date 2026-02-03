const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      minlength: 2,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: (value) => validator.isEmail(value),
        message: "Invalid email",
      },
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: (value) => validator.isMobilePhone(value, "any"),
        message: "Invalid phone number",
      },
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    profilePhoto: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      default: null, // e.g., "Nigeria", "Kenya", "Ghana"
    },
    location: {
      type: String,
      default: null, // e.g., "Lagos, Nigeria" or "Nairobi, Kenya"
    },
    tier: {
      type: String,
      enum: ["Free", "Starter", "Premium", "Pro"],
      default: "Free",
    },

    // Membership expiration (used by membership/payment controllers)
    tierExpiresAt: {
      type: Date,
      default: null,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    settings: {
      emailNotifications: {
        type: Boolean,
        default: true,
      },
      profileVisibility: {
        type: Boolean,
        default: true,
      },
      phoneVisibility: {
        type: Boolean,
        default: false,
      },
      twoFactorAuth: {
        type: Boolean,
        default: false,
      },
    },

    // Email OTP for 2FA login (stored hashed; short-lived)
    loginOtp: {
      hash: { type: String, default: null, select: false },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
      lastSentAt: { type: Date, default: null },
    },
    // Pro tier specific fields
    verifiedBadge: {
      type: Boolean,
      default: false,
    },
    pageDesign: {
      primaryColor: {
        type: String,
        default: null,
      },
      headerBanner: {
        type: String,
        default: null,
      },
      removeBranding: {
        type: Boolean,
        default: false,
      },
    },
    dedicatedManager: {
      type: String, // Admin user ID assigned as dedicated manager
      default: null,
    },
    // Recently viewed listing metadata (for cross-device sync)
    recentViews: [
      {
        listingId: { type: mongoose.Schema.Types.ObjectId, ref: "Listing" },
        title: String,
        thumbnail: String,
        viewedAt: { type: Date, default: Date.now },
        pinned: { type: Boolean, default: false },
      },
    ],
    // Subscription fields for 2Checkout integration
    subscriptionId: {
      type: String, // 2Checkout subscription reference
      default: null,
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "cancelled", "payment_failed", "expired", null],
      default: null,
    },
    subscriptionRenewsAt: {
      type: Date,
      default: null,
    },
    subscriptionCancelledAt: {
      type: Date,
      default: null,
    },

    // Payment method vault tokens (provider-stored). Never store card numbers/CVV.
    paymentVault: {
      paypal: {
        vaultId: { type: String, default: null },
        createdAt: { type: Date, default: null },
        updatedAt: { type: Date, default: null },
      },
    },
  },
  {
    timestamps: true, // This adds createdAt and updatedAt fields
  }
);

userSchema.statics.findUserByCredentials = function findUserByCredentials(email, password) {
  return this.findOne({ email })
    .select("+password")
    .then((user) => {
      if (!user) {
        return Promise.reject(new Error("Incorrect email or password"));
      }

      return bcrypt.compare(password, user.password).then((matched) => {
        if (!matched) {
          return Promise.reject(new Error("Incorrect email or password"));
        }
        return user;
      });
    });
};

module.exports = mongoose.model("User", userSchema);
