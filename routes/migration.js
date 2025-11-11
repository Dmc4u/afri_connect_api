const express = require("express");
const { celebrate, Joi } = require("celebrate");
const User = require("../models/User");
const Listing = require("../models/Listing");
const Payment = require("../models/Payment");
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

// === DATA MIGRATION ROUTES ===

// Migrate user tiers
router.post(
  "/migrate-user-tiers",
  celebrate({
    body: Joi.object().keys({
      dryRun: Joi.boolean().default(true),
      batchSize: Joi.number().integer().min(1).max(1000).default(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const { dryRun = true, batchSize = 100 } = req.body;

      let processed = 0;
      let updated = 0;
      const errors = [];

      // Find users without proper tier
      const usersToUpdate = await User.find({
        $or: [{ tier: { $exists: false } }, { tier: null }, { tier: "" }],
      }).limit(batchSize);

      for (const user of usersToUpdate) {
        try {
          processed++;

          if (!dryRun) {
            // Set default tier based on payment history
            const hasActivePayment = await Payment.findOne({
              user: user._id,
              status: "completed",
              isActive: true,
            });

            const newTier = hasActivePayment ? hasActivePayment.tierUpgrade.to : "Free";

            await User.findByIdAndUpdate(user._id, { tier: newTier });
            updated++;
          }
        } catch (error) {
          errors.push({
            userId: user._id,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        migration: "user-tiers",
        dryRun,
        statistics: {
          processed,
          updated: dryRun ? 0 : updated,
          errors: errors.length,
          foundToProcess: usersToUpdate.length,
        },
        errors: errors.slice(0, 10), // Return first 10 errors
      });
    } catch (error) {
      next(error);
    }
  }
);

// Migrate listing statuses
router.post(
  "/migrate-listing-status",
  celebrate({
    body: Joi.object().keys({
      dryRun: Joi.boolean().default(true),
      batchSize: Joi.number().integer().min(1).max(1000).default(100),
      fromStatus: Joi.string(),
      toStatus: Joi.string().valid("active", "pending", "suspended", "deleted"),
    }),
  }),
  async (req, res, next) => {
    try {
      const { dryRun = true, batchSize = 100, fromStatus, toStatus } = req.body;

      let processed = 0;
      let updated = 0;
      const errors = [];

      // Build query
      const query = {};
      if (fromStatus) {
        query.status = fromStatus;
      } else {
        // Find listings without proper status
        query.$or = [{ status: { $exists: false } }, { status: null }, { status: "" }];
      }

      const listingsToUpdate = await Listing.find(query).limit(batchSize);

      for (const listing of listingsToUpdate) {
        try {
          processed++;

          if (!dryRun) {
            const newStatus = toStatus || "pending"; // Default to pending
            await Listing.findByIdAndUpdate(listing._id, { status: newStatus });
            updated++;
          }
        } catch (error) {
          errors.push({
            listingId: listing._id,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        migration: "listing-status",
        dryRun,
        statistics: {
          processed,
          updated: dryRun ? 0 : updated,
          errors: errors.length,
          foundToProcess: listingsToUpdate.length,
        },
        errors: errors.slice(0, 10),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Migrate listing tiers based on owner tier
router.post(
  "/migrate-listing-tiers",
  celebrate({
    body: Joi.object().keys({
      dryRun: Joi.boolean().default(true),
      batchSize: Joi.number().integer().min(1).max(1000).default(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const { dryRun = true, batchSize = 100 } = req.body;

      let processed = 0;
      let updated = 0;
      const errors = [];

      // Find listings without tier or mismatched tier
      const listings = await Listing.find({
        $or: [{ tier: { $exists: false } }, { tier: null }, { tier: "" }],
      })
        .populate("owner", "tier")
        .limit(batchSize);

      for (const listing of listings) {
        try {
          processed++;

          if (!dryRun && listing.owner) {
            const ownerTier = listing.owner.tier || "Free";
            await Listing.findByIdAndUpdate(listing._id, { tier: ownerTier });
            updated++;
          }
        } catch (error) {
          errors.push({
            listingId: listing._id,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        migration: "listing-tiers",
        dryRun,
        statistics: {
          processed,
          updated: dryRun ? 0 : updated,
          errors: errors.length,
          foundToProcess: listings.length,
        },
        errors: errors.slice(0, 10),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Clean up duplicate records
router.post(
  "/cleanup-duplicates",
  celebrate({
    body: Joi.object().keys({
      model: Joi.string().valid("User", "Listing", "Payment").required(),
      field: Joi.string().required(),
      dryRun: Joi.boolean().default(true),
    }),
  }),
  async (req, res, next) => {
    try {
      const { model, field, dryRun = true } = req.body;

      let Model;
      switch (model) {
        case "User":
          Model = User;
          break;
        case "Listing":
          Model = Listing;
          break;
        case "Payment":
          Model = Payment;
          break;
        default:
          throw new BadRequestError("Invalid model specified");
      }

      // Find duplicates
      const duplicates = await Model.aggregate([
        {
          $group: {
            _id: `$${field}`,
            docs: { $push: { _id: "$_id", createdAt: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        {
          $match: { count: { $gt: 1 } },
        },
      ]);

      let removed = 0;
      const errors = [];

      if (!dryRun) {
        for (const duplicate of duplicates) {
          try {
            // Keep the oldest record, remove the rest
            const sortedDocs = duplicate.docs.sort(
              (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
            );
            const toRemove = sortedDocs.slice(1); // Remove all except the first (oldest)

            for (const doc of toRemove) {
              await Model.findByIdAndDelete(doc._id);
              removed++;
            }
          } catch (error) {
            errors.push({
              duplicateGroup: duplicate._id,
              error: error.message,
            });
          }
        }
      }

      res.json({
        success: true,
        migration: "cleanup-duplicates",
        model,
        field,
        dryRun,
        statistics: {
          duplicateGroups: duplicates.length,
          recordsToRemove: duplicates.reduce((sum, dup) => sum + (dup.count - 1), 0),
          removed: dryRun ? 0 : removed,
          errors: errors.length,
        },
        errors: errors.slice(0, 10),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Fix missing indexes
router.post("/fix-indexes", async (req, res, next) => {
  try {
    const results = [];

    // User indexes
    try {
      await User.collection.createIndex({ email: 1 }, { unique: true });
      await User.collection.createIndex({ tier: 1, isActive: 1 });
      results.push({ model: "User", status: "success" });
    } catch (error) {
      results.push({ model: "User", status: "error", error: error.message });
    }

    // Listing indexes
    try {
      await Listing.collection.createIndex({ owner: 1, status: 1 });
      await Listing.collection.createIndex({ category: 1, status: 1 });
      await Listing.collection.createIndex({ tier: 1, status: 1 });
      results.push({ model: "Listing", status: "success" });
    } catch (error) {
      results.push({ model: "Listing", status: "error", error: error.message });
    }

    // Payment indexes
    try {
      await Payment.collection.createIndex({ user: 1, status: 1 });
      await Payment.collection.createIndex({ orderId: 1 }, { unique: true });
      await Payment.collection.createIndex({ isActive: 1, expirationDate: 1 });
      results.push({ model: "Payment", status: "success" });
    } catch (error) {
      results.push({ model: "Payment", status: "error", error: error.message });
    }

    res.json({
      success: true,
      migration: "fix-indexes",
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Get migration status
router.get("/status", async (req, res, next) => {
  try {
    const [usersWithoutTier, listingsWithoutStatus, listingsWithoutTier, paymentsWithoutOrder] =
      await Promise.all([
        User.countDocuments({
          $or: [{ tier: { $exists: false } }, { tier: null }, { tier: "" }],
        }),
        Listing.countDocuments({
          $or: [{ status: { $exists: false } }, { status: null }, { status: "" }],
        }),
        Listing.countDocuments({
          $or: [{ tier: { $exists: false } }, { tier: null }, { tier: "" }],
        }),
        Payment.countDocuments({
          $or: [{ orderId: { $exists: false } }, { orderId: null }, { orderId: "" }],
        }),
      ]);

    res.json({
      success: true,
      migrationStatus: {
        usersWithoutTier,
        listingsWithoutStatus,
        listingsWithoutTier,
        paymentsWithoutOrder,
        needsMigration:
          usersWithoutTier + listingsWithoutStatus + listingsWithoutTier + paymentsWithoutOrder > 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
