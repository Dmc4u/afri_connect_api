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

    // Find the current month's live event
    // Look for events scheduled for the next event or recent past (within 24 hours)
    // Exclude draft status for public display
    let showcase = await TalentShowcase.findOne({
      title: /LIVE.*Talent/i, // Matches "LIVE Talent Showcase" or similar
      eventDate: { $gte: oneDayAgo }, // Include events from the last 24 hours
      status: { $ne: 'draft' } // Exclude draft events
    }).sort({ eventDate: 1 });

    // If no upcoming event found, check if there's one in progress
    if (!showcase) {
      showcase = await TalentShowcase.findOne({
        title: /LIVE.*Talent/i,
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
    if (showcase && showcase.status !== 'cancelled' && showcase.status !== 'completed') {
      const newStatus = calculateShowcaseStatus(showcase);
      if (newStatus !== showcase.status) {
        showcase.status = newStatus;
        await showcase.save();
      }
    }

    // Get timeline if it exists
    let timeline = null;
    let eventStatus = 'scheduled';

    if (showcase) {
      timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });

      // AUTO-INITIALIZE AND AUTO-START: Check if event should start and isn't initialized/started yet
      const eventTime = new Date(showcase.eventDate).getTime();
      const currentTime = Date.now();
      const timeUntilEvent = eventTime - currentTime;

      // If event time has arrived and no timeline exists, auto-initialize (no time limit)
      if (timeUntilEvent <= 0 && !timeline && showcase.status !== 'completed') {
        console.log(`🚀 AUTO-INITIALIZE: Event "${showcase.title}" is starting, initializing timeline...`);

        try {
          // Get contestants
          const TalentContestant = require('../models/TalentContestant');
          const contestants = await TalentContestant.find({
            showcase: showcase._id,
            status: 'selected'
          }).sort({ voteCount: -1 }).limit(showcase.maxContestants || 5);

          if (contestants.length > 0) {
            // Create new timeline
            timeline = new ShowcaseEventTimeline({
              showcase: showcase._id,
              config: {
                welcomeDuration: showcase.welcomeDuration || 3,
                performanceSlotDuration: showcase.performanceDuration || 0,
                commercialDuration: showcase.commercialDuration || 0,
                votingDuration: showcase.votingDisplayDuration || 3,
                winnerDeclarationDuration: showcase.winnerDisplayDuration || 3,
                thankYouDuration: showcase.thankYouDuration || 2
              },
              welcomeMessage: {
                title: showcase.welcomeMessage || `Welcome to ${showcase.title}!`,
                message: showcase.rulesMessage || `Get ready for amazing talent! We have ${contestants.length} incredible contestants competing.`,
                rules: showcase.rulesMessage ? showcase.rulesMessage.split('\n') : []
              },
              thankYouMessage: {
                title: 'Thank You for Joining Us!',
                message: showcase.thankYouMessage || `Thank you for being part of ${showcase.title}! See you next month!`,
                nextEventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
              }
            });

            // Generate timeline phases
            timeline.generateTimeline();

            // Schedule contestant performances
            if (contestants.length > 0) {
              timeline.schedulePerformances(contestants);
              console.log(`🎬 AUTO-INITIALIZE: Scheduled ${timeline.performances.length} performances`);
            }

            await timeline.save();
            console.log(`✅ AUTO-INITIALIZE: Timeline created for "${showcase.title}"`);
          }
        } catch (initError) {
          console.error('❌ AUTO-INITIALIZE ERROR:', initError);
        }
      }

      // SAFEGUARD: If timeline exists but has no performances, schedule them now
      if (timeline && (!timeline.performances || timeline.performances.length === 0)) {
        const TalentContestant = require('../models/TalentContestant');
        const selectedContestants = await TalentContestant.find({
          showcase: showcase._id,
          status: 'selected'
        }).sort({ rafflePosition: 1 });

        if (selectedContestants.length > 0) {
          console.log(`🔧 SAFEGUARD: Timeline exists but no performances! Scheduling ${selectedContestants.length} now...`);
          timeline.performances = [];
          timeline.schedulePerformances(selectedContestants);
          await timeline.save();
          console.log(`✅ SAFEGUARD: Scheduled ${timeline.performances.length} performances`);
        }
      }

      // If event time has arrived and timeline exists but not started, auto-start
      if (timeUntilEvent <= 0 && timeline && !timeline.isLive && timeline.eventStatus !== 'completed') {
        const scheduledEventTime = new Date(showcase.eventDate);
        const now = new Date();
        const lateStartSeconds = Math.floor((now - scheduledEventTime) / 1000);

        console.log(`🎬 AUTO-START: Starting live event "${showcase.title}" (${lateStartSeconds > 0 ? `${lateStartSeconds}s late` : 'on time'})...`);

        try {
          timeline.isLive = true;
          timeline.actualStartTime = scheduledEventTime; // Use scheduled time, not current time
          timeline.currentPhase = 'welcome';
          timeline.eventStatus = 'live';

          // Ensure all phases start as pending
          timeline.phases.forEach(phase => {
            phase.status = 'pending';
          });

          // Mark first phase (Welcome) as active - calculate from SCHEDULED event time
          if (timeline.phases.length > 0 && timeline.phases[0].name === 'welcome') {
            timeline.phases[0].status = 'active';
            const originalDuration = timeline.phases[0].duration;

            // Start time is the scheduled event time, not current time
            timeline.phases[0].startTime = scheduledEventTime;
            timeline.phases[0].endTime = new Date(scheduledEventTime.getTime() + originalDuration * 60000);

            console.log(`✅ AUTO-START: Welcome phase activated at scheduled time (${originalDuration} min, ends at ${timeline.phases[0].endTime.toLocaleTimeString()})`);

            if (lateStartSeconds > 0) {
              console.log(`⚠️  Event started ${lateStartSeconds}s late - Welcome phase may have less time remaining`);
            }
          }

          await timeline.save();

          // Update showcase status to live
          if (showcase.status !== 'live') {
            showcase.status = 'live';
            await showcase.save();
          }

          console.log(`✅ AUTO-START: Event "${showcase.title}" is now LIVE!`);
        } catch (startError) {
          console.error('❌ AUTO-START ERROR:', startError);
        }
      }

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
        title: /LIVE.*Talent/i,
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
        title: /LIVE.*Talent/i,
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
              return sum + (comm.duration || 0);
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
            const totalSeconds = showcase.commercials.reduce((sum, comm) => sum + (comm.duration || 0), 0);
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
