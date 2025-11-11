const express = require("express");
const mongoose = require("mongoose");
const { celebrate, Joi } = require("celebrate");
const User = require("../models/User");
const Listing = require("../models/Listing");
const Payment = require("../models/Payment");
const ApiKey = require("../models/ApiKey");
const ApiUsage = require("../models/ApiUsage");
const ActivityLog = require("../models/ActivityLog");
const Announcement = require("../models/Announcement");
const { logActivity } = require("../utils/activityLogger");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");
const auth = require("../middlewares/auth");

const router = express.Router();

// Middleware to check admin permissions
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  next();
};

// Apply auth and admin check to all routes
router.use(auth);
router.use(requireAdmin);

// Validation schemas
const userIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

const updateUserValidation = celebrate({
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(2).max(30),
      email: Joi.string().email(),
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro"),
      role: Joi.string().valid("user", "admin"),
      isActive: Joi.boolean(),
    })
    .min(1),
});

const listingIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

const updateListingValidation = celebrate({
  body: Joi.object()
    .keys({
      status: Joi.string().valid("active", "pending", "suspended", "deleted"),
      featured: Joi.boolean(),
      moderationNotes: Joi.string().max(500),
    })
    .min(1),
});

const announcementIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

// === DASHBOARD STATISTICS ===

// GET /admin/stats?range=24h|7d|30d|90d
router.get("/stats", async (req, res, next) => {
  try {
    const { range = "7d" } = req.query;

    const now = new Date();
    const periodMs = (unit, n) => ({
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }[unit] * n);

    let windowMs;
    if (range === "24h") windowMs = periodMs("h", 24);
    else if (range === "30d") windowMs = periodMs("d", 30);
    else if (range === "90d") windowMs = periodMs("d", 90);
    else windowMs = periodMs("d", 7); // default 7d

    const startDate = new Date(now.getTime() - windowMs);
    const prevStartDate = new Date(startDate.getTime() - windowMs);

    // Parallelize aggregation queries
    const [
      totalUsers,
      newUsersInRange,
      tiersAgg,
      newUsersByTierAgg,
      totalListings,
      pendingListings,
      newListingsInRange,
      categoriesAgg,
      totalPayments,
      activeSubscriptions,
      paymentsAggInRange,
    ] = await Promise.all([
      // Totals (lifetime)
      User.countDocuments({}),
      // Range: Users created in the selected window
      User.countDocuments({ createdAt: { $gte: startDate, $lte: now } }),
      // Distribution of users by tier (lifetime to show current composition)
      User.aggregate([
        { $group: { _id: { $ifNull: ["$tier", "Free"] }, count: { $sum: 1 } } },
      ]),
      // Range: new users by tier
      User.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: now } } },
        { $group: { _id: { $ifNull: ["$tier", "Free"] }, count: { $sum: 1 } } },
      ]),
      // Totals (lifetime)
      Listing.countDocuments({}),
      Listing.countDocuments({ status: "pending" }),
      // Range: Listings created in the selected window
      Listing.countDocuments({ createdAt: { $gte: startDate, $lte: now } }),
      // Range: Category distribution limited to listings created in the window
      Listing.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: now } } },
        { $group: { _id: { $ifNull: ["$category", "Other"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // Totals (lifetime) - only completed payments, excluding admin-owned payments
      Payment.aggregate([
        { $match: { status: "completed" } },
        { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $match: { "user.role": { $ne: "admin" } } },
        { $count: "count" },
      ]).then((r) => (Array.isArray(r) && r[0] ? r[0].count : 0)),
      // Active subscriptions as of now (completed, active, not expired), excluding admin-owned
      Payment.aggregate([
        {
          $match: {
            status: "completed",
            isActive: true,
            $or: [
              { expirationDate: null },
              { expirationDate: { $gte: now } },
            ],
          },
        },
        { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $match: { "user.role": { $ne: "admin" } } },
        { $count: "count" },
      ]).then((r) => (Array.isArray(r) && r[0] ? r[0].count : 0)),
      // Range: Payments count and revenue aggregation by currency - completed only, exclude admin-owned
      Payment.aggregate([
        { $match: { status: "completed", createdAt: { $gte: startDate, $lte: now } } },
        { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $match: { "user.role": { $ne: "admin" } } },
        { $group: { _id: "$amount.currency", count: { $sum: 1 }, revenue: { $sum: "$amount.value" } } },
      ]),
    ]);

    // Basic growth metric example: users in current vs previous window
    const prevUsersInRange = await User.countDocuments({
      createdAt: { $gte: prevStartDate, $lt: startDate },
    });

    // Derive payments totals across currencies
    const paymentsInRange = Array.isArray(paymentsAggInRange)
      ? paymentsAggInRange.reduce((acc, c) => acc + (c.count || 0), 0)
      : 0;
    const revenueInRange = Array.isArray(paymentsAggInRange)
      ? paymentsAggInRange.reduce((acc, c) => acc + (c.revenue || 0), 0)
      : 0;

    const statistics = {
      overview: {
        totalUsers,
        totalListings,
        pendingListings,
        totalPayments,
        activeSubscriptions,
      },
      growth: {
        newUsersThisWeek: newUsersInRange,
        prevWindowUsers: prevUsersInRange,
        newListingsInRange,
        paymentsInRange,
        revenueInRange,
        paymentsByCurrency: paymentsAggInRange,
      },
      distribution: {
        tiers: tiersAgg,
        newTiers: newUsersByTierAgg,
        categories: categoriesAgg,
      },
      meta: { range },
    };

    res.json({ success: true, statistics });
  } catch (error) {
    next(error);
  }
});

