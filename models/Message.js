const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    // Reference to conversation
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    // Sender user ID (optional for guest contact form messages)
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Optional: Contact form sender name (for guest messages)
    senderName: {
      type: String,
      default: null,
      sparse: true,
    },
    // Optional: Contact form sender email (for guest messages)
    senderEmail: {
      type: String,
      default: null,
      sparse: true,
    },
    // Message text content
    text: {
      type: String,
      required: [true, "Message text is required"],
      trim: true,
      maxlength: [5000, "Message cannot exceed 5000 characters"],
    },
    // Optional attachments (URLs from Cloudinary)
    attachments: [
      {
        type: String, // URL to file/image
        url: String,
      },
    ],
    // Track read status per recipient
    readBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: Date,
      },
    ],
    // Edit history
    editedAt: Date,
    editHistory: [
      {
        text: String,
        editedAt: Date,
      },
    ],
    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for finding messages by conversation
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ "readBy.user": 1 });

module.exports = mongoose.model("Message", messageSchema);
