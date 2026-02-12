const TalentShowcase = require("../models/TalentShowcase");
const TalentContestant = require("../models/TalentContestant");
const ShowcaseVote = require("../models/ShowcaseVote");
const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
const User = require("../models/User");
const SponsorshipRequest = require("../models/SponsorshipRequest");
const { performRaffle, verifyRaffle, generatePublicReport } = require("../utils/raffleSelection");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { isGcsEnabled, getGcsBucketName, buildObjectName, uploadFromPath } = require("../utils/gcs");

function parseBoolEnv(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "n" || v === "off") return false;
  return null;
}

// Cloudinary has been removed; cloud uploads for showcases use GCS.

async function ensureWinnerAnnouncement(timeline, showcaseId) {
  if (timeline?.winnerAnnouncement?.announcementTime) return;

  const TalentContestant = require("../models/TalentContestant");
  const showcase = await TalentShowcase.findById(showcaseId);

  const prizeText = showcase?.prizeDetails?.amount
    ? `$${showcase.prizeDetails.amount} ${showcase.prizeDetails.description || "cash prize and featured placement"}`
    : "Cash prize and featured placement for the winner";

  const contestants = await TalentContestant.find({ showcase: showcaseId })
    .sort({ votes: -1, _id: 1 })
    .populate("user")
    .populate("listing");

  if (contestants.length === 0) {
    timeline.winnerAnnouncement = {
      totalVotes: 0,
      prizeDetails: `${prizeText} - No contestants participated`,
      announcementTime: new Date(),
      noWinner: true,
    };
    return;
  }

  const totalVotes = contestants.reduce((sum, c) => sum + (c.votes || 0), 0);
  if (totalVotes === 0) {
    timeline.winnerAnnouncement = {
      totalVotes: 0,
      prizeDetails: `${prizeText} - No votes were cast, no winner declared`,
      announcementTime: new Date(),
      noWinner: true,
    };
    return;
  }

  const highestVotes = contestants[0].votes || 0;
  const tiedContestants = contestants.filter((c) => (c.votes || 0) === highestVotes);

  if (tiedContestants.length > 1) {
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
    return;
  }

  const winner = contestants[0];
  timeline.winnerAnnouncement = {
    winner: winner._id,
    totalVotes: highestVotes,
    prizeDetails: `${prizeText} - Won with ${highestVotes} votes out of ${totalVotes} total`,
    announcementTime: new Date(),
  };

  winner.isWinner = true;
  winner.wonAt = new Date();
  await winner.save();

  try {
    const { autoFeatureWinner } = require("../utils/featuredHelper");
    await autoFeatureWinner(winner);
  } catch (e) {
    console.warn("⚠️ Failed to auto-feature winner:", e?.message || e);
  }
}

const COMMERCIAL_TMP_ROOT = path.join(__dirname, "..", "uploads", "tmp", "commercials");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeFilename(originalName) {
  const base = String(originalName || "upload")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  return base || "upload";
}

async function addCommercialToShowcase({ showcaseId, filePath, title, requestedDurationSeconds }) {
  const showcase = await TalentShowcase.findById(showcaseId);
  if (!showcase) {
    const err = new Error("Showcase not found");
    err.statusCode = 404;
    throw err;
  }

  const uploadsRoot = path.join(__dirname, "..", "uploads");
  const relToUploads = path.relative(uploadsRoot, filePath).replace(/\\/g, "/");
  const localVideoUrl = `/uploads/${relToUploads.replace(/^\/+/, "")}`;

  const { getVideoDurationInSeconds } = require("get-video-duration");
  // Cap a single advert to 2 minutes 30 seconds by default.
  const MAX_COMMERCIAL_SECONDS = Number(process.env.COMMERCIAL_MAX_SECONDS || 150);
  const requestedDuration = Number(requestedDurationSeconds);
  let duration = 30;

  try {
    const durationInSeconds = await getVideoDurationInSeconds(filePath);
    duration = Math.ceil(durationInSeconds);
    if (duration > MAX_COMMERCIAL_SECONDS) duration = MAX_COMMERCIAL_SECONDS;
  } catch (err) {
    if (Number.isFinite(requestedDuration) && requestedDuration > 0) {
      duration = Math.ceil(requestedDuration);
      if (duration > MAX_COMMERCIAL_SECONDS) duration = MAX_COMMERCIAL_SECONDS;
    }
  }

  if (!showcase.commercials) showcase.commercials = [];

  let videoUrl = localVideoUrl;
  let localFileToDeleteAfterSave = null;

  if (isGcsEnabled()) {
    const bucketName = getGcsBucketName();
    if (!bucketName) {
      const err = new Error("GCS is enabled but GCS_BUCKET is not configured.");
      err.statusCode = 500;
      throw err;
    }

    const deleteLocalAfterUpload =
      parseBoolEnv(process.env.COMMERCIAL_DELETE_LOCAL_AFTER_UPLOAD) ??
      parseBoolEnv(process.env.COMMERCIAL_DELETE_LOCAL_AFTER_CLOUDINARY) ??
      true;

    try {
      const filename = path.basename(filePath);
      const objectName = buildObjectName({
        resourceType: "video",
        purpose: "commercial",
        filename,
      });

      const uploadedUrl = await uploadFromPath({
        bucketName,
        objectName,
        localPath: filePath,
      });

      if (uploadedUrl) {
        videoUrl = uploadedUrl;
        if (deleteLocalAfterUpload) {
          // Defer deleting the local file until after the showcase is saved.
          localFileToDeleteAfterSave = filePath;
        }
      }
    } catch (cloudErr) {
      console.warn("⚠️ Commercial GCS upload failed; using local URL:", cloudErr?.message);
    }
  }

  const newCommercial = {
    videoUrl,
    title: title || `Advertisement ${showcase.commercials.length + 1}`,
    duration,
    order: showcase.commercials.length,
    uploadedAt: new Date(),
  };

  showcase.commercials.push(newCommercial);

  const totalDurationSeconds = showcase.commercials.reduce((sum, c) => {
    const seconds = Number(c?.duration);
    // Guard against bad durations (e.g., 0/1) that would prematurely end the commercial phase.
    return sum + (Number.isFinite(seconds) && seconds > 3 ? seconds : 30);
  }, 0);
  showcase.commercialDuration = Math.ceil(totalDurationSeconds / 60);
  await showcase.save();

  // Best-effort cleanup after save when cloud upload succeeded.
  {
    const toDelete = localFileToDeleteAfterSave;
    if (toDelete && typeof toDelete === "string") {
      try {
        fs.unlinkSync(toDelete);
      } catch (e) {
        console.warn("⚠️ Could not delete local commercial after upload:", e?.message);
      }
    }
  }

  return {
    videoUrl,
    commercials: showcase.commercials,
    totalDurationSeconds,
    commercialDuration: showcase.commercialDuration,
  };
}

// Helper function to calculate showcase status based on dates
const calculateShowcaseStatus = (showcase) => {
  const now = new Date();
  const eventDate = new Date(showcase.eventDate);
  const registrationStart = showcase.registrationStartDate
    ? new Date(showcase.registrationStartDate)
    : null;
  const registrationEnd = showcase.registrationEndDate
    ? new Date(showcase.registrationEndDate)
    : null;
  const raffleDate = showcase.raffleScheduledDate ? new Date(showcase.raffleScheduledDate) : null;

  // If manually set to certain statuses, respect them
  if (showcase.status === "cancelled") {
    return "cancelled";
  }

  // Calculate automatic status based on timeline
  if (registrationStart && now < registrationStart) {
    return "draft"; // Before registration opens
  } else if (
    registrationStart &&
    registrationEnd &&
    now >= registrationStart &&
    now <= registrationEnd
  ) {
    return "nomination"; // Registration is open
  } else if (registrationEnd && raffleDate && now > registrationEnd && now < raffleDate) {
    return "upcoming"; // Between registration close and raffle
  } else if (raffleDate && eventDate && now >= raffleDate && now < eventDate) {
    return "upcoming"; // After raffle, before event
  } else if (now >= eventDate) {
    // Check if event has ended (assume 2 hours duration if not specified)
    const eventDuration = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    const eventEndTime = new Date(eventDate.getTime() + eventDuration);

    if (now >= eventDate && now < eventEndTime) {
      return "live"; // Event is currently happening
    } else if (now >= eventEndTime) {
      return "completed"; // Event has ended
    }
  }

  return "upcoming"; // Default fallback
};

// ============ SHOWCASE MANAGEMENT ============

// Create new talent showcase event (Admin only)
exports.createShowcase = async (req, res) => {
  try {
    // Default submissionDeadline to registrationEndDate if not provided
    if (!req.body.submissionDeadline && req.body.registrationEndDate) {
      req.body.submissionDeadline = req.body.registrationEndDate;
    }

    // Create the showcase
    const showcase = new TalentShowcase(req.body);

    // Calculate and set automatic status if not manually set to cancelled
    if (!req.body.status || req.body.status !== "cancelled") {
      showcase.status = calculateShowcaseStatus(showcase);
    }

    await showcase.save();

    // If this is a LIVE event, automatically create the event timeline
    if (req.body.title && req.body.title.includes("LIVE")) {
      const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

      // Calculate total duration dynamically
      const welcomeDuration = showcase.welcomeDuration ?? 5;
      const performanceSlotDuration = showcase.performanceDuration ?? 5;
      const commercialDuration = showcase.commercialDuration ?? 5;
      const votingDuration = showcase.votingDisplayDuration ?? 10;
      const winnerDeclarationDuration = showcase.winnerDisplayDuration ?? 3;
      const thankYouDuration = showcase.thankYouDuration ?? 2;
      const countdownDuration = showcase.countdownDuration ?? 5;

      // Total will be recalculated when performances are scheduled with actual video lengths
      const estimatedTotalDuration =
        welcomeDuration +
        commercialDuration +
        votingDuration +
        winnerDeclarationDuration +
        thankYouDuration +
        countdownDuration;

      const timeline = new ShowcaseEventTimeline({
        showcase: showcase._id,
        actualStartTime: showcase.eventDate,
        config: {
          totalDuration: estimatedTotalDuration, // Will be updated with actual performance durations
          welcomeDuration,
          performanceSlotDuration,
          maxVideoLength: 270,
          commercialDuration,
          votingDuration,
          winnerDeclarationDuration,
          thankYouDuration,
          countdownDuration,
        },
        eventStatus: "scheduled",
        isLive: false,
        welcomeMessage: {
          title: `Welcome to ${showcase.title}!`,
          message: `Get ready for an amazing hour of talent! Watch incredible performers compete for amazing prizes.`,
          rules: [
            "Each contestant will perform for 5 minutes",
            "After all performances, voting will open for 15 minutes",
            "Each user can vote once (Premium users get bonus votes)",
            "Winner will be announced at the end",
            "Be respectful and enjoy the show!",
          ],
        },
        thankYouMessage: {
          title: "Thank You for Joining Us!",
          message: `Thank you for being part of ${showcase.title}! See you next month!`,
          nextEventDate: (() => {
            // Calculate next month same day and time
            const nextMonth = new Date(showcase.eventDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            // Handle edge case: if current day is 31 and next month has fewer days,
            // JavaScript automatically adjusts to the last day of that month
            return nextMonth;
          })(),
        },
      });

      // Ensure generateTimeline() can access showcase.commercials if present
      timeline.showcase = showcase;
      timeline.generateTimeline();

      // Schedule performances with selected contestants (if any exist)
      const TalentContestant = require("../models/TalentContestant");
      const selectedContestants = await TalentContestant.find({
        showcase: showcase._id,
        status: { $in: ["approved", "selected"] },
      }).sort({ rafflePosition: 1, voteCount: -1 });

      if (selectedContestants.length > 0) {
        console.log(`🎬 Scheduling ${selectedContestants.length} performances for new timeline`);
        timeline.schedulePerformances(selectedContestants);
      } else {
        console.log(
          "⚠️ No contestants yet - performances will be scheduled when contestants are selected"
        );
      }

      await timeline.save();

      console.log("✅ Event timeline created automatically for:", showcase.title);
    }

    res.status(201).json({
      success: true,
      message: "Talent showcase created successfully",
      showcase,
    });
  } catch (error) {
    console.error("Error creating showcase:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create showcase",
      error: error.message,
    });
  }
};

