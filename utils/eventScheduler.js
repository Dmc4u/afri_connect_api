const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
const TalentShowcase = require("../models/TalentShowcase");
const TalentContestant = require("../models/TalentContestant");
const { performRaffle } = require("./raffleSelection");

/**
 * Event Auto-Start Scheduler
 * Automatically starts events at their scheduled time and executes raffles
 */

let schedulerInterval = null;
let lastRaffleCheckAt = 0;
let lastTimelineEnsureAt = 0;

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

async function ensureLiveTalentEventTimeline() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Match public selection logic (next upcoming or recent within 24h, else currently live)
  let showcase = await TalentShowcase.findOne({
    eventDate: { $gte: oneDayAgo },
    status: { $nin: ["draft", "cancelled", "completed"] },
  }).sort({ eventDate: 1 });

  if (!showcase) {
    showcase = await TalentShowcase.findOne({ status: "live" });
  }

  if (!showcase) return;

  // Keep persisted status reasonably in-sync without relying on a public GET
  if (showcase.status !== "cancelled" && showcase.status !== "completed") {
    const newStatus = calculateShowcaseStatus(showcase);
    if (newStatus !== showcase.status) {
      await TalentShowcase.findByIdAndUpdate(showcase._id, { status: newStatus });
      showcase.status = newStatus;
    }
  }

  let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
  if (!timeline) {
    // Create timeline if missing (previously done in public GET)
    const contestants = await TalentContestant.find({
      showcase: showcase._id,
      status: "selected",
    })
      .sort({ voteCount: -1 })
      .limit(showcase.maxContestants || 5);

    timeline = new ShowcaseEventTimeline({
      showcase: showcase._id,
      actualStartTime: showcase.eventDate,
      config: {
        welcomeDuration: showcase.welcomeDuration ?? 5,
        performanceSlotDuration: showcase.performanceDuration || 0,
        commercialDuration: showcase.commercialDuration || 0,
        votingDuration: showcase.votingDisplayDuration || 3,
        winnerDeclarationDuration: showcase.winnerDisplayDuration || 3,
        thankYouDuration: showcase.thankYouDuration || 2,
        countdownDuration: showcase.countdownDuration ?? 1,
      },
      eventStatus: "scheduled",
      isLive: false,
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
        nextEventDate: (() => {
          const nextMonth = new Date(showcase.eventDate);
          nextMonth.setMonth(nextMonth.getMonth() + 1);
          return nextMonth;
        })(),
      },
    });

    timeline.generateTimeline();
    if (contestants.length > 0) {
      timeline.schedulePerformances(contestants);
    }

    await timeline.save();
    return;
  }

  // Ensure phases exist
  if (!timeline.phases || timeline.phases.length === 0) {
    timeline.generateTimeline();
    await timeline.save();
  }

  // SAFEGUARD: if performances missing, schedule them
  if (!timeline.performances || timeline.performances.length === 0) {
    const selectedContestants = await TalentContestant.find({
      showcase: showcase._id,
      status: "selected",
    }).sort({ rafflePosition: 1 });

    if (selectedContestants.length > 0) {
      timeline.performances = [];
      timeline.schedulePerformances(selectedContestants);
      await timeline.save();
    }
  }
}

/**
 * Check for events that should auto-start
 */
