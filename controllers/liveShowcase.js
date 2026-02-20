const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
const TalentShowcase = require("../models/TalentShowcase");
const TalentContestant = require("../models/TalentContestant");

const DEFAULT_VIEWER_COUNT_BASE = 2000;

function getViewerCountBase(timeline) {
  const base = Number(timeline?.viewerCountBase);
  return Number.isFinite(base) && base >= 0 ? base : DEFAULT_VIEWER_COUNT_BASE;
}

function computeDisplayedViewerCount(timeline) {
  const base = getViewerCountBase(timeline);
  const active = Array.isArray(timeline?.activeViewers) ? timeline.activeViewers.length : 0;
  return base + active;
}

function isAdminUser(user) {
  return !!user && (user.role === "admin" || user.isAdmin === true);
}

/**
 * Live Showcase Event Controller
 * Manages real-time event flow with automatic phase transitions
 */

// Initialize event timeline for a showcase
exports.initializeEventTimeline = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    // Get all contestants for this showcase (sorted by votes for performance order)
    const contestants = await TalentContestant.find({
      showcase: showcaseId,
      status: { $in: ["approved", "selected"] }, // Accept both approved AND selected contestants
    })
      .sort({ voteCount: -1 })
      .limit(5);

    if (contestants.length === 0) {
      return res
        .status(400)
        .json({ message: "No approved or selected contestants found for this showcase" });
    }

    console.log(`🎬 Found ${contestants.length} contestants for initialization`);
    contestants.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.performanceTitle} - Duration: ${c.videoDuration}s`);
    });

    // Check if timeline already exists
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (timeline && timeline.performances && timeline.performances.length > 0) {
      // Timeline exists with performances already scheduled
      return res.status(400).json({
        message: "Event timeline already exists with scheduled performances",
        timeline,
        performancesCount: timeline.performances.length,
      });
    }

    // If timeline exists but NO performances, we'll reschedule them
    if (timeline && (!timeline.performances || timeline.performances.length === 0)) {
      console.log("⚠️  Timeline exists but no performances scheduled. Rescheduling...");

      // Regenerate timeline
      // Ensure generateTimeline() can access showcase.commercials if present
      timeline.showcase = showcase;
      timeline.generateTimeline();

      // Schedule performances
      timeline.schedulePerformances(contestants);

      await timeline.save();

      console.log(`✅ Rescheduled ${timeline.performances.length} performances`);

      return res.status(200).json({
        message: "Performances scheduled successfully",
        timeline,
        totalContestants: contestants.length,
        performancesScheduled: timeline.performances.length,
      });
    }

    // Create new timeline with showcase configured durations
    timeline = new ShowcaseEventTimeline({
      showcase: showcaseId,
      config: {
        welcomeDuration: showcase.welcomeDuration ?? 5,
        performanceSlotDuration: showcase.performanceDuration || 0, // Total performance duration from actual video lengths
        commercialDuration: showcase.commercialDuration || 0,
        votingDuration: showcase.votingDisplayDuration || 3,
        winnerDeclarationDuration: showcase.winnerDisplayDuration || 3,
        thankYouDuration: showcase.thankYouDuration || 2,
      },
      welcomeMessage: {
        title: showcase.welcomeMessage || `Welcome to ${showcase.title}!`,
        message:
          showcase.rulesMessage ||
          `Get ready for amazing talent! We have ${contestants.length} incredible contestants competing.`,
        rules: showcase.rulesMessage ? showcase.rulesMessage.split("\n") : [],
      },
      thankYouMessage: {
        title: "Thank You for Joining Us!",
        message:
          showcase.thankYouMessage ||
          `Thank you for being part of ${showcase.title}! See you next month!`,
        nextEventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Generate timeline phases
    // Ensure generateTimeline() can access showcase.commercials if present
    timeline.showcase = showcase;
    timeline.generateTimeline();

    // Schedule contestant performances
    timeline.schedulePerformances(contestants);

    await timeline.save();

    // Do not force the showcase into "live" during initialization.
    // Initialization prepares the schedule; going live is handled by the start endpoint
    // (or the timeline auto-initialize when the scheduled time has passed).

    res.status(201).json({
      message: "Event timeline initialized successfully",
      timeline,
      totalContestants: contestants.length,
      estimatedDuration: `${timeline.config.totalDuration} minutes`,
    });
  } catch (error) {
    console.error("Error initializing event timeline:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reschedule performances for an existing timeline
exports.reschedulePerformances = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res
        .status(404)
        .json({ message: "Event timeline not found. Please initialize first." });
    }

    // Get all contestants for this showcase
    const contestants = await TalentContestant.find({
      showcase: showcaseId,
      status: { $in: ["approved", "selected"] }, // Accept both approved AND selected contestants
    }).sort({ voteCount: -1 });

    if (contestants.length === 0) {
      return res
        .status(400)
        .json({ message: "No approved or selected contestants found for this showcase" });
    }

    console.log(`🔄 Rescheduling performances for ${contestants.length} contestants...`);

    // Clear existing performances
    timeline.performances = [];

    // Reschedule all performances
    timeline.schedulePerformances(contestants);

    await timeline.save();

    console.log(`✅ Rescheduled ${timeline.performances.length} performances`);

    res.json({
      success: true,
      message: "Performances rescheduled successfully",
      performancesCount: timeline.performances.length,
      contestants: contestants.map((c) => ({
        name: c.performanceTitle,
        videoDuration: c.videoDuration,
      })),
    });
  } catch (error) {
    console.error("Error rescheduling performances:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Start the live event
exports.startLiveEvent = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res
        .status(404)
        .json({ message: "Event timeline not found. Please initialize first." });
    }

    if (timeline.isLive) {
      return res.status(400).json({ message: "Event is already live" });
    }

    // Start the event now and REBASE the entire schedule so timers match the configured durations.
    // Previously only the welcome phase was rebased, causing later phase timers to drift.
    const now = new Date();
    timeline.actualStartTime = now;
    timeline.isLive = true;
    timeline.eventStatus = "live";
    timeline.currentPhase = "welcome";
    timeline.isPaused = false;
    timeline.pausedAt = null;
    timeline.pausedBy = null;

    // Rebase phases sequentially from "now".
    let cursor = new Date(now);
    if (Array.isArray(timeline.phases) && timeline.phases.length > 0) {
      timeline.phases.forEach((phase, index) => {
        phase.status = index === 0 ? "active" : "pending";
      });

      for (let i = 0; i < timeline.phases.length; i++) {
        const phase = timeline.phases[i];
        phase.startTime = new Date(cursor);

        if (phase.name === "countdown") {
          // Countdown is continuous. Preserve a future endTime if it exists; otherwise default to 30 days.
          const existingEnd = phase.endTime ? new Date(phase.endTime) : null;
          const fallbackEnd = new Date(cursor.getTime() + 30 * 24 * 60 * 60 * 1000);
          phase.endTime = existingEnd && existingEnd > cursor ? existingEnd : fallbackEnd;
          cursor = new Date(phase.endTime);
          break;
        }

        const minutes = Number(phase.duration);
        const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
        phase.endTime = new Date(cursor.getTime() + safeMinutes * 60000);
        cursor = new Date(phase.endTime);
      }

      // Rebase performances to the (new) performance phase startTime.
      const performancePhase = timeline.phases.find((p) => p?.name === "performance");
      if (performancePhase?.startTime && Array.isArray(timeline.performances)) {
        const fallbackSeconds = (timeline.config?.performanceSlotDuration || 5) * 60;
        const sorted = timeline.performances
          .slice()
          .sort((a, b) => Number(a?.performanceOrder || 0) - Number(b?.performanceOrder || 0));

        let perfCursor = new Date(performancePhase.startTime);
        sorted.forEach((perf) => {
          const seconds = Number(perf?.videoDuration);
          const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds;
          perf.videoDuration = safeSeconds;
          perf.status = "pending";
          perf.startTime = new Date(perfCursor);
          perf.endTime = new Date(perfCursor.getTime() + safeSeconds * 1000);
          perfCursor = new Date(perf.endTime);
        });

        // Ensure performance phase end matches the last performance end.
        performancePhase.endTime = new Date(perfCursor);
        performancePhase.duration =
          (new Date(performancePhase.endTime).getTime() -
            new Date(performancePhase.startTime).getTime()) /
          60000;

        // Rebase phases AFTER performance so everything stays contiguous.
        const perfIndex = timeline.phases.findIndex((p) => p?.name === "performance");
        if (perfIndex >= 0) {
          cursor = new Date(performancePhase.endTime);
          for (let i = perfIndex + 1; i < timeline.phases.length; i++) {
            const ph = timeline.phases[i];
            ph.startTime = new Date(cursor);
            if (ph.name === "countdown") {
              const existingEnd = ph.endTime ? new Date(ph.endTime) : null;
              const fallbackEnd = new Date(cursor.getTime() + 30 * 24 * 60 * 60 * 1000);
              ph.endTime = existingEnd && existingEnd > cursor ? existingEnd : fallbackEnd;
              break;
            }
            const minutes = Number(ph.duration);
            const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
            ph.endTime = new Date(cursor.getTime() + safeMinutes * 60000);
            cursor = new Date(ph.endTime);
          }
        }
      }
    }

    await timeline.save();

    // Update showcase status
    await TalentShowcase.findByIdAndUpdate(showcaseId, {
      status: "live",
      liveStartTime: now,
    });

    res.json({
      message: "Live event started successfully",
      timeline,
      currentPhase: timeline.phases[0],
    });
  } catch (error) {
    console.error("Error starting live event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// NOTE: getEventStatus() removed - unused duplicate code
// Frontend exclusively uses /talent-showcase/:id/timeline endpoint
// See: talentShowcaseController.getStructuredTimeline() for single source of truth

// Advance to next phase (manual or automatic)
exports.advanceToNextPhase = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    // Don't advance if event is already completed or not live
    if (timeline.eventStatus === "completed" || !timeline.isLive) {
      return res.status(400).json({
        message: "Cannot advance phases - event is not live",
        eventStatus: timeline.eventStatus,
        isLive: timeline.isLive,
      });
    }

    const nextPhase = timeline.advancePhase();

    if (!nextPhase) {
      // Event ended
      timeline.actualEndTime = new Date();
      timeline.isLive = false;

      await timeline.save();

      // Update showcase to completed
      await TalentShowcase.findByIdAndUpdate(showcaseId, {
        status: "completed",
        endDate: new Date(),
      });

      return res.json({
        message: "Event completed successfully",
        timeline,
      });
    }

    // Special handling for voting phase
    if (nextPhase.name === "voting") {
      await TalentShowcase.findByIdAndUpdate(showcaseId, {
        status: "voting",
        votingEndTime: nextPhase.endTime,
      });
    }

    await timeline.save();

    res.json({
      message: `Advanced to ${nextPhase.name} phase`,
      currentPhase: nextPhase,
      timeline,
    });
  } catch (error) {
    console.error("Error advancing phase:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Declare winner (during winner phase)
exports.declareWinner = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    if (timeline.currentPhase !== "winner") {
      return res.status(400).json({
        message: "Can only declare winner during winner phase",
        currentPhase: timeline.currentPhase,
      });
    }

    // Get all contestants sorted by votes
    const contestants = await TalentContestant.find({ showcase: showcaseId })
      .sort({ votes: -1, _id: 1 })
      .populate("listing")
      .populate("user");

    if (contestants.length === 0) {
      timeline.winnerAnnouncement = {
        totalVotes: 0,
        prizeDetails: req.body.prizeDetails || "Grand Prize Winner! - No contestants participated",
        announcementTime: new Date(),
        noWinner: true,
      };
      await timeline.save();
      return res.status(404).json({ message: "No contestants found" });
    }

    // Check if there are any votes at all
    const totalVotes = contestants.reduce((sum, c) => sum + (c.votes || 0), 0);
    const highestVotes = contestants[0].votes || 0;

    // Check for tie at the top
    const tiedContestants = contestants.filter((c) => (c.votes || 0) === highestVotes);

    if (tiedContestants.length > 1) {
      // TIE - No winner declared
      timeline.winnerAnnouncement = {
        totalVotes: highestVotes,
        prizeDetails: `TIE - ${tiedContestants.length} contestants tied with ${highestVotes} votes each. No winner can be declared.`,
        announcementTime: new Date(),
        isTie: true,
        noWinner: true,
        tiedContestants: tiedContestants.map((c) => ({
          id: c._id,
          name: c.performanceTitle,
          performer: c.user?.name,
          votes: c.votes,
        })),
      };
      await timeline.save();

      return res.json({
        message: "Tie detected - No winner declared",
        tie: true,
        tiedContestants: tiedContestants.map((c) => ({
          id: c._id,
          name: c.performanceTitle,
          performer: c.user?.name,
          votes: c.votes,
        })),
        announcement: timeline.winnerAnnouncement,
      });
    }

    // If no votes at all, don't declare a winner (changed from random selection)
    if (totalVotes === 0) {
      timeline.winnerAnnouncement = {
        totalVotes: 0,
        prizeDetails:
          req.body.prizeDetails || "Grand Prize Winner! - No votes were cast, no winner declared",
        announcementTime: new Date(),
        noWinner: true,
      };
      await timeline.save();

      return res.json({
        message: "No votes cast - No winner declared",
        noWinner: true,
        announcement: timeline.winnerAnnouncement,
      });
    }

    // Clear winner exists
    const winner = contestants[0];

    // Update timeline with winner
    timeline.winnerAnnouncement = {
      winner: winner._id,
      totalVotes: winner.votes,
      prizeDetails: req.body.prizeDetails || "Grand Prize Winner!",
      announcementTime: new Date(),
    };

    // Mark winner in contestant record
    winner.isWinner = true;
    winner.wonAt = new Date();
    await winner.save();

    // Auto-feature winner (and update winner label/description)
    const { autoFeatureWinner } = require("../utils/featuredHelper");
    const featuredResult = await autoFeatureWinner(winner);

    await timeline.save();

    res.json({
      message: "Winner declared successfully",
      winner: {
        id: winner._id,
        name: winner.performanceTitle,
        votes: winner.votes,
        featured: Boolean(featuredResult?.listing || featuredResult?.placement),
      },
      announcement: timeline.winnerAnnouncement,
    });
  } catch (error) {
    console.error("Error declaring winner:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update viewer count
exports.updateViewerCount = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { count } = req.body;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    // Allow manual override while still supporting "active sessions" reporting.
    const base = getViewerCountBase(timeline);
    const n = Number(count) || 0;
    const displayed = n >= base ? n : base + n;

    // Persist base if missing on older docs
    if (timeline.viewerCountBase === undefined || timeline.viewerCountBase === null) {
      timeline.viewerCountBase = base;
    }

    timeline.viewerCount = displayed;
    timeline.peakViewerCount = Math.max(timeline.peakViewerCount || 0, displayed);

    await timeline.save();

    // Emit viewer count update via WebSocket
    const io = req.app.locals.io;
    if (io) {
      io.to(`showcase-${showcaseId}`).emit("viewerCountUpdate", {
        viewerCount: timeline.viewerCount,
        peakViewerCount: timeline.peakViewerCount,
      });
    }

    res.json({
      viewerCount: timeline.viewerCount,
      peakViewerCount: timeline.peakViewerCount,
    });
  } catch (error) {
    console.error("Error updating viewer count:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Join live event (viewer tracking)
exports.joinLiveEvent = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { viewerSessionId } = req.body;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    if (!timeline.isLive) {
      return res.status(400).json({ message: "Event is not currently live" });
    }

    // Initialize activeViewers array if it doesn't exist
    if (!timeline.activeViewers) {
      timeline.activeViewers = [];
    }

    // Add viewer session if not already present
    if (viewerSessionId && !timeline.activeViewers.includes(viewerSessionId)) {
      timeline.activeViewers.push(viewerSessionId);
    }

    // Update viewer count based on unique sessions + baseline
    const base = getViewerCountBase(timeline);
    if (timeline.viewerCountBase === undefined || timeline.viewerCountBase === null) {
      timeline.viewerCountBase = base;
    }
    const displayed = computeDisplayedViewerCount(timeline);
    timeline.viewerCount = displayed;
    timeline.peakViewerCount = Math.max(timeline.peakViewerCount || 0, displayed);

    await timeline.save();

    // Emit viewer count update
    const io = req.app.locals.io;
    if (io) {
      io.to(`showcase-${showcaseId}`).emit("viewerCountUpdate", {
        viewerCount: timeline.viewerCount,
        peakViewerCount: timeline.peakViewerCount,
      });
    }

    res.json({
      success: true,
      viewerCount: timeline.viewerCount,
      message: "Joined live event",
    });
  } catch (error) {
    console.error("Error joining live event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Leave live event (viewer tracking)
exports.leaveLiveEvent = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { viewerSessionId } = req.body;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    // Initialize activeViewers array if it doesn't exist
    if (!timeline.activeViewers) {
      timeline.activeViewers = [];
    }

    // Remove viewer session from active viewers
    if (viewerSessionId) {
      timeline.activeViewers = timeline.activeViewers.filter((id) => id !== viewerSessionId);
    }

    // Update viewer count based on unique sessions + baseline
    const base = getViewerCountBase(timeline);
    if (timeline.viewerCountBase === undefined || timeline.viewerCountBase === null) {
      timeline.viewerCountBase = base;
    }
    const displayed = computeDisplayedViewerCount(timeline);
    timeline.viewerCount = displayed;
    timeline.peakViewerCount = Math.max(timeline.peakViewerCount || 0, displayed);

    await timeline.save();

    // Emit viewer count update
    const io = req.app.locals.io;
    if (io) {
      io.to(`showcase-${showcaseId}`).emit("viewerCountUpdate", {
        viewerCount: timeline.viewerCount,
        peakViewerCount: timeline.peakViewerCount,
      });
    }

    res.json({
      success: true,
      viewerCount: timeline.viewerCount,
      message: "Left live event",
    });
  } catch (error) {
    console.error("Error leaving live event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update baseline viewers (admin only)
exports.updateViewerCountBase = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    if (!isAdminUser(req.user)) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const raw = req.body?.viewerCountBase ?? req.body?.base ?? req.body?.count;
    const nextBase = Number(raw);
    if (!Number.isFinite(nextBase) || nextBase < 0) {
      return res.status(400).json({ message: "viewerCountBase must be a non-negative number" });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    timeline.viewerCountBase = Math.floor(nextBase);
    timeline.viewerCount = computeDisplayedViewerCount(timeline);
    timeline.peakViewerCount = Math.max(timeline.peakViewerCount || 0, timeline.viewerCount);

    await timeline.save();

    const io = req.app.locals.io;
    if (io) {
      io.to(`showcase-${showcaseId}`).emit("viewerCountUpdate", {
        viewerCountBase: timeline.viewerCountBase,
        viewerCount: timeline.viewerCount,
        peakViewerCount: timeline.peakViewerCount,
      });
    }

    res.json({
      viewerCountBase: timeline.viewerCountBase,
      viewerCount: timeline.viewerCount,
      peakViewerCount: timeline.peakViewerCount,
    });
  } catch (error) {
    console.error("Error updating viewerCountBase:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// End event (emergency stop)
exports.endEvent = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    // Use atomic update to prevent race conditions
    const timeline = await ShowcaseEventTimeline.findOneAndUpdate(
      { showcase: showcaseId },
      {
        $set: {
          isLive: false,
          actualEndTime: new Date(),
          eventStatus: "completed",
          currentPhase: "ended",
          "phases.$[].status": "completed",
          "performances.$[].status": "completed",
          currentPerformance: null,
        },
      },
      { new: true }
    );

    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    await TalentShowcase.findByIdAndUpdate(showcaseId, {
      status: "completed",
      endDate: new Date(),
    });

    console.log(`🛑 Event manually ended: ${showcaseId}`);

    res.json({
      message: "Event ended successfully",
      timeline,
    });
  } catch (error) {
    console.error("Error ending event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Restart event
exports.restartEvent = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    // Reset all phases to pending except Welcome which should be active
    const now = new Date();
    timeline.phases.forEach((phase, index) => {
      if (index === 0) {
        // Welcome phase - set it active
        phase.status = "active";
        phase.startTime = now;
        phase.endTime = new Date(now.getTime() + phase.duration * 60 * 1000);
      } else {
        // All other phases - reset to pending
        phase.status = "pending";
        phase.startTime = null;
        phase.endTime = null;
      }
    });

    // Reset performances to pending
    timeline.performances.forEach((performance) => {
      performance.status = "pending";
      performance.performanceStartTime = null;
      performance.performanceEndTime = null;
    });

    // Reset event state
    timeline.isLive = true;
    timeline.eventStatus = "live";
    timeline.currentPhase = "welcome";
    timeline.currentPerformance = null;
    timeline.actualStartTime = now;
    timeline.actualEndTime = null;

    await timeline.save();

    // Update showcase status
    await TalentShowcase.findByIdAndUpdate(showcaseId, {
      status: "live",
    });

    console.log(`🔄 Event restarted: ${showcaseId}`);

    res.json({
      success: true,
      message: "Event restarted successfully",
      timeline,
    });
  } catch (error) {
    console.error("Error restarting event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete timeline completely (for testing/reset)
exports.deleteTimeline = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const result = await ShowcaseEventTimeline.findOneAndDelete({ showcase: showcaseId });

    if (!result) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    console.log(`🗑️  Timeline deleted for showcase: ${showcaseId}`);

    res.json({
      success: true,
      message: "Timeline deleted successfully. You can now reinitialize.",
    });
  } catch (error) {
    console.error("Error deleting timeline:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get event analytics
exports.getEventAnalytics = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId }).populate(
      "performances.contestant"
    );

    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    const contestants = await TalentContestant.find({ showcase: showcaseId }).sort({
      voteCount: -1,
    });

    const totalVotes = contestants.reduce((sum, c) => sum + c.voteCount, 0);

    const analytics = {
      eventDuration: timeline.actualEndTime
        ? Math.floor((timeline.actualEndTime - timeline.actualStartTime) / 60000)
        : null,
      peakViewers: timeline.peakViewerCount,
      totalContestants: contestants.length,
      totalVotes,
      votesPerContestant: contestants.map((c) => ({
        name: c.name,
        votes: c.voteCount,
        percentage: totalVotes > 0 ? ((c.voteCount / totalVotes) * 100).toFixed(1) : 0,
      })),
      winner: timeline.winnerAnnouncement?.winner
        ? {
            id: timeline.winnerAnnouncement.winner,
            votes: timeline.winnerAnnouncement.totalVotes,
          }
        : null,
      phasesCompleted: timeline.phases.filter((p) => p.status === "completed").length,
      eventStatus: timeline.eventStatus,
    };

    res.json(analytics);
  } catch (error) {
    console.error("Error getting event analytics:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Vote for contestant
exports.voteForContestant = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { contestantId } = req.body;
    const userId = req.user?._id;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!contestantId) {
      return res.status(400).json({ message: "Contestant ID is required" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Get event timeline
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: "Event timeline not found" });
    }

    // Check if voting phase is active
    const votingPhase = timeline.phases.find((p) => p.name === "voting");
    if (!votingPhase || votingPhase.status !== "active") {
      return res.status(400).json({ message: "Voting is not currently open" });
    }

    // Check showcase voting rules
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: "Showcase not found" });
    }

    // Find contestant (during live voting, accept approved/selected)
    const contestant = await TalentContestant.findOne({
      _id: contestantId,
      showcase: showcaseId,
      status: { $in: ["approved", "selected"] },
    });

    if (!contestant) {
      return res.status(404).json({ message: "Contestant not found in this showcase" });
    }

    const ShowcaseVote = require("../models/ShowcaseVote");

    // Enforce a maximum votes-per-user if configured; default to 1 if missing
    const maxVotesPerUser = Number(showcase?.rules?.maxVotesPerUser);
    const premiumBonusVotes = Number(showcase?.rules?.premiumBonusVotes);
    const baseMax = Number.isFinite(maxVotesPerUser) ? maxVotesPerUser : 1;
    const bonus = Number.isFinite(premiumBonusVotes) ? premiumBonusVotes : 0;
    const isPaidTier = req.user?.tier && req.user.tier !== "Free";
    const maxVotes = isPaidTier ? baseMax + bonus : baseMax;

    const userVotes = await ShowcaseVote.countDocuments({ showcase: showcaseId, user: userId });
    if (userVotes >= maxVotes) {
      return res
        .status(400)
        .json({ message: `You have reached the maximum number of votes (${maxVotes})` });
    }

    // Create vote record (schema requires ipAddress)
    await ShowcaseVote.create({
      showcase: showcaseId,
      contestant: contestantId,
      user: userId,
      ipAddress,
      userAgent: req.get("user-agent"),
      voteWeight: 1,
      country: req.body?.country,
    });

    // Increment vote count
    contestant.votes = (contestant.votes || 0) + 1;
    await contestant.save();

    // Keep showcase totalVotes in sync when available
    if (typeof showcase.totalVotes === "number") {
      showcase.totalVotes += 1;
      await showcase.save();
    }

    res.json({
      message: "Vote submitted successfully",
      votesRemaining: Math.max(0, maxVotes - (userVotes + 1)),
      contestant: {
        id: contestant._id,
        name: contestant.performanceTitle,
        votes: contestant.votes,
      },
    });
  } catch (error) {
    console.error("Error voting for contestant:", error);
    if (error.code === 11000) {
      return res.status(400).json({ message: "You have already voted for this contestant" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