// Get all showcases with filters
exports.getShowcases = async (req, res) => {
  try {
    const { status, category, page = 1, limit = 10 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;

    const skip = (page - 1) * limit;

    const showcases = await TalentShowcase.find(filter)
      .populate({
        path: "contestants",
        match: { status: { $in: ["submitted", "approved", "selected"] } },
        select:
          "performanceTitle performanceDescription votes country thumbnailUrl videoUrl user status",
        populate: {
          path: "user",
          select: "name username profilePhoto",
        },
      })
      .populate("winner", "performanceTitle user votes")
      .sort({ eventDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Update status for each showcase based on current time
    for (const showcase of showcases) {
      if (showcase.status !== "cancelled" && showcase.status !== "completed") {
        const newStatus = calculateShowcaseStatus(showcase);
        if (newStatus !== showcase.status) {
          showcase.status = newStatus;
          await showcase.save();
        }
      }
    }

    const total = await TalentShowcase.countDocuments(filter);

    // If no showcases found, return next event date for countdown
    if (showcases.length === 0) {
      const lastCompletedEvent = await TalentShowcase.findOne({
        status: "completed",
      }).sort({ eventDate: -1 });

      let nextEventDate = null;
      if (lastCompletedEvent) {
        const timeline = await ShowcaseEventTimeline.findOne({ showcase: lastCompletedEvent._id });
        nextEventDate = timeline?.nextEventDate || lastCompletedEvent.nextEventDate;

        if (!nextEventDate && lastCompletedEvent.eventDate) {
          const lastDate = new Date(lastCompletedEvent.eventDate);
          const nextMonth = new Date(lastDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          nextEventDate = nextMonth;
        }
      } else {
        // No events exist yet - set default to first Saturday of next month at 8 PM
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        // Find first Saturday of next month
        while (nextMonth.getDay() !== 6) {
          nextMonth.setDate(nextMonth.getDate() + 1);
        }

        // Set time to 8 PM (20:00)
        nextMonth.setHours(20, 0, 0, 0);
        nextEventDate = nextMonth;
      }

      return res.json({
        success: true,
        showcases: [],
        userRegistrations: {},
        nextEventDate,
        pagination: {
          total: 0,
          page: parseInt(page),
          pages: 0,
        },
      });
    } // Find the LIVE Monthly Talent Showcase event to use as reference for all countdowns
    const liveEvent = await TalentShowcase.findOne({
      title: /LIVE.*Talent/i,
      eventDate: { $gte: new Date() },
    }).sort({ eventDate: 1 });

    // Add server-side countdown for each showcase
    const showcasesWithCountdown = showcases.map((showcase) => {
      const showcaseObj = showcase.toObject();
      const now = new Date();

      // If there's a LIVE event, use its dates for countdown; otherwise use showcase's own dates
      const useOwnDates = !liveEvent || showcase._id.equals(liveEvent._id);
      const eventDate = useOwnDates ? new Date(showcase.eventDate) : new Date(liveEvent.eventDate);

      // Use calculated voting times from new flow or legacy fields
      const votingStart = useOwnDates
        ? showcase.votingStartTime
          ? new Date(showcase.votingStartTime)
          : showcase.calculateVotingStartTime()
        : liveEvent.votingStartTime
          ? new Date(liveEvent.votingStartTime)
          : liveEvent.calculateVotingStartTime();
      const votingEnd = useOwnDates
        ? showcase.votingEndTime
          ? new Date(showcase.votingEndTime)
          : showcase.calculateVotingEndTime()
        : liveEvent.votingEndTime
          ? new Date(liveEvent.votingEndTime)
          : liveEvent.calculateVotingEndTime();

      // Calculate time until event starts
      const timeUntilEvent = eventDate - now;
      const timeUntilVoting = votingStart - now;
      const timeUntilVotingEnds = votingEnd - now;

      showcaseObj.countdown = {
        serverTime: now.toISOString(),
        eventDate: eventDate.toISOString(),
        votingStartTime: votingStart.toISOString(),
        votingEndTime: votingEnd.toISOString(),
        millisecondsUntilEvent: Math.max(0, timeUntilEvent),
        millisecondsUntilVoting: Math.max(0, timeUntilVoting),
        millisecondsUntilVotingEnds: Math.max(0, timeUntilVotingEnds),
        isLive: showcase.status === "live" || showcase.status === "voting",
        isVotingOpen: now >= votingStart && now <= votingEnd,
        hasEnded: now > votingEnd,
        syncedToLiveEvent: !useOwnDates, // Flag to indicate countdown is synced to LIVE event
      };

      return showcaseObj;
    });

    // If user is authenticated, fetch their registrations for all showcases
    let userRegistrations = {};
    if (req.user && req.user._id) {
      const TalentContestant = require("../models/TalentContestant");
      const showcaseIds = showcases.map((s) => s._id);
      const registrations = await TalentContestant.find({
        showcase: { $in: showcaseIds },
        user: req.user._id,
      }).select(
        "showcase performanceTitle performanceDescription themeTitle themeCreator country videoUrl status"
      );

      registrations.forEach((reg) => {
        userRegistrations[reg.showcase.toString()] = reg;
      });
    }

    res.json({
      success: true,
      showcases: showcasesWithCountdown,
      userRegistrations: userRegistrations,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching showcases:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch showcases",
      error: error.message,
    });
  }
};

// Get single showcase with full details
exports.getShowcaseById = async (req, res) => {
  try {
    const showcase = await TalentShowcase.findById(req.params.id)
      .populate({
        path: "contestants",
        populate: {
          path: "user",
          select: "name username profilePhoto",
        },
      })
      .populate({
        path: "winner",
        populate: {
          path: "user",
          select: "name username profilePhoto",
        },
      });

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Sort contestants by votes
    if (showcase.contestants) {
      showcase.contestants.sort((a, b) => b.votes - a.votes);
    }

    // Find the LIVE Monthly Talent Showcase event to use as reference for countdown
    const liveEvent = await TalentShowcase.findOne({
      title: /LIVE.*Talent/i,
      eventDate: { $gte: new Date() },
    }).sort({ eventDate: 1 });

    // Add server-side countdown
    const showcaseObj = showcase.toObject();
    const now = new Date();

    // If there's a LIVE event, use its dates for countdown; otherwise use showcase's own dates
    const useOwnDates = !liveEvent || showcase._id.equals(liveEvent._id);
    const eventDate = useOwnDates ? new Date(showcase.eventDate) : new Date(liveEvent.eventDate);

    // Use calculated voting times from new flow or legacy fields
    let votingStart, votingEnd;

    try {
      votingStart = useOwnDates
        ? showcase.votingStartTime
          ? new Date(showcase.votingStartTime)
          : showcase.calculateVotingStartTime()
        : liveEvent.votingStartTime
          ? new Date(liveEvent.votingStartTime)
          : liveEvent.calculateVotingStartTime();
      votingEnd = useOwnDates
        ? showcase.votingEndTime
          ? new Date(showcase.votingEndTime)
          : showcase.calculateVotingEndTime()
        : liveEvent.votingEndTime
          ? new Date(liveEvent.votingEndTime)
          : liveEvent.calculateVotingEndTime();
    } catch (calcError) {
      // Fallback if calculation fails
      console.error("Error calculating voting times:", calcError);
      votingStart = new Date(eventDate.getTime() + 40 * 60 * 1000); // 40 min after event
      votingEnd = new Date(votingStart.getTime() + (showcase.votingDuration || 15) * 60 * 1000);
    }

    const timeUntilEvent = eventDate - now;
    const timeUntilVoting = votingStart - now;
    const timeUntilVotingEnds = votingEnd - now;

    // Check if we have a structured timeline for this showcase
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
    let isVotingOpenFromTimeline = false;

    if (timeline && timeline.phases) {
      // Check if current phase is 'voting'
      for (const phase of timeline.phases) {
        if (phase.name === "voting") {
          const phaseStart = new Date(phase.startTime);
          const phaseEnd = new Date(phase.endTime);
          if (now >= phaseStart && now <= phaseEnd) {
            isVotingOpenFromTimeline = true;
            break;
          }
        }
      }
    }

    showcaseObj.countdown = {
      serverTime: now.toISOString(),
      eventDate: eventDate.toISOString(),
      votingStartTime: votingStart.toISOString(),
      votingEndTime: votingEnd.toISOString(),
      millisecondsUntilEvent: Math.max(0, timeUntilEvent),
      millisecondsUntilVoting: Math.max(0, timeUntilVoting),
      millisecondsUntilVotingEnds: Math.max(0, timeUntilVotingEnds),
      isLive: showcase.status === "live" || showcase.status === "voting",
      isVotingOpen: isVotingOpenFromTimeline || (now >= votingStart && now <= votingEnd),
      hasEnded: now > votingEnd,
      syncedToLiveEvent: !useOwnDates, // Flag to indicate countdown is synced to LIVE event
    };

    res.json({
      success: true,
      showcase: showcaseObj,
    });
  } catch (error) {
    console.error("Error fetching showcase:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch showcase",
      error: error.message,
    });
  }
};

// Update showcase (Admin only)
exports.updateShowcase = async (req, res) => {
  try {
    // Log welcome phase timings if they're being updated
    if (
      req.body.welcomeMessageDuration !== undefined ||
      req.body.rulesDuration !== undefined ||
      req.body.contestantsIntroDuration !== undefined
    ) {
      console.log("📝 Updating welcome phase timings:", {
        welcomeMessageDuration: req.body.welcomeMessageDuration,
        rulesDuration: req.body.rulesDuration,
        contestantsIntroDuration: req.body.contestantsIntroDuration,
      });
    }

    // Default submissionDeadline to registrationEndDate if not provided
    if (!req.body.submissionDeadline && req.body.registrationEndDate) {
      req.body.submissionDeadline = req.body.registrationEndDate;
    }

    const showcase = await TalentShowcase.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Log the saved values
    if (
      req.body.welcomeMessageDuration !== undefined ||
      req.body.rulesDuration !== undefined ||
      req.body.contestantsIntroDuration !== undefined
    ) {
      console.log("✅ Saved welcome phase timings:", {
        welcomeMessageDuration: showcase.welcomeMessageDuration,
        rulesDuration: showcase.rulesDuration,
        contestantsIntroDuration: showcase.contestantsIntroDuration,
      });
    }

    // Calculate and update status automatically if not manually set to cancelled or completed
    if (showcase.status !== "cancelled" && showcase.status !== "completed") {
      showcase.status = calculateShowcaseStatus(showcase);
      await showcase.save();
    }

    // If welcomeDuration is changed, update any existing timeline so the Welcome phase timer
    // reflects the configured minutes.
    if (req.body.welcomeDuration !== undefined) {
      try {
        const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
        const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });

        if (timeline && timeline.eventStatus !== "completed") {
          const desiredWelcomeMinutes = showcase.welcomeDuration ?? 5;
          const currentWelcomeMinutes = timeline.config?.welcomeDuration;

          if (currentWelcomeMinutes !== desiredWelcomeMinutes) {
            const welcomeIndex = Array.isArray(timeline.phases)
              ? timeline.phases.findIndex((p) => p.name === "welcome")
              : -1;

            if (welcomeIndex >= 0) {
              const welcomePhase = timeline.phases[welcomeIndex];
              const startTime = welcomePhase.startTime ? new Date(welcomePhase.startTime) : null;
              const oldEndTime = welcomePhase.endTime ? new Date(welcomePhase.endTime) : null;

              timeline.config.welcomeDuration = desiredWelcomeMinutes;
              welcomePhase.duration = desiredWelcomeMinutes;

              if (startTime && !Number.isNaN(startTime.getTime())) {
                const newEndTime = new Date(startTime.getTime() + desiredWelcomeMinutes * 60000);
                const deltaMs = oldEndTime ? newEndTime.getTime() - oldEndTime.getTime() : 0;
                welcomePhase.endTime = newEndTime;

                if (deltaMs !== 0) {
                  // Shift subsequent phases
                  for (let i = welcomeIndex + 1; i < timeline.phases.length; i++) {
                    if (timeline.phases[i].startTime) {
                      timeline.phases[i].startTime = new Date(
                        new Date(timeline.phases[i].startTime).getTime() + deltaMs
                      );
                    }
                    if (timeline.phases[i].endTime) {
                      timeline.phases[i].endTime = new Date(
                        new Date(timeline.phases[i].endTime).getTime() + deltaMs
                      );
                    }
                  }

                  // Shift scheduled performances (if already scheduled)
                  if (Array.isArray(timeline.performances)) {
                    timeline.performances.forEach((perf) => {
                      if (perf.startTime) {
                        perf.startTime = new Date(new Date(perf.startTime).getTime() + deltaMs);
                      }
                      if (perf.endTime) {
                        perf.endTime = new Date(new Date(perf.endTime).getTime() + deltaMs);
                      }
                    });
                  }
                }
              }

              await timeline.save();
            }
          }
        }
      } catch (timelineSyncError) {
        console.error("Error syncing timeline welcomeDuration:", timelineSyncError);
      }
    }

    res.json({
      success: true,
      message: "Showcase updated successfully",
      showcase,
    });
  } catch (error) {
    console.error("Error updating showcase:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update showcase",
      error: error.message,
    });
  }
};

// Delete showcase (Admin only)
exports.deleteShowcase = async (req, res) => {
  try {
    const showcase = await TalentShowcase.findByIdAndDelete(req.params.id);

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Delete related contestants and votes, BUT preserve winners for display on homepage
    // Only delete contestants who are NOT winners
    const deleteResult = await TalentContestant.deleteMany({
      showcase: req.params.id,
      isWinner: { $ne: true }, // Exclude winners from deletion
    });

    console.log(
      `🗑️  Deleted ${deleteResult.deletedCount} non-winner contestants from showcase ${req.params.id}`
    );

    // Count how many winners were preserved
    const preservedWinners = await TalentContestant.countDocuments({
      showcase: req.params.id,
      isWinner: true,
    });

    if (preservedWinners > 0) {
      console.log(`✅ Preserved ${preservedWinners} winner(s) for homepage display`);
    }

    await ShowcaseVote.deleteMany({ showcase: req.params.id });

    res.json({
      success: true,
      message: "Showcase deleted successfully",
      deletedContestants: deleteResult.deletedCount,
      preservedWinners,
    });
  } catch (error) {
    console.error("Error deleting showcase:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete showcase",
      error: error.message,
    });
  }
};

// ============ CONTESTANT MANAGEMENT ============

// Register as contestant
exports.registerContestant = async (req, res) => {
  try {
    const {
      showcaseId,
      performanceTitle,
      performanceDescription,
      themeTitle,
      themeCreator,
      country,
      videoUrl,
      videoCloudinaryId,
      videoDuration, // Video duration in seconds from upload
      thumbnailUrl,
      listingId,
      socialMedia,
      paymentOrderId,
      skipPayment, // For admin or free entries
    } = req.body;

    // Check if showcase exists and is accepting registrations
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    if (showcase.status !== "upcoming" && showcase.status !== "nomination") {
      return res.status(400).json({
        success: false,
        message: "Registration is closed for this showcase",
      });
    }

    // Check if user already registered
    const existing = await TalentContestant.findOne({
      showcase: showcaseId,
      user: req.user._id,
    });

    if (existing) {
      // Allow editing only if not yet approved (status is pending)
      if (existing.status === "pending") {
        return res.status(200).json({
          success: true,
          message: "You have already registered for this showcase. You can edit your registration.",
          contestant: existing,
          canEdit: true,
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `You have already registered for this showcase and your status is "${existing.status}". Contact admin if you need to make changes.`,
          contestant: existing,
          canEdit: false,
        });
      }
    }

    // Prepare entry fee data
    const hasEntryFee = showcase.entryFee > 0;
    const isAdmin = req.user?.role === "admin";

    let entryFeeData = {
      paid: false,
      amount: showcase.entryFee || 0,
    };

    // If there's an entry fee, verify payment was made
    if (hasEntryFee && !skipPayment && !isAdmin) {
      if (!paymentOrderId) {
        return res.status(400).json({
          success: false,
          message: "Payment is required. Please complete payment before registration.",
          entryFee: showcase.entryFee,
          entryFeeCurrency: showcase.entryFeeCurrency || "USD",
        });
      }

      // Verify payment with PayPal (amount/currency + approval state)
      try {
        const { getOrder, captureOrder } = require("../utils/paypal");

        // Pre-check: validate order details before capturing
        const order = await getOrder(paymentOrderId);
        const unit = order?.purchase_units?.[0];
        const orderCurrency = unit?.amount?.currency_code;
        const orderAmount = parseFloat(unit?.amount?.value || "0");
        const expectedCurrency = (showcase.entryFeeCurrency || "USD").toUpperCase();

        if (orderCurrency && orderCurrency !== expectedCurrency) {
          return res.status(400).json({
            success: false,
            message: "Payment currency mismatch. Please retry payment.",
          });
        }

        if (orderAmount && Math.abs(orderAmount - showcase.entryFee) > 0.01) {
          return res.status(400).json({
            success: false,
            message: "Payment amount mismatch. Please retry payment.",
          });
        }

        if (order?.status && !["APPROVED", "COMPLETED"].includes(order.status)) {
          return res.status(400).json({
            success: false,
            message: "Order not approved. Please complete payment first.",
          });
        }

        // Capture the PayPal order
        const capture = await captureOrder(paymentOrderId);

        if (capture.status !== "COMPLETED") {
          return res.status(400).json({
            success: false,
            message: "Payment verification failed. Please complete payment first.",
          });
        }

        entryFeeData = {
          paid: true,
          amount: showcase.entryFee,
          transactionId: paymentOrderId,
          paidAt: new Date(),
        };
      } catch (error) {
        console.error("Payment verification error:", error);
        return res.status(400).json({
          success: false,
          message: "Payment verification failed. Please try again.",
        });
      }
    } else if (isAdmin || !hasEntryFee) {
      // Admin bypass or free entry
      entryFeeData.paid = true;
      entryFeeData.transactionId = isAdmin ? `ADMIN-${Date.now()}` : "FREE";
      entryFeeData.paidAt = new Date();
    }

    // Create contestant with provided duration
    const contestant = new TalentContestant({
      showcase: showcaseId,
      user: req.user._id,
      listing: listingId,
      performanceTitle,
      performanceDescription,
      themeTitle,
      themeCreator,
      country,
      videoUrl,
      videoCloudinaryId: videoCloudinaryId || null,
      videoDuration: videoDuration, // Use provided duration
      thumbnailUrl,
      socialMedia,
      entryFee: entryFeeData,
    });

    await contestant.save();

    // Extract video duration in background if not provided (non-blocking)
    if (videoUrl && !videoDuration) {
      const { isYouTubeUrl, getYouTubeDuration } = require("../utils/youtubeUtils");

      if (isYouTubeUrl(videoUrl)) {
        // Run in background without blocking response
        getYouTubeDuration(videoUrl)
          .then((duration) => {
            if (duration) {
              console.log(
                `✅ Background: Extracted YouTube duration: ${duration}s (${(duration / 60).toFixed(2)} minutes)`
              );
              // Update contestant with extracted duration
              TalentContestant.findByIdAndUpdate(
                contestant._id,
                { videoDuration: duration },
                { new: true }
              ).catch((err) => console.error("Error updating video duration:", err));
            } else {
              console.log("⚠️ Background: Could not extract YouTube duration");
            }
          })
          .catch((err) => console.error("Background YouTube extraction error:", err));
      }
    }

    // Add contestant to showcase (robust for older production docs that may not have `contestants` initialized)
    await TalentShowcase.updateOne(
      { _id: showcaseId },
      { $addToSet: { contestants: contestant._id } }
    );

    res.status(201).json({
      success: true,
      message: hasEntryFee
        ? "Payment received! Your registration has been submitted for review."
        : "Successfully registered for showcase",
      contestant,
    });
  } catch (error) {
    console.error("Error registering contestant:", error);
    console.error("Register contestant context:", {
      showcaseId: req.body?.showcaseId,
      userId: req.user?._id,
    });
    res.status(500).json({
      success: false,
      message: "Failed to register",
      error: error.message,
    });
  }
};

