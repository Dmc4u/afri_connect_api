const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const TalentShowcase = require("../models/TalentShowcase");
const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

/**
 * Admin utility endpoint to fix showcase durations
 * POST /api/admin/fix-durations
 */
router.post("/fix-durations", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    console.log("🔧 Admin triggered showcase duration fix...");

    const showcases = await TalentShowcase.find({});

    let updatedShowcases = 0;
    let updatedTimelines = 0;
    const updates = [];

    for (const showcase of showcases) {
      let needsUpdate = false;
      const showcaseUpdates = {};

      // Check and fix each duration field using model defaults
      if (showcase.welcomeDuration === undefined || showcase.welcomeDuration === null) {
        showcaseUpdates.welcomeDuration = 5;
        needsUpdate = true;
      }

      if (showcase.votingDisplayDuration === undefined || showcase.votingDisplayDuration === null) {
        showcaseUpdates.votingDisplayDuration = 10;
        needsUpdate = true;
      }

      if (showcase.winnerDisplayDuration === undefined || showcase.winnerDisplayDuration === null) {
        showcaseUpdates.winnerDisplayDuration = 5;
        needsUpdate = true;
      }

      if (showcase.thankYouDuration === undefined || showcase.thankYouDuration === null) {
        showcaseUpdates.thankYouDuration = 2;
        needsUpdate = true;
      }

      if (showcase.commercialDuration === undefined || showcase.commercialDuration === null) {
        showcaseUpdates.commercialDuration = 2;
        needsUpdate = true;
      }

      if (showcase.performanceDuration === undefined || showcase.performanceDuration === null) {
        showcaseUpdates.performanceDuration = 5;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await TalentShowcase.findByIdAndUpdate(showcase._id, showcaseUpdates);
        updatedShowcases++;

        // Also update timeline if it exists and isn't live
        const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
        if (timeline && !timeline.isLive) {
          let timelineNeedsUpdate = false;

          // Update timeline config to match showcase
          if (showcaseUpdates.welcomeDuration !== undefined) {
            timeline.config.welcomeDuration = showcaseUpdates.welcomeDuration;
            timelineNeedsUpdate = true;
          }

          if (showcaseUpdates.votingDisplayDuration !== undefined) {
            timeline.config.votingDuration = showcaseUpdates.votingDisplayDuration;
            timelineNeedsUpdate = true;
          }

          if (showcaseUpdates.winnerDisplayDuration !== undefined) {
            timeline.config.winnerDeclarationDuration = showcaseUpdates.winnerDisplayDuration;
            timelineNeedsUpdate = true;
          }

          if (showcaseUpdates.thankYouDuration !== undefined) {
            timeline.config.thankYouDuration = showcaseUpdates.thankYouDuration;
            timelineNeedsUpdate = true;
          }

          if (showcaseUpdates.commercialDuration !== undefined) {
            timeline.config.commercialDuration = showcaseUpdates.commercialDuration;
            timelineNeedsUpdate = true;
          }

          if (timelineNeedsUpdate) {
            timeline.showcase = showcase;
            timeline.generateTimeline();
            await timeline.save();
            updatedTimelines++;
          }
        }

        updates.push({
          showcaseId: showcase._id,
          title: showcase.title,
          updates: showcaseUpdates,
        });
      }
    }

    res.json({
      success: true,
      message: "Showcase durations fixed successfully",
      showcasesUpdated: updatedShowcases,
      timelinesUpdated: updatedTimelines,
      totalScanned: showcases.length,
      updates,
    });
  } catch (error) {
    console.error("Error fixing showcase durations:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
