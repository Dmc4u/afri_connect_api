const express = require("express");
const { celebrate, Joi } = require("celebrate");
const {
  getCurrentUser,
  updateUser,
  updateUserPhoto,
  deleteUserPhoto,
  updateUserSettings,
  toggleVerifiedBadge,
  updatePageDesign,
  enableLeadGeneration,
  getRecentViews,
  addRecentView,
  clearRecentViews,
  pinRecentView,
} = require("../controllers/user");
const { validateUpdateUser } = require("../middlewares/validation");
const auth = require("../middlewares/auth");
const uploadProfile = require("../middlewares/uploadProfile");
const Announcement = require("../models/Announcement");
const {
  requireVerifiedBadgeAccess,
  requirePageDesignAccess,
  requireLeadGenerationAccess,
  requireProfileCustomization,
} = require("../middlewares/tierCheck");

const router = express.Router();

// All user routes require authentication
router.use(auth);

router.get("/me", getCurrentUser);
router.patch("/me", validateUpdateUser, updateUser);
router.patch("/me/settings", updateUserSettings);
router.patch(
  "/me/photo",
  requireProfileCustomization,
  uploadProfile.single("photo"),
  updateUserPhoto
);
router.post(
  "/me/photo",
  requireProfileCustomization,
  uploadProfile.single("photo"),
  updateUserPhoto
);
router.delete("/me/photo", requireProfileCustomization, deleteUserPhoto);

// Pro-tier specific routes
router.patch("/me/verified-badge", requireVerifiedBadgeAccess, toggleVerifiedBadge);
router.patch("/me/page-design", requirePageDesignAccess, updatePageDesign);
router.patch("/me/lead-generation", requireLeadGenerationAccess, enableLeadGeneration);

// === RECENT VIEWS (cross-device sync) ===
router.get("/me/recent-views", getRecentViews);
router.post(
  "/me/recent-views",
  celebrate({ body: Joi.object().keys({ listingId: Joi.string().hex().length(24).required() }) }),
  addRecentView
);
router.delete("/me/recent-views", clearRecentViews);
router.patch(
  "/me/recent-views/pin",
  celebrate({ body: Joi.object().keys({ listingId: Joi.string().hex().length(24).required(), pinned: Joi.boolean().required() }) }),
  pinRecentView
);

// === ANNOUNCEMENTS ===

// Get user's announcements
router.get("/announcements", async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Find announcements for this user or sent to all
    const visibilityFilter = {
      $or: [
        { "recipients.type": "all" },
        { "recipients.type": "tier", "recipients.value": req.user.tier },
        { "recipients.type": "individual", "recipients.value": { $in: [req.user._id] } },
      ],
    };

    console.log(`[Announcements] Fetching for user ${req.user.email} (tier: ${req.user.tier})`);

    const notDismissedFilter = {
      $and: [
        {
          $or: [
            { dismissedByUsers: { $exists: false } },
            { dismissedByUsers: { $ne: req.user._id } },
          ],
        },
        {
          $or: [
            { dismissedForTiers: { $exists: false } },
            { dismissedForTiers: { $ne: req.user.tier } },
          ],
        },
      ],
    };

    const announcements = await Announcement.find({ $and: [visibilityFilter, notDismissedFilter] })
      .populate("sender", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Announcement.countDocuments({
      $and: [visibilityFilter, notDismissedFilter],
    });

    console.log(`[Announcements] Found ${announcements.length} announcements for user ${req.user.email}`);

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

// Mark announcement as read
router.patch(
  "/announcements/:id/read",
  celebrate({
    params: Joi.object().keys({
      id: Joi.string().hex().length(24).required(),
    }),
  }),
  async (req, res, next) => {
    try {
      const announcement = await Announcement.findByIdAndUpdate(
        req.params.id,
        {
          $addToSet: {
            readBy: {
              userId: req.user._id,
              readAt: new Date(),
            },
          },
        },
        { new: true }
      );

      if (!announcement) {
        return res.status(404).json({
          success: false,
          message: "Announcement not found",
        });
      }

      res.json({
        success: true,
        message: "Announcement marked as read",
        announcement,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Dismiss announcement (hide for this user only)
router.patch(
  "/announcements/:id/dismiss",
  celebrate({
    params: Joi.object().keys({
      id: Joi.string().hex().length(24).required(),
    }),
  }),
  async (req, res, next) => {
    try {
      const announcement = await Announcement.findByIdAndUpdate(
        req.params.id,
        { $addToSet: { dismissedByUsers: req.user._id } },
        { new: true }
      );

      if (!announcement) {
        return res.status(404).json({ success: false, message: "Announcement not found" });
      }

      res.json({ success: true, message: "Announcement dismissed", announcementId: req.params.id });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
