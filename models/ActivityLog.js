const mongoose = require("mongoose");
const { ACTIVITY_RETENTION_SECONDS } = require("../utils/activityRetention");

const activityLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "user_registered",
        "password_reset_requested",
        "password_reset_completed",
        "password_reset_blocked",
        "suspicious_password_reset",
        "listing_created",
        "listing_approved",
        "listing_rejected",
        "listing_suspended",
        "payment_processed",
        "user_verified",
        "user_suspended",
        "api_key_created",
        "forum_post",
        "message_received",
        "contact_reply_sent",
        "announcement_sent",
      ],
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    userName: {
      type: String,
      required: true,
    },
    userEmail: String,
    action: {
      type: String,
      enum: [
        "create",
        "request",
        "update",
        "delete",
        "approve",
        "reject",
        "suspend",
        "verify",
        "send",
      ],
      required: true,
    },
    targetType: {
      type: String,
      enum: ["user", "listing", "payment", "message", "forum_post", "api_key", "announcement"],
      required: true,
    },
    targetId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    reviewStatus: {
      type: String,
      enum: ["open", "resolved"],
      default: null,
      index: true,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolutionNote: {
      type: String,
      default: null,
      maxlength: 500,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
      expires: ACTIVITY_RETENTION_SECONDS,
    },
  },
  { collection: "activity_logs" }
);

// Indexes for common queries
activityLogSchema.index({ timestamp: -1 });
activityLogSchema.index({ type: 1, timestamp: -1 });
activityLogSchema.index({ userId: 1, timestamp: -1 });
activityLogSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