// Get contestants for a showcase
exports.getContestants = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { status } = req.query;

    const filter = { showcase: showcaseId };
    // Only filter by status if it's explicitly provided and not empty
    if (status && status.trim() !== "") {
      filter.status = status;
    }

    const contestants = await TalentContestant.find(filter)
      .populate("user", "name username profilePhoto")
      .populate("listing", "title category")
      .sort({ votes: -1 });

    res.json({
      success: true,
      contestants,
    });
  } catch (error) {
    console.error("Error fetching contestants:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch contestants",
      error: error.message,
    });
  }
};

// Upload talent video
exports.uploadTalentVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No video file uploaded",
      });
    }

    // Get video duration using ffprobe if available
    let videoDuration = null;
    try {
      const ffprobe = require("fluent-ffmpeg").ffprobe;
      const videoPath = req.file.path;

      // Make ffprobe async with Promise
      videoDuration = await new Promise((resolve) => {
        ffprobe(videoPath, (err, metadata) => {
          if (!err && metadata && metadata.format && metadata.format.duration) {
            const duration = Math.round(metadata.format.duration);
            console.log(
              `✅ Video duration detected: ${duration} seconds (${(duration / 60).toFixed(2)} minutes)`
            );
            resolve(duration);
          } else {
            console.log("⚠️ Could not detect video duration");
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.log("⚠️ ffprobe not available, video duration will not be auto-detected");
    }

    // Return the uploaded file path
    const videoUrl = `/uploads/talent-videos/${req.file.filename}`;

    res.json({
      success: true,
      message: "Video uploaded successfully",
      videoUrl: videoUrl,
      videoDuration: videoDuration,
      filename: req.file.filename,
      size: req.file.size,
    });
  } catch (error) {
    console.error("Error uploading talent video:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload video",
      error: error.message,
    });
  }
};

// Update contestant registration (User can edit their own pending registration)
exports.updateContestantRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      performanceTitle,
      performanceDescription,
      themeTitle,
      themeCreator,
      country,
      videoUrl,
      videoCloudinaryId,
      videoDuration, // Video duration in seconds from upload
      thumbnailUrl,
      socialMedia,
    } = req.body;

    // Find the contestant
    const contestant = await TalentContestant.findById(id);

    if (!contestant) {
      return res.status(404).json({
        success: false,
        message: "Registration not found",
      });
    }

    // Verify user owns this registration
    if (contestant.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own registration",
      });
    }

    // Only allow editing if status is pending
    if (contestant.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot edit registration with status "${contestant.status}". Contact admin if you need to make changes.`,
      });
    }

    // Check if showcase is still accepting registrations
    const showcase = await TalentShowcase.findById(contestant.showcase);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    if (showcase.status !== "upcoming" && showcase.status !== "nomination") {
      return res.status(400).json({
        success: false,
        message: "Registration period has ended for this showcase",
      });
    }

    // Update contestant details
    const MAX_PERFORMANCE_DURATION = 300; // 5 minutes max

    if (videoCloudinaryId !== undefined) {
      const newId = videoCloudinaryId || null;
      contestant.videoCloudinaryId = newId;
    }

    contestant.performanceTitle = performanceTitle || contestant.performanceTitle;
    contestant.performanceDescription = performanceDescription || contestant.performanceDescription;
    contestant.themeTitle = themeTitle || contestant.themeTitle;
    contestant.themeCreator = themeCreator || contestant.themeCreator;
    contestant.country = country || contestant.country;
    contestant.videoUrl = videoUrl || contestant.videoUrl;
    if (videoDuration !== undefined)
      contestant.videoDuration = Math.min(videoDuration, MAX_PERFORMANCE_DURATION); // Cap at 5 minutes
    contestant.thumbnailUrl = thumbnailUrl || contestant.thumbnailUrl;
    if (socialMedia) contestant.socialMedia = socialMedia;

    await contestant.save();

    res.json({
      success: true,
      message: "Registration updated successfully",
      contestant,
    });
  } catch (error) {
    console.error("Error updating contestant registration:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update registration",
      error: error.message,
    });
  }
};

// Approve/Reject contestant (Admin only)
exports.updateContestantStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const contestant = await TalentContestant.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).populate("showcase");

    if (!contestant) {
      return res.status(404).json({
        success: false,
        message: "Contestant not found",
      });
    }

    // If approved, check if we need to update the event timeline
    if (status === "approved" && contestant.showcase) {
      const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
      const TalentContestant = require("../models/TalentContestant");

      const timeline = await ShowcaseEventTimeline.findOne({ showcase: contestant.showcase._id });

      if (timeline) {
        // Get all approved/selected contestants
        const approvedContestants = await TalentContestant.find({
          showcase: contestant.showcase._id,
          status: { $in: ["approved", "selected"] },
        });

        // Reschedule performances with updated contestant list
        timeline.schedulePerformances(approvedContestants);
        await timeline.save();

        console.log(
          `✅ Updated timeline with ${approvedContestants.length} approved/selected contestants`
        );
      }

      // If there's an entry fee and it hasn't been paid, notify user about payment
      if (contestant.entryFee?.amount > 0 && !contestant.entryFee.paid) {
        // TODO: Send email/notification with payment instructions
        // For now, we'll include payment info in the response
        console.log(
          `💰 Payment required: ${contestant.showcase.entryFeeCurrency} ${contestant.entryFee.amount}`
        );
      }
    }

    const responseMessage =
      status === "approved" && contestant.entryFee?.amount > 0 && !contestant.entryFee.paid
        ? `Contestant approved. Payment of ${contestant.showcase.entryFeeCurrency || "USD"} ${contestant.entryFee.amount} is required to complete registration.`
        : `Contestant ${status}`;

    res.json({
      success: true,
      message: responseMessage,
      contestant,
      paymentRequired:
        status === "approved" && contestant.entryFee?.amount > 0 && !contestant.entryFee.paid,
      paymentDetails:
        contestant.entryFee?.amount > 0
          ? {
              amount: contestant.entryFee.amount,
              currency: contestant.showcase.entryFeeCurrency || "USD",
              paid: contestant.entryFee.paid,
            }
          : null,
    });
  } catch (error) {
    console.error("Error updating contestant status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update contestant status",
      error: error.message,
    });
  }
};

// ============ VOTING SYSTEM ============

// Cast vote
exports.castVote = async (req, res) => {
  try {
    const { showcaseId } = req.params; // Get from URL params
    const { contestantId } = req.body;
    const userId = req.user ? req.user._id : null;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Check showcase
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Check if voting is open - either via showcase flag OR timeline voting phase
    let isVotingAllowed = showcase.isVotingOpen;

    // Also check timeline for live events
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (timeline && timeline.isLive) {
      const votingPhase = timeline.phases.find((p) => p.name === "voting");
      if (votingPhase && votingPhase.status === "active") {
        isVotingAllowed = true;
      }
    }

    if (!isVotingAllowed) {
      return res.status(400).json({
        success: false,
        message: "Voting is not currently open for this showcase",
      });
    }

    // Check contestant - during live voting, accept 'selected' or 'approved' status
    const contestant = await TalentContestant.findOne({
      _id: contestantId,
      showcase: showcaseId,
      status: { $in: ["approved", "selected"] },
    });

    if (!contestant) {
      return res.status(404).json({
        success: false,
        message: "Contestant not found or not approved",
      });
    }

    // Check if user or IP already voted
    const existingVote = userId
      ? await ShowcaseVote.findOne({ showcase: showcaseId, user: userId })
      : await ShowcaseVote.findOne({ showcase: showcaseId, ipAddress });

    if (existingVote) {
      // Check max votes rule
      const userVotes = userId
        ? await ShowcaseVote.countDocuments({ showcase: showcaseId, user: userId })
        : await ShowcaseVote.countDocuments({ showcase: showcaseId, ipAddress });

      const maxVotes =
        userId && req.user.tier && req.user.tier !== "Free"
          ? showcase.rules.maxVotesPerUser + showcase.rules.premiumBonusVotes
          : showcase.rules.maxVotesPerUser;

      if (userVotes >= maxVotes) {
        return res.status(400).json({
          success: false,
          message: `You have reached the maximum number of votes (${maxVotes})`,
        });
      }
    }

    // Determine vote weight - everyone gets 1 vote weight for fair voting
    let voteWeight = 1;

    // Create vote
    const vote = new ShowcaseVote({
      showcase: showcaseId,
      contestant: contestantId,
      user: userId,
      ipAddress,
      userAgent: req.get("user-agent"),
      voteWeight,
      country: req.body.country,
    });

    await vote.save();

    // Update contestant votes
    contestant.votes += voteWeight;
    await contestant.save();

    // Update showcase total votes
    showcase.totalVotes += voteWeight;
    await showcase.save();

    res.json({
      success: true,
      message: "Vote cast successfully",
      votesRemaining:
        userId && req.user.tier && req.user.tier !== "Free"
          ? showcase.rules.maxVotesPerUser +
            showcase.rules.premiumBonusVotes -
            (existingVote ? userVotes + 1 : 1)
          : showcase.rules.maxVotesPerUser - (existingVote ? userVotes + 1 : 1),
    });
  } catch (error) {
    console.error("Error casting vote:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "You have already voted for this contestant",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to cast vote",
      error: error.message,
    });
  }
};

// Get voting results/leaderboard
exports.getLeaderboard = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const contestants = await TalentContestant.find({
      showcase: showcaseId,
      status: { $in: ["approved", "selected"] },
    })
      .populate("user", "name username profilePhoto")
      .sort({ votes: -1, finalScore: -1 })
      .limit(20);

    res.json({
      success: true,
      leaderboard: contestants,
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
      error: error.message,
    });
  }
};

// Get user's voting history
exports.getUserVotes = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const votes = await ShowcaseVote.find({
      showcase: showcaseId,
      user: req.user._id,
    }).populate("contestant", "performanceTitle votes");

    res.json({
      success: true,
      votes,
    });
  } catch (error) {
    console.error("Error fetching user votes:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch votes",
      error: error.message,
    });
  }
};

// ============ ADMIN FUNCTIONS ============

// Set winner and close showcase
exports.setWinner = async (req, res) => {
  try {
    const { showcaseId, contestantId } = req.body;

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    const contestant = await TalentContestant.findById(contestantId)
      .populate("user")
      .populate("listing");

    if (!contestant) {
      return res.status(404).json({
        success: false,
        message: "Contestant not found",
      });
    }

    // Mark contestant as winner
    contestant.isWinner = true;
    contestant.wonAt = new Date();
    await contestant.save();

    showcase.winner = contestantId;
    showcase.status = "completed";
    await showcase.save();

    // Auto-feature the winner on homepage for 30 days
    const { autoFeatureWinner } = require("../utils/featuredHelper");
    const featured = await autoFeatureWinner(contestant);

    console.log(`✅ Winner set and featured: ${contestant.performanceTitle}`);

    res.json({
      success: true,
      message: "Winner set and auto-featured successfully",
      showcase,
      featured,
    });
  } catch (error) {
    console.error("Error setting winner:", error);
    res.status(500).json({
      success: false,
      message: "Failed to set winner",
      error: error.message,
    });
  }
};

// Add judge score
exports.addJudgeScore = async (req, res) => {
  try {
    const { contestantId, judgeName, score, comment } = req.body;

    const contestant = await TalentContestant.findById(contestantId);
    if (!contestant) {
      return res.status(404).json({
        success: false,
        message: "Contestant not found",
      });
    }

    contestant.judgeScores.push({
      judge: judgeName,
      score,
      comment,
    });

    // Calculate total judge score
    const totalScore = contestant.judgeScores.reduce((sum, js) => sum + js.score, 0);
    const avgScore = totalScore / contestant.judgeScores.length;
    contestant.totalJudgeScore = avgScore;

    // Recalculate final score
    contestant.calculateFinalScore();

    await contestant.save();

    res.json({
      success: true,
      message: "Judge score added successfully",
      contestant,
    });
  } catch (error) {
    console.error("Error adding judge score:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add judge score",
      error: error.message,
    });
  }
};

// Get showcase analytics
exports.getShowcaseAnalytics = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Get vote distribution by country
    const votesByCountry = await ShowcaseVote.aggregate([
      { $match: { showcase: showcase._id } },
      { $group: { _id: "$country", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Get votes over time
    const votesOverTime = await ShowcaseVote.aggregate([
      { $match: { showcase: showcase._id } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d %H:%M", date: "$votedAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get top contestants
    const topContestants = await TalentContestant.find({
      showcase: showcaseId,
      status: "approved",
    })
      .populate("user", "name username")
      .sort({ votes: -1 })
      .limit(10);

    res.json({
      success: true,
      analytics: {
        totalVotes: showcase.totalVotes,
        totalViewers: showcase.totalViewers,
        totalContestants: showcase.contestants.length,
        votesByCountry,
        votesOverTime,
        topContestants,
      },
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
      error: error.message,
    });
  }
};

// Submit sponsorship request
exports.submitSponsorshipRequest = async (req, res) => {
  try {
    const { name, email, companyName, contributionAmount, currency, message, phone, website } =
      req.body;

    // Validate required fields
    if (!name || !email || !contributionAmount) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and contribution amount are required",
      });
    }

    // Verify payment on the server (never trust client-side paymentStatus)
    const { paymentOrderId } = req.body;
    if (!paymentOrderId) {
      return res.status(400).json({
        success: false,
        message: "Payment is required before submitting sponsorship.",
      });
    }

    const Payment = require("../models/Payment");
    const expectedCurrency = String(currency || "USD").toUpperCase();
    const expectedAmount = parseFloat(contributionAmount);

    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid contribution amount",
      });
    }

    const payment = await Payment.findOne({
      orderId: paymentOrderId,
      status: "completed",
      paymentType: "showcase",
      user: req.user._id,
    }).select("amount user paymentType status");

    if (!payment) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Please complete payment first.",
      });
    }

    if (payment.amount?.currency && payment.amount.currency !== expectedCurrency) {
      return res.status(400).json({
        success: false,
        message: "Payment currency mismatch",
      });
    }

    if (payment.amount?.value && Math.abs(payment.amount.value - expectedAmount) > 0.01) {
      return res.status(400).json({
        success: false,
        message: "Payment amount mismatch",
      });
    }

    // Create and save sponsorship request
    const sponsorshipRequest = await SponsorshipRequest.create({
      user: req.user._id,
      name,
      email,
      companyName,
      contributionAmount,
      currency: currency || "USD",
      message,
      phone,
      website,
      status: "completed", // Payment completed successfully
      viewedByAdmin: false, // Mark as unread so admin can see new sponsorships
      paymentOrderId: paymentOrderId || null,
    });

    console.log("Sponsorship Request Created:", sponsorshipRequest._id);

    res.json({
      success: true,
      message: "Sponsorship request submitted successfully. We will contact you soon!",
      sponsorshipId: sponsorshipRequest._id,
    });
  } catch (error) {
    console.error("Error submitting sponsorship request:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit sponsorship request",
      error: error.message,
    });
  }
};

// Get all sponsorship requests (Admin only)
exports.getSponsorshipRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const requests = await SponsorshipRequest.find(filter)
      .populate("user", "name email profilePhoto")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SponsorshipRequest.countDocuments(filter);
    const unreadCount = await SponsorshipRequest.countDocuments({ viewedByAdmin: false });

    res.json({
      success: true,
      requests,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching sponsorship requests:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sponsorship requests",
      error: error.message,
    });
  }
};

// Mark sponsorship request as viewed (Admin only)
exports.markSponsorshipViewed = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await SponsorshipRequest.findByIdAndUpdate(
      id,
      {
        viewedByAdmin: true,
        viewedAt: new Date(),
      },
      { new: true }
    ).populate("user", "name email profilePhoto");

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Sponsorship request not found",
      });
    }

    res.json({
      success: true,
      request,
    });
  } catch (error) {
    console.error("Error marking sponsorship as viewed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update sponsorship request",
      error: error.message,
    });
  }
};

// Update sponsorship request status (Admin only)
exports.updateSponsorshipStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const request = await SponsorshipRequest.findByIdAndUpdate(
      id,
      {
        status,
        adminNotes,
        viewedByAdmin: true,
        viewedAt: new Date(),
      },
      { new: true }
    ).populate("user", "name email profilePhoto");

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Sponsorship request not found",
      });
    }

    res.json({
      success: true,
      message: "Sponsorship request updated successfully",
      request,
    });
  } catch (error) {
    console.error("Error updating sponsorship status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update sponsorship request",
      error: error.message,
    });
  }
};

// Delete sponsorship request (Admin only)
exports.deleteSponsorshipRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await SponsorshipRequest.findByIdAndDelete(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Sponsorship request not found",
      });
    }

    res.json({
      success: true,
      message: "Sponsorship request deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting sponsorship request:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete sponsorship request",
      error: error.message,
    });
  }
};

// Get unread sponsorship count (Admin only)
exports.getUnreadSponsorshipCount = async (req, res) => {
  try {
    const count = await SponsorshipRequest.countDocuments({ viewedByAdmin: false });

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
      error: error.message,
    });
  }
};

// Create PayPal order for entry fee (before registration)
exports.createEntryFeePayPalOrder = async (req, res) => {
  try {
    const { showcaseId } = req.body;
    const { createOrder } = require("../utils/paypal");

    const showcase = await TalentShowcase.findById(showcaseId);

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Check if showcase has entry fee
    if (!showcase.entryFee || showcase.entryFee <= 0) {
      return res.status(400).json({
        success: false,
        message: "This showcase does not require an entry fee",
      });
    }

    // Check if user already registered
    const existing = await TalentContestant.findOne({
      showcase: showcaseId,
      user: req.user._id,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already registered for this showcase",
      });
    }

    const amount = showcase.entryFee;
    const currency = showcase.entryFeeCurrency || "USD";

    // Admin bypass
    if (req.user?.role === "admin") {
      const fakeOrderId = `ADMIN-ENTRY-${Date.now()}`;

      return res.json({
        success: true,
        orderId: fakeOrderId,
        adminBypass: true,
        message: "Admin bypass - you can register without payment",
      });
    }

    // Create PayPal order (authoritative server amount)
    const order = await createOrder(
      amount,
      `showcase-entry-${showcaseId}`,
      currency,
      req.user._id,
      {
        returnUrl: process.env.PAYPAL_RETURN_URL || "http://localhost:3001",
        cancelUrl: process.env.PAYPAL_CANCEL_URL || "http://localhost:3001",
      }
    );

    res.json({
      success: true,
      orderId: order.id,
      amount,
      currency,
    });
  } catch (error) {
    console.error("Error creating PayPal order for entry fee:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create payment order",
      error: error.message,
    });
  }
};

// ============ RAFFLE SELECTION SYSTEM ============

/**
 * Execute raffle selection for a showcase
 * (Admin only)
 */
exports.executeRaffle = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { customSeed } = req.body; // Optional: for testing/verification

    // Verify admin
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admins can execute raffle",
      });
    }

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Check if registration has closed
    const now = new Date();
    if (now < showcase.registrationEndDate) {
      return res.status(400).json({
        success: false,
        message: `Registration is still open until ${showcase.registrationEndDate.toLocaleString()}. Raffle cannot be executed yet.`,
      });
    }

    // Check if raffle already executed
    if (showcase.raffleExecutedDate) {
      return res.status(400).json({
        success: false,
        message: "Raffle has already been executed for this showcase",
        executedAt: showcase.raffleExecutedDate,
        executedBy: showcase.raffleExecutedBy,
      });
    }

    // Get all submitted contestants (status: 'submitted' or 'pending-raffle')
    const contestants = await TalentContestant.find({
      showcase: showcaseId,
      status: { $in: ["submitted", "pending-raffle"] },
    }).populate("user", "name email country");

    if (contestants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No contestants have registered for this showcase",
      });
    }

    // Check if enough contestants
    const maxContestants = showcase.maxContestants || 5;

    // Perform raffle
    const raffleResults = performRaffle(contestants, maxContestants, customSeed);

    // Update showcase with raffle results
    showcase.raffleSeed = raffleResults.raffleSeed;
    showcase.raffleExecutedDate = raffleResults.raffleTimestamp;
    showcase.raffleExecutedBy = req.user._id;
    showcase.raffleResults = raffleResults.selected;
    showcase.waitlist = raffleResults.waitlist;
    showcase.status = "raffle-completed";

    // Update selected contestants
    const updatePromises = [];

    for (const selected of raffleResults.selected) {
      updatePromises.push(
        TalentContestant.findByIdAndUpdate(selected.contestant, {
          raffleStatus: "selected",
          rafflePosition: selected.position,
          raffleRandomNumber: selected.randomNumber,
          status: "selected",
        })
      );
    }

    // Update waitlisted contestants
    for (const waitlisted of raffleResults.waitlist) {
      updatePromises.push(
        TalentContestant.findByIdAndUpdate(waitlisted.contestant, {
          raffleStatus: "waitlisted",
          rafflePosition: waitlisted.position,
          raffleRandomNumber: waitlisted.randomNumber,
          status: "waitlisted",
        })
      );
    }

    await Promise.all(updatePromises);

    // Delete all unselected AND waitlisted contestants immediately after raffle
    // Only keep the selected contestants
    const selectedIds = raffleResults.selected.map((s) => s.contestant.toString());

    // Find all non-selected contestants before deleting for logging
    const nonSelectedContestants = await TalentContestant.find({
      showcase: showcaseId,
      _id: { $nin: selectedIds },
    }).populate("user", "name email");

    console.log(
      `🗑️  Preparing to delete ${nonSelectedContestants.length} non-selected contestants (waitlisted + unselected) from showcase ${showcaseId}`
    );
    nonSelectedContestants.forEach((c) => {
      console.log(
        `   - Deleting: ${c.user?.name || "Unknown"} (${c.user?.email || "No email"}) - Status: ${c.status}`
      );
    });

    // Permanently delete all contestants except selected ones
    const deleteResult = await TalentContestant.deleteMany({
      showcase: showcaseId,
      _id: { $nin: selectedIds },
    });

    console.log(
      `✅ Successfully deleted ${deleteResult.deletedCount} non-selected contestants from showcase ${showcaseId}`
    );

    // Update showcase with raffle info and save
    showcase.contestants = raffleResults.selected.map((s) => s.contestant);
    // Clear waitlist since we're deleting them
    showcase.waitlist = [];
    await showcase.save();

    // ✨ IMPORTANT: Schedule performances in timeline now that contestants are selected
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (timeline) {
      // Get the selected contestants with full data
      const selectedContestants = await TalentContestant.find({
        showcase: showcaseId,
        status: "selected",
      }).sort({ rafflePosition: 1 });

      if (selectedContestants.length > 0) {
        console.log(
          `🎬 [RAFFLE] Scheduling ${selectedContestants.length} performances in timeline after raffle`
        );

        // Clear any existing performances and schedule new ones
        timeline.performances = [];
        timeline.schedulePerformances(selectedContestants);
        await timeline.save();

        console.log(
          `✅ [RAFFLE] Successfully scheduled ${timeline.performances.length} performances`
        );
        timeline.performances.forEach((perf, idx) => {
          console.log(
            `   ${idx + 1}. Duration: ${perf.videoDuration}s - ${selectedContestants[idx]?.performanceTitle || "Unknown"}`
          );
        });
      }
    } else {
      console.log(
        "⚠️ [RAFFLE] No timeline found - performances will be scheduled when timeline is created"
      );
    }

    // Generate public report
    const publicReport = generatePublicReport(raffleResults, showcase.title);

    // Send notifications to selected contestants
    // 1) Real-time in-app popup (Socket.io) if they are online
    // 2) Persistent announcement so they can see it later even if offline
    const Announcement = require("../models/Announcement");
    const { getIO } = require("../utils/socket");

    const selectedContestantsForNotify = await TalentContestant.find({
      _id: { $in: selectedIds },
    }).populate("user", "_id name email");

    const selectedUserIds = selectedContestantsForNotify.map((c) => c.user?._id).filter(Boolean);

    // Persistent announcement (shows in Profile -> Announcements)
    if (selectedUserIds.length > 0) {
      await Announcement.create({
        subject: `🎉 You have been selected for ${showcase.title}!`,
        message: `Next Steps: Start reaching out to friends, family, and supporters to solicit their votes during the live event. The more support you gather now, the better your chances!`,
        sender: req.user._id,
        recipients: {
          type: "individual",
          value: selectedUserIds,
        },
        priority: "high",
        status: "sent",
      });
    }

    // Real-time socket event (immediate popup)
    const io = getIO?.();
    if (io && selectedUserIds.length > 0) {
      selectedUserIds.forEach((userId) => {
        io.to(userId.toString()).emit("raffle-selected", {
          showcaseId: showcaseId,
          showcaseTitle: showcase.title,
        });
      });
    }

    // Log selections
    selectedContestantsForNotify.forEach((contestantDoc) => {
      const match = raffleResults.selected.find(
        (s) => s.contestant.toString() === contestantDoc._id.toString()
      );
      console.log(
        `✅ Selected: ${contestantDoc.user?.name || "Unknown"} - Position ${match?.position ?? "N/A"}`
      );
    });

    res.json({
      success: true,
      message: `Raffle executed successfully. ${raffleResults.selected.length} selected and kept, ${deleteResult.deletedCount} contestants (waitlisted + unselected) permanently deleted.`,
      raffle: {
        totalApplicants: contestants.length,
        selected: raffleResults.selected.length,
        waitlisted: 0, // No longer keeping waitlist
        unselectedDeleted: deleteResult.deletedCount,
        keptTotal: raffleResults.selected.length,
        executedAt: raffleResults.raffleTimestamp,
        executedBy: req.user.email,
      },
      publicReport,
    });
  } catch (error) {
    console.error("Error executing raffle:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute raffle",
      error: error.message,
    });
  }
};

/**
 * Get raffle results for a showcase (Public)
 */
exports.getRaffleResults = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const showcase = await TalentShowcase.findById(showcaseId)
      .populate({
        path: "raffleResults.contestant",
        populate: {
          path: "user",
          select: "name country profilePhoto",
        },
      })
      .populate({
        path: "waitlist.contestant",
        populate: {
          path: "user",
          select: "name country",
        },
      });

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    if (!showcase.raffleExecutedDate) {
      return res.status(400).json({
        success: false,
        message: "Raffle has not been executed yet",
        registrationEndDate: showcase.registrationEndDate,
        raffleScheduledDate: showcase.raffleScheduledDate,
      });
    }

    // Build transparent results
    const results = {
      showcase: {
        title: showcase.title,
        category: showcase.category,
        maxContestants: showcase.maxContestants,
      },
      raffle: {
        executedDate: showcase.raffleExecutedDate,
        raffleSeed: showcase.raffleSeed, // Public for verification
        algorithm: "SHA-256 Deterministic Random Selection",
      },
      statistics: {
        totalApplicants: showcase.raffleResults.length + showcase.waitlist.length,
        selected: showcase.raffleResults.length,
        waitlisted: showcase.waitlist.length,
      },
      selectedContestants: showcase.raffleResults.map((result) => ({
        position: result.position,
        randomNumber: result.randomNumber,
        selectedAt: result.selectedAt,
        contestant: {
          id: result.contestant._id,
          name: result.contestant.user?.name || "Unknown",
          country: result.contestant.user?.country || result.contestant.country,
          performanceTitle: result.contestant.performanceTitle,
          thumbnailUrl: result.contestant.thumbnailUrl,
        },
      })),
      waitlist: showcase.waitlist.slice(0, 10).map((result) => ({
        // Show top 10
        position: result.position,
        randomNumber: result.randomNumber,
        contestant: {
          id: result.contestant._id,
          name: result.contestant.user?.name || "Unknown",
          country: result.contestant.user?.country || result.contestant.country,
        },
      })),
      verification: {
        howToVerify: [
          "1. Use the raffle seed provided above",
          '2. Apply SHA-256 hash to "seed-contestantIndex" for each contestant',
          "3. Sort all contestants by their random numbers (ascending)",
          "4. The top N contestants with the lowest random numbers are selected",
          "5. Compare the contestant IDs with the selected list above",
        ],
        note: "This raffle used cryptographically secure random number generation to ensure fairness and transparency.",
      },
    };

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("Error getting raffle results:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get raffle results",
      error: error.message,
    });
  }
};

/**
 * Verify raffle results (Public)
 * Allows anyone to independently verify the raffle was fair
 */
exports.verifyRaffleResults = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    if (!showcase.raffleExecutedDate) {
      return res.status(400).json({
        success: false,
        message: "Raffle has not been executed yet",
      });
    }

    // Get all contestants (both selected and waitlisted)
    // We need ALL contestants who were part of the raffle, not just selected/waitlisted
    const allContestants = await TalentContestant.find({
      showcase: showcaseId,
      status: { $in: ["selected", "waitlisted"] },
    }).sort({ createdAt: 1 }); // Sort by creation time to maintain original order

    if (allContestants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No contestants found for this raffle",
      });
    }

    const expectedSelected = showcase.raffleResults.map((r) => r.contestant.toString());

    // Verify raffle
    const isValid = verifyRaffle(
      allContestants,
      showcase.raffleSeed,
      expectedSelected,
      showcase.maxContestants
    );

    res.json({
      success: true,
      verified: isValid,
      message: isValid
        ? "Raffle results are valid and verifiable"
        : "Raffle results verification failed",
      details: {
        raffleSeed: showcase.raffleSeed,
        totalContestants: allContestants.length,
        selectedContestants: expectedSelected.length,
        executedDate: showcase.raffleExecutedDate,
      },
    });
  } catch (error) {
    console.error("Error verifying raffle:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify raffle",
      error: error.message,
    });
  }
};

/**
 * Get raffle status for a showcase (Public)
 * Shows registration windows and raffle schedule
 */
exports.getRaffleStatus = async (req, res) => {
  try {
    const { showcaseId } = req.params;

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    const now = new Date();

    // Count current registrations
    const registrationCount = await TalentContestant.countDocuments({
      showcase: showcaseId,
      status: { $in: ["submitted", "pending-raffle", "selected", "waitlisted"] },
    });

    const status = {
      showcase: {
        title: showcase.title,
        category: showcase.category,
        maxContestants: showcase.maxContestants,
      },
      registration: {
        startDate: showcase.registrationStartDate,
        endDate: showcase.registrationEndDate,
        submissionDeadline: showcase.submissionDeadline,
        isOpen: now >= showcase.registrationStartDate && now <= showcase.registrationEndDate,
        hasEnded: now > showcase.registrationEndDate,
        currentRegistrations: registrationCount,
        spotsAvailable: showcase.maxContestants,
      },
      raffle: {
        scheduledDate: showcase.raffleScheduledDate,
        executedDate: showcase.raffleExecutedDate,
        isExecuted: !!showcase.raffleExecutedDate,
        isPending: now > showcase.registrationEndDate && !showcase.raffleExecutedDate,
      },
      timeline: {
        current: now,
        phase:
          now < showcase.registrationStartDate
            ? "before-registration"
            : now <= showcase.registrationEndDate
              ? "registration-open"
              : now <= showcase.submissionDeadline
                ? "submission-period"
                : !showcase.raffleExecutedDate
                  ? "awaiting-raffle"
                  : "raffle-completed",
      },
    };

    res.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error("Error getting raffle status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get raffle status",
      error: error.message,
    });
  }
};

// Upload commercial video for showcase (supports multiple commercials)
exports.uploadCommercialVideo = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { title } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No video file provided",
      });
    }

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    const result = await addCommercialToShowcase({
      showcaseId,
      filePath: req.file.path,
      title,
      requestedDurationSeconds: req.body?.duration,
    });

    res.json({
      success: true,
      message: "Commercial uploaded successfully",
      videoUrl: result.videoUrl,
      commercials: result.commercials,
      totalDuration: result.totalDurationSeconds,
      commercialDuration: result.commercialDuration,
    });
  } catch (error) {
    console.error("Error uploading commercial video:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload commercial video",
      error: error.message,
    });
  }
};

// Add commercial by URL (Admin) - used for direct-to-Cloudinary uploads
exports.addCommercialFromUrl = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { title, videoUrl, duration } = req.body || {};

    const urlStr = String(videoUrl || "").trim();
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) {
      return res.status(400).json({
        success: false,
        message: "videoUrl is required and must be an absolute http(s) URL",
      });
    }

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ success: false, message: "Showcase not found" });
    }

    const MAX_COMMERCIAL_SECONDS = Number(process.env.COMMERCIAL_MAX_SECONDS || 150);
    const requestedDuration = Number(duration);
    let normalizedDuration = 30;
    if (Number.isFinite(requestedDuration) && requestedDuration > 0) {
      normalizedDuration = Math.ceil(requestedDuration);
      if (normalizedDuration > MAX_COMMERCIAL_SECONDS) {
        normalizedDuration = MAX_COMMERCIAL_SECONDS;
      }
    }

    if (!showcase.commercials) showcase.commercials = [];

    const newCommercial = {
      videoUrl: urlStr,
      title: title || `Advertisement ${showcase.commercials.length + 1}`,
      duration: normalizedDuration,
      order: showcase.commercials.length,
      uploadedAt: new Date(),
    };

    showcase.commercials.push(newCommercial);

    const totalDurationSeconds = showcase.commercials.reduce((sum, c) => {
      const seconds = Number(c?.duration);
      return sum + (Number.isFinite(seconds) && seconds > 3 ? seconds : 30);
    }, 0);
    showcase.commercialDuration = Math.ceil(totalDurationSeconds / 60);
    await showcase.save();

    return res.json({
      success: true,
      message: "Commercial added successfully",
      videoUrl: urlStr,
      commercials: showcase.commercials,
      totalDuration: totalDurationSeconds,
      commercialDuration: showcase.commercialDuration,
    });
  } catch (error) {
    console.error("Error adding commercial from URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add commercial",
      error: error.message,
    });
  }
};

// ============ CHUNKED COMMERCIAL UPLOADS (Admin) ============

exports.initCommercialUpload = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { filename, totalChunks, totalSize, mimetype, title, duration, chunkSize } =
      req.body || {};

    const nTotalChunks = Number(totalChunks);
    const nTotalSize = Number(totalSize);
    const nChunkSize = Number(chunkSize || 0);

    if (!filename || !Number.isFinite(nTotalChunks) || nTotalChunks <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid upload metadata (filename/totalChunks required)",
      });
    }

    // Validate showcase exists early
    const showcase = await TalentShowcase.findById(showcaseId).select("_id");
    if (!showcase) {
      return res.status(404).json({ success: false, message: "Showcase not found" });
    }

    ensureDir(COMMERCIAL_TMP_ROOT);
    const uploadId = uuidv4();
    const dir = path.join(COMMERCIAL_TMP_ROOT, uploadId);
    ensureDir(dir);

    const meta = {
      uploadId,
      showcaseId,
      filename: safeFilename(filename),
      mimetype: mimetype || null,
      totalChunks: nTotalChunks,
      totalSize: Number.isFinite(nTotalSize) ? nTotalSize : null,
      title: title || null,
      duration: Number(duration) || null,
      chunkSize: Number.isFinite(nChunkSize) && nChunkSize > 0 ? nChunkSize : null,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));

    res.json({
      success: true,
      uploadId,
      maxChunkBytes: Number(process.env.UPLOAD_CHUNK_MAX_BYTES || 8 * 1024 * 1024),
    });
  } catch (error) {
    console.error("initCommercialUpload error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to init upload", error: error.message });
  }
};

exports.uploadCommercialChunk = async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body || {};
    const idx = Number(chunkIndex);

    if (!uploadId || !Number.isFinite(idx) || idx < 0) {
      return res
        .status(400)
        .json({ success: false, message: "uploadId and chunkIndex are required" });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: "No chunk provided" });
    }

    const dir = path.join(COMMERCIAL_TMP_ROOT, uploadId);
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ success: false, message: "Upload session not found" });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (String(meta.uploadId) !== String(uploadId)) {
      return res.status(400).json({ success: false, message: "Invalid upload session" });
    }
    if (idx >= Number(meta.totalChunks)) {
      return res.status(400).json({ success: false, message: "chunkIndex out of range" });
    }

    // Basic access check: ensure session matches this showcase and requester is admin (already enforced)
    const chunkName = `chunk-${String(idx).padStart(6, "0")}`;
    fs.writeFileSync(path.join(dir, chunkName), req.file.buffer);

    res.json({ success: true, uploadId, chunkIndex: idx });
  } catch (error) {
    console.error("uploadCommercialChunk error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to upload chunk", error: error.message });
  }
};

exports.completeCommercialUpload = async (req, res) => {
  try {
    const { showcaseId } = req.params;
    const { uploadId } = req.body || {};
    if (!uploadId) {
      return res.status(400).json({ success: false, message: "uploadId is required" });
    }

    const dir = path.join(COMMERCIAL_TMP_ROOT, uploadId);
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ success: false, message: "Upload session not found" });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (String(meta.showcaseId) !== String(showcaseId)) {
      return res.status(400).json({ success: false, message: "Upload session showcase mismatch" });
    }

    const totalChunks = Number(meta.totalChunks);
    for (let i = 0; i < totalChunks; i++) {
      const chunkName = `chunk-${String(i).padStart(6, "0")}`;
      if (!fs.existsSync(path.join(dir, chunkName))) {
        return res.status(400).json({
          success: false,
          message: `Missing chunk ${i}/${totalChunks - 1}`,
        });
      }
    }

    // Merge chunks into final file in uploads/listings
    const listingsDir = path.join(__dirname, "..", "uploads", "listings");
    ensureDir(listingsDir);
    const finalName = `${Date.now()}-${safeFilename(meta.filename)}`;
    const finalPath = path.join(listingsDir, finalName);

    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < totalChunks; i++) {
      const chunkName = `chunk-${String(i).padStart(6, "0")}`;
      const chunkPath = path.join(dir, chunkName);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(chunkPath);
        readStream.on("error", reject);
        readStream.on("end", resolve);
        readStream.pipe(writeStream, { end: false });
      });
    }

    await new Promise((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    const result = await addCommercialToShowcase({
      showcaseId,
      filePath: finalPath,
      title: meta.title,
      requestedDurationSeconds: meta.duration,
    });

    // Cleanup temp session
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn("⚠️ Could not cleanup commercial upload temp:", cleanupErr.message);
    }

    res.json({
      success: true,
      message: "Commercial uploaded successfully",
      videoUrl: result.videoUrl,
      commercials: result.commercials,
      totalDuration: result.totalDurationSeconds,
      commercialDuration: result.commercialDuration,
    });
  } catch (error) {
    console.error("completeCommercialUpload error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to complete upload", error: error.message });
  }
};

// Delete commercial video from showcase
exports.deleteCommercialVideo = async (req, res) => {
  try {
    const { showcaseId, commercialIndex } = req.params;
    const index = parseInt(commercialIndex);

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    if (!showcase.commercials || showcase.commercials.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No commercials found",
      });
    }

    if (index < 0 || index >= showcase.commercials.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid commercial index",
      });
    }

    // Get the commercial to delete (for file cleanup)
    const commercialToDelete = showcase.commercials[index];

    // Remove the commercial from array
    showcase.commercials.splice(index, 1);

    // Re-calculate order for remaining commercials
    showcase.commercials.forEach((commercial, idx) => {
      commercial.order = idx;
    });

    // Auto-calculate total commercial duration (in minutes)
    const totalDurationSeconds = showcase.commercials.reduce((sum, c) => {
      const seconds = Number(c?.duration);
      return sum + (Number.isFinite(seconds) && seconds > 3 ? seconds : 30);
    }, 0);
    showcase.commercialDuration = Math.ceil(totalDurationSeconds / 60);

    await showcase.save();

    // Optional: Delete the file from filesystem (only for local uploads)
    try {
      const localUrl = String(commercialToDelete.videoUrl || "");
      if (/^\/uploads\//.test(localUrl)) {
        const path = require("path");
        const fs = require("fs");
        const relativeVideoPath = localUrl.replace(/^\/+/, "");
        const filePath = path.join(__dirname, "..", relativeVideoPath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      console.warn("Could not delete commercial file:", err.message);
    }

    res.json({
      success: true,
      message: "Commercial deleted successfully",
      commercials: showcase.commercials,
      totalDuration: totalDurationSeconds,
      commercialDuration: showcase.commercialDuration,
    });
  } catch (error) {
    console.error("Error deleting commercial video:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete commercial video",
      error: error.message,
    });
  }
};

// Upload stream video for showcase
exports.uploadStreamVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No video file provided",
      });
    }

    // Store the file path/URL
    const videoUrl = `/uploads/listings/${req.file.filename}`;

    res.json({
      success: true,
      message: "Stream video uploaded successfully",
      streamUrl: videoUrl,
    });
  } catch (error) {
    console.error("Error uploading stream video:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload stream video",
      error: error.message,
    });
  }
};

// Upload static image for showcase
exports.uploadStaticImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    // Store the file path/URL
    const imageUrl = `/uploads/listings/${req.file.filename}`;

    res.json({
      success: true,
      message: "Image uploaded successfully",
      imageUrl: imageUrl,
    });
  } catch (error) {
    console.error("Error uploading static image:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload image",
      error: error.message,
    });
  }
};

// Get structured timeline for a showcase
exports.getStructuredTimeline = async (req, res) => {
  try {
    const serverNow = new Date();

    // This endpoint is polled frequently and also triggers auto-advance logic.
    // In production behind proxies/CDNs, ensure it is never cached.
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
    const TalentContestant = require("../models/TalentContestant");

    // First, get the showcase to check if auto-initialization is needed
    const showcase = await TalentShowcase.findById(req.params.id);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    let timeline = await ShowcaseEventTimeline.findOne({
      showcase: req.params.id,
    })
      .populate("showcase")
      .populate({
        path: "performances.contestant",
        populate: {
          path: "user",
          select: "name username profilePhoto",
        },
      })
      .populate({
        path: "winnerAnnouncement.winner",
        select: "performanceTitle performanceDescription user votes country thumbnailUrl videoUrl",
        populate: {
          path: "user",
          select: "name username profilePhoto",
        },
      });

    // AUTO-INITIALIZE: If no timeline exists and event time has passed, create it
    if (!timeline && showcase.eventDate) {
      const eventTime = new Date(showcase.eventDate).getTime();
      const currentTime = Date.now();

      if (currentTime >= eventTime && showcase.status !== "completed") {
        console.log(
          `🚀 AUTO-INITIALIZE (via timeline fetch): Event "${showcase.title}" should be live, creating timeline...`
        );

        try {
          // Get selected contestants
          const contestants = await TalentContestant.find({
            showcase: req.params.id,
            status: "selected",
          }).sort({ rafflePosition: 1 });

          if (contestants.length > 0) {
            // Create new timeline
            timeline = new ShowcaseEventTimeline({
              showcase: req.params.id,
              config: {
                welcomeDuration: showcase.welcomeDuration ?? 5,
                performanceSlotDuration: showcase.performanceDuration || 0,
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

            // CRITICAL: Initialize phase start/end times BEFORE scheduling performances
            const eventStartTime = new Date(showcase.eventDate);
            let currentTime = new Date(eventStartTime);

            timeline.phases.forEach((phase, index) => {
              phase.startTime = new Date(currentTime);
              phase.endTime = new Date(currentTime.getTime() + phase.duration * 60000);
              currentTime = new Date(phase.endTime);
              phase.status = index === 0 ? "active" : "pending"; // First phase is active
            });

            // Now schedule contestant performances (requires phase times to be set)
            timeline.schedulePerformances(contestants);
            console.log(
              `🎬 AUTO-INITIALIZE: Scheduled ${timeline.performances.length} performances`
            );

            // Auto-start the event
            timeline.isLive = true;
            timeline.actualStartTime = eventStartTime;
            timeline.currentPhase = "welcome";
            timeline.eventStatus = "live";

            await timeline.save();

            // Update showcase status
            if (showcase.status !== "live") {
              showcase.status = "live";
              await showcase.save();
            }

            console.log(
              `✅ AUTO-INITIALIZE: Timeline created and event started for "${showcase.title}"`
            );

            // Populate the timeline for response
            timeline = await ShowcaseEventTimeline.findById(timeline._id)
              .populate("showcase")
              .populate({
                path: "performances.contestant",
                populate: {
                  path: "user",
                  select: "name username profilePhoto",
                },
              });
          }
        } catch (initError) {
          console.error("❌ AUTO-INITIALIZE ERROR:", initError);
        }
      }
    }

    if (!timeline) {
      return res.status(404).json({
        success: false,
        message: "Timeline not found for this showcase",
      });
    }

    // Get approved contestants
    const contestants = await TalentContestant.find({
      showcase: req.params.id,
      status: "selected",
    })
      .populate("user", "name username profilePhoto")
      .sort({ rafflePosition: 1 }); // Sort by raffle position for performance order

    // If contestants selection changed after timeline creation, ensure performances includes ALL selected.
    // This prevents the performance phase from only ever playing the contestants that were selected at
    // the time the timeline was first created.
    try {
      const shouldEnsurePerformances =
        timeline &&
        Array.isArray(timeline.performances) &&
        Array.isArray(contestants) &&
        (timeline.currentPhase === "welcome" || timeline.currentPhase === "performance");

      if (shouldEnsurePerformances) {
        const existingContestantIds = new Set(
          timeline.performances
            .map((p) => (p?.contestant?._id || p?.contestant)?.toString())
            .filter(Boolean)
        );

        const missing = contestants.filter((c) => !existingContestantIds.has(c?._id?.toString()));

        if (missing.length > 0) {
          const maxOrder = timeline.performances.reduce((max, p) => {
            const n = Number(p?.performanceOrder);
            return Number.isFinite(n) ? Math.max(max, n) : max;
          }, 0);

          const fallbackSeconds = (timeline.config?.performanceSlotDuration || 5) * 60;

          console.log(
            `🎬 [TIMELINE] Appending ${missing.length} missing performances (had ${timeline.performances.length}, selected ${contestants.length})`
          );

          missing.forEach((contestant, idx) => {
            const raw = Number(contestant?.videoDuration);
            const videoDurationSeconds = Number.isFinite(raw) && raw > 0 ? raw : fallbackSeconds;

            timeline.performances.push({
              contestant: contestant._id,
              performanceOrder: maxOrder + idx + 1,
              videoDuration: videoDurationSeconds,
              status: "pending",
            });
          });

          await timeline.save();

          // Re-populate so response has full contestant objects
          await timeline.populate({
            path: "performances.contestant",
            populate: { path: "user", select: "name username profilePhoto" },
          });
        }
      }
    } catch (ensureErr) {
      console.error(
        "⚠️ [TIMELINE] Failed to ensure performances include all selected contestants:",
        ensureErr
      );
    }

    // AUTO-ADVANCE (time-based) phases when they expire.
    // Without this, phases like welcome/voting can remain "active" forever once started.
    // Performance is intentionally excluded because it advances per-video via /auto-advance-performance.
    try {
      const canAutoAdvance =
        timeline.isLive &&
        timeline.eventStatus !== "completed" &&
        !timeline.isPaused &&
        !(timeline.manualOverride && timeline.manualOverride.active);

      if (canAutoAdvance && Array.isArray(timeline.phases) && timeline.phases.length > 0) {
        // Commercial phase is advanced explicitly by the client once all adverts have played.
        // Auto-advancing by time can cut the break short if commercials are uploaded/changed after
        // timeline creation or if durations drift.
        const eligible = new Set(["welcome", "voting", "winner", "thankyou"]);

        let guard = 0;
        while (guard < 10) {
          guard += 1;

          let activePhase = timeline.phases.find((p) => p.status === "active");

          // Recovery: if no phase is active, activate the first non-completed phase.
          if (!activePhase) {
            const nextIndex = timeline.phases.findIndex((p) => p.status !== "completed");
            if (nextIndex === -1) break;
            timeline.phases.forEach((p, idx) => {
              if (p.status !== "completed") {
                p.status = idx === nextIndex ? "active" : "pending";
              }
            });
            timeline.currentPhase = timeline.phases[nextIndex].name;
            await timeline.save();
            continue;
          }

          const phaseName = activePhase.name;
          if (!eligible.has(phaseName)) break;
          if (!activePhase.endTime) break;

          const nowTime = new Date();
          const phaseEnd = new Date(activePhase.endTime);
          if (nowTime <= phaseEnd) break;

          console.log(
            `⏭️ [AUTO-ADVANCE] Phase "${phaseName}" expired at ${phaseEnd.toISOString()}, advancing...`
          );

          const nextPhase = timeline.advancePhase();

          // Keep voting state + winner announcement in sync on phase changes.
          try {
            const showcaseId = timeline.showcase?._id?.toString() || String(timeline.showcase);
            if (nextPhase?.name === "voting") {
              await TalentShowcase.findByIdAndUpdate(showcaseId, {
                isVotingOpen: true,
                status: "voting",
                votingStartTime: nextPhase.startTime,
                votingEndTime: nextPhase.endTime,
              });
            }
            if (nextPhase?.name === "winner") {
              await TalentShowcase.findByIdAndUpdate(showcaseId, {
                isVotingOpen: false,
              });
              await ensureWinnerAnnouncement(timeline, showcaseId);
            }
          } catch (syncErr) {
            console.error("⚠️ [AUTO-ADVANCE] Phase transition sync failed:", syncErr);
          }

          await timeline.save();

          // Stop once we enter performance (manual per-video) or the event ends.
          if (!nextPhase || nextPhase.name === "performance") {
            break;
          }
        }
      }
    } catch (autoErr) {
      console.error("⚠️ [AUTO-ADVANCE] Failed to auto-advance phase:", autoErr);
    }

    // Get current phase and time remaining
    const now = new Date();
    let currentPhaseObj = null;
    let timeRemaining = 0;
    let currentPerformer = null;

    // Safety: if we're already in winner phase but the announcement wasn't generated (e.g., manual overrides), generate it.
    try {
      const currentPhaseName =
        typeof timeline.currentPhase === "object"
          ? timeline.currentPhase.name
          : timeline.currentPhase;
      if (currentPhaseName === "winner" && !timeline?.winnerAnnouncement?.announcementTime) {
        const showcaseId = timeline.showcase?._id?.toString() || String(timeline.showcase);
        await ensureWinnerAnnouncement(timeline, showcaseId);
        await timeline.save();
      }
    } catch (winnerErr) {
      console.error("⚠️ Failed to ensure winner announcement:", winnerErr);
    }

    // If we just wrote winnerAnnouncement, ensure it's populated for the client response.
    try {
      if (
        timeline?.winnerAnnouncement?.winner &&
        !timeline.winnerAnnouncement.winner?.performanceTitle
      ) {
        await timeline.populate({
          path: "winnerAnnouncement.winner",
          select:
            "performanceTitle performanceDescription user votes country thumbnailUrl videoUrl",
          populate: {
            path: "user",
            select: "name username profilePhoto",
          },
        });
      }
    } catch (populateErr) {
      console.error("⚠️ Failed to populate winnerAnnouncement.winner:", populateErr);
    }

    // Find current active phase
    const activePhase = timeline.phases.find((p) => p.status === "active");
    if (activePhase) {
      currentPhaseObj = activePhase;
      const phaseEnd = new Date(activePhase.endTime);
      timeRemaining = Math.floor(Math.max(0, (phaseEnd - now) / 1000)); // in seconds
    }

    // If we're in the performance phase, find the current performer
    let activePerformance = null;
    const currentPhaseName =
      typeof timeline.currentPhase === "object"
        ? timeline.currentPhase.name
        : timeline.currentPhase;

    if (
      currentPhaseName === "performance" &&
      timeline.performances &&
      timeline.performances.length > 0
    ) {
      // CRITICAL: Sort performances by performanceOrder to ensure correct playback sequence
      timeline.performances.sort((a, b) => a.performanceOrder - b.performanceOrder);

      console.log("🎭 [DEBUG] Performance phase - checking for active performer");
      console.log("🎭 [DEBUG] Total performances:", timeline.performances.length);
      console.log(
        " [DEBUG] Performances status:",
        timeline.performances.map(
          (p, i) => `#${i + 1}: ${p.status} - ${p.contestant?.performanceTitle || "NO CONTESTANT"}`
        )
      );

      // DEBUG: Log all performance videoDurations AND contestant population status
      console.log("🎭 [DEBUG] Performance videoDurations:");
      timeline.performances.forEach((p, i) => {
        console.log(`  Performance #${i + 1}:`, {
          order: p.performanceOrder,
          status: p.status,
          videoDuration: p.videoDuration,
          contestantId: p.contestant?._id || "NULL CONTESTANT ID",
          contestantPopulated: !!p.contestant,
          contestantVideoDuration: p.contestant?.videoDuration,
          title: p.contestant?.performanceTitle,
        });
      });

      // Find the active performance
      activePerformance = timeline.performances.find((p) => p.status === "active");

      // CRITICAL: Ensure only ONE performance is active at a time
      const multipleActive = timeline.performances.filter((p) => p.status === "active");
      if (multipleActive.length > 1) {
        console.error("❌ CRITICAL: Multiple performances marked as active! Fixing...");
        // Keep only the first one active, mark others as pending
        multipleActive.forEach((perf, idx) => {
          if (idx > 0) {
            console.log(
              `⚠️ Resetting duplicate active performance #${perf.performanceOrder} to pending`
            );
            perf.status = "pending";
          }
        });
        activePerformance = multipleActive[0];
      }

      // If no active performance found but we're in performance phase, use the first pending one
      if (!activePerformance) {
        activePerformance = timeline.performances.find((p) => p.status === "pending");
        console.log(
          "⚠️ [TIMELINE] No active performance found, using first pending:",
          activePerformance?.contestant?.performanceTitle
        );
      }

      // If we had to fall back to a pending performance, promote it to active so auto-advance works.
      // IMPORTANT: Do NOT mutate timeline state on GET requests.
      // Starting/resetting performances here means a viewer refresh can affect all devices.
      // The scheduler and explicit advance endpoints are responsible for marking a performance active.

      if (activePerformance) {
        console.log("🎭 [DEBUG] Found performance:", {
          status: activePerformance.status,
          hasContestant: !!activePerformance.contestant,
          contestantId: activePerformance.contestant?._id,
          title: activePerformance.contestant?.performanceTitle,
          videoUrl: activePerformance.contestant?.videoUrl,
          performanceVideoDuration: activePerformance.videoDuration,
          contestantVideoDuration: activePerformance.contestant?.videoDuration,
        });
      }

      if (activePerformance && activePerformance.contestant) {
        currentPerformer = activePerformance.contestant;

        // Priority order for videoDuration:
        // 1. Performance record's videoDuration (set during scheduling)
        // 2. Contestant's videoDuration (from upload)
        const perfDuration = activePerformance.videoDuration;
        const contestantDuration = currentPerformer.videoDuration;

        if (perfDuration && perfDuration > 0) {
          currentPerformer.videoDuration = perfDuration;
          console.log(`✅ Using performance.videoDuration: ${perfDuration}s`);
        } else if (contestantDuration && contestantDuration > 0) {
          currentPerformer.videoDuration = contestantDuration;
          console.log(
            `⚠️ Performance.videoDuration missing, using contestant.videoDuration: ${contestantDuration}s`
          );
        } else {
          console.error(
            `❌ CRITICAL: No videoDuration found for ${currentPerformer.performanceTitle}!`
          );
          // Don't set a fallback - let it be null/undefined to surface the issue
        }

        console.log(
          "✅ [TIMELINE] Current performer set:",
          currentPerformer.performanceTitle,
          "URL:",
          currentPerformer.videoUrl,
          "Duration:",
          currentPerformer.videoDuration
        );
      } else {
        console.log(
          "❌ [TIMELINE] No currentPerformer found - activePerformance:",
          !!activePerformance,
          "contestant:",
          !!activePerformance?.contestant
        );
      }
    }

    console.log("📤 [TIMELINE API RESPONSE]:", {
      currentPhase: currentPhaseName,
      hasCurrentPerformer: !!currentPerformer,
      currentPerformerTitle: currentPerformer?.performanceTitle,
      currentPerformerVideoUrl: currentPerformer?.videoUrl,
      performancesCount: timeline.performances?.length || 0,
      activePerformanceIndex: timeline.performances?.findIndex((p) => p.status === "active"),
      performancesExist: !!timeline.performances,
      rawPerformances: timeline.performances?.map((p) => ({
        order: p.performanceOrder,
        status: p.status,
        hasContestant: !!p.contestant,
        contestantId: p.contestant?._id?.toString() || "NULL",
      })),
    });

    // CRITICAL: Check if we're in performance phase but have no performer
    if (currentPhaseName === "performance" && !currentPerformer) {
      console.error("❌❌❌ CRITICAL ERROR: Performance phase active but NO currentPerformer!");
      console.error("Timeline ID:", timeline._id);
      console.error("Showcase ID:", timeline.showcase?._id);
      console.error("Performances count:", timeline.performances?.length || 0);
      console.error("Active performance:", activePerformance ? "EXISTS" : "NULL");
      console.error(
        "Active performance has contestant:",
        activePerformance?.contestant ? "YES" : "NO"
      );

      if (timeline.performances && timeline.performances.length > 0) {
        console.error("All performance records:");
        timeline.performances.forEach((p, i) => {
          console.error(
            `  [${i}] Order: ${p.performanceOrder}, Status: ${p.status}, Contestant ID in DB: ${p.contestant}, Populated: ${!!p.contestant?._id}`
          );
        });
      }
    }

    // Viewer count: baseline + real unique sessions
    const baseViewers = Number.isFinite(Number(timeline.viewerCountBase))
      ? Math.max(0, Number(timeline.viewerCountBase))
      : 2000;
    const activeViewersCount = Array.isArray(timeline.activeViewers)
      ? timeline.activeViewers.length
      : 0;
    const shouldShowLiveViewers =
      timeline.isLive ||
      timeline.eventStatus === "live" ||
      timeline.showcase?.status === "live" ||
      timeline.showcase?.status === "voting";
    const computedViewerCount = shouldShowLiveViewers
      ? baseViewers + activeViewersCount
      : activeViewersCount;
    const computedPeakViewerCount = Math.max(timeline.peakViewerCount || 0, computedViewerCount);

    res.json({
      success: true,
      timeline: {
        serverTime: serverNow.toISOString(),
        _id: timeline._id,
        showcase: timeline.showcase,
        phases: timeline.phases,
        currentPhase: currentPhaseObj || timeline.currentPhase,
        currentPhaseStartTime: currentPhaseObj?.startTime,
        currentPerformanceStartTime: activePerformance?.startTime,
        currentPerformer: currentPerformer
          ? {
              _id: currentPerformer._id,
              performanceTitle: currentPerformer.performanceTitle,
              performanceDescription: currentPerformer.performanceDescription,
              videoUrl: currentPerformer.videoUrl,
              videoDuration: currentPerformer.videoDuration, // Already set from performance record above
              thumbnailUrl: currentPerformer.thumbnailUrl,
              country: currentPerformer.country,
              votes: currentPerformer.votes || currentPerformer.voteCount || 0,
              user: currentPerformer.user,
            }
          : null,
        timeRemaining,
        isLive: timeline.isLive,
        isPaused: !!timeline.isPaused,
        pausedAt: timeline.pausedAt || null,
        eventStatus: timeline.eventStatus,
        viewerCountBase: baseViewers,
        viewerCount: computedViewerCount,
        peakViewerCount: computedPeakViewerCount,
        performances: timeline.performances,
        commercialContent: timeline.showcase.commercialContent,
        commercialVideoUrl: timeline.showcase.commercialVideoUrl,
        winnerAnnouncement: timeline.winnerAnnouncement,
        thankYouMessage: timeline.thankYouMessage,
        contestants: contestants.map((c) => ({
          _id: c._id,
          performanceTitle: c.performanceTitle,
          performanceDescription: c.performanceDescription,
          videoUrl: c.videoUrl,
          thumbnailUrl: c.thumbnailUrl,
          votes: c.votes || c.voteCount || 0,
          user: c.user,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching structured timeline:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch timeline",
      error: error.message,
    });
  }
};

// ============ LIVE EVENT CONTROL ENDPOINTS ============

// Pause/Resume live event
exports.pauseResumeEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'pause' or 'resume'

    console.log(`🎮 Pause/Resume request - ID: ${id}, Action: ${action}`);

    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

    const showcase = await TalentShowcase.findById(id);
    if (!showcase) {
      console.error("❌ Showcase not found:", id);
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (timeline) {
      console.log("✅ Timeline found, current phase:", timeline.currentPhase);
      // Keep legacy control state in sync for admin UI/other processes
      showcase.liveEventControl = showcase.liveEventControl || {};
      // Use timeline pause/resume
      if (action === "pause") {
        timeline.isPaused = true;
        timeline.pausedAt = new Date();
        if (req.user && req.user._id) {
          timeline.pausedBy = req.user._id;
        }

        showcase.liveEventControl.isPaused = true;
        showcase.liveEventControl.pausedAt = timeline.pausedAt;
        if (req.user && req.user._id) {
          showcase.liveEventControl.pausedBy = req.user._id;
        }
      } else if (action === "resume") {
        const pausedAt = timeline.pausedAt;
        timeline.isPaused = false;

        // Calculate pause duration and extend phase times
        if (pausedAt) {
          const pauseDuration = new Date() - pausedAt;

          // Extend all remaining phases by pause duration
          const currentPhaseIndex = timeline.phases.findIndex(
            (p) => p.name === timeline.currentPhase
          );
          if (currentPhaseIndex >= 0) {
            for (let i = currentPhaseIndex; i < timeline.phases.length; i++) {
              if (timeline.phases[i].startTime) {
                timeline.phases[i].startTime = new Date(
                  timeline.phases[i].startTime.getTime() + pauseDuration
                );
              }
              if (timeline.phases[i].endTime) {
                timeline.phases[i].endTime = new Date(
                  timeline.phases[i].endTime.getTime() + pauseDuration
                );
              }
            }
          }

          // Extend performances if in performance phase
          if (timeline.currentPhase === "performance" && timeline.performances) {
            const activePerformance = timeline.performances.find((p) => p.status === "active");
            if (activePerformance) {
              // Extend the active performance times
              if (activePerformance.startTime) {
                activePerformance.startTime = new Date(
                  activePerformance.startTime.getTime() + pauseDuration
                );
              }
              if (activePerformance.endTime) {
                activePerformance.endTime = new Date(
                  activePerformance.endTime.getTime() + pauseDuration
                );
              }
            }

            // Extend all pending performances
            timeline.performances.forEach((perf) => {
              if (perf.status === "pending") {
                if (perf.startTime) {
                  perf.startTime = new Date(perf.startTime.getTime() + pauseDuration);
                }
                if (perf.endTime) {
                  perf.endTime = new Date(perf.endTime.getTime() + pauseDuration);
                }
              }
            });
          }
        }

        timeline.pausedAt = null;
        timeline.pausedBy = null;

        showcase.liveEventControl.isPaused = false;
        showcase.liveEventControl.pausedAt = null;
        showcase.liveEventControl.pausedBy = null;
      }

      await timeline.save();
      await showcase.save();

      res.json({
        success: true,
        message: action === "pause" ? "Event paused" : "Event resumed",
        liveEventControl: {
          isPaused: timeline.isPaused,
          pausedAt: timeline.pausedAt,
          currentStage: timeline.currentPhase,
        },
      });
    } else {
      // Legacy fallback
      showcase.liveEventControl = showcase.liveEventControl || {};

      if (action === "pause") {
        showcase.liveEventControl.isPaused = true;
        showcase.liveEventControl.pausedAt = new Date();
        if (req.user && req.user._id) {
          showcase.liveEventControl.pausedBy = req.user._id;
        }
      } else if (action === "resume") {
        showcase.liveEventControl.isPaused = false;
        showcase.liveEventControl.pausedAt = null;
      }

      await showcase.save();

      res.json({
        success: true,
        message: action === "pause" ? "Event paused" : "Event resumed",
        liveEventControl: showcase.liveEventControl,
      });
    }
  } catch (error) {
    console.error("❌ Error pausing/resuming event:", error);
    console.error("Stack trace:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to pause/resume event",
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// Skip to next stage
exports.skipToStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body; // 'welcome', 'performance', 'commercial', 'voting', 'winner', 'thankyou', 'countdown'
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

    const showcase = await TalentShowcase.findById(id);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (timeline) {
      // Update all phase statuses
      const targetPhaseIndex = timeline.phases.findIndex((p) => p.name === stage);
      if (targetPhaseIndex === -1) {
        return res.status(400).json({
          success: false,
          message: "Invalid stage name",
        });
      }

      // Set previous phases to completed
      for (let i = 0; i < targetPhaseIndex; i++) {
        timeline.phases[i].status = "completed";
      }

      // Set target phase to active
      timeline.phases[targetPhaseIndex].status = "active";
      timeline.phases[targetPhaseIndex].startTime = new Date();

      // Set future phases to pending
      for (let i = targetPhaseIndex + 1; i < timeline.phases.length; i++) {
        timeline.phases[i].status = "pending";
      }

      // Update timeline to skip to the requested phase
      timeline.currentPhase = stage;
      timeline.currentPhaseStartTime = new Date();

      // Keep voting state + winner announcement consistent.
      if (stage === "voting") {
        await TalentShowcase.findByIdAndUpdate(id, {
          isVotingOpen: true,
          status: "voting",
        });
      }
      if (stage === "winner") {
        await TalentShowcase.findByIdAndUpdate(id, {
          isVotingOpen: false,
        });
        await ensureWinnerAnnouncement(timeline, id);
      }

      if (!timeline.manualOverride) {
        timeline.manualOverride = {};
      }
      timeline.manualOverride.active = true;
      timeline.manualOverride.overriddenAt = new Date();
      timeline.manualOverride.overriddenBy = req.user._id;

      // If skipping to performance phase, reset to first performance
      if (stage === "performance" && timeline.performances && timeline.performances.length > 0) {
        timeline.currentPerformerIndex = 0;
        // Reset all performances to pending
        timeline.performances.forEach((p) => (p.status = "pending"));
        // Set first to active
        timeline.performances[0].status = "active";
        timeline.performances[0].startTime = new Date();
      }

      await timeline.save();

      res.json({
        success: true,
        message: `Skipped to ${stage} phase`,
        liveEventControl: {
          currentStage: timeline.currentPhase,
          stageStartedAt: timeline.currentPhaseStartTime,
          manualOverride: timeline.manualOverride,
        },
      });
    } else {
      // Legacy fallback
      showcase.liveEventControl = showcase.liveEventControl || {};
      showcase.liveEventControl.manualOverride = {
        active: true,
        stage,
        setBy: req.user._id,
        setAt: new Date(),
      };
      showcase.liveEventControl.currentStage = stage;
      showcase.liveEventControl.stageStartedAt = new Date();

      await showcase.save();

      res.json({
        success: true,
        message: `Skipped to ${stage} stage`,
        liveEventControl: showcase.liveEventControl,
      });
    }
  } catch (error) {
    console.error("Error skipping to stage:", error);
    res.status(500).json({
      success: false,
      message: "Failed to skip to stage",
      error: error.message,
    });
  }
};

// Extend or reduce current stage time (supports positive and negative values)
exports.extendStageTime = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, additionalMinutes } = req.body;
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

    const showcase = await TalentShowcase.findById(id);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (timeline) {
      // Find the current active phase
      const currentPhaseIndex = timeline.phases.findIndex((p) => p.status === "active");
      if (currentPhaseIndex === -1) {
        return res.status(400).json({
          success: false,
          message: "No active phase to modify",
        });
      }

      // Calculate adjustment in milliseconds (positive = extend, negative = reduce)
      const adjustmentMs = additionalMinutes * 60 * 1000;

      // Check if reduction would make phase end time before current time
      const currentPhase = timeline.phases[currentPhaseIndex];
      const newEndTime = new Date(currentPhase.endTime.getTime() + adjustmentMs);
      const now = new Date();

      if (newEndTime < now && additionalMinutes < 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot reduce time by ${Math.abs(additionalMinutes)} minutes. This would make the phase end time (${newEndTime.toISOString()}) earlier than current time (${now.toISOString()}). Maximum reduction: ${Math.floor((currentPhase.endTime - now) / 60000)} minutes.`,
        });
      }

      // Adjust the current phase end time
      timeline.phases[currentPhaseIndex].endTime = newEndTime;

      // Adjust all future phases by the same amount
      for (let i = currentPhaseIndex + 1; i < timeline.phases.length; i++) {
        timeline.phases[i].startTime = new Date(
          timeline.phases[i].startTime.getTime() + adjustmentMs
        );
        timeline.phases[i].endTime = new Date(timeline.phases[i].endTime.getTime() + adjustmentMs);
      }

      // Track the adjustment
      if (!timeline.timeExtensions) {
        timeline.timeExtensions = [];
      }
      timeline.timeExtensions.push({
        phase: timeline.currentPhase,
        extensionMinutes: additionalMinutes,
        action: additionalMinutes > 0 ? "extended" : "reduced",
        extendedAt: new Date(),
        extendedBy: req.user._id,
      });

      await timeline.save();

      const action = additionalMinutes > 0 ? "Extended" : "Reduced";
      const actionPast = additionalMinutes > 0 ? "extended by" : "reduced by";

      res.json({
        success: true,
        message: `${action} ${timeline.currentPhase} phase ${actionPast} ${Math.abs(additionalMinutes)} minutes`,
        adjustment: {
          phase: timeline.currentPhase,
          minutes: additionalMinutes,
          action: additionalMinutes > 0 ? "extend" : "reduce",
          newEndTime: newEndTime.toISOString(),
          timeRemaining: Math.floor((newEndTime - now) / 1000), // seconds
        },
        liveEventControl: {
          currentStage: timeline.currentPhase,
          timeExtensions: timeline.timeExtensions,
        },
      });
    } else {
      // Legacy fallback
      if (!showcase.liveEventControl) {
        showcase.liveEventControl = {};
      }
      if (!showcase.liveEventControl.timeExtensions) {
        showcase.liveEventControl.timeExtensions = [];
      }

      showcase.liveEventControl.timeExtensions.push({
        stage,
        additionalMinutes,
        action: additionalMinutes > 0 ? "extended" : "reduced",
        addedBy: req.user._id,
        addedAt: new Date(),
      });

      await showcase.save();

      const action = additionalMinutes > 0 ? "Extended" : "Reduced";
      const actionPast = additionalMinutes > 0 ? "extended by" : "reduced by";

      res.json({
        success: true,
        message: `${action} ${stage} stage ${actionPast} ${Math.abs(additionalMinutes)} minutes`,
        liveEventControl: showcase.liveEventControl,
      });
    }
  } catch (error) {
    console.error("Error adjusting stage time:", error);
    res.status(500).json({
      success: false,
      message: "Failed to adjust stage time",
      error: error.message,
    });
  }
};

// Stop event
exports.stopEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { declareWinner, winnerId } = req.body;

    const showcase = await TalentShowcase.findById(id);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    if (declareWinner && winnerId) {
      showcase.winner = winnerId;

      // Update winner in contestant
      const TalentContestant = require("../models/TalentContestant");
      await TalentContestant.findByIdAndUpdate(winnerId, {
        isWinner: true,
        wonAt: new Date(),
      });
    }

    showcase.status = "completed";
    showcase.liveEventControl.isPaused = false;
    showcase.liveEventControl.manualOverride = {
      active: false,
      stage: null,
    };

    await showcase.save();

    res.json({
      success: true,
      message: "Event stopped successfully",
      showcase,
    });
  } catch (error) {
    console.error("Error stopping event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to stop event",
      error: error.message,
    });
  }
};

// Restart event
exports.restartEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
    const TalentContestant = require("../models/TalentContestant");

    const showcase = await TalentShowcase.findById(id);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    let timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (!timeline) {
      return res.status(404).json({
        success: false,
        message: "Event timeline not found",
      });
    }

    // Get selected contestants
    const contestants = await TalentContestant.find({
      showcase: id,
      status: "selected",
    })
      .populate("user", "name username profilePhoto")
      .sort({ rafflePosition: 1 });

    console.log(`🔄 [RESTART] Found ${contestants.length} selected contestants`);

    // If timeline has no performances, reschedule them from contestants
    if (!timeline.performances || timeline.performances.length === 0) {
      console.log("⚠️ [RESTART] Timeline has no performances, rescheduling from contestants");

      if (contestants.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot restart event: No contestants found",
        });
      }

      // Reschedule performances
      timeline.schedulePerformances(contestants);
      console.log(`✅ [RESTART] Scheduled ${timeline.performances.length} performances`);
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
      performance.startTime = null;
      performance.endTime = null;
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
    showcase.status = "live";
    showcase.liveEventControl = {
      isPaused: false,
      currentStage: "welcome",
      manualOverride: {
        active: false,
        stage: null,
      },
    };

    await showcase.save();

    console.log(`🔄 Event restarted: ${id} with ${timeline.performances.length} performances`);

    res.json({
      success: true,
      message: "Event restarted successfully",
      showcase,
      timeline,
      performancesScheduled: timeline.performances.length,
    });
  } catch (error) {
    console.error("Error restarting event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to restart event",
      error: error.message,
    });
  }
};

// Resume event from Performance Phase (without resetting everything)
exports.resumePerformancePhase = async (req, res) => {
  try {
    const { id } = req.params;
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
    const TalentContestant = require("../models/TalentContestant");

    const showcase = await TalentShowcase.findById(id);
    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    let timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (!timeline) {
      return res.status(404).json({
        success: false,
        message: "Event timeline not found",
      });
    }

    // Get selected contestants
    const contestants = await TalentContestant.find({
      showcase: id,
      status: "selected",
    })
      .populate("user", "name username profilePhoto")
      .sort({ rafflePosition: 1 });

    console.log(`🎭 [RESUME PERFORMANCE] Found ${contestants.length} selected contestants`);

    if (contestants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot resume performances: No contestants found",
      });
    }

    // If timeline has no performances, reschedule them from contestants
    if (!timeline.performances || timeline.performances.length === 0) {
      console.log(
        "⚠️ [RESUME PERFORMANCE] Timeline has no performances, scheduling from contestants"
      );
      timeline.schedulePerformances(contestants);
      console.log(`✅ [RESUME PERFORMANCE] Scheduled ${timeline.performances.length} performances`);
    }

    // Find the performance phase
    const performancePhaseIndex = timeline.phases.findIndex((p) => p.name === "performance");

    if (performancePhaseIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "Performance phase not found in timeline",
      });
    }

    const now = new Date();

    // Set all phases before performance to completed
    timeline.phases.forEach((phase, index) => {
      if (index < performancePhaseIndex) {
        phase.status = "completed";
      } else if (index === performancePhaseIndex) {
        // Performance phase - set it active
        phase.status = "active";
        phase.startTime = now;
        // Calculate end time based on total performance duration
        const totalDuration = timeline.performances.reduce((sum, perf) => {
          return sum + (perf.videoDuration || 300);
        }, 0);
        phase.endTime = new Date(now.getTime() + totalDuration * 1000);
      } else {
        // Future phases - keep pending
        phase.status = "pending";
        phase.startTime = null;
        phase.endTime = null;
      }
    });

    // Reset all performances to pending
    timeline.performances.forEach((perf) => {
      perf.status = "pending";
      perf.startTime = null;
      perf.endTime = null;
    });

    // Set first performance as active
    if (timeline.performances.length > 0) {
      timeline.performances[0].status = "active";
      timeline.performances[0].startTime = now;
      const videoDuration = timeline.performances[0].videoDuration || 300;
      timeline.performances[0].endTime = new Date(now.getTime() + videoDuration * 1000);
      console.log(
        `✅ [RESUME PERFORMANCE] First performance activated: ${timeline.performances[0].contestant}`
      );
    }

    // Update timeline state
    timeline.isLive = true;
    timeline.eventStatus = "live";
    timeline.currentPhase = "performance";
    timeline.isPaused = false;

    await timeline.save();

    // Update showcase status
    showcase.status = "live";
    showcase.liveEventControl = {
      isPaused: false,
      currentStage: "performance",
      manualOverride: {
        active: false,
        stage: null,
      },
    };

    await showcase.save();

    console.log(
      ` Event resumed at Performance phase: ${id} with ${timeline.performances.length} performances`
    );

    res.json({
      success: true,
      message: "Event resumed at Performance phase successfully",
      showcase,
      timeline,
      performancesScheduled: timeline.performances.length,
    });
  } catch (error) {
    console.error("Error resuming performance phase:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resume performance phase",
      error: error.message,
    });
  }
};

// Get live event control status
exports.getLiveEventControl = async (req, res) => {
  try {
    const { id } = req.params;
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

    const showcase = await TalentShowcase.findById(id).select(
      "title status eventDate showcaseType contestants musicUrl musicPlaying"
    );

    if (!showcase) {
      return res.status(404).json({
        success: false,
        message: "Showcase not found",
      });
    }

    // Check if this is a structured event with timeline
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (timeline) {
      // Auto-update showcase status if timeline has ended
      if (timeline.eventStatus === "completed" && showcase.status !== "completed") {
        showcase.status = "completed";
        await showcase.save();
      }

      // Return timeline-based control state
      res.json({
        success: true,
        showcase: {
          _id: showcase._id,
          title: showcase.title,
          status: timeline.eventStatus === "completed" ? "completed" : showcase.status,
          eventDate: showcase.eventDate,
          showcaseType: "structured",
          musicUrl: showcase.musicUrl,
          musicPlaying: showcase.musicPlaying,
          liveEventControl: {
            isLive: timeline.isLive,
            isPaused: timeline.isPaused,
            pausedAt: timeline.pausedAt,
            currentStage: timeline.currentPhase,
            stageStartedAt: timeline.currentPhaseStartTime,
            manualOverride: timeline.manualOverride || { active: false },
            timeExtensions: timeline.timeExtensions || [],
          },
          timeline: {
            currentPhase: timeline.currentPhase,
            currentPerformer: timeline.currentPerformer,
            totalPerformances: timeline.performances?.length || 0,
            completedPerformances:
              timeline.performances?.filter((p) => p.status === "completed").length || 0,
          },
        },
      });
    } else {
      // Return legacy control state
      res.json({
        success: true,
        showcase: {
          _id: showcase._id,
          title: showcase.title,
          status: showcase.status,
          eventDate: showcase.eventDate,
          showcaseType: "legacy",
          musicUrl: showcase.musicUrl,
          musicPlaying: showcase.musicPlaying,
          liveEventControl: showcase.liveEventControl || {
            isPaused: false,
            currentStage: null,
            timeExtensions: [],
          },
        },
      });
    }
  } catch (error) {
    console.error("Error getting live event control:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get live event control",
      error: error.message,
    });
  }
};

// Advance to next performance (automatically called by system or manually by admin)
exports.advancePerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: id }).populate(
      "performances.contestant"
    );

    if (!timeline) {
      return res.status(404).json({
        success: false,
        message: "Timeline not found",
      });
    }

    // Prevent accidental double-advances when multiple clients fire the "ended" trigger
    // (or the same client fires twice). If we're not in the performance phase, this
    // endpoint should be a no-op.
    const activePhaseName = timeline?.phases?.find((p) => p.status === "active")?.name;
    const phaseName = activePhaseName || timeline.currentPhase;
    if (phaseName !== "performance") {
      return res.json({
        success: true,
        message: "Not in performance phase - no action taken",
        currentPhase: phaseName,
      });
    }

    if (timeline.isPaused) {
      return res.status(409).json({
        success: false,
        message: "Event is paused - cannot advance performance",
        isPaused: true,
        currentPhase: timeline.currentPhase,
      });
    }

    // CRITICAL: Sort performances by performanceOrder to ensure correct sequence
    timeline.performances.sort((a, b) => a.performanceOrder - b.performanceOrder);

    // Find current active performance
    let currentIndex = timeline.performances.findIndex((p) => p.status === "active");

    console.log(
      `📡 [ADVANCE] Current active index: ${currentIndex}, Total performances: ${timeline.performances.length}`
    );

    // If no active performance found, find the last completed one to determine next
    if (currentIndex === -1) {
      const completedPerformances = timeline.performances.filter((p) => p.status === "completed");
      if (completedPerformances.length > 0) {
        // Find the highest index among completed performances
        currentIndex = timeline.performances.findIndex((p) =>
          p._id.equals(completedPerformances[completedPerformances.length - 1]._id)
        );
        console.log(
          `⚠️ [ADVANCE] No active performance, using last completed at index ${currentIndex}`
        );
      } else {
        // No active and no completed: treat as "not started yet" and start the first pending.
        const firstPendingIndex = timeline.performances.findIndex((p) => p.status === "pending");
        if (firstPendingIndex >= 0) {
          console.warn(
            `⚠️ [ADVANCE] No active/completed performances found; starting first pending at index ${firstPendingIndex}`
          );
          currentIndex = firstPendingIndex - 1; // so nextIndex becomes firstPendingIndex
        } else {
          console.error(
            `❌ [ADVANCE] No active, completed, or pending performances found - invalid state`
          );
          return res.status(400).json({
            success: false,
            message: "Invalid performance state - no performances available",
          });
        }
      }
    }

    // CRITICAL: Mark ALL active performances as completed (in case of duplicates)
    timeline.performances.forEach((perf, idx) => {
      if (perf.status === "active") {
        perf.status = "completed";
        console.log(
          `✅ [ADVANCE] Marked performance #${perf.performanceOrder} as completed (index ${idx})`
        );
      }
    });

    // Move to next performance
    const nextIndex = currentIndex + 1;

    if (nextIndex < timeline.performances.length) {
      // Start next performance
      const nextPerf = timeline.performances[nextIndex];
      nextPerf.status = "active";
      nextPerf.startTime = new Date();

      // Ensure videoDuration is set - if not, get from contestant
      if (!nextPerf.videoDuration) {
        const contestant = nextPerf.contestant;
        nextPerf.videoDuration = contestant.videoDuration || 300; // 5 min fallback
        console.log(
          `⚠️ videoDuration was missing, set to: ${nextPerf.videoDuration}s from contestant`
        );
      }

      nextPerf.endTime = new Date(Date.now() + nextPerf.videoDuration * 1000);

      timeline.currentPerformance = {
        contestant: nextPerf.contestant._id,
        performanceOrder: nextPerf.performanceOrder,
        startTime: new Date(),
        timeRemaining: nextPerf.videoDuration,
      };

      console.log(
        `✅ Advanced to performance #${nextPerf.performanceOrder}: ${nextPerf.contestant.performanceTitle} (${nextPerf.videoDuration}s)`
      );

      await timeline.save();

      // Re-populate to get full contestant data
      await timeline.populate("performances.contestant");

      res.json({
        success: true,
        message: "Advanced to next performance",
        currentPerformance: timeline.performances[nextIndex],
        currentPerformer: timeline.performances[nextIndex].contestant,
        timeRemaining: timeline.performances[nextIndex].videoDuration,
      });
    } else {
      // All performances complete - advance to next phase (commercial)
      // Re-check phase before advancing in case the timeline changed between
      // request arrival and execution.
      const activePhaseNameNow = timeline?.phases?.find((p) => p.status === "active")?.name;
      const phaseNameNow = activePhaseNameNow || timeline.currentPhase;
      if (phaseNameNow !== "performance") {
        return res.json({
          success: true,
          message: "Not in performance phase - no action taken",
          currentPhase: phaseNameNow,
        });
      }

      timeline.advancePhase();
      await timeline.save();

      res.json({
        success: true,
        message: "All performances complete, advancing to next phase",
        nextPhase: timeline.currentPhase,
      });
    }
  } catch (error) {
    console.error("Error advancing performance:", error);
    res.status(500).json({
      success: false,
      message: "Failed to advance performance",
      error: error.message,
    });
  }
};