async function checkAndStartScheduledEvents() {
  try {
    const now = new Date();

    // Throttle heavier checks so phase transitions can run more frequently
    if (now.getTime() - lastRaffleCheckAt >= 30_000) {
      lastRaffleCheckAt = now.getTime();
      await checkAndExecuteScheduledRaffles();
    }

    if (now.getTime() - lastTimelineEnsureAt >= 15_000) {
      lastTimelineEnsureAt = now.getTime();
      // Ensure the public live talent event always has a timeline (no public GET writes)
      await ensureLiveTalentEventTimeline();
    }

    // Find all scheduled events that should start now (within 1 minute window)
    const timelines = await ShowcaseEventTimeline.find({
      eventStatus: "scheduled",
      isLive: false,
    }).populate("showcase");

    for (const timeline of timelines) {
      if (!timeline.showcase || !timeline.showcase.eventDate) {
        console.warn(
          `⚠️  Timeline ${timeline._id} has no associated showcase or event date - skipping`
        );
        continue;
      }

      const eventDate = new Date(timeline.showcase.eventDate);
      const timeDiff = eventDate - now;

      // If event should start now (at or after scheduled time, allow up to 24h late)
      if (timeDiff <= 0 && timeDiff >= -(24 * 60 * 60 * 1000)) {
        const lateSeconds = Math.abs(Math.floor(timeDiff / 1000));
        console.log(
          `🚀 Auto-starting event: ${timeline.showcase.title || "Unnamed Event"} (${lateSeconds > 0 ? `${lateSeconds}s late` : "on time"})`
        );

        // Start the event NOW so the welcome timer begins immediately
        const startTime = new Date();

        timeline.actualStartTime = startTime;
        timeline.isLive = true;
        timeline.eventStatus = "live";
        timeline.currentPhase = "welcome";

        // Generate timeline if not already generated
        if (!timeline.phases || timeline.phases.length === 0) {
          timeline.generateTimeline();
        }

        // Schedule performances if not already scheduled
        if (!timeline.performances || timeline.performances.length === 0) {
          const TalentContestant = require("../models/TalentContestant");
          const contestants = await TalentContestant.find({
            showcase: timeline.showcase._id,
            status: "selected",
          }).sort({ rafflePosition: 1 });

          if (contestants.length > 0) {
            timeline.schedulePerformances(contestants);
            console.log(`📋 Scheduled ${contestants.length} performances`);
          }
        }

        // Set first phase to active - start from NOW
        if (timeline.phases.length > 0) {
          // Reset any non-completed phases to pending so welcome can activate cleanly
          timeline.phases.forEach((phase) => {
            if (phase.status !== "completed") phase.status = "pending";
          });

          timeline.phases[0].status = "active";

          // Recalculate all phase times sequentially from NOW
          let currentTime = new Date(startTime);
          timeline.phases.forEach((phase) => {
            phase.startTime = new Date(currentTime);
            phase.endTime = new Date(currentTime.getTime() + phase.duration * 60000);
            currentTime = phase.endTime;
          });

          // Rebase performance schedule to the new performance phase start time
          const performancePhase = timeline.phases.find((p) => p.name === "performance");
          if (
            performancePhase &&
            Array.isArray(timeline.performances) &&
            timeline.performances.length > 0
          ) {
            let perfTime = new Date(performancePhase.startTime);
            timeline.performances
              .sort((a, b) => (a.performanceOrder || 0) - (b.performanceOrder || 0))
              .forEach((perf) => {
                const durationSeconds = perf.videoDuration || 0;
                perf.startTime = new Date(perfTime);
                perf.endTime = new Date(perfTime.getTime() + durationSeconds * 1000);
                perfTime = new Date(perf.endTime);
              });
          }

          console.log(`📅 Phases scheduled from start time: ${startTime.toLocaleTimeString()}`);
        }

        await timeline.save();

        // Update showcase status
        await TalentShowcase.findByIdAndUpdate(timeline.showcase._id, {
          status: "live",
          liveStartTime: startTime,
        });

        console.log(
          `✅ Event started: ${timeline.showcase.title || "Unnamed Event"} (ID: ${timeline.showcase._id})`
        );
      }
    }

    // Auto-advance phases for live events
    await checkAndAdvancePhases();
  } catch (error) {
    console.error("❌ Error in event scheduler:", error);
  }
}

/**
 * Check for phases that should advance
 */
