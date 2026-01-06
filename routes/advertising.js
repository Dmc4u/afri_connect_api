const express = require("express");
const auth = require("../middlewares/auth");
const optionalAuth = require('../middlewares/optionalAuth');
const { adminCheckMiddleware } = require('../utils/adminCheck');
const { requireAdvancedAdsAccess } = require("../middlewares/tierCheck");
const { ForbiddenError, BadRequestError } = require("../utils/errors");
const {
  getActiveAds,
  createAdRequest,
  getMyAds,
  getAdById,
  trackImpression,
  trackClick,
  completeAdPayment,
  adminGetAllAds,
  adminUpdateAdStatus,
  adminUpdateAd,
  adminDeleteAd,
  adminGetAnalytics,
  adminCreateAd
} = require('../controllers/advertising');

const router = express.Router();

// ===== NEW ADVERTISEMENT SYSTEM =====
// Public routes
router.get('/ads/active', getActiveAds); // Get active ads for display
router.post('/ads/request', optionalAuth, createAdRequest); // Submit ad request (public or logged-in)
router.post('/ads/track/impression/:id', trackImpression); // Track impression
router.post('/ads/track/click/:id', trackClick); // Track click

// Authenticated routes
router.get('/ads/my', auth, getMyAds); // Get my advertisements
router.get('/ads/:id', auth, getAdById); // Get single advertisement
router.post('/ads/:id/payment', auth, completeAdPayment); // Complete payment for approved ad

// Admin routes
router.post('/ads/admin/create', auth, adminCheckMiddleware, adminCreateAd); // Admin: Create ad without payment
router.get('/ads/admin/all', auth, adminCheckMiddleware, adminGetAllAds); // Get all ads
router.get('/ads/admin/analytics', auth, adminCheckMiddleware, adminGetAnalytics); // Get analytics
router.patch('/ads/admin/:id/status', auth, adminCheckMiddleware, adminUpdateAdStatus); // Update status
router.patch('/ads/admin/:id', auth, adminCheckMiddleware, adminUpdateAd); // Update ad details
router.delete('/ads/admin/:id', auth, adminCheckMiddleware, adminDeleteAd); // Delete ad

// ===== LEGACY AD CAMPAIGNS (Pro Feature) =====
/**
 * GET /advertising/campaigns - Get all ad campaigns for user (Pro only)
 */
router.get("/campaigns", auth, requireAdvancedAdsAccess, (req, res, next) => {
  // TODO: Implement ad campaign retrieval from database
  // For now, return empty campaigns array
  return res.send({
    campaigns: [],
    message: "Ad campaigns endpoint. Full implementation coming soon.",
  });
});

/**
 * POST /advertising/campaigns - Create new ad campaign (Pro only)
 */
router.post("/campaigns", auth, requireAdvancedAdsAccess, (req, res, next) => {
  const { name, budget, targetAudience, duration, platformPreferences } = req.body;

  if (!name || !budget || !targetAudience || !duration) {
    return next(new BadRequestError("Name, budget, target audience, and duration are required"));
  }

  // TODO: Implement ad campaign creation in database
  return res.status(201).send({
    campaign: {
      id: "campaign_" + Date.now(),
      userId: req.user._id,
      name,
      budget,
      targetAudience,
      duration,
      platformPreferences: platformPreferences || {},
      status: "active",
      createdAt: new Date(),
    },
    message: "Ad campaign created successfully (Pro feature)",
  });
});

/**
 * PATCH /advertising/campaigns/:id - Update ad campaign (Pro only)
 */
router.patch("/campaigns/:id", auth, requireAdvancedAdsAccess, (req, res, next) => {
  const { name, budget, targetAudience, status } = req.body;

  if (!name && !budget && !targetAudience && !status) {
    return next(new BadRequestError("At least one field is required to update"));
  }

  // TODO: Implement ad campaign update with ownership validation
  return res.send({
    campaign: {
      id: req.params.id,
      userId: req.user._id,
      name: name || "Updated Campaign",
      budget: budget || 100,
      status: status || "active",
    },
    message: "Ad campaign updated successfully (Pro feature)",
  });
});

/**
 * GET /advertising/analytics - Get advertising analytics (Pro only)
 */
router.get("/analytics", auth, requireAdvancedAdsAccess, (req, res, next) => {
  // TODO: Implement advertising analytics aggregation
  return res.send({
    analytics: {
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      conversionRate: 0,
      campaigns: [],
    },
    message: "Advertising analytics endpoint (Pro feature)",
  });
});

/**
 * POST /advertising/targeting - Advanced audience targeting (Pro only)
 */
router.post("/targeting", auth, requireAdvancedAdsAccess, (req, res, next) => {
  const { ageRange, locations, interests, behaviors } = req.body;

  if (!locations || locations.length === 0) {
    return next(new BadRequestError("At least one location is required"));
  }

  // TODO: Implement advanced targeting persistence and validation
  return res.status(201).send({
    targeting: {
      id: "target_" + Date.now(),
      ageRange: ageRange || "18-65",
      locations,
      interests: interests || [],
      behaviors: behaviors || [],
      status: "active",
    },
    message: "Advanced targeting profile created (Pro feature)",
  });
});

module.exports = router;
