const mongoose = require("mongoose");

/**
 * Agent Model
 * Represents customer support, sales, or technical agents
 * Links to User model for authentication and basic profile
 */
const agentSchema = new mongoose.Schema(
  {
    // Reference to User account
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // Agent role/type
    role: {
      type: String,
      enum: ["support", "sales", "technical", "supervisor", "moderator"],
      default: "support",
      required: true,
    },

    // Current status
    status: {
      type: String,
      enum: ["online", "offline", "busy", "away"],
      default: "offline",
    },

    // Department/Team
    department: {
      type: String,
      enum: ["customer_support", "sales", "technical", "billing", "moderation", "general"],
      default: "customer_support",
    },

    // Languages spoken
    languages: {
      type: [String],
      default: ["English"],
    },

    // Specializations/expertise areas
    specializations: {
      type: [String],
      default: [],
      // Examples: 'business_listings', 'talent_showcase', 'payments', 'premium_features'
    },

    // Countries this agent can handle (for geo-routing)
    assignedCountries: {
      type: [String],
      default: [],
      // Examples: ['Nigeria', 'Kenya', 'Ghana']
    },

    // Chat capacity
    activeChats: {
      type: Number,
      default: 0,
      min: 0,
    },

    maxChats: {
      type: Number,
      default: 5,
      min: 1,
      max: 20,
    },

    // Performance metrics
    totalChats: {
      type: Number,
      default: 0,
    },

    resolvedChats: {
      type: Number,
      default: 0,
    },

    escalatedChats: {
      type: Number,
      default: 0,
    },

    avgResponseTime: {
      type: Number, // in seconds
      default: null,
    },

    avgResolutionTime: {
      type: Number, // in seconds
      default: null,
    },

    // Customer satisfaction rating (1-5)
    rating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5,
    },

    totalRatings: {
      type: Number,
      default: 0,
    },

    ratingSum: {
      type: Number,
      default: 0,
    },

    // Availability schedule
    availability: {
      timezone: {
        type: String,
        default: "UTC",
      },
      schedule: {
        type: Map,
        of: {
          start: String, // "09:00"
          end: String, // "17:00"
          enabled: Boolean,
        },
        default: {
          monday: { start: "09:00", end: "17:00", enabled: true },
          tuesday: { start: "09:00", end: "17:00", enabled: true },
          wednesday: { start: "09:00", end: "17:00", enabled: true },
          thursday: { start: "09:00", end: "17:00", enabled: true },
          friday: { start: "09:00", end: "17:00", enabled: true },
          saturday: { start: "09:00", end: "17:00", enabled: false },
          sunday: { start: "09:00", end: "17:00", enabled: false },
        },
      },
    },

    // Last activity timestamps
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },

    lastStatusChange: {
      type: Date,
      default: Date.now,
    },

    // Agent permissions/access levels
    permissions: {
      canTransferChats: {
        type: Boolean,
        default: true,
      },
      canCloseChats: {
        type: Boolean,
        default: true,
      },
      canEscalate: {
        type: Boolean,
        default: true,
      },
      canAccessAllChats: {
        type: Boolean,
        default: false, // Only supervisors
      },
      canManageAgents: {
        type: Boolean,
        default: false, // Only supervisors
      },
    },

    // Auto-responses settings
    autoResponses: {
      enabled: {
        type: Boolean,
        default: true,
      },
      greetingMessage: {
        type: String,
        default: "Hello! I'm here to help you. How can I assist you today?",
      },
      awayMessage: {
        type: String,
        default: "I'm currently away from my desk. I'll respond as soon as I return.",
      },
    },

    // Activity tracking
    dailyStats: {
      date: {
        type: Date,
        default: null,
      },
      chatsHandled: {
        type: Number,
        default: 0,
      },
      messagesCount: {
        type: Number,
        default: 0,
      },
      avgResponseTime: {
        type: Number,
        default: 0,
      },
    },

    // Notes/Bio for internal use
    notes: {
      type: String,
      default: "",
    },

    // Account status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Training/certification
    certifications: [
      {
        name: String,
        issuedDate: Date,
        expiryDate: Date,
      },
    ],

    // Supervisor (if applicable)
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
agentSchema.index({ userId: 1 });
agentSchema.index({ status: 1, activeChats: 1 });
agentSchema.index({ role: 1, status: 1 });
agentSchema.index({ department: 1, status: 1 });
agentSchema.index({ isActive: 1, status: 1 });

