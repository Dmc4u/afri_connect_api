const express = require('express');
const router = express.Router();
const TalentShowcase = require('../models/TalentShowcase');
const ShowcaseEventTimeline = require('../models/ShowcaseEventTimeline');

// Helper function to calculate showcase status based on dates
const calculateShowcaseStatus = (showcase) => {
  const now = new Date();
  const eventDate = new Date(showcase.eventDate);
  const registrationStart = showcase.registrationStartDate ? new Date(showcase.registrationStartDate) : null;
  const registrationEnd = showcase.registrationEndDate ? new Date(showcase.registrationEndDate) : null;
  const raffleDate = showcase.raffleScheduledDate ? new Date(showcase.raffleScheduledDate) : null;

  if (showcase.status === 'cancelled') {
    return 'cancelled';
  }

  if (registrationStart && now < registrationStart) {
    return 'draft';
  } else if (registrationStart && registrationEnd && now >= registrationStart && now <= registrationEnd) {
    return 'nomination';
  } else if (registrationEnd && raffleDate && now > registrationEnd && now < raffleDate) {
    return 'upcoming';
  } else if (raffleDate && eventDate && now >= raffleDate && now < eventDate) {
    return 'upcoming';
  } else if (now >= eventDate) {
    const eventDuration = 2 * 60 * 60 * 1000;
    const eventEndTime = new Date(eventDate.getTime() + eventDuration);

    if (now >= eventDate && now < eventEndTime) {
      return 'live';
    } else if (now >= eventEndTime) {
      return 'completed';
    }
  }

  return 'upcoming';
};

