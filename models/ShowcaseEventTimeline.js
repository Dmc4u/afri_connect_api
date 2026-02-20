const mongoose = require("mongoose");

/**
 * Event Timeline Schema
 * Manages the structured talent showcase event with automatic phase transitions
 *
 * TIMELINE FLOW:
 * 1. Welcome & Rules: 3 min (default in test mode)
 * 2. Performances: Variable based on number of contestants (auto-play videos)
 * 3. Commercial: 1 min (plays uploaded commercial video)
 * 4. Voting: 3 min (users vote for favorite)
 * 5. Winner Display: 1 min (announce winner)
 * 6. Thank You: 1 min (thank you message)
 * 7. Next Event Countdown: Continuous until next event
 */

const eventPhaseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: [
      "welcome", // 5 min - Welcome & Rules
      "performance", // 25 min - All contestant performances (5 min each)
      "commercial", // 5 min - Commercial break
      "voting", // 20 min - Voting period
      "winner", // 3 min - Winner declaration
      "thankyou", // 2 min - Thank you message
      "countdown", // Continuous - Next event countdown
    ],
  },
  duration: {
    type: Number, // Duration in minutes
    required: true,
  },
  startTime: Date,
  endTime: Date,
  status: {
    type: String,
    enum: ["pending", "active", "completed"],
    default: "pending",
  },
});

const contestantPerformanceSchema = new mongoose.Schema({
  contestant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TalentContestant",
    required: true,
  },
  performanceOrder: {
    type: Number,
    required: true,
  },
  videoDuration: {
    type: Number, // Duration in seconds
    default: 300, // Default to 5 minutes if not specified
  },
  startTime: Date,
  endTime: Date,
  status: {
    type: String,
    enum: ["pending", "active", "completed"],
    default: "pending",
  },
});

