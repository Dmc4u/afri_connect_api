const express = require("express");
const { celebrate, Joi } = require("celebrate");
const auth = require("../middlewares/auth");
const adminAuth = require("../middlewares/adminAuth");
const {
  getRewardSummary,
  createRewardClaim,
  listClaims,
  reviewClaim,
} = require("../controllers/rewards");

const router = express.Router();
router.get("/me", auth, getRewardSummary);
router.post(
  "/claims",
  auth,
  celebrate({
    body: Joi.object().keys({
      rewardType: Joi.string().valid("featured_credit", "advertising_credit", "cash_review").required(),
      note: Joi.string().trim().max(500).allow("").optional(),
    }),
  }),
  createRewardClaim
);
router.get("/admin/claims", auth, adminAuth, listClaims);
router.patch(
  "/admin/claims/:id",
  auth,
  adminAuth,
  celebrate({
    params: Joi.object().keys({ id: Joi.string().hex().length(24).required() }),
    body: Joi.object().keys({ status: Joi.string().valid("approved", "rejected").required() }),
  }),
  reviewClaim
);

module.exports = router;
