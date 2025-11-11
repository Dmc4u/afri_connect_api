const express = require("express");
const { celebrate, Joi } = require("celebrate");
const {
  getMembershipTiers,
  getCurrentMembership,
  upgradeMembership,
  captureMembershipPayment,
  cancelMembership,
  getMembershipBenefits,
  getMembershipStats,
  adminSetUserTier,
} = require("../controllers/membership");
const auth = require("../middlewares/auth");

const router = express.Router();

// Validation schemas
const upgradeMembershipValidation = celebrate({
  body: Joi.object().keys({
    tier: Joi.string().valid("Starter", "Premium", "Pro").required(),
  }),
});

const capturePaymentValidation = celebrate({
  body: Joi.object().keys({
    orderId: Joi.string().required(),
  }),
});

const tierValidation = celebrate({
  params: Joi.object().keys({
    tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").required(),
  }),
});

const adminUpdateTierValidation = celebrate({
  body: Joi.object().keys({
    userId: Joi.string().required(),
    tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").required(),
    reason: Joi.string().allow("", null),
  }),
});

// Public routes
router.get("/tiers", getMembershipTiers);
router.get("/benefits/:tier", tierValidation, getMembershipBenefits);

// Protected routes (require authentication)
router.use(auth);

router.get("/current", getCurrentMembership);
router.post("/upgrade", upgradeMembershipValidation, upgradeMembership);
router.post("/capture-payment", capturePaymentValidation, captureMembershipPayment);
router.post("/cancel", cancelMembership);

// Admin routes
router.get("/stats", getMembershipStats); // Admin access check is inside controller
router.post("/admin/update-tier", adminUpdateTierValidation, adminSetUserTier);

module.exports = router;
