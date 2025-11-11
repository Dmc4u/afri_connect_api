const mongoose = require("mongoose");

const apiKeySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    keyName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    keyValue: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    permissions: [
      {
        type: String,
        enum: ["read", "write", "delete", "admin"],
        default: "read",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    lastUsed: {
      type: Date,
      default: null,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    rateLimit: {
      requestsPerHour: {
        type: Number,
        default: 1000,
      },
      requestsPerDay: {
        type: Number,
        default: 10000,
      },
    },
    allowedOrigins: [
      {
        type: String,
        trim: true,
      },
    ],
    expiresAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
apiKeySchema.index({ user: 1, isActive: 1 });
apiKeySchema.index({ keyValue: 1 }, { unique: true });
apiKeySchema.index({ expiresAt: 1 }, { sparse: true });

// Pre-save middleware
apiKeySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to check if API key is expired
apiKeySchema.methods.isExpired = function () {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Instance method to check if API key is valid
apiKeySchema.methods.isValid = function () {
  return this.isActive && !this.isExpired();
};

// Instance method to increment usage
apiKeySchema.methods.recordUsage = function () {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

// Static method to generate unique API key
apiKeySchema.statics.generateKey = function () {
  const crypto = require("crypto");
  return "ak_" + crypto.randomBytes(32).toString("hex");
};

module.exports = mongoose.model("ApiKey", apiKeySchema);