async function checkAndAdvancePhases() {
  try {
    const now = new Date();

    // Find all live events
    const liveTimelines = await ShowcaseEventTimeline.find({
      isLive: true,
      eventStatus: "live",
    }).populate("showcase");

    for (const timeline of liveTimelines) {
      // Skip if showcase is null or deleted
      if (!timeline.showcase) {
        console.warn(`⚠️  Timeline ${timeline._id} has no associated showcase - marking as ended`);
        timeline.isLive = false;
        timeline.eventStatus = "cancelled";
        await timeline.save();
        continue;
      }

      // Skip if event is paused
      // NOTE: Admin pause can set the pause flag on the timeline (structured events)
      // and/or on the showcase.liveEventControl (legacy). Respect both.
      if (timeline.isPaused || timeline.showcase.liveEventControl?.isPaused) {
        console.log(`⏸️  Event paused: ${timeline.showcase.title}`);
        continue;
      }

      let currentPhase = timeline.getCurrentPhase();

      if (!currentPhase) {
        // No current phase means event should have ended
        const lastPhase = timeline.phases[timeline.phases.length - 1];
        if (lastPhase && now > lastPhase.endTime) {
          console.log(`🏁 Auto-ending event: ${timeline.showcase.title}`);

          timeline.actualEndTime = new Date();
          timeline.isLive = false;
          timeline.eventStatus = "completed";
          timeline.currentPhase = "ended";

          await timeline.save();

          // Update showcase status
          await TalentShowcase.findByIdAndUpdate(timeline.showcase._id, {
            status: "completed",
            endDate: new Date(),
          });

          console.log(`✅ Event ended: ${timeline.showcase.title}`);
        }
        continue;
      }

      // Check if current phase has ended; advance immediately (catch up if needed)
      let guard = 0;

      // Commercial-phase safeguard:
      // If the phase endTime was generated with a default (e.g., 1 minute) but we actually
      // have commercial durations on the showcase, extend the commercial phase so adverts
      // aren't cut off early.
      if (
        currentPhase?.name === "commercial" &&
        currentPhase?.startTime &&
        timeline.showcase?.commercials &&
        timeline.showcase.commercials.length > 0
      ) {
        const MAX_COMMERCIAL_SECONDS = Number(process.env.COMMERCIAL_MAX_SECONDS || 150);
        const getCommercialSeconds = (commercial, fallbackSeconds = 30) => {
          const raw = Number(commercial?.duration);
          // Treat tiny values (e.g., 1s) as invalid; they cause premature phase end.
          const seconds = Number.isFinite(raw) && raw > 3 ? raw : fallbackSeconds;
          return Math.min(seconds, MAX_COMMERCIAL_SECONDS);
        };

        const expectedSeconds = timeline.showcase.commercials.reduce(
          (sum, commercial) => sum + getCommercialSeconds(commercial, 30),
          0
        );

        const expectedEndTime = new Date(
          new Date(currentPhase.startTime).getTime() + expectedSeconds * 1000
        );

        // Only extend; never shorten an existing schedule.
        if (currentPhase.endTime && expectedEndTime > new Date(currentPhase.endTime)) {
          currentPhase.endTime = expectedEndTime;
          // Keep duration minutes consistent with endTime.
          currentPhase.duration = expectedSeconds / 60;
          await timeline.save();
          console.log(
            `📺 Extended commercial phase to match adverts: ${expectedSeconds}s (cap ${MAX_COMMERCIAL_SECONDS}s per advert)`
          );
        }
      }

      while (currentPhase && now > currentPhase.endTime) {
        guard += 1;
        if (guard > (timeline.phases?.length || 0) + 5) {
          console.warn(`⚠️  Phase advance guard tripped for: ${timeline.showcase.title}`);
          break;
        }
        // Don't auto-advance from countdown phase - it runs until next event
        if (currentPhase.name === "countdown") {
          console.log(`⏰ Event in countdown mode: ${timeline.showcase.title}`);
          break;
        }

        // Don't auto-advance from performance phase based on time alone
        // Performance phase should only advance when all performances are completed
        if (currentPhase.name === "performance") {
          const allCompleted = timeline.performances.every((p) => p.status === "completed");
          if (!allCompleted) {
            console.log(
              `🎬 Performance phase time exceeded but not all performances completed - staying in phase`
            );
            break;
          }
          console.log(`🎬 All performances completed - ready to advance from performance phase`);
        }

        console.log(
          `⏭️  Auto-advancing phase for: ${timeline.showcase.title} (${currentPhase.name} → next)`
        );

        const nextPhase = timeline.advancePhase();

        if (!nextPhase) {
          // Event ended
          timeline.actualEndTime = new Date();
          timeline.isLive = false;

          await timeline.save();

          // Update showcase to completed
          await TalentShowcase.findByIdAndUpdate(timeline.showcase._id, {
            status: "completed",
            endDate: new Date(),
          });

          console.log(`✅ Event completed: ${timeline.showcase.title}`);
        } else {
          // Handle special phase transitions
          if (nextPhase.name === "voting") {
            // Auto-enable voting when voting phase starts
            await TalentShowcase.findByIdAndUpdate(timeline.showcase._id, {
              isVotingOpen: true,
              status: "voting",
              votingStartTime: nextPhase.startTime,
              votingEndTime: nextPhase.endTime,
            });
            console.log(`🗳️  Voting opened for: ${timeline.showcase.title}`);
          } else if (nextPhase.name === "winner") {
            // Auto-close voting and declare winner when winner phase starts
            await TalentShowcase.findByIdAndUpdate(timeline.showcase._id, {
              isVotingOpen: false,
            });
            await autoDeclareWinner(timeline);
            console.log(`🏆 Winner auto-declared for: ${timeline.showcase.title}`);
          }

          await timeline.save();
          console.log(`✅ Advanced to phase: ${nextPhase.name}`);
        }

        // Refresh phase after advancing
        currentPhase = timeline.getCurrentPhase();
      }

      // Auto-advance performances within performance phase
      if (timeline.currentPhase === "performance") {
        const currentPerf = timeline.getCurrentPerformance();

        if (!currentPerf) {
          console.log(`⚠️ No active performance found during performance phase`);
          // Find next pending performance (should be the first one if none is active)
          const nextPerf = timeline.performances
            .sort((a, b) => a.performanceOrder - b.performanceOrder)
            .find((p) => p.status === "pending");

          if (nextPerf) {
            console.log(
              `🎭 Auto-starting performance Order #${nextPerf.performanceOrder} (was pending)`
            );
            nextPerf.status = "active";
            nextPerf.startTime = new Date();
            // Use actual video duration instead of slot duration
            const videoDuration =
              nextPerf.videoDuration || timeline.config.performanceSlotDuration * 60;
            nextPerf.endTime = new Date(Date.now() + videoDuration * 1000);
            await timeline.save();
            console.log(
              `✅ Started performance ${nextPerf.performanceOrder}/${timeline.performances.length}, duration: ${videoDuration}s`
            );
          } else {
            console.log(`⚠️ No pending performances found - all may be completed`);
          }
        } else {
          // There is an active performance - check if it should have ended
          const videoDuration =
            currentPerf.videoDuration || timeline.config.performanceSlotDuration * 60;
          const expectedEndTime = new Date(currentPerf.startTime.getTime() + videoDuration * 1000);

          if (now > expectedEndTime) {
            console.log(
              `⏱️ Performance ${currentPerf.performanceOrder}/${timeline.performances.length} exceeded its duration (${videoDuration}s), auto-completing`
            );
            currentPerf.status = "completed";
            await timeline.save();
            console.log(
              `✅ Auto-completed performance ${currentPerf.performanceOrder}/${timeline.performances.length}`
            );
          }
        }
      }

      // Commercial phase advancement happens via:
      // - the normal phase timer (phase endTime), and/or
      // - the explicit /commercials-complete signal from the client.
      // Avoid duplicate commercial-specific auto-advance logic here.
    }
  } catch (error) {
    console.error("❌ Error in phase advancement:", error);
  }
}

