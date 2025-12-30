const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional for donations
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    paypalOrderId: {
      type: String,
      sparse: true,
    },
    paypalPaymentId: {
      type: String,
      sparse: true,
    },
    amount: {
      currency: {
        type: String,
        required: true,
        default: "USD",
        uppercase: true,
  enum: ["USD", "EUR", "GBP", "CAD", "AUD", "ILS"],
      },
      value: {
        type: Number,
        required: true,
        min: 0.01,
        validate: {
          validator: function (v) {
            return Number.isFinite(v) && v > 0;
          },
          message: "Amount must be a positive number",
        },
      },
    },
    paymentType: {
      type: String,
      enum: ["membership", "showcase", "advertising", "donation", "listing", "featured"],
      default: "membership",
      index: true,
    },
    tierUpgrade: {
      from: {
        type: String,
        enum: ["Free", "Starter", "Premium", "Pro"],
        required: false,
      },
      to: {
        type: String,
        enum: ["Starter", "Premium", "Pro"],
        required: false,
      },
      duration: {
        type: String,
        enum: ["monthly", "yearly"],
        required: false,
      },
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled", "refunded", "disputed"],
      default: "pending",
      index: true,
    },
    integrityHash: {
      type: String,
      required: false,
      index: true,
    },
    capturing: {
      type: Boolean,
      default: false,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["paypal", "stripe", "twocheckout", "manual"],
      default: "paypal",
    },
    paymentDetails: {
      payerInfo: {
        email: String,
        firstName: String,
        lastName: String,
        payerId: String,
      },
      transactionId: String,
      authorizationId: String,
      captureId: String,
      refundId: String,
    },
    metadata: {
      ipAddress: String,
      userAgent: String,
      referrer: String,
      promoCode: String,
      discount: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
    },
    processingFees: {
      paypal: {
        type: Number,
        min: 0,
        default: 0,
      },
      platform: {
        type: Number,
        min: 0,
        default: 0,
      },
    },
    refund: {
      amount: {
        type: Number,
        min: 0,
      },
      reason: {
        type: String,
        enum: ["user_request", "dispute", "fraud", "technical_error", "other"],
      },
      processedAt: Date,
      refundId: String,
      status: {
        type: String,
        enum: ["pending", "completed", "failed"],
      },
    },
    activationDate: {
      type: Date,
      default: null,
    },
    expirationDate: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    autoRenewal: {
      enabled: {
        type: Boolean,
        default: false,
      },
      nextBillingDate: Date,
      billingAgreementId: String,
    },
    notifications: {
      paymentConfirmation: {
        sent: { type: Boolean, default: false },
        sentAt: Date,
      },
      activationNotice: {
        sent: { type: Boolean, default: false },
        sentAt: Date,
      },
      expirationWarning: {
        sent: { type: Boolean, default: false },
        sentAt: Date,
      },
    },
    auditLog: [
      {
        action: {
          type: String,
          required: true,
          enum: [
            "created",
            "updated",
            "completed",
            "failed",
            "refunded",
            "cancelled",
            "activated",
            "expired",
          ],
        },
        details: mongoose.Schema.Types.Mixed,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
paymentSchema.index({ user: 1, status: 1, createdAt: -1 });
// orderId already indexed via unique: true
// paypalOrderId already indexed via sparse: true
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ isActive: 1, expirationDate: 1 });
paymentSchema.index({ "tierUpgrade.to": 1, status: 1 });

// Virtual for checking if payment is expired
paymentSchema.virtual("isExpired").get(function () {
  return this.expirationDate && new Date() > this.expirationDate;
});

// Virtual for days remaining
paymentSchema.virtual("daysRemaining").get(function () {
  if (!this.expirationDate || this.isExpired) return 0;
  const now = new Date();
  const diffTime = this.expirationDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Pre-save middleware
paymentSchema.pre("save", function (next) {
  this.updatedAt = Date.now();

  // Set completion date when status changes to completed
  if (this.isModified("status") && this.status === "completed" && !this.completedAt) {
    this.completedAt = new Date();
  }

  // Calculate expiration date based on tier and duration
  if (this.isModified("activationDate") && this.activationDate && !this.expirationDate) {
    const activation = new Date(this.activationDate);
    const expiration = new Date(activation);

    if (this.tierUpgrade.duration === "monthly") {
      expiration.setMonth(expiration.getMonth() + 1);
    } else if (this.tierUpgrade.duration === "yearly") {
      expiration.setFullYear(expiration.getFullYear() + 1);
    }

    this.expirationDate = expiration;
  }

  next();
});

// Static util to compute integrity hash
paymentSchema.statics.computeIntegrityHash = function (payload) {
  const { userId, tierTo, priceValue, currency, duration } = payload;
  const base = `${userId}|${tierTo}|${priceValue}|${currency}|${duration}`;
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(base).digest('hex');
};

// Instance method to activate payment
paymentSchema.methods.activate = function () {
  this.isActive = true;
  this.activationDate = new Date();
  this.status = "completed";

  // Add audit log entry
  this.auditLog.push({
    action: "activated",
    details: { tierUpgrade: this.tierUpgrade },
    timestamp: new Date(),
  });

  return this.save();
};

// Instance method to refund payment
paymentSchema.methods.processRefund = function (amount, reason = "user_request") {
  this.refund = {
    amount: amount || this.amount.value,
    reason,
    processedAt: new Date(),
    status: "pending",
  };
  this.status = "refunded";
  this.isActive = false;

  // Add audit log entry
  this.auditLog.push({
    action: "refunded",
    details: { amount, reason },
    timestamp: new Date(),
  });

  return this.save();
};

// Instance method to check if payment needs renewal warning
paymentSchema.methods.needsRenewalWarning = function () {
  if (!this.isActive || !this.expirationDate) return false;

  const daysUntilExpiry = this.daysRemaining;
  const warningThreshold = 7; // Days before expiration to send warning

  return (
    daysUntilExpiry <= warningThreshold &&
    daysUntilExpiry > 0 &&
    !this.notifications.expirationWarning.sent
  );
};

// Static method to get active subscription for user
paymentSchema.statics.getActiveSubscription = function (userId) {
  return this.findOne({
    user: userId,
    status: "completed",
    isActive: true,
    $or: [{ expirationDate: { $gt: new Date() } }, { expirationDate: null }],
  }).populate("user", "name email tier");
};

// Static method to get payment history for user
paymentSchema.statics.getUserPaymentHistory = function (userId, limit = 10) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("user", "name email");
};

// Static method to find expiring subscriptions
paymentSchema.statics.findExpiringSoon = function (days = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  return this.find({
    isActive: true,
    status: "completed",
    expirationDate: {
      $lte: futureDate,
      $gt: new Date(),
    },
    "notifications.expirationWarning.sent": false,
  }).populate("user", "name email");
};

module.exports = mongoose.model("Payment", paymentSchema);
