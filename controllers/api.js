const ApiKey = require("../models/ApiKey");
const ApiUsage = require("../models/ApiUsage");
const User = require("../models/User");
const {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
} = require("../utils/errors");
const crypto = require("crypto");

// Generate API key
const generateApiKey = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Check if user already has an active API key
    const existingKey = await ApiKey.findOne({
      user: userId,
      status: "active",
    });

    if (existingKey) {
      throw new BadRequestError("You already have an active API key");
    }

    // Check user tier for API access
    const user = await User.findById(userId);
    if (!["Premium", "Pro"].includes(user.tier) && user.role !== "admin") {
      throw new ForbiddenError("API access requires Premium or Pro membership");
    }

    // Generate unique API key
    const keyString = crypto.randomBytes(32).toString("hex");
    const hashedKey = crypto.createHash("sha256").update(keyString).digest("hex");

    // Set rate limits based on tier
    const rateLimits = {
      Premium: { requests: 1000, window: 3600 }, // 1000 requests per hour
      Pro: { requests: 4000, window: 3600 }, // 4000 requests per hour
      admin: { requests: 10000, window: 3600 }, // 10000 requests per hour
    };

    const limits = rateLimits[user.tier] || rateLimits[user.role] || rateLimits["Premium"];

    const apiKey = await ApiKey.create({
      user: userId,
      name: req.body.name || "Default API Key",
      keyHash: hashedKey,
      permissions: req.body.permissions || ["read"],
      rateLimit: limits,
      status: "active",
    });

    res.status(201).json({
      success: true,
      message: "API key generated successfully",
      apiKey: {
        id: apiKey._id,
        name: apiKey.name,
        key: keyString, // Only return the plain key once
        permissions: apiKey.permissions,
        rateLimit: apiKey.rateLimit,
        createdAt: apiKey.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get user's API keys
const getApiKeys = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const apiKeys = await ApiKey.find({
      user: userId,
    })
      .select("-keyHash")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      apiKeys,
    });
  } catch (error) {
    next(error);
  }
};

// Revoke API key
const revokeApiKey = async (req, res, next) => {
  try {
    const { keyId } = req.params;
    const userId = req.user._id;

    const apiKey = await ApiKey.findOne({
      _id: keyId,
      user: userId,
    });

    if (!apiKey) {
      throw new NotFoundError("API key not found");
    }

    apiKey.status = "revoked";
    apiKey.revokedAt = new Date();
    await apiKey.save();

    res.json({
      success: true,
      message: "API key revoked successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Get API usage statistics
const getApiUsage = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate, keyId } = req.query;

    const query = { user: userId };

    if (keyId) {
      query.apiKey = keyId;
    }

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const usage = await ApiUsage.find(query)
      .populate("apiKey", "name")
      .sort({ timestamp: -1 })
      .limit(100);

    // Get usage summary
    const summary = await ApiUsage.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          successfulRequests: {
            $sum: { $cond: [{ $gte: ["$statusCode", 200] }, 1, 0] },
          },
          errorRequests: {
            $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] },
          },
          avgResponseTime: { $avg: "$responseTime" },
        },
      },
    ]);

    res.json({
      success: true,
      usage,
      summary: summary[0] || {
        totalRequests: 0,
        successfulRequests: 0,
        errorRequests: 0,
        avgResponseTime: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Validate API key (internal function)
const validateApiKey = async (keyString) => {
  try {
    const hashedKey = crypto.createHash("sha256").update(keyString).digest("hex");

    const apiKey = await ApiKey.findOne({
      keyHash: hashedKey,
      status: "active",
    }).populate("user", "tier role status");

    if (!apiKey) {
      throw new UnauthorizedError("Invalid API key");
    }

    if (apiKey.user.status !== "active") {
      throw new UnauthorizedError("User account is not active");
    }

    // Update last used
    apiKey.lastUsed = new Date();
    await apiKey.save();

    return apiKey;
  } catch (error) {
    throw error;
  }
};

// Check rate limit
const checkRateLimit = async (apiKey) => {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - apiKey.rateLimit.window * 1000);

    const requestCount = await ApiUsage.countDocuments({
      apiKey: apiKey._id,
      timestamp: { $gte: windowStart },
    });

    if (requestCount >= apiKey.rateLimit.requests) {
      throw new Error("Rate limit exceeded");
    }

    return true;
  } catch (error) {
    throw error;
  }
};

// Log API usage
const logApiUsage = async (apiKey, req, res, responseTime) => {
  try {
    await ApiUsage.create({
      user: apiKey.user._id,
      apiKey: apiKey._id,
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode,
      responseTime,
      userAgent: req.get("User-Agent"),
      ipAddress: req.ip,
    });
  } catch (error) {
    console.error("Failed to log API usage:", error);
  }
};

module.exports = {
  generateApiKey,
  getApiKeys,
  revokeApiKey,
  getApiUsage,
  validateApiKey,
  checkRateLimit,
  logApiUsage,
};
