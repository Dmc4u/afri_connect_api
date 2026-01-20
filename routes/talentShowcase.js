const express = require("express");
const router = express.Router();
const showcaseController = require("../controllers/talentShowcase");
const authenticateToken = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const upload = require("../middlewares/upload");
const uploadTalentVideo = require("../middlewares/uploadTalentVideo");
const uploadChunk = require("../middlewares/uploadChunk");
const { paymentCreateLimiter } = require("../middlewares/rateLimiter");
const {
  validateShowcaseCreation,
  validateContestantRegistration,
  validateVote,
  validateShowcaseQuery,
  validateShowcaseId,
  validateContestantId,
  validateJudgeScore,
  validateCommercialUpload,
  validateCommercialDeletion,
  validateTimeAdjustment,
} = require("../middlewares/showcaseValidation");

// Admin check middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  next();
};

// ============ PUBLIC ROUTES ============

// Get all showcases (with filters)
router.get("/", optionalAuth, validateShowcaseQuery, showcaseController.getShowcases);

// Get showcase type (for routing) - MUST come before /:id route
router.get("/:id/type", async (req, res) => {
  try {
    const TalentShowcase = require("../models/TalentShowcase");
    const showcase = await TalentShowcase.findById(req.params.id).select("showcaseType");

    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    res.json({ showcaseType: showcase.showcaseType || "structured" });
  } catch (error) {
    console.error("Error fetching showcase type:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get structured timeline data for a showcase
router.get("/:id/timeline", showcaseController.getStructuredTimeline);

// Get single showcase by ID
router.get("/:id", validateShowcaseId, showcaseController.getShowcaseById);

// Get contestants for a showcase
router.get("/:showcaseId/contestants", showcaseController.getContestants); // Get leaderboard
router.get("/:showcaseId/leaderboard", showcaseController.getLeaderboard);

// ============ AUTHENTICATED ROUTES ============

// Cast vote (requires auth or IP-based voting if allowed)
router.post("/:showcaseId/vote", optionalAuth, validateVote, showcaseController.castVote);

// Upload talent video
router.post(
  "/upload-video",
  authenticateToken,
  uploadTalentVideo.single("video"),
  showcaseController.uploadTalentVideo
);

// Register as contestant
router.post(
  "/register",
  authenticateToken,
  validateContestantRegistration,
  showcaseController.registerContestant
);

// Update contestant registration (User can edit their own pending registration)
router.put(
  "/contestant/:id",
  authenticateToken,
  validateContestantId,
  showcaseController.updateContestantRegistration
);

// Get user's votes for a showcase
router.get("/:showcaseId/my-votes", authenticateToken, showcaseController.getUserVotes);

// Entry fee payment - Create PayPal order (before registration)
router.post(
  "/entry-fee/create-order",
  paymentCreateLimiter,
  authenticateToken,
  showcaseController.createEntryFeePayPalOrder
);

// ============ ADMIN ROUTES ============

// Create new showcase
router.post(
  "/admin/create",
  authenticateToken,
  requireAdmin,
  validateShowcaseCreation,
  showcaseController.createShowcase
);

// Update showcase
router.put(
  "/admin/:id",
  authenticateToken,
  requireAdmin,
  validateShowcaseId,
  showcaseController.updateShowcase
);

// Delete showcase
router.delete(
  "/admin/:id",
  authenticateToken,
  requireAdmin,
  validateShowcaseId,
  showcaseController.deleteShowcase
);

// Approve/Reject contestant
router.patch(
  "/admin/contestant/:id/status",
  authenticateToken,
  requireAdmin,
  validateContestantId,
  showcaseController.updateContestantStatus
);

// Set winner
router.post("/admin/set-winner", authenticateToken, requireAdmin, showcaseController.setWinner);

// Add judge score
router.post(
  "/admin/judge-score",
  authenticateToken,
  requireAdmin,
  validateJudgeScore,
  showcaseController.addJudgeScore
);

// Sponsorship request
router.post("/sponsor", authenticateToken, showcaseController.submitSponsorshipRequest);

// Get all sponsorship requests (Admin only)
router.get(
  "/admin/sponsorships",
  authenticateToken,
  requireAdmin,
  showcaseController.getSponsorshipRequests
);

// Get unread sponsorship count (Admin only)
router.get(
  "/admin/sponsorships/unread-count",
  authenticateToken,
  requireAdmin,
  showcaseController.getUnreadSponsorshipCount
);

// Mark sponsorship as viewed (Admin only)
router.patch(
  "/admin/sponsorships/:id/view",
  authenticateToken,
  requireAdmin,
  showcaseController.markSponsorshipViewed
);

// Update sponsorship status (Admin only)
router.patch(
  "/admin/sponsorships/:id/status",
  authenticateToken,
  requireAdmin,
  showcaseController.updateSponsorshipStatus
);

// Delete sponsorship request (Admin only)
router.delete(
  "/admin/sponsorships/:id",
  authenticateToken,
  requireAdmin,
  showcaseController.deleteSponsorshipRequest
);

// Get analytics
router.get(
  "/admin/:showcaseId/analytics",
  authenticateToken,
  requireAdmin,
  showcaseController.getShowcaseAnalytics
);

// Upload commercial video (Admin only)
router.post(
  "/admin/:showcaseId/upload-commercial",
  authenticateToken,
  requireAdmin,
  upload.single("commercialVideo"),
  validateCommercialUpload,
  showcaseController.uploadCommercialVideo
);

// Chunked commercial upload (Admin only) - for large files behind proxies/CDNs
router.post(
  "/admin/:showcaseId/upload-commercial/init",
  authenticateToken,
  requireAdmin,
  showcaseController.initCommercialUpload
);

router.post(
  "/admin/:showcaseId/upload-commercial/chunk",
  authenticateToken,
  requireAdmin,
  uploadChunk().single("chunk"),
  showcaseController.uploadCommercialChunk
);

router.post(
  "/admin/:showcaseId/upload-commercial/complete",
  authenticateToken,
  requireAdmin,
  showcaseController.completeCommercialUpload
);

// Delete commercial video (Admin only)
router.delete(
  "/admin/:showcaseId/delete-commercial/:commercialIndex",
  authenticateToken,
  requireAdmin,
  validateCommercialDeletion,
  showcaseController.deleteCommercialVideo
);

// Upload stream video (Admin only)
router.post(
  "/upload-stream",
  authenticateToken,
  requireAdmin,
  upload.single("streamVideo"),
  showcaseController.uploadStreamVideo
);

// Upload static image (Admin only)
router.post(
  "/upload-image",
  authenticateToken,
  requireAdmin,
  upload.single("staticImage"),
  showcaseController.uploadStaticImage
);

// ============ RAFFLE SELECTION ROUTES ============

// Execute raffle selection (Admin only)
router.post(
  "/admin/:showcaseId/execute-raffle",
  authenticateToken,
  requireAdmin,
  showcaseController.executeRaffle
);

// Get raffle results (Public - for transparency)
router.get("/:showcaseId/raffle-results", showcaseController.getRaffleResults);

// Verify raffle results (Public - anyone can verify)
router.get("/:showcaseId/verify-raffle", showcaseController.verifyRaffleResults);

// Get raffle status (Public)
router.get("/:showcaseId/raffle-status", showcaseController.getRaffleStatus);

// ============ LIVE EVENT CONTROL ROUTES (ADMIN ONLY) ============

// Auto-advance to next performance (PUBLIC - system triggered)
router.post("/:id/auto-advance-performance", showcaseController.advancePerformance);

// Signal that all commercials have completed (PUBLIC - system triggered)
router.post("/:id/commercials-complete", showcaseController.commercialsComplete);

// Advance to next performance (ADMIN - manual control)
router.post(
  "/admin/:id/advance-performance",
  authenticateToken,
  requireAdmin,
  showcaseController.advancePerformance
);

// Pause/Resume live event
router.patch(
  "/admin/:id/pause-resume",
  authenticateToken,
  requireAdmin,
  showcaseController.pauseResumeEvent
);

// Skip to specific stage
router.patch(
  "/admin/:id/skip-to-stage",
  authenticateToken,
  requireAdmin,
  showcaseController.skipToStage
);

// Extend stage time
router.post(
  "/admin/:id/extend-time",
  authenticateToken,
  requireAdmin,
  validateTimeAdjustment,
  showcaseController.extendStageTime
);

// Stop event
router.post("/admin/:id/stop-event", authenticateToken, requireAdmin, showcaseController.stopEvent);

// Restart event
router.post(
  "/admin/:id/restart-event",
  authenticateToken,
  requireAdmin,
  showcaseController.restartEvent
);

// Resume event from Performance phase
router.post(
  "/admin/:id/resume-performance",
  authenticateToken,
  requireAdmin,
  showcaseController.resumePerformancePhase
);

// Get live event control status
router.get(
  "/admin/:id/live-control",
  authenticateToken,
  requireAdmin,
  showcaseController.getLiveEventControl
);

// Control background music (play/stop)
router.patch("/admin/:id/music-control", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { action } = req.body;

    if (!action || !["play", "stop"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'action must be "play" or "stop"',
      });
    }

    const TalentShowcase = require("../models/TalentShowcase");
    const showcase = await TalentShowcase.findById(req.params.id);

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Update music playing state
    showcase.musicPlaying = action === "play";
    await showcase.save();

    res.json({
      success: true,
      message: `Music ${action === "play" ? "started" : "stopped"} successfully`,
      musicPlaying: showcase.musicPlaying,
    });
  } catch (error) {
    console.error("Error controlling music:", error);
    res.status(500).json({
      success: false,
      message: "Failed to control music",
      error: error.message,
    });
  }
});

module.exports = router;
