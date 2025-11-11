const Listing = require("../models/Listing");
const User = require("../models/User");
const ApiKey = require("../models/ApiKey");
const { validateApiKey, checkRateLimit, logApiUsage } = require("./api");
const {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
} = require("../utils/errors");

// API Export - Get all listings (public API)
const exportListings = async (req, res, next) => {
  const startTime = Date.now();
  let apiKey = null;

  try {
    // Validate API key
    const keyString = req.headers["x-api-key"];
    if (!keyString) {
      throw new UnauthorizedError("API key required");
    }

    apiKey = await validateApiKey(keyString);
    await checkRateLimit(apiKey);

    const {
      category,
      location,
      search,
      page = 1,
      limit = 50,
      tier,
      status = "active",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query = { status };

    if (category && category !== "all") {
      query.category = category;
    }

    if (location) {
      query.location = { $regex: location, $options: "i" };
    }

    if (tier) {
      query.tier = tier;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Pagination
    const skip = (page - 1) * Math.min(limit, 100); // Max 100 per page
    const actualLimit = Math.min(limit, 100);

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const listings = await Listing.find(query)
      .populate("owner", "name email tier role")
      .sort(sortOptions)
      .skip(skip)
      .limit(actualLimit)
      .lean();

    const total = await Listing.countDocuments(query);

    // Transform data for API response
    const transformedListings = listings.map((listing) => ({
      id: listing._id,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      location: listing.location,
      tier: listing.tier,
      owner: {
        id: listing.owner._id,
        name: listing.owner.name,
        tier: listing.owner.tier,
      },
      mediaFiles: listing.mediaFiles.map((file) => ({
        id: file._id,
        type: file.type,
        url: file.url,
        filename: file.filename,
      })),
      status: listing.status,
      views: listing.views,
      featured: listing.featured,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    }));

    const responseTime = Date.now() - startTime;

    // Log usage
    await logApiUsage(apiKey, req, res, responseTime);

    res.json({
      success: true,
      data: transformedListings,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / actualLimit),
        hasNext: skip + listings.length < total,
        hasPrev: page > 1,
        totalItems: total,
      },
      meta: {
        responseTime: `${responseTime}ms`,
        apiVersion: "1.0",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Log failed usage
    if (apiKey) {
      res.statusCode = error.statusCode || 500;
      await logApiUsage(apiKey, req, res, responseTime);
    }

    next(error);
  }
};

// API Export - Get single listing (public API)
const exportListingById = async (req, res, next) => {
  const startTime = Date.now();
  let apiKey = null;

  try {
    // Validate API key
    const keyString = req.headers["x-api-key"];
    if (!keyString) {
      throw new UnauthorizedError("API key required");
    }

    apiKey = await validateApiKey(keyString);
    await checkRateLimit(apiKey);

    const { id } = req.params;

    const listing = await Listing.findOne({
      _id: id,
      status: "active",
    })
      .populate("owner", "name email tier role")
      .lean();

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Transform data for API response
    const transformedListing = {
      id: listing._id,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      location: listing.location,
      tier: listing.tier,
      owner: {
        id: listing.owner._id,
        name: listing.owner.name,
        tier: listing.owner.tier,
      },
      mediaFiles: listing.mediaFiles.map((file) => ({
        id: file._id,
        type: file.type,
        url: file.url,
        filename: file.filename,
      })),
      status: listing.status,
      views: listing.views,
      featured: listing.featured,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    };

    const responseTime = Date.now() - startTime;

    // Log usage
    await logApiUsage(apiKey, req, res, responseTime);

    res.json({
      success: true,
      data: transformedListing,
      meta: {
        responseTime: `${responseTime}ms`,
        apiVersion: "1.0",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Log failed usage
    if (apiKey) {
      res.statusCode = error.statusCode || 500;
      await logApiUsage(apiKey, req, res, responseTime);
    }

    next(error);
  }
};

// API Export - Get users (admin only)
const exportUsers = async (req, res, next) => {
  const startTime = Date.now();
  let apiKey = null;

  try {
    // Validate API key
    const keyString = req.headers["x-api-key"];
    if (!keyString) {
      throw new UnauthorizedError("API key required");
    }

    apiKey = await validateApiKey(keyString);
    await checkRateLimit(apiKey);

    // Check admin permissions
    if (apiKey.user.role !== "admin" && !apiKey.permissions.includes("admin")) {
      throw new ForbiddenError("Admin access required");
    }

    const {
      tier,
      status = "active",
      page = 1,
      limit = 50,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query = { status };

    if (tier) {
      query.tier = tier;
    }

    // Pagination
    const skip = (page - 1) * Math.min(limit, 100);
    const actualLimit = Math.min(limit, 100);

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const users = await User.find(query)
      .select("-password")
      .sort(sortOptions)
      .skip(skip)
      .limit(actualLimit)
      .lean();

    const total = await User.countDocuments(query);

    const responseTime = Date.now() - startTime;

    // Log usage
    await logApiUsage(apiKey, req, res, responseTime);

    res.json({
      success: true,
      data: users,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / actualLimit),
        hasNext: skip + users.length < total,
        hasPrev: page > 1,
        totalItems: total,
      },
      meta: {
        responseTime: `${responseTime}ms`,
        apiVersion: "1.0",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Log failed usage
    if (apiKey) {
      res.statusCode = error.statusCode || 500;
      await logApiUsage(apiKey, req, res, responseTime);
    }

    next(error);
  }
};

module.exports = {
  exportListings,
  exportListingById,
  exportUsers,
};
