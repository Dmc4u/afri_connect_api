const ApiKey = require("../models/ApiKey");
const ApiUsage = require("../models/ApiUsage");
const User = require("../models/User");
const { UnauthorizedError, ForbiddenError, TooManyRequestsError } = require("../utils/errors");

/**
 * API Key Authentication Middleware
 * Validates API keys and enforces rate limits
 */
const apiAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers["x-api-key"] || req.query.apiKey;

    if (!apiKey) {
      throw new UnauthorizedError("API key is required");
    }

    // Find and validate API key
    const keyDoc = await ApiKey.findOne({
      keyValue: apiKey,
      isActive: true,
    }).populate("user", "name email tier role isActive");

    if (!keyDoc) {
      throw new UnauthorizedError("Invalid API key");
    }

    // Check if key is expired
    if (keyDoc.isExpired()) {
      throw new UnauthorizedError("API key has expired");
    }

    // Check if user is active
    if (!keyDoc.user.isActive) {
      throw new ForbiddenError("User account is inactive");
    }

    // Check rate limits
    await checkRateLimit(keyDoc);

    // Record API usage
    const startTime = Date.now();

    // Add API key info to request
    req.apiKey = keyDoc;
    req.apiUser = keyDoc.user;

    // Override the res.json method to capture response data
    const originalJson = res.json;
    res.json = function (data) {
      const responseTime = Date.now() - startTime;

      // Log usage asynchronously
      logApiUsage({
        apiKey: keyDoc._id,
        user: keyDoc.user._id,
        endpoint: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        responseTime,
        requestSize: req.headers["content-length"] || 0,
        responseSize: JSON.stringify(data).length,
        userAgent: req.headers["user-agent"],
        ipAddress: req.ip || req.connection.remoteAddress,
      });

      // Update API key usage
      keyDoc.recordUsage().catch((err) => console.error("Failed to update API key usage:", err));

      return originalJson.call(this, data);
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Check rate limits for API key
 */
const checkRateLimit = async (apiKey) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Count requests in the last hour
  const hourlyUsage = await ApiUsage.countDocuments({
    apiKey: apiKey._id,
    timestamp: { $gte: oneHourAgo },
  });

  if (hourlyUsage >= apiKey.rateLimit.requestsPerHour) {
    throw new TooManyRequestsError("Hourly rate limit exceeded");
  }

  // Count requests in the last day
  const dailyUsage = await ApiUsage.countDocuments({
    apiKey: apiKey._id,
    timestamp: { $gte: oneDayAgo },
  });

  if (dailyUsage >= apiKey.rateLimit.requestsPerDay) {
    throw new TooManyRequestsError("Daily rate limit exceeded");
  }
};

/**
 * Log API usage
 */
const logApiUsage = async (usageData) => {
  try {
    await ApiUsage.logUsage(usageData);
  } catch (error) {
    console.error("Failed to log API usage:", error);
    // Don't throw error to avoid breaking the main request
  }
};

/**
 * Check if user has specific permissions
 */
const requirePermissions = (permissions) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return next(new UnauthorizedError("API authentication required"));
    }

    const userPermissions = req.apiKey.permissions || [];
    const hasPermission = permissions.every(
      (permission) => userPermissions.includes(permission) || userPermissions.includes("admin")
    );

    if (!hasPermission) {
      return next(new ForbiddenError("Insufficient permissions"));
    }

    next();
  };
};

/**
 * Require admin permissions
 */
const requireAdmin = requirePermissions(["admin"]);

/**
 * Require write permissions
 */
const requireWrite = requirePermissions(["write"]);

/**
 * Require read permissions (default for most endpoints)
 */
const requireRead = requirePermissions(["read"]);

module.exports = {
  apiAuth,
  checkRateLimit,
  logApiUsage,
  requirePermissions,
  requireAdmin,
  requireWrite,
  requireRead,
};