// Handle commercials completion signal
exports.commercialsComplete = async (req, res) => {
  try {
    const { id } = req.params;
    const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: id });

    if (!timeline) {
      return res.status(404).json({
        success: false,
        message: "Timeline not found",
      });
    }

    if (timeline.isPaused) {
      return res.status(409).json({
        success: false,
        message: "Event is paused - cannot complete commercials",
        isPaused: true,
        currentPhase: timeline.currentPhase,
      });
    }

    // Check if we're in commercial phase
    if (timeline.currentPhase !== "commercial") {
      console.log(
        "📺 Commercials complete signal received, but not in commercial phase:",
        timeline.currentPhase
      );
      return res.json({
        success: true,
        message: "Not in commercial phase, no action needed",
        currentPhase: timeline.currentPhase,
      });
    }

    console.log("📺 All commercials completed, advancing to next phase...");

    // Advance to next phase (voting)
    timeline.advancePhase();
    await timeline.save();

    console.log("✅ Advanced from commercial to:", timeline.currentPhase);

    res.json({
      success: true,
      message: "All commercials completed, advanced to next phase",
      previousPhase: "commercial",
      nextPhase: timeline.currentPhase,
    });
  } catch (error) {
    console.error("❌ Error handling commercials complete:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process commercials completion",
      error: error.message,
    });
  }
};
