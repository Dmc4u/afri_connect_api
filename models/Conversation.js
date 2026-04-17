const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    // Type of conversation: "user-to-user" or "user-to-listing"
    type: {
      type: String,
      enum: ["user-to-user", "user-to-listing", "forum", "user-to-agent", "agent-support"],
      required: true,
    },
    // Participants - array of user IDs
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // For user-to-listing conversations, reference the listing
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      default: null,
    },
    // For forum conversations, reference the forum post
    forumPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ForumPost",
      default: null,
    },
    // Last message for quick reference
    lastMessage: {
      text: String,
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      timestamp: Date,
    },
    // Conversation title (for group or listing inquiries)
    title: {
      type: String,
      default: "",
    },
    // Track unread messages per user
    unreadCount: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    // Soft delete flag
    isArchived: {
      type: Boolean,
      default: false,
    },

    // Agent support fields
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    agentJoinedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "queued", "closed", "escalated", "waiting"],
      default: "active",
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    tags: [String], // ['billing', 'technical', 'sales', 'complaint']
    customerSatisfaction: {
      rating: { type: Number, min: 1, max: 5, default: null },
      feedback: { type: String, default: null },
      ratedAt: { type: Date, default: null },
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    transferHistory: [
      {
        fromAgent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent" },
        toAgent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent" },
        reason: String,
        transferredAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for finding conversations by participants
conversationSchema.index({ participants: 1 });
conversationSchema.index({ type: 1, listing: 1 });
conversationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