// Use shared helper for auto-featuring winners
const { autoFeatureWinner } = require("./featuredHelper");

/**
 * Auto-declare winner during winner phase
 */
async function autoDeclareWinner(timeline) {
  try {
    const TalentContestant = require("../models/TalentContestant");
    const TalentShowcase = require("../models/TalentShowcase");

    // Get showcase to access prize details
    const showcase = await TalentShowcase.findById(timeline.showcase._id || timeline.showcase);
    const prizeText = showcase?.prizeDetails?.amount
      ? `$${showcase.prizeDetails.amount} ${showcase.prizeDetails.description || "cash prize and featured placement"}`
      : "Cash prize and featured placement for the winner";

    // Get all contestants sorted by votes
    const contestants = await TalentContestant.find({
      showcase: timeline.showcase._id || timeline.showcase,
    })
      .sort({ votes: -1, _id: 1 }) // Sort by votes desc, then by ID for consistency
      .populate("user")
      .populate("listing");

    if (contestants.length === 0) {
      console.log(`⚠️  No contestants found for winner declaration`);
      timeline.winnerAnnouncement = {
        totalVotes: 0,
        prizeDetails: prizeText + " - No contestants participated",
        announcementTime: new Date(),
        noWinner: true,
      };
      return;
    }

    // Check if there are any votes
    const totalVotes = contestants.reduce((sum, c) => sum + (c.votes || 0), 0);

    if (totalVotes === 0) {
      console.log(`⚠️  No votes cast - no winner declared`);
      // No winner when no votes
      timeline.winnerAnnouncement = {
        totalVotes: 0,
        prizeDetails: prizeText + " - No votes were cast, no winner declared",
        announcementTime: new Date(),
        noWinner: true,
      };

      console.log(`ℹ️  No winner: No votes cast`);
      return;
    }

    // Get the highest vote count
    const highestVotes = contestants[0].votes || 0;

    // Check for tie
    const tiedContestants = contestants.filter((c) => (c.votes || 0) === highestVotes);

    if (tiedContestants.length > 1) {
      console.log(
        `⚠️  ${tiedContestants.length} contestants tied with ${highestVotes} votes - no winner declared`
      );
      // No winner declared when there's a tie
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

      console.log(
        `🤝 TIE: No winner declared - ${tiedContestants.length} contestants with ${highestVotes} votes each`
      );
      return;
    }

    // Clear winner
    const winner = contestants[0];
    timeline.winnerAnnouncement = {
      winner: winner._id,
      totalVotes: highestVotes,
      prizeDetails: prizeText + ` - Won with ${highestVotes} votes out of ${totalVotes} total`,
      announcementTime: new Date(),
    };

    winner.isWinner = true;
    winner.wonAt = new Date();
    await winner.save();

    // Auto-feature winner's listing
    await autoFeatureWinner(winner);

    console.log(`✅ Winner declared: ${winner.performanceTitle} (${highestVotes} votes)`);
  } catch (error) {
    console.error("❌ Error auto-declaring winner:", error);
    timeline.winnerAnnouncement = {
      totalVotes: 0,
      prizeDetails: "Cash prize and featured placement - Error determining winner",
      announcementTime: new Date(),
      error: true,
    };
  }
}

