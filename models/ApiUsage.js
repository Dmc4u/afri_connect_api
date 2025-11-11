const mongoose = require("mongoose");

const apiUsageSchema = new mongoose.Schema(
  {
    apiKey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ApiKey",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      required: true,
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      uppercase: true,
    },
    statusCode: {
      type: Number,
      required: true,
      min: 100,
      max: 599,
    },
    responseTime: {
      type: Number,
      required: true,
      min: 0,
    },
    requestSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    responseSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    ipAddress: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          // Basic IP validation (IPv4 and IPv6)
          const ipv4Regex =
            /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
          const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
          return !v || ipv4Regex.test(v) || ipv6Regex.test(v);
        },
        message: "Invalid IP address format",
      },
    },
    errorMessage: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false, // Using custom timestamp field
  }
);

// Compound indexes for efficient queries
apiUsageSchema.index({ apiKey: 1, timestamp: -1 });
apiUsageSchema.index({ user: 1, timestamp: -1 });
apiUsageSchema.index({ endpoint: 1, method: 1, timestamp: -1 });
apiUsageSchema.index({ statusCode: 1, timestamp: -1 });
apiUsageSchema.index({ timestamp: -1 }); // For cleanup operations

// TTL index to automatically delete old records (optional - 90 days)
apiUsageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// Virtual for success status
apiUsageSchema.virtual("isSuccess").get(function () {
  return this.statusCode >= 200 && this.statusCode < 300;
});

// Virtual for error status
apiUsageSchema.virtual("isError").get(function () {
  return this.statusCode >= 400;
});

// Static method to get usage statistics
apiUsageSchema.statics.getUsageStats = async function (filter = {}, timeRange = "day") {
  const now = new Date();
  let startDate;

  switch (timeRange) {
    case "hour":
      startDate = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "day":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const pipeline = [
    {
      $match: {
        ...filter,
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        successfulRequests: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ["$statusCode", 200] }, { $lt: ["$statusCode", 300] }] },
              1,
              0,
            ],
          },
        },
        errorRequests: {
          $sum: {
            $cond: [{ $gte: ["$statusCode", 400] }, 1, 0],
          },
        },
        avgResponseTime: { $avg: "$responseTime" },
        totalDataTransfer: { $sum: { $add: ["$requestSize", "$responseSize"] } },
      },
    },
  ];

  const result = await this.aggregate(pipeline);
  return (
    result[0] || {
      totalRequests: 0,
      successfulRequests: 0,
      errorRequests: 0,
      avgResponseTime: 0,
      totalDataTransfer: 0,
    }
  );
};

// Static method to log API usage
apiUsageSchema.statics.logUsage = async function (data) {
  try {
    const usage = new this(data);
    await usage.save();
    return usage;
  } catch (error) {
    console.error("Failed to log API usage:", error);
    // Don't throw error to avoid breaking the main request
    return null;
  }
};

module.exports = mongoose.model("ApiUsage", apiUsageSchema);
