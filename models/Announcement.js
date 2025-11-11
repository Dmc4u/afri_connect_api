const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipients: {
      type: {
        type: String,
        enum: ["individual", "tier", "all"],
        default: "individual",
      },
      value: {
        type: mongoose.Schema.Types.Mixed, // Can be user IDs array, tier name, or null for all
      },
    },
    readBy: [
      {
        userId: mongoose.Schema.Types.ObjectId,
        readAt: Date,
      },
    ],
    status: {
      type: String,
      enum: ["draft", "sent", "archived"],
      default: "sent",
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },
    dismissedByUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    dismissedForTiers: [
      {
        type: String,
        enum: ["Free", "Starter", "Premium", "Pro"],
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
  },
  { timestamps: true }
);

// Index for efficient queries
announcementSchema.index({ createdAt: -1 });
announcementSchema.index({ "recipients.type": 1 });
announcementSchema.index({ sender: 1 });
announcementSchema.index({ dismissedByUsers: 1 });
announcementSchema.index({ dismissedForTiers: 1 });

module.exports = mongoose.model("Announcement", announcementSchema);
