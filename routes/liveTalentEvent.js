const express = require("express");
const router = express.Router();
const TalentShowcase = require("../models/TalentShowcase");
const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
const ytdl = require("@distube/ytdl-core");

const YT_DURATION_CACHE_TTL_MS = 10 * 60 * 1000;
const youtubeDurationCache = new Map();

const normalizeDurationSeconds = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;

  // Heuristic: treat exact-millisecond values as ms (e.g., 254000 => 254s)
  if (value >= 1000 && value % 1000 === 0) {
    const asSeconds = value / 1000;
    // Only accept the ms interpretation when it yields a reasonable video duration
    if (asSeconds > 0 && asSeconds < 6 * 60 * 60) return Math.round(asSeconds);
  }

  return Math.round(value);
};

const getYouTubeDurationSeconds = async (url) => {
  if (!url || !ytdl.validateURL(url)) return 0;

  const cached = youtubeDurationCache.get(url);
  if (cached && Date.now() - cached.at < YT_DURATION_CACHE_TTL_MS) {
    return cached.seconds;
  }

  try {
    const info = await ytdl.getBasicInfo(url);
    const seconds = normalizeDurationSeconds(info?.videoDetails?.lengthSeconds);
    if (seconds > 0) {
      youtubeDurationCache.set(url, { seconds, at: Date.now() });
    }
    return seconds;
  } catch (err) {
    console.warn("⚠️ Unable to fetch YouTube duration:", url, err?.message || err);
    return 0;
  }
};

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

  if (showcase.status === "cancelled") {
    return "cancelled";
  }

  if (registrationStart && now < registrationStart) {
    return "draft";
  } else if (
    registrationStart &&
    registrationEnd &&
    now >= registrationStart &&
    now <= registrationEnd
  ) {
    return "nomination";
  } else if (registrationEnd && raffleDate && now > registrationEnd && now < raffleDate) {
    return "upcoming";
  } else if (raffleDate && eventDate && now >= raffleDate && now < eventDate) {
    return "upcoming";
  } else if (now >= eventDate) {
    const eventDuration = 2 * 60 * 60 * 1000;
    const eventEndTime = new Date(eventDate.getTime() + eventDuration);

    if (now >= eventDate && now < eventEndTime) {
      return "live";
    } else if (now >= eventEndTime) {
      return "completed";
    }
  }

  return "upcoming";
};