/**
 * Live Talent Event - Public endpoint
 * Returns the scheduled live talent event for this month
 */

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Find the next showcase (or recent one within 24h) for public display.
    // NOTE: This endpoint backs `/live-talent-event` which should reflect newly created
    // showcases in nomination/upcoming stages; do not hard-require a title pattern.
    let showcase = await TalentShowcase.findOne({
      eventDate: { $gte: oneDayAgo }, // Include events from the last 24 hours
      status: { $nin: ['draft', 'cancelled', 'completed'] }
    }).sort({ eventDate: 1 });

    // If no upcoming event found, check if there's one in progress
    if (!showcase) {
      showcase = await TalentShowcase.findOne({
        status: 'live'
      });
    }

    // Fetch actual contestants with videoDuration for accurate calculations
    let contestantsWithDuration = [];
    if (showcase) {
      const TalentContestant = require('../models/TalentContestant');
      contestantsWithDuration = await TalentContestant.find({
        showcase: showcase._id,
        status: { $in: ['submitted', 'selected', 'approved'] } // Include submitted (registered) contestants
      }).select('videoDuration performanceTitle');
    }

    // Update showcase status dynamically before returning
    const computedShowcaseStatus = (showcase && showcase.status !== 'cancelled' && showcase.status !== 'completed')
      ? calculateShowcaseStatus(showcase)
      : (showcase?.status || null);

    // Get timeline if it exists
    let timeline = null;
    let eventStatus = 'scheduled';

    if (showcase) {
      timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
      // NOTE: This endpoint is intentionally read-only. Timeline creation/starting is handled by the scheduler.

      // Determine status based on timeline phases if available
      if (timeline && timeline.phases && timeline.phases.length > 0) {
        const now = Date.now();

        // Check if any phase is currently active
        const hasActivePhase = timeline.phases.some(p => p.status === 'active');

        // Check if all phases are completed
        const allPhasesCompleted = timeline.phases.every(p => p.status === 'completed');

        // Get the first phase start time
        const firstPhase = timeline.phases[0];
        const firstPhaseStartTime = firstPhase ? new Date(firstPhase.startTime).getTime() : new Date(showcase.eventDate).getTime();

        // Get the last phase end time
        const lastPhase = timeline.phases[timeline.phases.length - 1];
        const lastPhaseEndTime = lastPhase ? new Date(lastPhase.endTime).getTime() : 0;

        if (allPhasesCompleted || now >= lastPhaseEndTime) {
          // Event has ended
          eventStatus = 'ended';
        } else if (hasActivePhase && now >= firstPhaseStartTime) {
          // Event is live ONLY if there's an active phase AND we're past the start time
          eventStatus = 'live';
        } else if (now < firstPhaseStartTime) {
          // Before the scheduled start time - still scheduled
          eventStatus = 'scheduled';
        } else {
          // Between start time and end time, but no active phase - consider it scheduled
          // (This handles the case where timeline exists but hasn't been activated yet)
          eventStatus = 'scheduled';
        }
      } else {
        // Fallback to original time-based calculation if no timeline
        const eventTime = new Date(showcase.eventDate).getTime();
        const currentTime = Date.now();
        const eventEndTime = eventTime + (timeline?.config?.totalDuration || 60) * 60 * 1000;

        if (currentTime >= eventTime && currentTime < eventEndTime) {
          eventStatus = 'live';
        } else if (currentTime >= eventEndTime) {
          eventStatus = 'ended';
        } else {
          eventStatus = 'scheduled';
        }
      }
    }

    // Calculate next event date if this event has ended
    let nextEventDate = null;
    if (showcase && eventStatus === 'ended') {
      // First, check if there's already a next showcase scheduled in the database
      const nextShowcase = await TalentShowcase.findOne({
        eventDate: { $gt: new Date(showcase.eventDate) }, // After current event
        status: { $nin: ['cancelled', 'completed', 'draft'] } // Exclude cancelled/completed/draft
      }).sort({ eventDate: 1 }).limit(1);

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
        status: 'completed'
      }).sort({ eventDate: -1 }).limit(1);

      let nextEventDate = null;

      if (lastEvent) {
        const lastTimeline = await ShowcaseEventTimeline.findOne({ showcase: lastEvent._id });
        nextEventDate = lastTimeline?.thankYouMessage?.nextEventDate || (() => {
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
        message: 'No upcoming live talent event scheduled',
        event: null,
        status: 'no-event',
        nextEventDate: nextEventDate,
        musicUrl: lastEvent?.musicUrl || null, // Include music from last event if available
        musicPlaying: lastEvent?.musicPlaying || false,
        lastEventDate: lastEvent?.eventDate || null
      });
    }

    res.json({
      success: true,
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

          // Calculate total performance time - use timeline if available (most accurate)
          let performances = 0;
          if (timeline && timeline.performances && timeline.performances.length > 0) {
            const totalSeconds = timeline.performances.reduce((sum, perf) => {
              return sum + (perf.videoDuration || 0);
            }, 0);
            performances = parseFloat((totalSeconds / 60).toFixed(2));
          } else if (contestantsWithDuration && contestantsWithDuration.length > 0) {
            // Fallback: Sum up all video durations (in seconds) and convert to minutes
            const totalSeconds = contestantsWithDuration.reduce((sum, contestant) => {
              // Only count if videoDuration is set and > 0, otherwise use 5-min estimate
              const duration = (contestant.videoDuration && contestant.videoDuration > 0)
                ? contestant.videoDuration
                : 300; // 5 minutes realistic estimate for display
              return sum + duration;
            }, 0);
            performances = parseFloat((totalSeconds / 60).toFixed(2)); // Exact decimal value
          }

          // Calculate total commercial time from actual commercial video durations
          let commercial = 0;
          if (showcase.commercials && showcase.commercials.length > 0) {
            // Sum up all commercial durations (in seconds) and convert to minutes
            const totalCommercialSeconds = showcase.commercials.reduce((sum, comm) => {
              const seconds = comm.duration || 0;
              return sum + Math.min(seconds, 180);
            }, 0);
            commercial = parseFloat((totalCommercialSeconds / 60).toFixed(2)); // Exact decimal value
          }

          const voting = showcase.votingDisplayDuration || 10;
          const winner = showcase.winnerDisplayDuration || 5;
          const thankYou = showcase.thankYouDuration || 2;
          const countdown = showcase.countdownDuration || 1; // Next event countdown phase duration (default 1 minute)
          const total = welcome + performances + commercial + voting + winner + thankYou + countdown;
          return parseFloat(total.toFixed(2)); // Exact decimal value
        })(),
        prize: showcase.prizeDetails?.amount || 0,
        category: showcase.category,
        musicUrl: showcase.musicUrl || null, // Admin-configured event music
        musicPlaying: showcase.musicPlaying || false, // Admin controls music play/stop
        // 7-Stage Event Flow Durations - Use actual values from database
        welcomeDuration: showcase.welcomeDuration !== undefined ? showcase.welcomeDuration : 5,
        performanceDuration: (() => {
          // Use timeline's actual performance data if available (most accurate)
          if (timeline && timeline.performances && timeline.performances.length > 0) {
            const totalSeconds = timeline.performances.reduce((sum, perf) => {
              return sum + (perf.videoDuration || 0);
            }, 0);
            const minutes = parseFloat((totalSeconds / 60).toFixed(2));
            console.log(`📊 Performance duration from timeline: ${minutes} min (${totalSeconds}s from ${timeline.performances.length} performances)`);
            return minutes;
          }

          // Fallback: Calculate from actual contestant video durations
          if (contestantsWithDuration && contestantsWithDuration.length > 0) {
            const totalSeconds = contestantsWithDuration.reduce((sum, contestant) => {
              // Only count if videoDuration is set and > 0, otherwise use 5-min estimate
              const duration = (contestant.videoDuration && contestant.videoDuration > 0)
                ? contestant.videoDuration
                : 300; // 5 minutes realistic estimate for display
              return sum + duration;
            }, 0);
            return parseFloat((totalSeconds / 60).toFixed(2)); // Exact decimal value
          }
          return 0;
        })(),
        commercialDuration: (() => {
          // Calculate from actual commercial videos
          if (showcase.commercials && showcase.commercials.length > 0) {
            const totalSeconds = showcase.commercials.reduce((sum, comm) => sum + Math.min((comm.duration || 0), 180), 0);
            return parseFloat((totalSeconds / 60).toFixed(2)); // Exact decimal value
          }
          return 0;
        })(),
        votingDisplayDuration: showcase.votingDisplayDuration !== undefined ? showcase.votingDisplayDuration : 10,
        winnerDisplayDuration: showcase.winnerDisplayDuration !== undefined ? showcase.winnerDisplayDuration : 5,
        thankYouDuration: showcase.thankYouDuration !== undefined ? showcase.thankYouDuration : 2,
        countdownDuration: showcase.countdownDuration !== undefined ? showcase.countdownDuration : 1,
        nextEventDate: nextEventDate // Include next event date in event object if ended
      },
      status: eventStatus,
      nextEventDate: nextEventDate, // Include at top level for consistency
      timeline: timeline ? {
        phases: timeline.phases?.length || 0,
        currentPhase: timeline.currentPhase,
        isLive: timeline.isLive
      } : null
    });

  } catch (error) {
    console.error('Error fetching live talent event:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
