const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "user_registered",
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
      enum: ["create", "update", "delete", "approve", "reject", "suspend", "verify", "send"],
      required: true,
    },
    targetType: {
      type: String,
      enum: ["user", "listing", "payment", "message", "forum_post", "api_key"],
      required: true,
    },
    targetId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
      expires: 2592000, // Auto-delete after 30 days
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
