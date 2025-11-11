const mongoose = require("mongoose");

const ContactMessageSchema = new mongoose.Schema(
  {
    // Guest/Sender information
    senderName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
    },
    senderEmail: {
      type: String,
      required: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    message: {
      type: String,
      required: true,
      minlength: 10,
      maxlength: 5000,
    },

    // Business/Listing information
    businessOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: false,
    },

    // Sender (if logged-in user sent the message, not just guest email)
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    // Status tracking
    status: {
      type: String,
      enum: ["new", "read", "replied"],
      default: "new",
    },

    // Replies from business owner (following Forum pattern)
    replies: [
      {
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        authorName: {
          type: String,
          required: true,
          trim: true,
        },
        authorEmail: {
          type: String,
          required: true,
          lowercase: true,
        },
        content: {
          type: String,
          required: true,
          maxlength: 5000,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Metadata
    ipAddress: String,
    userAgent: String,
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
ContactMessageSchema.index({ businessOwner: 1, createdAt: -1 });
ContactMessageSchema.index({ sender: 1, createdAt: -1 });
ContactMessageSchema.index({ senderEmail: 1 });
ContactMessageSchema.index({ status: 1 });

module.exports = mongoose.model("ContactMessage", ContactMessageSchema);