// === USER MANAGEMENT ===

// Get all users with pagination and filtering
router.get(
  "/users",
  celebrate({
    query: Joi.object().keys({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro"),
      role: Joi.string().valid("user", "admin"),
      isActive: Joi.boolean(),
      search: Joi.string().trim().max(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, tier, role, isActive, search } = req.query;

      const query = {};
      if (tier) query.tier = tier;
      if (role) query.role = role;
      if (typeof isActive === "boolean") query.isActive = isActive;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (page - 1) * limit;

      const users = await User.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await User.countDocuments(query);

      res.json({
        success: true,
        users,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          hasNext: skip + users.length < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get recent users (must be before /:id route)
router.get("/users/recent", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

    const users = await User.find()
      .select("name email tier role createdAt profilePhoto")
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    next(error);
  }
});

// Export users as CSV (must be before /:id route)
router.get(
  "/users/export",
  celebrate({
    query: Joi.object().keys({
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro"),
      status: Joi.string().valid("active", "inactive"),
    }),
  }),
  async (req, res, next) => {
    try {
      const { tier, status } = req.query;

      const query = {};
      if (tier) query.tier = tier;
      if (status === "active") query.isActive = true;
      if (status === "inactive") query.isActive = false;

      const users = await User.find(query)
        .select("name email tier createdAt isActive")
        .sort({ createdAt: -1 });

      // Generate CSV
      const csvHeader = "Name,Email,Tier,Joined,Status\n";
      const csvRows = users
        .map(
          (user) =>
            `"${user.name}","${user.email}","${user.tier || "Free"}","${new Date(user.createdAt).toLocaleDateString()}","${user.isActive ? "Active" : "Inactive"}"`
        )
        .join("\n");

      const csv = csvHeader + csvRows;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="users-${new Date().toISOString().split("T")[0]}.csv"`
      );
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

// Export single user as CSV
router.get("/users/:id/export", userIdValidation, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select(
      "name email phone country tier createdAt isActive role"
    );

    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Get user's statistics
    const [listingsCount, paymentsCount, activePayment] = await Promise.all([
      Listing.countDocuments({ owner: user._id }),
      Payment.countDocuments({ user: user._id }),
      Payment.getActiveSubscription(user._id),
    ]);

    // Generate CSV with more detailed user information
    const csvContent = `User Export - ${user.name}
Generated: ${new Date().toLocaleString()}

Profile Information
Name,${user.name}
Email,${user.email}
Phone,${user.phone || "N/A"}
Country,${user.country || "N/A"}
Tier,${user.tier || "Free"}
Status,${user.isActive ? "Active" : "Inactive"}
Role,${user.role}
Joined,${new Date(user.createdAt).toLocaleDateString()}

Statistics
Listings,${listingsCount}
Payments,${paymentsCount}
Active Subscription,${activePayment ? "Yes" : "No"}`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${user.name.replace(/\s+/g, "-")}-export-${new Date().toISOString().split("T")[0]}.csv"`
    );
    res.send(csvContent);
  } catch (error) {
    next(error);
  }
});

// Get single user by ID
router.get("/users/:id", userIdValidation, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select("-password");

    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Get user's statistics
    const [listingsCount, paymentsCount, activePayment] = await Promise.all([
      Listing.countDocuments({ owner: user._id }),
      Payment.countDocuments({ user: user._id }),
      Payment.getActiveSubscription(user._id),
    ]);

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        statistics: {
          listingsCount,
          paymentsCount,
          hasActiveSubscription: !!activePayment,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Update user
router.patch("/users/:id", userIdValidation, updateUserValidation, async (req, res, next) => {
  try {
    const updates = req.body;

    // Don't allow updating admin user by non-super-admin
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      throw new NotFoundError("User not found");
    }

    if (targetUser.role === "admin" && req.user.role !== "super-admin") {
      throw new ForbiddenError("Cannot modify admin users");
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    res.json({
      success: true,
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    next(error);
  }
});

// Admin: Update user tier (no payment required)
router.patch(
  "/users/:id/tier",
  userIdValidation,
  celebrate({
    body: Joi.object().keys({
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").required(),
      duration: Joi.number().integer().min(1).max(365).default(30), // days
    }),
  }),
  async (req, res, next) => {
    try {
      const { tier, duration } = req.body;

      const user = await User.findById(req.params.id);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Update tier
      user.tier = tier;

      // Set expiration (except for Free tier)
      if (tier !== "Free") {
        user.tierExpiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
      } else {
        user.tierExpiresAt = null;
      }

      await user.save();

      // Create a payment record for tracking
      await Payment.create({
        user: user._id,
        amount: 0,
        currency: "USD",
        type: "admin_override",
        tier: tier,
        paymentMethod: "admin",
        status: "completed",
        orderId: `ADMIN-${Date.now()}`,
        expiresAt: user.tierExpiresAt,
        metadata: {
          adminId: req.user._id,
          adminEmail: req.user.email,
          note: "Admin tier assignment",
        },
      });

      res.json({
        success: true,
        message: `User tier updated to ${tier} successfully`,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          tier: user.tier,
          tierExpiresAt: user.tierExpiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// === LISTING MANAGEMENT ===

// Get all listings with admin filters
router.get(
  "/listings",
  celebrate({
    query: Joi.object().keys({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      status: Joi.string().valid("active", "pending", "suspended", "deleted"),
      category: Joi.string(),
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro"),
      featured: Joi.boolean(),
      search: Joi.string().trim().max(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, status, category, tier, featured, search } = req.query;

      const query = {};
      if (status) query.status = status;
      if (category) query.category = category;
      if (tier) query.tier = tier;
      if (typeof featured === "boolean") query.featured = featured;
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (page - 1) * limit;

      const listings = await Listing.find(query)
        .populate("owner", "name email tier")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Listing.countDocuments(query);

      res.json({
        success: true,
        listings,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          hasNext: skip + listings.length < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get pending listings
router.get("/listings/pending", async (req, res, next) => {
  try {
    const listings = await Listing.find({ status: "pending" })
      .populate("owner", "_id name email tier")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      listings,
    });
  } catch (error) {
    next(error);
  }
});

// Approve listing
router.patch("/listings/:id/approve", listingIdValidation, async (req, res, next) => {
  try {
    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { status: "active" },
      { new: true, runValidators: true }
    ).populate("owner", "name email tier");

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Log activity
    logActivity({
      type: "listing_approved",
      description: `Listing "${listing.title}" approved by admin`,
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "approve",
      targetType: "listing",
      targetId: listing._id,
      details: { listingTitle: listing.title, ownerId: listing.owner._id },
    });

    res.json({
      success: true,
      message: "Listing approved successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
});

// Reject listing
router.patch("/listings/:id/reject", listingIdValidation, async (req, res, next) => {
  try {
    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { status: "deleted" },
      { new: true, runValidators: true }
    ).populate("owner", "name email tier");

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Log activity
    logActivity({
      type: "listing_rejected",
      description: `Listing "${listing.title}" rejected by admin`,
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "reject",
      targetType: "listing",
      targetId: listing._id,
      details: { listingTitle: listing.title, ownerId: listing.owner._id },
    });

    res.json({
      success: true,
      message: "Listing rejected successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
});

// Suspend listing
router.patch("/listings/:id/suspend", listingIdValidation, async (req, res, next) => {
  try {
    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { status: "suspended" },
      { new: true, runValidators: true }
    ).populate("owner", "name email tier");

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    res.json({
      success: true,
      message: "Listing suspended successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
});

// Update listing status
router.patch(
  "/listings/:id",
  listingIdValidation,
  updateListingValidation,
  async (req, res, next) => {
    try {
      const listing = await Listing.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      }).populate("owner", "name email tier");

      if (!listing) {
        throw new NotFoundError("Listing not found");
      }

      res.json({
        success: true,
        message: "Listing updated successfully",
        listing,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Admin: Update listing tier (make listings real/demo)
router.patch(
  "/listings/:id/tier",
  listingIdValidation,
  celebrate({
    body: Joi.object().keys({
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").required(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { tier } = req.body;

      const listing = await Listing.findById(req.params.id);
      if (!listing) {
        throw new NotFoundError("Listing not found");
      }

      // Update listing tier
      listing.tier = tier;
      await listing.save();
      await listing.populate("owner", "name email tier");

      res.json({
        success: true,
        message: `Listing tier updated to ${tier} successfully`,
        listing,
      });
    } catch (error) {
      next(error);
    }
  }
);

// NOTE: A legacy /admin/stats handler without range support used to exist here.
// It has been removed to ensure the range-aware /admin/stats route defined earlier
// handles all requests consistently based on the selected time window.

// === API KEY MANAGEMENT ===

// Get all API keys
router.get(
  "/api-keys",
  celebrate({
    query: Joi.object().keys({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      isActive: Joi.boolean(),
      userId: Joi.string().hex().length(24),
    }),
  }),
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, isActive, userId } = req.query;

      const query = {};
      if (typeof isActive === "boolean") query.isActive = isActive;
      if (userId) query.user = userId;

      const skip = (page - 1) * limit;

      const apiKeys = await ApiKey.find(query)
        .populate("user", "name email tier")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await ApiKey.countDocuments(query);

      res.json({
        success: true,
        apiKeys,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          hasNext: skip + apiKeys.length < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get API usage statistics
router.get(
  "/api-usage",
  celebrate({
    query: Joi.object().keys({
      timeRange: Joi.string().valid("hour", "day", "week", "month").default("day"),
      apiKeyId: Joi.string().hex().length(24),
      userId: Joi.string().hex().length(24),
    }),
  }),
  async (req, res, next) => {
    try {
      const { timeRange = "day", apiKeyId, userId } = req.query;

      const filter = {};
      if (apiKeyId) filter.apiKey = apiKeyId;
      if (userId) filter.user = userId;

      const stats = await ApiUsage.getUsageStats(filter, timeRange);

      res.json({
        success: true,
        timeRange,
        statistics: stats,
      });
    } catch (error) {
      next(error);
    }
  }
);

// === ANNOUNCEMENTS ===

// Send announcement to users
router.post(
  "/announcements",
  celebrate({
    body: Joi.object().keys({
      recipients: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().hex().length(24)),
          Joi.object().keys({
            type: Joi.string().valid("tier"),
            value: Joi.string().valid("Free", "Starter", "Premium", "Pro"),
          })
        )
        .required(),
      recipientType: Joi.string().valid("individual", "tier", "multiple", "all").required(),
      subject: Joi.string().trim().min(1).max(200).required(),
      message: Joi.string().trim().min(1).max(5000).required(),
      priority: Joi.string().valid("low", "normal", "high").default("normal"),
    }),
  }),
  async (req, res, next) => {
    try {
      const { recipients, recipientType, subject, message, priority } = req.body;

      let userIds = [];

      if (recipientType === "individual" || recipientType === "multiple") {
        userIds = Array.isArray(recipients) ? recipients : [recipients];
        // Ensure ObjectId type for proper matching in user queries
        userIds = userIds
          .filter(Boolean)
          .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)));
      } else if (recipientType === "tier") {
        const tierUsers = await User.find({ tier: recipients.value }).select("_id");
        userIds = tierUsers.map((u) => u._id);
      } else if (recipientType === "all") {
        const allUsers = await User.find().select("_id");
        userIds = allUsers.map((u) => u._id);
      }

      // Map "multiple" to "individual" for storage to match schema and user queries
      const recipientTypeForStorage =
        recipientType === "all"
          ? "all"
          : recipientType === "multiple"
          ? "individual"
          : recipientType;

      // Save announcement to database
      const announcement = new Announcement({
        subject,
        message,
        sender: req.user._id,
        recipients: {
          type: recipientTypeForStorage,
          value:
            recipientType === "all" ? null : recipientType === "tier" ? recipients.value : userIds,
        },
        status: "sent",
        priority: priority || "normal",
      });

      await announcement.save();

      // Log activity
      await logActivity({
        userId: req.user._id,
        type: "ANNOUNCEMENT_SENT",
        targetType: "Announcement",
        targetId: announcement._id,
        details: {
          subject,
          recipientCount: userIds.length,
          recipientType,
        },
      });

      console.log(`Announcement "${subject}" sent to ${userIds.length} users by ${req.user.email}`);

      res.json({
        success: true,
        message: `Announcement sent to ${userIds.length} user${userIds.length !== 1 ? "s" : ""}`,
        recipientCount: userIds.length,
        announcementId: announcement._id,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get announcements (for users to see them)
// Get all announcements (admin only - already using requireAdmin middleware)
router.get("/announcements/all", async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const announcements = await Announcement.find()
      .populate("sender", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Announcement.countDocuments();

    res.json({
      success: true,
      announcements,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + announcements.length < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Delete an announcement (admin only)
router.delete("/announcements/:id", announcementIdValidation, async (req, res, next) => {
  try {
    const { id } = req.params;
    const announcement = await Announcement.findById(id);
    if (!announcement) {
      throw new NotFoundError("Announcement not found");
    }

    await announcement.deleteOne();

    // Log activity
    await logActivity({
      userId: req.user._id,
      type: "ANNOUNCEMENT_DELETED",
      targetType: "Announcement",
      targetId: id,
      details: {
        subject: announcement.subject,
      },
    });

    res.json({ success: true, message: "Announcement deleted" });
  } catch (error) {
    next(error);
  }
});

// Dismiss announcement for a tier (admin-only)
router.patch(
  "/announcements/:id/dismiss-for-tier",
  announcementIdValidation,
  celebrate({
    body: Joi.object().keys({
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").required(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { tier } = req.body;

      const announcement = await Announcement.findByIdAndUpdate(
        id,
        { $addToSet: { dismissedForTiers: tier } },
        { new: true }
      );

      if (!announcement) {
        throw new NotFoundError("Announcement not found");
      }

      await logActivity({
        userId: req.user._id,
        type: "ANNOUNCEMENT_DISMISSED_FOR_TIER",
        targetType: "Announcement",
        targetId: id,
        details: { tier, subject: announcement.subject },
      });

      res.json({ success: true, message: `Announcement dismissed for ${tier} tier` });
    } catch (error) {
      next(error);
    }
  }
);

// Get recent activity logs
router.get(
  "/activity",
  celebrate({
    query: Joi.object().keys({
      limit: Joi.number().integer().min(1).max(100).default(20),
      skip: Joi.number().integer().min(0).default(0),
      type: Joi.string(),
      targetType: Joi.string(),
      range: Joi.string().valid("24h", "7d", "30d", "90d"),
    }),
  }),
  async (req, res, next) => {
    try {
      const { limit, skip, type, targetType, range } = req.query;

      const filter = {};
      if (type) filter.type = type;
      if (targetType) filter.targetType = targetType;

      // Optional time range filter
      if (range) {
        const now = new Date();
        const periodMs = (unit, n) => ({ h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[unit] * n);
        let windowMs;
        if (range === "24h") windowMs = periodMs("h", 24);
        else if (range === "30d") windowMs = periodMs("d", 30);
        else if (range === "90d") windowMs = periodMs("d", 90);
        else windowMs = periodMs("d", 7);
        const startDate = new Date(now.getTime() - windowMs);
        filter.timestamp = { $gte: startDate, $lte: now };
      }

      const activities = await ActivityLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .lean();

      const total = await ActivityLog.countDocuments(filter);

      res.json({
        success: true,
        activities,
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
