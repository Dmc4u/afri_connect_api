/**
 * Universal Payment Routes
 * Centralized routes for all payment types
 */

const express = require("express");
const { createUniversalOrder, captureUniversalOrder, getAdminDonations, getAdminAdvertising, deleteDonation, deleteAdvertising } = require("../controllers/universalPayment");
const auth = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const adminAuth = require("../middlewares/adminAuth");
const { paymentCreateLimiter, paymentCaptureLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// Create order for any payment type (optional auth for donations)
router.post("/create-order", paymentCreateLimiter, optionalAuth, createUniversalOrder);

// Capture order after PayPal approval (optional auth for donations)
router.post("/capture-order", paymentCaptureLimiter, optionalAuth, captureUniversalOrder);

// Admin: Get all donations
router.get("/admin/donations", auth, adminAuth, getAdminDonations);

// Admin: Delete donation
router.delete("/admin/donations/:id", auth, adminAuth, deleteDonation);

// Admin: Get all advertising records
router.get("/admin/advertising", auth, adminAuth, getAdminAdvertising);

// Admin: Delete advertising record
router.delete("/admin/advertising/:id", auth, adminAuth, deleteAdvertising);

module.exports = router;
