const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
const TalentShowcase = require("../models/TalentShowcase");

/**
 * Admin Event Timeline Configuration Routes
 * Allows admins to manage event phase durations and settings
 */

// Get event configuration template
router.get("/config/template", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    // Default configuration template - Production values
    // Note: These are defaults. Actual values come from showcase settings when creating timeline.
    const defaultConfig = {
      totalDuration: 60, // minutes (calculated based on performance count + phase durations)
      welcomeDuration: 5, // minutes (calculated from welcomeMessageDuration + rulesDuration + contestantsIntroDuration * count)
      performanceSlotDuration: 5, // minutes per contestant (actual video durations used when available)
      maxVideoLength: 3600, // seconds = 1 hour max per video
      commercialDuration: 2, // minutes (calculated from actual commercial video durations)
      votingDuration: 1, // minutes
      winnerDeclarationDuration: 1, // minutes
      thankYouDuration: 1, // minutes
      countdownDuration: 0, // instant completion (event ends immediately when thank you phase completes)
    };

    res.json({
      success: true,
      config: defaultConfig,
      phases: [
        { name: "welcome", description: "Welcome & Rules", defaultDuration: 5 },
        {
          name: "performance",
          description: "Contestant Performances (auto-calculated from video durations)",
          perContestant: 5,
        },
        { name: "commercial", description: "Commercial Break", defaultDuration: 2 },
        { name: "voting", description: "Voting Period", defaultDuration: 10 },
        { name: "winner", description: "Winner Declaration", defaultDuration: 3 },
        { name: "thankyou", description: "Thank You Message", defaultDuration: 2 },
        { name: "countdown", description: "Event Completion (instant)", defaultDuration: 0 },
      ],
    });
  } catch (error) {
    console.error("Error getting config template:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update event timeline configuration
router.put("/:showcaseId/config", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { showcaseId } = req.params;
    const { config } = req.body;

    // Validate config
    if (!config) {
      return res.status(400).json({ message: "Configuration is required" });
    }

    // Get showcase
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    // Find or create timeline
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      // Create new timeline with config - Use values from showcase model
      // Calculate welcome duration from granular fields (all in seconds)
      const welcomeMessageSec = showcase.welcomeMessageDuration ?? 5;
      const rulesSec = showcase.rulesDuration ?? 10;
      const perContestantSec = showcase.contestantsIntroDuration ?? 3;
      // Estimate contestant count for initial calculation (will be recalculated when performances are scheduled)
      const estimatedContestants = showcase.maxContestants || 5;
      const totalWelcomeSeconds =
        welcomeMessageSec + rulesSec + perContestantSec * estimatedContestants;
      const welcomeDurationMinutes = totalWelcomeSeconds / 60;

      timeline = new ShowcaseEventTimeline({
        showcase: showcaseId,
        config: {
          totalDuration: 60, // Will be recalculated after performances scheduled
          welcomeDuration: welcomeDurationMinutes, // Calculated from granular showcase settings
          performanceSlotDuration: showcase.performanceDuration || 5,
          maxVideoLength: 3600, // 1 hour max per video
          commercialDuration: showcase.commercialDuration || 2,
          votingDuration: showcase.votingDisplayDuration || 1,
          winnerDeclarationDuration: showcase.winnerDisplayDuration || 1,
          thankYouDuration: showcase.thankYouDuration || 1,
          countdownDuration: 0, // Instant completion (event ends after thank you)
          ...config, // Allow override from request body if provided
        },
        eventStatus: "scheduled",
        isLive: false,
        phases: [],
        performances: [],
      });
    } else {
      // Check if event is already live
      if (timeline.isLive) {
        return res.status(400).json({
          message: "Cannot modify configuration while event is live",
        });
      }

      // Update configuration
      timeline.config = {
        ...timeline.config,
        ...config,
      };
    }

    // Recalculate total duration based on actual configuration
    // NOTE: Countdown phase is excluded because it instantly completes the event
    const performanceDuration =
      timeline.performances.length *
      (timeline.config.performanceSlotDuration || showcase.performanceDuration || 5);
    timeline.config.totalDuration =
      (timeline.config.welcomeDuration || showcase.welcomeDuration || 5) +
      performanceDuration +
      (timeline.config.commercialDuration || showcase.commercialDuration || 2) +
      (timeline.config.votingDuration || showcase.votingDisplayDuration || 1) +
      (timeline.config.winnerDeclarationDuration || showcase.winnerDisplayDuration || 1) +
      (timeline.config.thankYouDuration || showcase.thankYouDuration || 1);
    // Countdown is NOT included - it instantly completes the event

    await timeline.save();

    res.json({
      success: true,
      message: "Event configuration saved successfully",
      config: timeline.config,
      totalDuration: timeline.config.totalDuration,
    });
  } catch (error) {
    console.error("Error updating config:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get current event configuration
router.get("/:showcaseId/config", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { showcaseId } = req.params;

    // Get showcase info
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    // Try to find existing timeline
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId }).populate(
      "showcase",
      "title eventDate"
    );

    // If no timeline exists, return default config based on showcase settings
    if (!timeline) {
      // Calculate welcome duration from granular fields (all in seconds)
      const welcomeMessageSec = showcase.welcomeMessageDuration ?? 5;
      const rulesSec = showcase.rulesDuration ?? 10;
      const perContestantSec = showcase.contestantsIntroDuration ?? 3;
      const estimatedContestants = showcase.maxContestants || 5;
      const totalWelcomeSeconds =
        welcomeMessageSec + rulesSec + perContestantSec * estimatedContestants;
      const welcomeDurationMinutes = totalWelcomeSeconds / 60;

      return res.json({
        success: true,
        showcase: { _id: showcase._id, title: showcase.title, eventDate: showcase.eventDate },
        config: {
          totalDuration: 60, // Will be calculated based on actual performance count
          welcomeDuration: welcomeDurationMinutes,
          performanceSlotDuration: showcase.performanceDuration || 5,
          maxVideoLength: 3600, // 1 hour max
          commercialDuration: showcase.commercialDuration || 2,
          votingDuration: showcase.votingDisplayDuration || 1,
          winnerDeclarationDuration: showcase.winnerDisplayDuration || 1,
          thankYouDuration: showcase.thankYouDuration || 1,
          countdownDuration: 0, // Instant completion
          musicUrl: showcase.musicUrl || null,
        },
        phases: [],
        totalDuration: 60,
        isLive: false,
        canEdit: true,
        timelineExists: false,
      });
    }

    res.json({
      success: true,
      showcase: timeline.showcase,
      config: {
        ...timeline.config,
        musicUrl: showcase.musicUrl || null,
      },
      phases: timeline.phases.map((p) => ({
        name: p.name,
        duration: p.duration,
        startTime: p.startTime,
        endTime: p.endTime,
        status: p.status,
      })),
      totalDuration: timeline.config.totalDuration,
      isLive: timeline.isLive,
      canEdit: !timeline.isLive,
      timelineExists: true,
    });
  } catch (error) {
    console.error("Error getting config:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update individual phase duration
router.put("/:showcaseId/config/phase/:phaseName", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { showcaseId, phaseName } = req.params;
    const { duration } = req.body;

    // Get showcase
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    // Handle music URL update separately (not a duration field)
    if (phaseName === "music") {
      showcase.musicUrl = duration; // 'duration' param is actually the musicUrl for this case
      await showcase.save();

      return res.json({
        success: true,
        message: "Event music URL updated successfully",
        musicUrl: showcase.musicUrl,
      });
    }

    if (!duration || duration <= 0) {
      return res.status(400).json({ message: "Valid duration is required (in minutes)" });
    }

    // Find or create timeline
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      // Create new timeline with default config
      timeline = new ShowcaseEventTimeline({
        showcase: showcaseId,
        config: {
          totalDuration: 60,
          welcomeDuration: 5,
          performanceSlotDuration: 5,
          maxVideoLength: 3600,
          commercialDuration: 5,
          votingDuration: 1,
          winnerDeclarationDuration: 1,
          thankYouDuration: 1,
        },
        eventStatus: "scheduled",
        isLive: false,
        phases: [],
        performances: [],
      });
    }

    if (timeline.isLive) {
      return res.status(400).json({ message: "Cannot modify configuration while event is live" });
    }

    // Update the specific phase duration in config
    const configMap = {
      welcome: "welcomeDuration",
      performance: "performanceSlotDuration",
      commercial: "commercialDuration",
      voting: "votingDuration",
      winner: "winnerDeclarationDuration",
      thankyou: "thankYouDuration",
    };

    const configKey = configMap[phaseName];
    if (!configKey) {
      return res.status(400).json({ message: "Invalid phase name" });
    }

    timeline.config[configKey] = duration;

    // Also update the showcase model fields so config persists if timeline is recreated
    const showcaseFieldMap = {
      welcome: "welcomeDuration",
      performance: "performanceDuration",
      commercial: "commercialDuration",
      voting: "votingDisplayDuration",
      winner: "winnerDisplayDuration",
      thankyou: "thankYouDuration",
    };

    const showcaseField = showcaseFieldMap[phaseName];
    if (showcaseField) {
      showcase[showcaseField] = duration;
      await showcase.save();
    }

    // Recalculate total duration
    const performanceDuration =
      timeline.performances.length * timeline.config.performanceSlotDuration;
    timeline.config.totalDuration =
      timeline.config.welcomeDuration +
      performanceDuration +
      timeline.config.commercialDuration +
      timeline.config.votingDuration +
      timeline.config.winnerDeclarationDuration +
      timeline.config.thankYouDuration;

    // Regenerate timeline
    timeline.generateTimeline();

    await timeline.save();

    res.json({
      success: true,
      message: `${phaseName} duration updated to ${duration} minutes`,
      config: timeline.config,
      totalDuration: timeline.config.totalDuration,
      phases: timeline.phases,
    });
  } catch (error) {
    console.error("Error updating phase duration:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all event timelines (admin overview)
router.get("/all", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const timelines = await ShowcaseEventTimeline.find()
      .populate("showcase", "title eventDate status")
      .sort({ createdAt: -1 });

    const summary = timelines.map((t) => ({
      id: t._id,
      showcase: t.showcase,
      eventStatus: t.eventStatus,
      isLive: t.isLive,
      totalDuration: t.config.totalDuration,
      viewerCount: t.viewerCount,
      peakViewerCount: t.peakViewerCount,
      currentPhase: t.currentPhase,
      phasesCompleted: t.phases.filter((p) => p.status === "completed").length,
      totalPhases: t.phases.length,
      createdAt: t.createdAt,
    }));

    res.json({
      success: true,
      count: timelines.length,
      timelines: summary,
    });
  } catch (error) {
    console.error("Error getting all timelines:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete event timeline (before it goes live)
router.delete("/:showcaseId", auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { showcaseId } = req.params;
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    if (timeline.isLive) {
      return res.status(400).json({
        message: "Cannot delete timeline while event is live. Use end event instead.",
      });
    }

    await ShowcaseEventTimeline.deleteOne({ _id: timeline._id });

    res.json({
      success: true,
      message: "Event timeline deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting timeline:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
