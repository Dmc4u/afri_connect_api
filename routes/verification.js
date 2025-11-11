const express = require("express");
const auth = require("../middlewares/auth");
const { requireVerifiedBadgeAccess } = require("../middlewares/tierCheck");
const Verification = require("../models/Verification");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");

const router = express.Router();

/**
 * POST /verification - Apply for verified badge (Pro only)
 */
router.post("/", auth, requireVerifiedBadgeAccess, (req, res, next) => {
  const { businessName, businessRegistration } = req.body;

  if (!businessName || !businessRegistration) {
    return next(new BadRequestError("Business name and registration number are required"));
  }

  return Verification.findOne({ userId: req.user._id })
    .then((existingVerification) => {
      if (existingVerification) {
        return res.status(400).send({
          message: "You already have a verification application",
          verification: existingVerification,
        });
      }

      return Verification.create({
        userId: req.user._id,
        businessName,
        businessRegistration,
        verificationStatus: "pending",
      });
    })
    .then((verification) => {
      return res.status(201).send({
        verification,
        message: "Verification application submitted (Pro feature)",
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
});

/**
 * GET /verification - Get verification status (Pro only)
 */
router.get("/", auth, requireVerifiedBadgeAccess, (req, res, next) => {
  return Verification.findOne({ userId: req.user._id })
    .then((verification) => {
      if (!verification) {
        return res.send({
          verification: null,
          message: "No verification application found",
        });
      }

      return res.send({
        verification,
        message: "Verification status retrieved (Pro feature)",
      });
    })
    .catch((err) => next(err));
});

/**
 * PATCH /verification - Update verification application (Pro only)
 */
router.patch("/", auth, requireVerifiedBadgeAccess, (req, res, next) => {
  const { businessName, businessRegistration } = req.body;

  return Verification.findOne({ userId: req.user._id })
    .then((verification) => {
      if (!verification) {
        return next(new NotFoundError("No verification application found"));
      }

      if (verification.verificationStatus !== "pending") {
        return next(new ForbiddenError("Can only update pending verification applications"));
      }

      if (businessName) verification.businessName = businessName;
      if (businessRegistration) verification.businessRegistration = businessRegistration;

      return verification.save();
    })
    .then((verification) => {
      return res.send({
        verification,
        message: "Verification application updated (Pro feature)",
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
});

/**
 * DELETE /verification - Withdraw verification application (Pro only)
 */
router.delete("/", auth, requireVerifiedBadgeAccess, (req, res, next) => {
  return Verification.findOne({ userId: req.user._id })
    .then((verification) => {
      if (!verification) {
        return next(new NotFoundError("No verification application found"));
      }

      if (verification.verificationStatus === "approved") {
        return next(new ForbiddenError("Cannot withdraw approved verification"));
      }

      return verification.deleteOne();
    })
    .then(() => {
      return res.send({
        message: "Verification application withdrawn (Pro feature)",
      });
    })
    .catch((err) => next(err));
});

module.exports = router;