/**
 * Check for raffles that should auto-execute
 * Executes raffles at their scheduled time
 */
async function checkAndExecuteScheduledRaffles() {
  try {
    const now = new Date();

    // Find showcases with scheduled raffles that haven't been executed yet
    // Look for raffles scheduled within the last 10 minutes (to account for scheduler intervals and delays)
    const showcases = await TalentShowcase.find({
      raffleScheduledDate: { $exists: true, $ne: null },
      raffleExecutedDate: { $exists: false },
      registrationEndDate: { $lt: now }, // Only if registration has closed
    });

    console.log(
      `🎲 Checking for raffles to execute... Found ${showcases.length} showcases with pending raffles`
    );

    for (const showcase of showcases) {
      const raffleDate = new Date(showcase.raffleScheduledDate);
      const timeDiff = now - raffleDate;
      const minutesDiff = Math.floor(timeDiff / 60000);

      console.log(`   Showcase: ${showcase.title}`);
      console.log(`   Raffle scheduled for: ${raffleDate.toLocaleString()}`);
      console.log(`   Current time: ${now.toLocaleString()}`);
      console.log(
        `   Time difference: ${minutesDiff} minutes (${Math.floor(timeDiff / 1000)} seconds)`
      );

      // If raffle should execute now (within 10 minute window after scheduled time)
      if (timeDiff >= 0 && timeDiff <= 600000) {
        console.log(`🎲 Auto-executing raffle for: ${showcase.title || "Unnamed Showcase"}`);

        try {
          // Get all submitted contestants
          const contestants = await TalentContestant.find({
            showcase: showcase._id,
            status: { $in: ["submitted", "pending-raffle"] },
          }).populate("user", "name email country");

          console.log(`   Found ${contestants.length} contestants for raffle`);

          if (contestants.length === 0) {
            console.warn(`⚠️  No contestants found for showcase ${showcase._id} - skipping raffle`);
            continue;
          }

          const maxContestants = showcase.maxContestants || 5;

          console.log(`   Max contestants: ${maxContestants}`);

          // Perform raffle
          const raffleResults = performRaffle(contestants, maxContestants);

          // Update showcase with raffle results
          showcase.raffleSeed = raffleResults.raffleSeed;
          showcase.raffleExecutedDate = raffleResults.raffleTimestamp;
          showcase.raffleExecutedBy = null; // Auto-executed (no specific admin)
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

          // Delete all unselected AND waitlisted contestants
          const selectedIds = raffleResults.selected.map((s) => s.contestant.toString());

          const deleteResult = await TalentContestant.deleteMany({
            showcase: showcase._id,
            _id: { $nin: selectedIds },
          });

          // Update showcase with only selected contestants
          showcase.contestants = raffleResults.selected.map((s) => s.contestant);
          showcase.waitlist = []; // Clear waitlist since we're deleting them
          await showcase.save();

          // Notify contestants (auto-executed raffles previously sent no messages)
          try {
            const Announcement = require("../models/Announcement");
            const User = require("../models/User");
            const { getIO } = require("./socket");

            const senderUser = await User.findOne({ role: "admin" }).select("_id").lean();
            const senderId = senderUser?._id;

            const contestantToUserId = new Map(
              contestants
                .map((c) => [c?._id?.toString?.(), c?.user?._id])
                .filter(([contestantId, userId]) => Boolean(contestantId) && Boolean(userId))
            );

            const selectedIdSet = new Set(
              raffleResults.selected.map((s) => s.contestant.toString())
            );
            const selectedUserIds = raffleResults.selected
              .map((s) => contestantToUserId.get(s.contestant.toString()))
              .filter(Boolean);
            const nonSelectedUserIds = contestants
              .filter((c) => c?._id && !selectedIdSet.has(c._id.toString()))
              .map((c) => c?.user?._id)
              .filter(Boolean);

            if (!senderId) {
              console.warn(
                `⚠️  No admin user found; skipping raffle announcements for showcase ${showcase._id}`
              );
            } else {
              if (selectedUserIds.length > 0) {
                await Announcement.create({
                  subject: `🎉 You have been selected for ${showcase.title}!`,
                  message: `You’ve been selected to compete in the live event! We’re thrilled and proud to showcase your talent.\n\nNext Steps: Start reaching out to friends, family, and supporters to solicit their votes during the live event. The more support you gather now, the better your chances!`,
                  sender: senderId,
                  recipients: { type: "individual", value: selectedUserIds },
                  priority: "high",
                  status: "sent",
                });
              }

              if (nonSelectedUserIds.length > 0) {
                await Announcement.create({
                  subject: `Update on ${showcase.title} raffle`,
                  message: `Thanks for entering ${showcase.title}. The raffle has been completed, and you were not selected for this live event. Keep an eye out for the next showcase — new opportunities are posted regularly.`,
                  sender: senderId,
                  recipients: { type: "individual", value: nonSelectedUserIds },
                  priority: "normal",
                  status: "sent",
                });
              }
            }

            const io = getIO?.();
            if (io && selectedUserIds.length > 0) {
              selectedUserIds.forEach((userId) => {
                io.to(userId.toString()).emit("raffle-selected", {
                  showcaseId: showcase._id.toString(),
                  showcaseTitle: showcase.title,
                });
              });
            }
          } catch (notifyErr) {
            console.error(
              `❌ Error sending raffle notifications for showcase ${showcase._id}:`,
              notifyErr
            );
          }

          console.log(
            `✅ Raffle auto-executed for ${showcase.title}: ${raffleResults.selected.length} selected, ${deleteResult.deletedCount} contestants deleted`
          );

          // Log selected contestants
          for (const selected of raffleResults.selected) {
            const contestant = await TalentContestant.findById(selected.contestant).populate(
              "user"
            );
            console.log(
              `   ✓ Selected: ${contestant.user?.name || "Unknown"} - Position ${selected.position}`
            );
          }
        } catch (error) {
          console.error(`❌ Error auto-executing raffle for showcase ${showcase._id}:`, error);
          // Continue with other raffles even if one fails
        }
      } else if (timeDiff < 0) {
        console.log(`   ⏰ Raffle not yet due (${Math.abs(minutesDiff)} minutes early)`);
      } else {
        console.log(
          `   ⚠️  Raffle window expired (${minutesDiff} minutes late - window is 10 minutes)`
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in automatic raffle executor:", error);
  }
}

/**
 * Start the event scheduler
 * Checks every 10 seconds for events to start and phases to advance
 */
function startScheduler() {
  if (schedulerInterval) {
    console.log("⚠️  Event scheduler already running");
    return;
  }

  console.log("🕐 Starting event auto-start and raffle execution scheduler...");

  // Check immediately
  checkAndStartScheduledEvents();

  // Check frequently so phase transitions feel immediate
  schedulerInterval = setInterval(checkAndStartScheduledEvents, 2000);

  console.log("✅ Event scheduler started (checking every 2 seconds; heavy checks throttled)");
}

/**
 * Stop the event scheduler
 */
function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("🛑 Event scheduler stopped");
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  checkAndStartScheduledEvents,
  checkAndAdvancePhases,
};