/**
 * Live Talent Event - Public endpoint
 * Returns the scheduled live talent event for this month
 */

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const serverTime = now.toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Find the next showcase (or recent one within 24h) for public display.
    // NOTE: This endpoint backs `/live-talent-event` which should reflect newly created
    // showcases in nomination/upcoming stages; do not hard-require a title pattern.
    let showcase = await TalentShowcase.findOne({
      eventDate: { $gte: oneDayAgo }, // Include events from the last 24 hours
      status: { $nin: ["draft", "cancelled", "completed"] },
    }).sort({ eventDate: 1 });

    // If no upcoming event found, check if there's one in progress
    if (!showcase) {
      showcase = await TalentShowcase.findOne({
        status: "live",
      });
    }

    // Fetch actual contestants with videoDuration for accurate calculations
    let contestantsWithDuration = [];
    let TalentContestant = null;
    if (showcase) {
      TalentContestant = require("../models/TalentContestant");
      contestantsWithDuration = await TalentContestant.find({
        showcase: showcase._id,
        status: { $in: ["submitted", "selected", "approved"] }, // Include submitted (registered) contestants
      }).select("videoDuration performanceTitle videoUrl");
    }

    // Update showcase status dynamically before returning
    // (For structured showcases, the timeline is the source of truth.)
    let computedShowcaseStatus = showcase?.status || null;

    // Get timeline if it exists
    let timeline = null;
    let eventStatus = "scheduled";

    if (showcase) {
      timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
      // NOTE: This endpoint is intentionally read-only. Timeline creation/starting is handled by the scheduler.

      if (showcase.showcaseType === "structured" && timeline) {
        if (timeline.eventStatus === "completed") {
          computedShowcaseStatus = "completed";
        } else if (timeline.isLive) {
          computedShowcaseStatus = timeline.currentPhase === "voting" ? "voting" : "live";
        } else if (showcase.status !== "cancelled" && showcase.status !== "completed") {
          computedShowcaseStatus = calculateShowcaseStatus(showcase);
        }
      } else if (showcase.status !== "cancelled" && showcase.status !== "completed") {
        computedShowcaseStatus = calculateShowcaseStatus(showcase);
      }

      // Determine status based on timeline phases if available
      if (timeline && timeline.phases && timeline.phases.length > 0) {
        const now = Date.now();

        // Check if any phase is currently active
        const hasActivePhase = timeline.phases.some((p) => p.status === "active");

        // Check if all phases are completed
        const allPhasesCompleted = timeline.phases.every((p) => p.status === "completed");

        // Get the first phase start time
        const firstPhase = timeline.phases[0];
        const firstPhaseStartTime = firstPhase
          ? new Date(firstPhase.startTime).getTime()
          : new Date(showcase.eventDate).getTime();

        // Get the last phase end time
        const lastPhase = timeline.phases[timeline.phases.length - 1];
        const lastPhaseEndTime = lastPhase ? new Date(lastPhase.endTime).getTime() : 0;

        if (allPhasesCompleted || now >= lastPhaseEndTime) {
          // Event has ended
          eventStatus = "ended";
        } else if (hasActivePhase && now >= firstPhaseStartTime) {
          // Event is live ONLY if there's an active phase AND we're past the start time
          eventStatus = "live";
        } else if (now < firstPhaseStartTime) {
          // Before the scheduled start time - still scheduled
          eventStatus = "scheduled";
        } else {
          // Between start time and end time, but no active phase - consider it scheduled
          // (This handles the case where timeline exists but hasn't been activated yet)
          eventStatus = "scheduled";
        }
      } else {
        // Fallback to original time-based calculation if no timeline
        const eventTime = new Date(showcase.eventDate).getTime();
        const currentTime = Date.now();
        const eventEndTime = eventTime + (timeline?.config?.totalDuration || 60) * 60 * 1000;

        if (currentTime >= eventTime && currentTime < eventEndTime) {
          eventStatus = "live";
        } else if (currentTime >= eventEndTime) {
          eventStatus = "ended";
        } else {
          eventStatus = "scheduled";
        }
      }
    }

    // Calculate next event date if this event has ended
    let nextEventDate = null;
    if (showcase && eventStatus === "ended") {
      // First, check if there's already a next showcase scheduled in the database
      const nextShowcase = await TalentShowcase.findOne({
        eventDate: { $gt: new Date(showcase.eventDate) }, // After current event
        status: { $nin: ["cancelled", "completed", "draft"] }, // Exclude cancelled/completed/draft
      })
        .sort({ eventDate: 1 })
        .limit(1);

      if (nextShowcase) {
        // Use the actual next scheduled showcase date
        nextEventDate = nextShowcase.eventDate;
      } else {
        // If no next showcase exists, check timeline's configured date
        const eventTimeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
        if (eventTimeline?.thankYouMessage?.nextEventDate) {
          nextEventDate = eventTimeline.thankYouMessage.nextEventDate;
        } else {
          // Final fallback: calculate next month from current event
          const nextMonth = new Date(showcase.eventDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          nextEventDate = nextMonth;
        }
      }
    }

    if (!showcase) {
      // No current event - check for the last completed event to get next event date
      const lastEvent = await TalentShowcase.findOne({
        status: "completed",
      })
        .sort({ eventDate: -1 })
        .limit(1);

      let nextEventDate = null;

      if (lastEvent) {
        const lastTimeline = await ShowcaseEventTimeline.findOne({ showcase: lastEvent._id });
        nextEventDate =
          lastTimeline?.thankYouMessage?.nextEventDate ||
          (() => {
            // Fallback: calculate next month from last event
            const nextMonth = new Date(lastEvent.eventDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            return nextMonth;
          })();
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
        success: false,
        serverTime,
        message: "No upcoming live talent event scheduled",
        event: null,
        status: "no-event",
        nextEventDate: nextEventDate,
        musicUrl: lastEvent?.musicUrl || null, // Include music from last event if available
        musicPlaying: lastEvent?.musicPlaying || false,
        lastEventDate: lastEvent?.eventDate || null,
      });
    }

    // Pre-compute stage durations once (seconds + minutes) so the client can display mm:ss accurately
    let timelinePerformanceTotalSeconds = 0;
    let timelinePerformanceLooksDefault = false;

    if (timeline && timeline.performances && timeline.performances.length > 0) {
      timelinePerformanceTotalSeconds = timeline.performances.reduce((sum, perf) => {
        const seconds = normalizeDurationSeconds(perf.videoDuration);
        if (!seconds || seconds === 300) timelinePerformanceLooksDefault = true;
        return sum + (seconds || 0);
      }, 0);
    }

    let performanceTotalSeconds = 0;
    let performanceDurationEstimated = false;

    if (contestantsWithDuration && contestantsWithDuration.length > 0) {
      for (const contestant of contestantsWithDuration) {
        let seconds = normalizeDurationSeconds(contestant.videoDuration);

        if (!seconds && contestant.videoUrl) {
          const ytSeconds = await getYouTubeDurationSeconds(contestant.videoUrl);
          if (ytSeconds > 0) {
            seconds = ytSeconds;
            // Persist so future calculations and timelines are accurate
            if (TalentContestant && contestant?._id) {
              await TalentContestant.updateOne(
                { _id: contestant._id },
                { $set: { videoDuration: ytSeconds } }
              );
            }
          }
        }

        if (!seconds) {
          performanceDurationEstimated = true;
          seconds = 300;
        }

        performanceTotalSeconds += seconds;
      }
    } else {
      // If we don't have contestants, fall back to timeline-derived duration
      performanceTotalSeconds = timelinePerformanceTotalSeconds;
      performanceDurationEstimated = timelinePerformanceLooksDefault;
    }

    // If timeline durations look like defaults but contestants have better data, prefer contestants.
    if (
      timelinePerformanceTotalSeconds > 0 &&
      performanceTotalSeconds > 0 &&
      timelinePerformanceLooksDefault
    ) {
      // Keep contestants-derived values (no-op); this branch exists for clarity.
    }

    const performanceDurationMinutes = parseFloat((performanceTotalSeconds / 60).toFixed(2));

    let commercialTotalSeconds = 0;
    if (showcase.commercials && showcase.commercials.length > 0) {
      const MAX_COMMERCIAL_SECONDS = Number(process.env.COMMERCIAL_MAX_SECONDS || 150);
      const getCommercialSeconds = (commercial, fallbackSeconds = 30) => {
        const raw = Number(commercial?.duration);
        // Guard against bad durations (e.g., 0/1) that would prematurely end the commercial phase.
        const seconds = Number.isFinite(raw) && raw > 3 ? raw : fallbackSeconds;
        return Math.min(seconds, MAX_COMMERCIAL_SECONDS);
      };

      commercialTotalSeconds = showcase.commercials.reduce(
        (sum, comm) => sum + getCommercialSeconds(comm, 30),
        0
      );
    }
    const commercialDurationMinutes = parseFloat((commercialTotalSeconds / 60).toFixed(2));

    res.json({
      success: true,
      serverTime,
      event: {
        showcaseId: showcase._id,
        showcaseStatus: computedShowcaseStatus,
        title: showcase.title,
        description: showcase.description,
        eventDate: showcase.eventDate,
        contestants: contestantsWithDuration?.length || 0, // Use actual number of contestants
        duration: (() => {
          // Calculate total duration from all stages using actual video lengths
          const welcome = showcase.welcomeDuration || 5;

          const performances = performanceDurationMinutes;
          const commercial = commercialDurationMinutes;

          const voting = showcase.votingDisplayDuration || 10;
          const winner = showcase.winnerDisplayDuration || 5;
          const thankYou = showcase.thankYouDuration || 2;
          const countdown = showcase.countdownDuration || 1; // Next event countdown phase duration (default 1 minute)
          const total =
            welcome + performances + commercial + voting + winner + thankYou + countdown;
          return parseFloat(total.toFixed(2)); // Exact decimal value
        })(),
        prize: showcase.prizeDetails?.amount || 0,
        category: showcase.category,
        musicUrl: showcase.musicUrl || null, // Admin-configured event music
        musicPlaying: showcase.musicPlaying || false, // Admin controls music play/stop
        // 7-Stage Event Flow Durations - Use actual values from database
        welcomeDuration: showcase.welcomeDuration !== undefined ? showcase.welcomeDuration : 5,
        performanceDuration: (() => {
          return performanceDurationMinutes;
        })(),
        performanceDurationSeconds: performanceTotalSeconds,
        performanceDurationEstimated: performanceDurationEstimated,
        commercialDuration: (() => {
          return commercialDurationMinutes;
        })(),
        commercialDurationSeconds: commercialTotalSeconds,
        votingDisplayDuration:
          showcase.votingDisplayDuration !== undefined ? showcase.votingDisplayDuration : 10,
        winnerDisplayDuration:
          showcase.winnerDisplayDuration !== undefined ? showcase.winnerDisplayDuration : 5,
        thankYouDuration: showcase.thankYouDuration !== undefined ? showcase.thankYouDuration : 2,
        countdownDuration:
          showcase.countdownDuration !== undefined ? showcase.countdownDuration : 1,
        nextEventDate: nextEventDate, // Include next event date in event object if ended
      },
      status: eventStatus,
      nextEventDate: nextEventDate, // Include at top level for consistency
      timeline: timeline
        ? {
            phases: timeline.phases?.length || 0,
            currentPhase: timeline.currentPhase,
            isLive: timeline.isLive,
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching live talent event:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;
