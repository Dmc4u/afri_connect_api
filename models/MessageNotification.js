const mongoose = require("mongoose");

const messageNotificationSchema = new mongoose.Schema(
  {
    // User who should receive notification
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Conversation this notification is about
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: function () {
        // Conversation is optional for contact-form notifications
        return this.type !== "contact-form";
      },
    },
    // Message that triggered notification (or contact message for contact-form type)
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: false, // Can be contact message or regular message
    },
    // Sender of message (optional for guest contact form messages)
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Notification type: "new-message", "reply", "mention", "contact-form"
    type: {
      type: String,
      enum: ["new-message", "reply", "mention", "contact-form"],
      default: "new-message",
    },
    // Whether user has seen this notification
    isRead: {
      type: Boolean,
      default: false,
    },
    // Whether user has dismissed it
    isDismissed: {
      type: Boolean,
      default: false,
    },
    // Notification message for display
    title: String,
    body: String,

    // Delivery channels
    deliveryChannels: {
      inApp: {
        type: Boolean,
        default: true,
      },
      email: {
        type: Boolean,
        default: false,
      },
      push: {
        type: Boolean,
        default: false,
      },
    },

    // Track delivery attempts
    deliveryAttempts: [
      {
        channel: String,
        status: {
          type: String,
          enum: ["pending", "sent", "failed"],
        },
        attemptedAt: Date,
        error: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for finding notifications by user
messageNotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
messageNotificationSchema.index({ conversation: 1 });
messageNotificationSchema.index({ sender: 1 });

module.exports = mongoose.model("MessageNotification", messageNotificationSchema);
