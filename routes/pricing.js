const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const { ForbiddenError } = require("../utils/errors");
const {
  getAllPricing,
  getPricingByTier,
  updatePricing,
  resetPricingDefaults,
  bulkUpdatePricing,
} = require("../controllers/pricing");

// Middleware to check admin permissions
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return next(new ForbiddenError("Admin access required"));
  }
  next();
};

// Public routes - Get pricing information
router.get("/pricing", getAllPricing);
router.get("/pricing/:tier", getPricingByTier);

// Protected admin routes
router.patch("/pricing/:tier", auth, requireAdmin, updatePricing);
router.post("/pricing/reset/defaults", auth, requireAdmin, resetPricingDefaults);
router.post("/pricing/bulk-update", auth, requireAdmin, bulkUpdatePricing);

module.exports = router;