const showcaseEventTimeline = new mongoose.Schema(
  {
    showcase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TalentShowcase",
      required: true,
      unique: true,
    },

    // Event Structure Configuration
    // Durations are set from showcase configuration during timeline creation
    config: {
      totalDuration: {
        type: Number,
        default: 60,
      },
      welcomeDuration: {
        type: Number,
        default: 3,
      },
      performanceSlotDuration: {
        type: Number,
        default: 5,
      },
      commercialDuration: {
        type: Number,
        default: 1,
      },
      votingDuration: {
        type: Number,
        default: 3,
      },
      winnerDeclarationDuration: {
        type: Number,
        default: 3,
      },
      thankYouDuration: {
        type: Number,
        default: 2,
      },
    },

    // Event Phases
    phases: [eventPhaseSchema],

    // Contestant Performances Schedule
    performances: [contestantPerformanceSchema],

    // Current Active Phase
    currentPhase: {
      type: String,
      enum: [
        "welcome",
        "performance",
        "commercial",
        "voting",
        "winner",
        "thankyou",
        "countdown",
        "ended",
      ],
      default: "welcome",
    },

    // Current Active Performance (during performance phase)
    currentPerformance: {
      contestant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TalentContestant",
      },
      performanceOrder: Number,
      startTime: Date,
      timeRemaining: Number, // Seconds remaining in current performance
    },

    // Event Status
    eventStatus: {
      type: String,
      enum: ["scheduled", "live", "completed", "cancelled"],
      default: "scheduled",
    },

    // Actual Event Times
    actualStartTime: Date,
    actualEndTime: Date,

    // Welcome Message Content
    welcomeMessage: {
      title: {
        type: String,
        default: "Welcome to the Talent Showcase!",
      },
      message: {
        type: String,
        default: "Get ready to witness amazing talent from across Africa!",
      },
      rules: [
        {
          type: String,
        },
      ],
    },

    // Commercial Break Content
    commercialContent: {
      sponsors: [
        {
          name: String,
          logo: String,
          videoUrl: String,
          duration: Number, // seconds
        },
      ],
      message: String,
    },

    // Winner Declaration Content
    winnerAnnouncement: {
      winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TalentContestant",
      },
      totalVotes: Number,
      prizeDetails: String,
      announcementTime: Date,
    },

    // Thank You Message
    thankYouMessage: {
      title: {
        type: String,
        default: "Thank You for Participating!",
      },
      message: {
        type: String,
        default: "Thank you to all contestants, voters, and viewers. See you next month!",
      },
      nextEventDate: Date,
    },

    // Real-time Tracking
    isLive: {
      type: Boolean,
      default: false,
    },
    // Baseline viewers to display (marketing/vanity count) + real unique sessions.
    // Total displayed viewers = viewerCountBase + activeViewers.length
    viewerCountBase: {
      type: Number,
      default: 4320,
    },
    viewerCount: {
      type: Number,
      default: 0,
    },
    peakViewerCount: {
      type: Number,
      default: 0,
    },
    activeViewers: {
      type: [String], // Array of viewer session IDs
      default: [],
    },

    // Pause/Resume Controls
    isPaused: {
      type: Boolean,
      default: false,
    },
    pausedAt: Date,
    pausedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Manual Override and Extensions
    manualOverride: {
      active: {
        type: Boolean,
        default: false,
      },
      reason: String,
      overriddenAt: Date,
      overriddenBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
    timeExtensions: [
      {
        phase: String,
        extensionMinutes: Number,
        extendedAt: Date,
        extendedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Method to calculate and set all phase times based on event start
showcaseEventTimeline.methods.generateTimeline = function () {
  const eventDate = new Date(this.actualStartTime || this.showcase.eventDate);
  // Welcome phase starts exactly at the scheduled event time
  const startTime = new Date(eventDate.getTime());
  let currentTime = new Date(startTime);

  this.phases = [];

  // 1. Welcome Phase - starts at event time
  this.phases.push({
    name: "welcome",
    duration: this.config.welcomeDuration,
    startTime: new Date(currentTime),
    endTime: new Date(currentTime.getTime() + this.config.welcomeDuration * 60000),
    status: "pending",
  });
  currentTime = new Date(currentTime.getTime() + this.config.welcomeDuration * 60000);

  // 2. Performance Phase - duration will be calculated from actual video lengths in schedulePerformances()
  // Start with a placeholder that will be updated when schedulePerformances() is called
  const performanceDuration =
    this.performances.reduce((total, perf) => {
      // Use exact decimal value for accurate timing
      return total + (perf.videoDuration || 300) / 60;
    }, 0) ||
    this.performances.length * this.config.performanceSlotDuration ||
    0;

  this.phases.push({
    name: "performance",
    duration: performanceDuration,
    startTime: new Date(currentTime),
    endTime: new Date(currentTime.getTime() + performanceDuration * 60000),
    status: "pending",
  });
  currentTime = new Date(currentTime.getTime() + performanceDuration * 60000);

  // 3. Commercial Phase - Calculate from actual commercial videos
  let commercialDurationMinutes = this.config.commercialDuration || 1; // Default fallback

  // Cap a single advert duration (seconds). Default: 30 minutes.
  // NOTE: This cap is applied per-commercial when computing the total commercial phase duration.
  // Set COMMERCIAL_MAX_SECONDS lower if you want to hard-limit individual ad length.
  const MAX_COMMERCIAL_SECONDS = Number(process.env.COMMERCIAL_MAX_SECONDS || 1800);

  // If showcase has commercials array with actual videos, calculate total duration
  if (this.showcase && this.showcase.commercials && this.showcase.commercials.length > 0) {
    const getCommercialSeconds = (commercial, fallbackSeconds = 30) => {
      const raw = Number(
        commercial?.duration || commercial?.videoDuration || commercial?.durationSeconds
      );
      // Guard against bad durations (e.g. 0/1) that would prematurely end the commercial phase.
      const seconds = Number.isFinite(raw) && raw > 3 ? raw : fallbackSeconds;
      return Math.min(seconds, MAX_COMMERCIAL_SECONDS);
    };

    const totalCommercialSeconds = this.showcase.commercials.reduce(
      (sum, commercial) => sum + getCommercialSeconds(commercial, 30),
      0
    );

    if (totalCommercialSeconds > 0) {
      commercialDurationMinutes = totalCommercialSeconds / 60; // Convert seconds to minutes
    }

    console.log(
      `✅ [COMMERCIAL] Calculated duration from ${this.showcase.commercials.length} videos: ${commercialDurationMinutes.toFixed(2)} minutes (${totalCommercialSeconds}s)`
    );
  } else {
    console.log(
      `⚠️ [COMMERCIAL] No commercial videos found, using default: ${commercialDurationMinutes} minutes`
    );
  }

  this.phases.push({
    name: "commercial",
    duration: commercialDurationMinutes,
    startTime: new Date(currentTime),
    endTime: new Date(currentTime.getTime() + commercialDurationMinutes * 60000),
    status: "pending",
  });
  currentTime = new Date(currentTime.getTime() + commercialDurationMinutes * 60000);

  // 4. Voting Phase (20 min)
  this.phases.push({
    name: "voting",
    duration: this.config.votingDuration,
    startTime: new Date(currentTime),
    endTime: new Date(currentTime.getTime() + this.config.votingDuration * 60000),
    status: "pending",
  });
  currentTime = new Date(currentTime.getTime() + this.config.votingDuration * 60000);

  // 5. Winner Declaration (3 min)
  this.phases.push({
    name: "winner",
    duration: this.config.winnerDeclarationDuration,
    startTime: new Date(currentTime),
    endTime: new Date(currentTime.getTime() + this.config.winnerDeclarationDuration * 60000),
    status: "pending",
  });
  currentTime = new Date(currentTime.getTime() + this.config.winnerDeclarationDuration * 60000);

  // 6. Thank You Phase (2 min)
  this.phases.push({
    name: "thankyou",
    duration: this.config.thankYouDuration,
    startTime: new Date(currentTime),
    endTime: new Date(currentTime.getTime() + this.config.thankYouDuration * 60000),
    status: "pending",
  });
  currentTime = new Date(currentTime.getTime() + this.config.thankYouDuration * 60000);

  // 7. Next Event Countdown (continuous until next event)
  this.phases.push({
    name: "countdown",
    duration: 0, // Continuous phase
    startTime: new Date(currentTime),
    endTime:
      this.thankYouMessage.nextEventDate ||
      new Date(currentTime.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days default
    status: "pending",
  });

  return this.phases;
};

// Method to schedule individual contestant performances
showcaseEventTimeline.methods.schedulePerformances = function (contestants) {
  const performancePhase = this.phases.find((p) => p.name === "performance");
  if (!performancePhase) return;

  let currentTime = new Date(performancePhase.startTime);
  this.performances = [];
  let totalDuration = 0;

  const fallbackSeconds = (this.config?.performanceSlotDuration || 5) * 60;

  contestants.forEach((contestant, index) => {
    console.log(`🎬 [SCHEDULE PERFORMANCE #${index + 1}]`, {
      performanceTitle: contestant.performanceTitle,
      contestantId: contestant._id,
      rawVideoDuration: contestant.videoDuration,
    });

    // Use actual video duration when available; fall back so ALL contestants get scheduled.
    let videoDurationSeconds = Number(contestant.videoDuration);
    if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) {
      console.warn(
        `⚠️  Performance #${index + 1} has no valid duration - using fallback: ${fallbackSeconds}s`
      );
      videoDurationSeconds = fallbackSeconds;
    }

    console.log(
      `🎬 [SCHEDULE PERFORMANCE #${index + 1}] Using videoDuration:`,
      videoDurationSeconds,
      "seconds (",
      (videoDurationSeconds / 60).toFixed(2),
      "minutes)"
    );

    const videoDurationMinutes = videoDurationSeconds / 60;

    this.performances.push({
      contestant: contestant._id,
      performanceOrder: index + 1,
      videoDuration: videoDurationSeconds,
      startTime: new Date(currentTime),
      endTime: new Date(currentTime.getTime() + videoDurationMinutes * 60000),
      status: "pending",
    });

    totalDuration += videoDurationMinutes;
    currentTime = new Date(currentTime.getTime() + videoDurationMinutes * 60000);
  });

  // Update performance phase duration and end time based on actual video lengths
  performancePhase.duration = totalDuration;
  performancePhase.endTime = new Date(performancePhase.startTime.getTime() + totalDuration * 60000);

  // Recalculate all subsequent phases
  const performanceIndex = this.phases.findIndex((p) => p.name === "performance");
  if (performanceIndex >= 0 && performanceIndex < this.phases.length - 1) {
    currentTime = new Date(performancePhase.endTime);
    for (let i = performanceIndex + 1; i < this.phases.length; i++) {
      this.phases[i].startTime = new Date(currentTime);

      // Countdown is a continuous phase whose endTime should NOT be derived from duration (duration is 0).
      // Preserve existing endTime (typically thankYouMessage.nextEventDate) or fall back to 30 days.
      if (this.phases[i].name === "countdown") {
        if (!this.phases[i].endTime) {
          this.phases[i].endTime =
            this.thankYouMessage?.nextEventDate ||
            new Date(currentTime.getTime() + 30 * 24 * 60 * 60 * 1000);
        }

        // Countdown is expected to be the last phase; don't advance currentTime based on it.
        currentTime = new Date(this.phases[i].endTime);
        continue;
      }

      this.phases[i].endTime = new Date(currentTime.getTime() + this.phases[i].duration * 60000);
      currentTime = this.phases[i].endTime;
    }
  }

  // Update total duration in config based on all phase durations
  const calculatedTotalDuration = this.phases.reduce((sum, phase) => sum + phase.duration, 0);
  this.config.totalDuration = calculatedTotalDuration;
};

// Method to get current active phase
// Method to get current active phase
showcaseEventTimeline.methods.getCurrentPhase = function () {
  // If event is completed or not live, don't return any active phase
  if (this.eventStatus === "completed" || !this.isLive) {
    return null;
  }

  // If event is paused, return the current phase without advancing
  if (this.isPaused) {
    const activePhase = this.phases.find((phase) => phase.status === "active");
    console.log("⏸️ Event is paused - returning current active phase without time-based advance");
    return activePhase || null;
  }

  const now = new Date();

  // If multiple phases are marked active (can happen after restarts/manual edits),
  // normalize to a single active phase to avoid UI/scheduler mismatches.
  const activePhases = this.phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => phase.status === "active");

  if (activePhases.length > 1) {
    // Prefer the phase matching currentPhase; otherwise prefer the most recently started.
    let intendedIndex = -1;
    if (this.currentPhase && this.currentPhase !== "ended") {
      intendedIndex = this.phases.findIndex((p) => p.name === this.currentPhase);
      if (!activePhases.some((p) => p.index === intendedIndex)) intendedIndex = -1;
    }

    if (intendedIndex < 0) {
      intendedIndex = activePhases.slice().sort((a, b) => {
        const aStart = a.phase.startTime ? new Date(a.phase.startTime).getTime() : 0;
        const bStart = b.phase.startTime ? new Date(b.phase.startTime).getTime() : 0;
        if (aStart !== bStart) return bStart - aStart;
        return b.index - a.index;
      })[0].index;
    }

    // Normalize statuses in order: past completed, intended active, future pending.
    this.phases.forEach((p, idx) => {
      if (idx < intendedIndex) p.status = "completed";
      else if (idx === intendedIndex) p.status = "active";
      else if (p.status !== "completed") p.status = "pending";
    });
    this.currentPhase = this.phases[intendedIndex]?.name || this.currentPhase;

    // Best-effort persist; keep method sync.
    this.save().catch((err) => console.error("Error normalizing phase statuses:", err));
  }

  // First, check if there's an explicitly active phase
  const activePhase = this.phases.find((phase) => phase.status === "active");
  if (activePhase) {
    // If countdown phase has passed its end time, mark as completed and end event
    if (activePhase.name === "countdown" && now > activePhase.endTime) {
      activePhase.status = "completed";
      this.currentPhase = "ended";
      this.eventStatus = "completed";
      this.isLive = false;

      // Also update the showcase status
      const TalentShowcase = require("./TalentShowcase");
      TalentShowcase.findByIdAndUpdate(this.showcase, {
        status: "completed",
      })
        .exec()
        .catch((err) => console.error("Error updating showcase status:", err));

      this.save().catch((err) => console.error("Error saving timeline:", err));
      return null;
    }
    return activePhase;
  }

  // If no active phase, find by time
  const timeBasedPhase = this.phases.find(
    (phase) => now >= phase.startTime && now <= phase.endTime && phase.status !== "completed"
  );

  // Auto-complete countdown if it has ended
  if (timeBasedPhase && timeBasedPhase.name === "countdown" && now > timeBasedPhase.endTime) {
    timeBasedPhase.status = "completed";
    this.currentPhase = "ended";
    this.eventStatus = "completed";
    this.isLive = false;

    // Also update the showcase status
    const TalentShowcase = require("./TalentShowcase");
    TalentShowcase.findByIdAndUpdate(this.showcase, {
      status: "completed",
    })
      .exec()
      .catch((err) => console.error("Error updating showcase status:", err));

    this.save().catch((err) => console.error("Error saving timeline:", err));
    return null;
  }

  return timeBasedPhase || null;
};

// Method to get current performance (during performance phase)
showcaseEventTimeline.methods.getCurrentPerformance = function () {
  // Ensure performances are sorted by performanceOrder
  const sortedPerformances = this.performances.sort(
    (a, b) => a.performanceOrder - b.performanceOrder
  );

  // First, check for explicitly active performance (more reliable)
  const activePerformance = sortedPerformances.find((perf) => perf.status === "active");
  if (activePerformance) {
    console.log(`✅ Found active performance: Order #${activePerformance.performanceOrder}`);
    return activePerformance;
  }

  // Fallback to time-based lookup
  const now = new Date();
  const timeBasedPerf = sortedPerformances.find(
    (perf) => now >= perf.startTime && now <= perf.endTime && perf.status !== "completed"
  );

  if (timeBasedPerf) {
    console.log(`⏰ Found time-based performance: Order #${timeBasedPerf.performanceOrder}`);
  } else {
    console.log(`⚠️ No current performance found`);
  }

  return timeBasedPerf;
};

// Method to advance to next phase
showcaseEventTimeline.methods.advancePhase = function () {
  // Don't advance if event is paused
  if (this.isPaused) {
    console.log("⏸️ Cannot advance phase - event is paused");
    return null;
  }

  // Don't advance if event is completed or not live
  if (this.eventStatus === "completed" || !this.isLive) {
    console.log("⚠️ Cannot advance phase - event is not live");
    return null;
  }

  const now = new Date();

  // Normalize phase statuses before advancing so we never carry multiple actives forward.
  const activeIndexes = this.phases
    .map((p, idx) => (p.status === "active" ? idx : -1))
    .filter((idx) => idx >= 0);

  if (activeIndexes.length > 1) {
    let intendedIndex = -1;
    if (this.currentPhase && this.currentPhase !== "ended") {
      intendedIndex = this.phases.findIndex((p) => p.name === this.currentPhase);
      if (!activeIndexes.includes(intendedIndex)) intendedIndex = -1;
    }

    if (intendedIndex < 0) {
      intendedIndex = activeIndexes.slice().sort((a, b) => {
        const aStart = this.phases[a]?.startTime ? new Date(this.phases[a].startTime).getTime() : 0;
        const bStart = this.phases[b]?.startTime ? new Date(this.phases[b].startTime).getTime() : 0;
        if (aStart !== bStart) return bStart - aStart;
        return b - a;
      })[0];
    }

    this.phases.forEach((p, idx) => {
      if (idx < intendedIndex) p.status = "completed";
      else if (idx === intendedIndex) p.status = "active";
      else if (p.status !== "completed") p.status = "pending";
    });
    this.currentPhase = this.phases[intendedIndex]?.name || this.currentPhase;
  }

  // Prefer explicitly active phase, but fall back to currentPhase/time-based
  // lookup if statuses got out of sync (e.g., after restarts/manual edits).
  let currentPhaseIndex = this.phases.findIndex((p) => p.status === "active");

  if (currentPhaseIndex < 0 && this.currentPhase && this.currentPhase !== "ended") {
    currentPhaseIndex = this.phases.findIndex(
      (p) => p.name === this.currentPhase && p.status !== "completed"
    );
  }

  if (currentPhaseIndex < 0) {
    // Time-based fallback (mirrors getCurrentPhase logic, but doesn't require an active status)
    currentPhaseIndex = this.phases.findIndex(
      (phase) => now >= phase.startTime && now <= phase.endTime && phase.status !== "completed"
    );
  }

  if (currentPhaseIndex >= 0) {
    this.phases[currentPhaseIndex].status = "completed";
  }

  const nextPhaseIndex = currentPhaseIndex >= 0 ? currentPhaseIndex + 1 : 0;
  if (nextPhaseIndex < this.phases.length) {
    // Ensure only the next phase becomes active.
    this.phases.forEach((p, idx) => {
      if (idx !== nextPhaseIndex && p.status === "active") {
        p.status = idx < nextPhaseIndex ? "completed" : "pending";
      }
    });

    this.phases[nextPhaseIndex].status = "active";
    let phaseDuration = this.phases[nextPhaseIndex].duration;

    // For performance phase, recalculate duration from actual performances
    if (this.phases[nextPhaseIndex].name === "performance" && this.performances.length > 0) {
      phaseDuration = this.performances.reduce((total, perf) => {
        const seconds = perf.videoDuration || (this.config?.performanceSlotDuration || 5) * 60;
        return total + seconds / 60; // seconds -> minutes
      }, 0);
      this.phases[nextPhaseIndex].duration = phaseDuration;
      console.log(
        `🎬 Recalculated performance phase duration: ${phaseDuration.toFixed(2)} minutes from ${this.performances.length} videos`
      );
    }

    this.phases[nextPhaseIndex].startTime = now;
    this.phases[nextPhaseIndex].endTime = new Date(now.getTime() + phaseDuration * 60000);
    this.currentPhase = this.phases[nextPhaseIndex].name;

    // If transitioning to performance phase, automatically start first performance
    if (this.currentPhase === "performance" && this.performances.length > 0) {
      // Sort performances by performanceOrder to ensure correct sequence
      this.performances.sort((a, b) => a.performanceOrder - b.performanceOrder);

      console.log(`🎬 Performance phase transition - checking all performances:`);
      this.performances.forEach((perf, idx) => {
        console.log(
          `  [${idx}] Order: ${perf.performanceOrder}, Status: ${perf.status}, ID: ${perf.contestant}`
        );
      });

      // Reset ALL performances to pending first to ensure clean state
      this.performances.forEach((perf) => {
        if (perf.status !== "completed") {
          perf.status = "pending";
        }
      });

      const firstPerf = this.performances[0];
      console.log(
        `🎯 Setting FIRST performance as active: Order #${firstPerf.performanceOrder}, Index: 0`
      );

      const durationSeconds =
        firstPerf.videoDuration || (this.config?.performanceSlotDuration || 5) * 60;

      firstPerf.status = "active";
      firstPerf.startTime = now;
      firstPerf.endTime = new Date(now.getTime() + durationSeconds * 1000); // seconds -> ms

      this.currentPerformance = {
        contestant: firstPerf.contestant,
        performanceOrder: firstPerf.performanceOrder,
        startTime: now,
        timeRemaining: durationSeconds,
      };
      console.log(
        `✅ Performance phase started - FIRST performance is active (Order #${firstPerf.performanceOrder}, Index: 0): ${firstPerf.contestant}`
      );
    }

    return this.phases[nextPhaseIndex];
  }

  this.currentPhase = "ended";
  this.eventStatus = "completed";
  this.isLive = false;
  return null;
};

module.exports = mongoose.model("ShowcaseEventTimeline", showcaseEventTimeline);