// Virtual for availability status
agentSchema.virtual("isAvailable").get(function () {
  return this.status === "online" && this.isActive && this.activeChats < this.maxChats;
});

// Virtual for success rate
agentSchema.virtual("successRate").get(function () {
  if (this.totalChats === 0) return 100;
  return ((this.resolvedChats / this.totalChats) * 100).toFixed(2);
});

// Method to update rating
agentSchema.methods.addRating = function (rating) {
  this.totalRatings += 1;
  this.ratingSum += rating;
  this.rating = parseFloat((this.ratingSum / this.totalRatings).toFixed(2));
  return this.save();
};

// Method to increment active chats
agentSchema.methods.acceptChat = function () {
  if (this.activeChats >= this.maxChats) {
    throw new Error("Agent has reached maximum chat capacity");
  }
  this.activeChats += 1;
  this.totalChats += 1;
  this.lastActiveAt = new Date();
  return this.save();
};

// Method to decrement active chats
agentSchema.methods.completeChat = function (resolved = true) {
  this.activeChats = Math.max(0, this.activeChats - 1);
  if (resolved) {
    this.resolvedChats += 1;
  } else {
    this.escalatedChats += 1;
  }
  this.lastActiveAt = new Date();
  return this.save();
};

// Method to update status
agentSchema.methods.updateStatus = function (newStatus) {
  this.status = newStatus;
  this.lastStatusChange = new Date();
  if (newStatus === "online" || newStatus === "away") {
    this.lastActiveAt = new Date();
  }
  return this.save();
};

// Static method to find available agents
agentSchema.statics.findAvailableAgent = async function (criteria = {}) {
  const {
    role = null,
    department = null,
    languages = null,
    specialization = null,
    country = null,
  } = criteria;

  const query = {
    isActive: true,
    status: { $in: ["online", "away"] },
    $expr: { $lt: ["$activeChats", "$maxChats"] },
  };

  if (role) query.role = role;
  if (department) query.department = department;
  if (languages) query.languages = { $in: Array.isArray(languages) ? languages : [languages] };
  if (specialization) query.specializations = specialization;
  if (country) query.assignedCountries = { $in: [country] };

  // Find agent with least active chats and best response time
  return this.findOne(query)
    .populate("userId", "name email profilePhoto")
    .sort({ activeChats: 1, avgResponseTime: 1, rating: -1 })
    .exec();
};

// Static method to get agent metrics
agentSchema.statics.getAgentMetrics = async function (agentId) {
  const agent = await this.findById(agentId).populate("userId", "name email profilePhoto");

  if (!agent) return null;

  return {
    agentId: agent._id,
    name: agent.userId.name,
    role: agent.role,
    department: agent.department,
    status: agent.status,
    activeChats: agent.activeChats,
    maxChats: agent.maxChats,
    totalChats: agent.totalChats,
    resolvedChats: agent.resolvedChats,
    successRate: agent.successRate,
    rating: agent.rating,
    avgResponseTime: agent.avgResponseTime,
    avgResolutionTime: agent.avgResolutionTime,
    lastActiveAt: agent.lastActiveAt,
    isAvailable: agent.isAvailable,
  };
};

// Static method to get dashboard stats
agentSchema.statics.getDashboardStats = async function () {
  const stats = await this.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalActiveChats: { $sum: "$activeChats" },
        avgRating: { $avg: "$rating" },
      },
    },
  ]);

  const totals = await this.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: null,
        totalAgents: { $sum: 1 },
        totalChatsToday: { $sum: "$dailyStats.chatsHandled" },
        avgResponseTime: { $avg: "$avgResponseTime" },
        totalActiveChats: { $sum: "$activeChats" },
      },
    },
  ]);

  return {
    byStatus: stats,
    overall: totals[0] || {},
  };
};

module.exports = mongoose.model("Agent", agentSchema);
