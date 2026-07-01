/* eslint-disable no-param-reassign, no-nested-ternary, no-use-before-define */
const DebateEvent = require("../models/DebateEvent");
const DebateVote = require("../models/DebateVote");
const User = require("../models/User");
const ContactMessage = require("../models/ContactMessage");
const MessageNotification = require("../models/MessageNotification");
const { performRaffle } = require("../utils/raffleSelection");

const ZOOM_EVENT_REMINDER =
  "Important Reminder: This event will be held on Zoom. Please make sure you have the Zoom application installed and working on your device before the event date.\n\n" +
  "To avoid any last-minute issues, we recommend testing Zoom in advance and ensuring you have a stable internet connection.";

const PHASE_LABELS = {
  scheduled: "Scheduled",
  welcome: "Welcome & Rules",
  round1: "Round 1 · Opening Statements",
  commercial1: "Sponsor Break",
  question: "Round 2 · Question",
  round2: "Round 2 · Responses",
  commercial2: "Sponsor Break",
  round3: "Round 3 · Final Word",
  voting: "Voting & Judging",
  results: "Final Results",
  finished: "Event Finished",
};

Object.assign(PHASE_LABELS, {
  round1: "Round 1 - Opening Statement",
  question: "Round 2 - Question",
  round2: "Round 2 - Responses",
  round3: "Round 3 - Final Word",
});

const SPEECH_PHASES = new Set(["round1", "round2", "round3"]);

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ success: false, message: "Admin access required" });
    return false;
  }
  return true;
}

async function getActiveEvent() {
  let event = await DebateEvent.findOne({ active: true }).sort({ updatedAt: -1 });
  if (!event) event = await DebateEvent.create({});
  return event;
}

function getPhaseSeconds(event, phase = event.phase) {
  if (phase === "voting" && event.votingEndsAt) {
    return Math.max(Math.ceil((event.votingEndsAt.getTime() - Date.now()) / 1000), 0);
  }
  const durations = {
    welcome: 60,
    round1: event.openingSeconds,
    commercial1: event.commercialSeconds,
    question: event.questionDisplaySeconds,
    round2: event.responseSeconds,
    commercial2: event.commercialSeconds,
    round3: event.closingSeconds,
    voting: event.votingSeconds,
  };
  return Number(durations[phase] || 0);
}

function startSpeakerWait(event) {
  startPhaseTimer(event, 0);
}

function startPhaseTimer(event, seconds = getPhaseSeconds(event)) {
  event.phaseStartedAt = new Date();
  event.paused = false;
  event.pausedRemainingSeconds = 0;
  event.timerEndsAt = seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

function getRemainingSeconds(event) {
  if (event.paused) return Number(event.pausedRemainingSeconds || 0);
  if (!event.timerEndsAt) return 0;
  return Math.max(Math.ceil((event.timerEndsAt.getTime() - Date.now()) / 1000), 0);
}

function hasRaffleRun(event) {
  return Boolean(event.raffleExecutedAt);
}

function getDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function hasDebateProgress(event) {
  return (
    hasRaffleRun(event) ||
    event.phase !== "scheduled" ||
    Boolean(event.votingOpenedAt) ||
    Boolean(event.votingClosedAt) ||
    (event.participants || []).some(
      (participant) =>
        participant.raffleStatus !== "registered" ||
        Number(participant.audienceVotes || 0) > 0 ||
        Number(participant.finalScore || 0) > 0 ||
        participant.placement
    )
  );
}

function resetDebateProgress(event, options = {}) {
  event.phase = "scheduled";
  event.currentTurnIndex = 0;
  event.votingOpenedAt = null;
  event.votingClosedAt = null;
  event.raffleSeed = "";
  event.raffleExecutedAt = null;
  event.timerEndsAt = null;
  event.paused = false;
  event.pausedRemainingSeconds = 0;
  if (options.clearParticipants) {
    event.participants = [];
    return;
  }
  event.participants.forEach((participant) => {
    participant.raffleStatus = "registered";
    participant.rafflePosition = null;
    participant.raffleRandomNumber = null;
    participant.selectionTransferredFromName = "";
    participant.selectionTransferredAt = null;
    participant.audienceVotes = 0;
    participant.finalScore = 0;
    participant.placement = null;
  });
}

const DEBATE_SETTINGS_FIELDS = [
  "title",
  "topic",
  "openingPrompt",
  "mainQuestion",
  "closingPrompt",
  "firstPlacePrize",
  "secondPlacePrize",
  "rules",
  "eventStartsAt",
  "eventEndsAt",
  "firstPlaceMinPoints",
  "secondPlaceMinPoints",
  "openingSeconds",
  "questionDisplaySeconds",
  "responseSeconds",
  "closingSeconds",
  "commercialSeconds",
  "votingSeconds",
  "votingEndsAt",
  "selectedParticipantSlots",
  "raffleRunsAt",
  "judgingMode",
  "judgeWeight",
  "audienceWeight",
  "sponsor",
  "meetingLinks",
];

function applyDebateSettings(event, settings = {}) {
  DEBATE_SETTINGS_FIELDS.forEach((key) => {
    if (settings[key] !== undefined) event[key] = settings[key];
  });
}

function getEligibleParticipants(event) {
  if (!hasRaffleRun(event)) return event.participants;
  return event.participants.filter((participant) => participant.raffleStatus === "selected");
}

function getParticipantForTurn(event) {
  if (!["round1", "round2", "round3"].includes(event.phase)) return null;
  const turnParticipants = getEligibleParticipants(event);
  const turnIndex = Number(event.currentTurnIndex || 0);
  const participantIndex =
    event.phase === "round3" ? turnParticipants.length - 1 - turnIndex : turnIndex;
  return turnParticipants[participantIndex] || null;
}

async function createDebateProfileMessage({ participant, title, body }) {
  if (!participant?.user) return;
  try {
    const contactMessage = await ContactMessage.create({
      senderName: "AfriOnet Debate",
      senderEmail: process.env.ADMIN_EMAIL || "support@afrionet.com",
      message: body,
      businessOwner: participant.user,
      sender: null,
    });

    await MessageNotification.create({
      user: participant.user,
      conversation: null,
      message: contactMessage._id,
      sender: null,
      type: "contact-form",
      title,
      body: body.slice(0, 100),
      isRead: false,
    });
  } catch (error) {
    console.warn("Debate profile message notification failed:", error.message);
  }
}

function getOrdinalNumber(number) {
  const value = Number(number);
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = value % 100;
  return `${value}${suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0]}`;
}

function getEventStartLabel(event) {
  return event.eventStartsAt
    ? event.eventStartsAt.toLocaleString("en-US")
    : "the scheduled event time";
}

function getRaffleTimeLabel(event) {
  return event.raffleRunsAt ? `Raffle time: ${event.raffleRunsAt.toLocaleString("en-US")}\n\n` : "";
}

async function sendDebateRegistrationMessage(participant, event) {
  await createDebateProfileMessage({
    participant,
    title: "Debate registration confirmed",
    body:
      `Hi ${participant.name || "there"},\n\n` +
      `You have registered for ${event.title || "the AfriOnet Live Debate"}.\n\n` +
      `Event start: ${getEventStartLabel(event)}\n\n${getRaffleTimeLabel(
        event
      )}${ZOOM_EVENT_REMINDER}\n\n` +
      `You will receive another message after the raffle if you are selected as a debate participant.\n\n` +
      `Best regards,\nThe AfriOnet Team`,
  });
}

async function sendDebateSelectionMessages(participants, event) {
  await Promise.all(
    participants.map((participant) => {
      if (participant.raffleStatus !== "selected") {
        return createDebateProfileMessage({
          participant,
          title: "Debate raffle result",
          body:
            `Hi ${participant.name || "there"},\n\n` +
            `Thank you for registering for ${event.title || "the AfriOnet Live Debate"}.\n\n` +
            "The raffle has been completed, and you were not selected as one of the live debaters for this event.\n\n" +
            "You can still join, watch, support the selected participants, and vote when voting opens.\n\n" +
            `${ZOOM_EVENT_REMINDER}\n\n` +
            "Best regards,\nThe AfriOnet Team",
        });
      }

      const position = participant.rafflePosition
        ? `${participant.rafflePosition} (${getOrdinalNumber(participant.rafflePosition)} participant)`
        : "on the selected list";
      return createDebateProfileMessage({
        participant,
        title: "You were selected for the debate",
        body:
          `Hi ${participant.name || "there"},\n\n` +
          `Congratulations! You were selected for ${event.title || "the AfriOnet Live Debate"}.\n\n` +
          `Your debate position: ${position}.\n\n` +
          `Event start: ${getEventStartLabel(event)}\n\n${getRaffleTimeLabel(
            event
          )}${ZOOM_EVENT_REMINDER}\n\n` +
          `Please be ready on Zoom when your name is called.\n\n` +
          `Best regards,\nThe AfriOnet Team`,
      });
    })
  );

  // Emit real-time socket event for selected users (immediate popup)
  const io = require("../utils/socket").getIO?.();
  if (io && event) {
    const selectedParticipants = participants.filter(
      (p) => p.raffleStatus === "selected" && p.user
    );
    selectedParticipants.forEach((participant) => {
      const userId = participant.user._id || participant.user;
      io.to(userId.toString()).emit("raffle-selected", {
        showcaseId: event._id.toString(),
        showcaseTitle: event.title || "Debate Event",
        eventType: "debate",
      });
    });
  }
}

async function runDebateRaffleForEvent(event, requestedMaxParticipants) {
  const rawMaxParticipants =
    requestedMaxParticipants !== undefined
      ? requestedMaxParticipants
      : event.selectedParticipantSlots;
  const maxParticipants = Number(rawMaxParticipants);

  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 50) {
    const error = new Error("Set the number of participants to select before running the raffle.");
    error.statusCode = 400;
    throw error;
  }

  const eligibleParticipants = event.participants.filter((participant) => participant.user);

  if (!eligibleParticipants.length) {
    const error = new Error("No registered users are available for the raffle.");
    error.statusCode = 400;
    throw error;
  }

  if (maxParticipants > eligibleParticipants.length) {
    const error = new Error(
      `You requested ${maxParticipants} participant slots, but only ${eligibleParticipants.length} user${
        eligibleParticipants.length === 1 ? " is" : "s are"
      } registered. Reduce the participant count or wait for more registrations.`
    );
    error.statusCode = 400;
    throw error;
  }

  const raffleResults = performRaffle(eligibleParticipants, maxParticipants);
  const selectedById = new Map(
    raffleResults.selected.map((entry) => [entry.contestant.toString(), entry])
  );

  event.participants.forEach((participant) => {
    const selectedEntry = selectedById.get(participant._id.toString());
    if (selectedEntry) {
      participant.raffleStatus = "selected";
      participant.rafflePosition = selectedEntry.position;
      participant.raffleRandomNumber = selectedEntry.randomNumber;
    } else {
      participant.raffleStatus = "not-selected";
      participant.rafflePosition = null;
      participant.raffleRandomNumber = null;
    }
    participant.selectionTransferredFromName = "";
    participant.selectionTransferredAt = null;
  });
  event.raffleSeed = raffleResults.raffleSeed;
  event.raffleExecutedAt = raffleResults.raffleTimestamp;
  event.currentTurnIndex = 0;

  await event.save();
  await sendDebateSelectionMessages(event.participants, event);
  return raffleResults;
}

async function syncDebateAutoRaffle(event) {
  if (!event.raffleExecutedAt && event.raffleRunsAt && event.raffleRunsAt.getTime() <= Date.now()) {
    try {
      await runDebateRaffleForEvent(event);
    } catch (error) {
      console.warn("Debate auto raffle failed:", error.message);
    }
  }
  return event;
}

async function syncDebateSchedule(event) {
  const now = Date.now();
  if (event.phase === "voting" && event.votingEndsAt && event.votingEndsAt.getTime() <= now) {
    event.phase = "results";
    event.currentTurnIndex = 0;
    event.votingClosedAt = event.votingClosedAt || new Date();
    calculateResults(event);
    startPhaseTimer(event, 0);
    await event.save();
    return event;
  }

  if (
    event.phase === "voting" &&
    event.votingEndsAt &&
    event.votingEndsAt.getTime() > now &&
    (!event.timerEndsAt ||
      Math.abs(event.timerEndsAt.getTime() - event.votingEndsAt.getTime()) > 1000)
  ) {
    event.timerEndsAt = event.votingEndsAt;
    event.paused = false;
    event.pausedRemainingSeconds = 0;
    await event.save();
    return event;
  }

  if (
    event.eventEndsAt &&
    event.eventEndsAt.getTime() <= now &&
    !["results", "finished"].includes(event.phase)
  ) {
    event.phase = "results";
    event.currentTurnIndex = 0;
    event.votingClosedAt = event.votingClosedAt || new Date();
    calculateResults(event);
    startPhaseTimer(event, 0);
    await event.save();
    return event;
  }

  if (!event.eventStartsAt) return event;

  const startsAt = event.eventStartsAt.getTime();
  const staleTerminalPhase = ["results", "finished"].includes(event.phase);

  if (startsAt > now && staleTerminalPhase) {
    event.phase = "scheduled";
    event.currentTurnIndex = 0;
    event.votingOpenedAt = null;
    event.votingClosedAt = null;
    event.participants.forEach((participant) => {
      participant.audienceVotes = 0;
      participant.finalScore = 0;
      participant.placement = null;
    });
    await DebateVote.deleteMany({ event: event._id });
    startPhaseTimer(event, 0);
    await event.save();
    return event;
  }

  if (startsAt <= now && event.phase === "scheduled") {
    event.phase = "welcome";
    event.currentTurnIndex = 0;
    startPhaseTimer(event, getPhaseSeconds(event, "welcome"));
    await event.save();
  }

  return event;
}

async function syncDebateTimer(event) {
  const timedPhases = new Set([
    "welcome",
    "round1",
    "commercial1",
    "question",
    "round2",
    "commercial2",
    "round3",
    "voting",
  ]);
  if (
    event.paused ||
    !event.timerEndsAt ||
    !timedPhases.has(event.phase) ||
    event.timerEndsAt.getTime() > Date.now()
  ) {
    return event;
  }

  moveForward(event);
  await event.save();
  return event;
}

async function syncDebateResults(event) {
  if (!["results", "finished"].includes(event.phase)) return event;

  const before = event.participants
    .map(
      (participant) =>
        `${participant._id}:${participant.finalScore || 0}:${participant.placement || ""}`
    )
    .join("|");
  calculateResults(event);
  const after = event.participants
    .map(
      (participant) =>
        `${participant._id}:${participant.finalScore || 0}:${participant.placement || ""}`
    )
    .join("|");

  if (before !== after) {
    await event.save();
  }
  return event;
}

function judgeTotal(participant) {
  const scores = participant.judgeScores || {};
  return ["argument", "evidence", "rebuttal", "delivery", "timeDiscipline"].reduce(
    (total, key) => total + Number(scores[key] || 0),
    0
  );
}

function calculateResults(event) {
  const scoringParticipants = getEligibleParticipants(event);
  const mode = event.judgingMode;
  event.participants.forEach((participant) => {
    if (hasRaffleRun(event) && participant.raffleStatus !== "selected") {
      participant.finalScore = 0;
      participant.placement = null;
      return;
    }
    const judgeScore = judgeTotal(participant);
    const audienceScore = Number(participant.audienceVotes || 0);
    participant.finalScore =
      mode === "audience"
        ? audienceScore
        : mode === "hybrid"
          ? judgeScore * (event.judgeWeight / 100) + audienceScore * (event.audienceWeight / 100)
          : judgeScore;
    participant.placement = null;
  });
  const ranked = [...scoringParticipants].sort((a, b) => b.finalScore - a.finalScore);
  const firstPlaceMin = Math.max(Number(event.firstPlaceMinPoints || 0), 1);
  const secondPlaceMin = Math.max(Number(event.secondPlaceMinPoints || 0), 1);
  const firstPlace = ranked[0];
  if (firstPlace && Number(firstPlace.finalScore || 0) >= firstPlaceMin) {
    firstPlace.placement = 1;
  }
  const secondPlace = ranked.find(
    (participant) => participant._id.toString() !== firstPlace?._id.toString()
  );
  if (secondPlace && Number(secondPlace.finalScore || 0) >= secondPlaceMin) {
    secondPlace.placement = 2;
  }
}

function serializeEvent(event, user = null, includePrivate = false) {
  const currentParticipant = getParticipantForTurn(event);
  // Live totals make audience voting transparent without exposing voter identities.
  const showVotes = includePrivate || ["voting", "results", "finished"].includes(event.phase);
  const visibleParticipants =
    includePrivate || hasRaffleRun(event)
      ? includePrivate
        ? event.participants
        : getEligibleParticipants(event)
      : [];
  const participants = visibleParticipants.map((participant) => ({
    id: participant._id,
    name: participant.name,
    position: participant.position,
    country: participant.country,
    profilePhoto: participant.profilePhoto,
    raffleStatus: includePrivate ? participant.raffleStatus : undefined,
    rafflePosition:
      participant.raffleStatus === "selected" || includePrivate
        ? participant.rafflePosition
        : undefined,
    raffleRandomNumber: includePrivate ? participant.raffleRandomNumber : undefined,
    selectionTransferredFromName: includePrivate
      ? participant.selectionTransferredFromName
      : undefined,
    selectionTransferredAt: includePrivate ? participant.selectionTransferredAt : undefined,
    user: includePrivate ? participant.user : undefined,
    judgeScores: includePrivate ? participant.judgeScores : undefined,
    judgeTotal: showVotes ? judgeTotal(participant) : undefined,
    audienceVotes: showVotes ? participant.audienceVotes : undefined,
    finalScore: showVotes ? Number(participant.finalScore || 0).toFixed(1) : undefined,
    placement: showVotes ? participant.placement : undefined,
  }));
  return {
    id: event._id,
    active: event.active,
    title: event.title,
    topic: event.topic,
    openingPrompt: event.openingPrompt,
    mainQuestion: event.mainQuestion,
    closingPrompt: event.closingPrompt,
    firstPlacePrize: event.firstPlacePrize || "",
    secondPlacePrize: event.secondPlacePrize || "",
    rules: event.rules,
    phase: event.phase,
    phaseLabel: PHASE_LABELS[event.phase] || event.phase,
    phaseStartedAt: event.phaseStartedAt,
    timerEndsAt: event.timerEndsAt,
    serverNow: new Date(),
    remainingSeconds: getRemainingSeconds(event),
    paused: event.paused,
    currentTurnIndex: event.currentTurnIndex,
    currentParticipantId: currentParticipant?._id || null,
    currentParticipantIsSelf: Boolean(
      user && currentParticipant?.user?.toString() === user._id?.toString()
    ),
    canMarkReady: Boolean(
      currentParticipant &&
        SPEECH_PHASES.has(event.phase) &&
        !event.timerEndsAt &&
        user &&
        (user.role === "admin" || currentParticipant.user?.toString() === user._id?.toString())
    ),
    waitingForReady: Boolean(
      currentParticipant && SPEECH_PHASES.has(event.phase) && !event.timerEndsAt
    ),
    eventStartsAt: event.eventStartsAt,
    eventEndsAt: event.eventEndsAt,
    firstPlaceMinPoints: event.firstPlaceMinPoints || 0,
    secondPlaceMinPoints: event.secondPlaceMinPoints || 0,
    openingSeconds: event.openingSeconds,
    questionDisplaySeconds: event.questionDisplaySeconds,
    responseSeconds: event.responseSeconds,
    closingSeconds: event.closingSeconds,
    commercialSeconds: event.commercialSeconds,
    votingSeconds: event.votingSeconds,
    votingEndsAt: event.votingEndsAt,
    selectedParticipantSlots: event.selectedParticipantSlots,
    raffleSeed: event.raffleSeed,
    raffleExecutedAt: event.raffleExecutedAt,
    raffleRunsAt: event.raffleRunsAt,
    registeredCount: event.participants.length,
    selectedCount: event.participants.filter(
      (participant) => participant.raffleStatus === "selected"
    ).length,
    judgingMode: event.judgingMode,
    judgeWeight: event.judgeWeight,
    audienceWeight: event.audienceWeight,
    sponsor: event.sponsor,
    meetingLinks: event.meetingLinks,
    participants,
    isRegistered: Boolean(
      user &&
        event.participants.some(
          (participant) => participant.user?.toString() === user._id?.toString()
        )
    ),
    canVote:
      event.phase === "voting" &&
      Boolean(user) &&
      user.role !== "admin" &&
      (!event.votingEndsAt || event.votingEndsAt.getTime() > Date.now()),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

async function getSerializedDebateEvents(user) {
  const events = await DebateEvent.find({}).sort({ active: -1, eventStartsAt: 1, createdAt: -1 });
  return events.map((event) => serializeEvent(event, user, true));
}

const getDebateEvent = async (req, res, next) => {
  try {
    const event = await syncDebateResults(
      await syncDebateTimer(
        await syncDebateAutoRaffle(await syncDebateSchedule(await getActiveEvent()))
      )
    );
    const existingVote = req.user
      ? await DebateVote.findOne({ event: event._id, user: req.user._id }).select("participant")
      : null;
    return res.json({
      success: true,
      event: serializeEvent(event, req.user, req.user?.role === "admin"),
      currentUserVote: existingVote?.participant || null,
    });
  } catch (error) {
    return next(error);
  }
};

const updateDebateEvent = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const previousEventStartsAt = getDateTime(event.eventStartsAt);
    const shouldConsiderScheduleReset =
      req.body.eventStartsAt !== undefined && hasDebateProgress(event);
    applyDebateSettings(event, req.body);
    if (Array.isArray(req.body.participants)) {
      event.participants = req.body.participants
        .filter((participant) => String(participant?.name || "").trim())
        .map((participant) => {
          const name = String(participant.name).trim();
          const existing = event.participants.find(
            (entry) => entry.name.trim().toLowerCase() === name.toLowerCase()
          );
          return {
            ...(existing?.toObject?.() || {}),
            name,
            position: String(participant.position || "").trim(),
            country: String(participant.country || "").trim(),
            profilePhoto: String(participant.profilePhoto || existing?.profilePhoto || "").trim(),
            raffleStatus: existing?.raffleStatus || "registered",
          };
        });
    }
    const nextEventStartsAt = getDateTime(event.eventStartsAt);
    const shouldResetForNewSchedule =
      shouldConsiderScheduleReset && previousEventStartsAt !== nextEventStartsAt;
    if (shouldResetForNewSchedule) {
      resetDebateProgress(event, { clearParticipants: true });
      await DebateVote.deleteMany({ event: event._id });
    }
    if (event.judgingMode === "hybrid" && event.judgeWeight + event.audienceWeight !== 100) {
      return res.status(400).json({ success: false, message: "Hybrid weights must total 100" });
    }
    await event.save();
    return res.json({
      success: true,
      event: serializeEvent(event, req.user, true),
      events: await getSerializedDebateEvents(req.user),
      message: "Debate event updated.",
    });
  } catch (error) {
    return next(error);
  }
};

const getDebateEvents = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const activeEvent = await getActiveEvent();
    return res.json({
      success: true,
      event: serializeEvent(activeEvent, req.user, true),
      events: await getSerializedDebateEvents(req.user),
    });
  } catch (error) {
    return next(error);
  }
};

const createDebateEvent = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    await DebateEvent.updateMany({ active: true }, { $set: { active: false } });
    const event = new DebateEvent({
      active: true,
      phase: "scheduled",
      phaseStartedAt: new Date(),
      participants: [],
    });
    applyDebateSettings(event, req.body);
    resetDebateProgress(event, { clearParticipants: true });

    if (event.judgingMode === "hybrid" && event.judgeWeight + event.audienceWeight !== 100) {
      return res.status(400).json({ success: false, message: "Hybrid weights must total 100" });
    }

    await event.save();
    return res.status(201).json({
      success: true,
      event: serializeEvent(event, req.user, true),
      events: await getSerializedDebateEvents(req.user),
      message: "New debate event created. Users can register again.",
    });
  } catch (error) {
    return next(error);
  }
};

const updateDebateEventById = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await DebateEvent.findById(req.params.eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Debate event not found" });
    }

    const previousEventStartsAt = getDateTime(event.eventStartsAt);
    const shouldConsiderScheduleReset =
      req.body.eventStartsAt !== undefined && hasDebateProgress(event);
    applyDebateSettings(event, req.body);
    if (Array.isArray(req.body.participants)) {
      event.participants = req.body.participants
        .filter((participant) => String(participant?.name || "").trim())
        .map((participant) => {
          const name = String(participant.name).trim();
          const existing = event.participants.find(
            (entry) => entry.name.trim().toLowerCase() === name.toLowerCase()
          );
          return {
            ...(existing?.toObject?.() || {}),
            name,
            position: String(participant.position || "").trim(),
            country: String(participant.country || "").trim(),
            profilePhoto: String(participant.profilePhoto || existing?.profilePhoto || "").trim(),
            raffleStatus: existing?.raffleStatus || "registered",
          };
        });
    }
    const nextEventStartsAt = getDateTime(event.eventStartsAt);
    const shouldResetForNewSchedule =
      shouldConsiderScheduleReset && previousEventStartsAt !== nextEventStartsAt;
    if (shouldResetForNewSchedule) {
      resetDebateProgress(event, { clearParticipants: true });
      await DebateVote.deleteMany({ event: event._id });
    }
    if (event.judgingMode === "hybrid" && event.judgeWeight + event.audienceWeight !== 100) {
      return res.status(400).json({ success: false, message: "Hybrid weights must total 100" });
    }

    await event.save();
    const activeEvent = event.active ? event : await getActiveEvent();
    return res.json({
      success: true,
      event: serializeEvent(activeEvent, req.user, true),
      editedEvent: serializeEvent(event, req.user, true),
      events: await getSerializedDebateEvents(req.user),
      message: "Debate event updated.",
    });
  } catch (error) {
    return next(error);
  }
};

const activateDebateEvent = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await DebateEvent.findById(req.params.eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Debate event not found" });
    }

    await DebateEvent.updateMany({ active: true }, { $set: { active: false } });
    event.active = true;
    await event.save();

    return res.json({
      success: true,
      event: serializeEvent(event, req.user, true),
      events: await getSerializedDebateEvents(req.user),
      message: "This debate event is now shown on the public page.",
    });
  } catch (error) {
    return next(error);
  }
};

const deleteDebateEvent = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const eventsCount = await DebateEvent.countDocuments();
    if (eventsCount <= 1) {
      return res.status(400).json({
        success: false,
        message: "Create another debate event before deleting the last one.",
      });
    }

    const event = await DebateEvent.findById(req.params.eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Debate event not found" });
    }

    const wasActive = event.active;
    await DebateVote.deleteMany({ event: event._id });
    await event.deleteOne();

    let activeEvent = await DebateEvent.findOne({ active: true }).sort({ updatedAt: -1 });
    if (wasActive || !activeEvent) {
      activeEvent = await DebateEvent.findOne({}).sort({ eventStartsAt: 1, createdAt: -1 });
      if (activeEvent) {
        await DebateEvent.updateMany({ active: true }, { $set: { active: false } });
        activeEvent.active = true;
        await activeEvent.save();
      }
    }

    return res.json({
      success: true,
      event: serializeEvent(activeEvent || (await getActiveEvent()), req.user, true),
      events: await getSerializedDebateEvents(req.user),
      message: "Debate event deleted.",
    });
  } catch (error) {
    return next(error);
  }
};

function moveForward(event) {
  const participantCount = getEligibleParticipants(event).length;
  if (SPEECH_PHASES.has(event.phase)) {
    if (event.currentTurnIndex + 1 < participantCount) {
      event.currentTurnIndex += 1;
      startSpeakerWait(event);
      return;
    }
  }
  const next = {
    scheduled: "welcome",
    welcome: "round1",
    round1: "commercial1",
    commercial1: "question",
    question: "round2",
    round2: "commercial2",
    commercial2: "round3",
    round3: "voting",
    voting: "results",
    results: "finished",
  }[event.phase];
  if (!next) return;
  event.phase = next;
  event.currentTurnIndex = 0;
  if (next === "voting") {
    event.votingOpenedAt = new Date();
    event.votingClosedAt = null;
  }
  if (next === "results") {
    event.votingClosedAt = new Date();
    calculateResults(event);
  }
  if (SPEECH_PHASES.has(next)) {
    startSpeakerWait(event);
  } else {
    startPhaseTimer(event);
  }
}

const controlDebateEvent = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const { action } = req.body;
    if (action === "next") {
      if (getEligibleParticipants(event).length < 1) {
        return res.status(400).json({ success: false, message: "Add at least 1 participant" });
      }
      moveForward(event);
    } else if (action === "pause" && !event.paused) {
      event.pausedRemainingSeconds = getRemainingSeconds(event);
      event.paused = true;
      event.timerEndsAt = null;
    } else if (action === "resume" && event.paused) {
      startPhaseTimer(event, event.pausedRemainingSeconds);
    } else if (action === "add-time") {
      const seconds = Math.min(Math.max(Number(req.body.seconds || 60), 1), 600);
      if (event.paused) event.pausedRemainingSeconds += seconds;
      else
        event.timerEndsAt = new Date((event.timerEndsAt?.getTime() || Date.now()) + seconds * 1000);
    } else if (action === "results") {
      event.phase = "results";
      event.votingClosedAt = new Date();
      calculateResults(event);
      startPhaseTimer(event, 0);
    } else if (action === "reset") {
      event.phase = "scheduled";
      event.currentTurnIndex = 0;
      event.votingOpenedAt = null;
      event.votingClosedAt = null;
      event.raffleSeed = "";
      event.raffleExecutedAt = null;
      event.participants.forEach((participant) => {
        participant.raffleStatus = "registered";
        participant.rafflePosition = null;
        participant.raffleRandomNumber = null;
        participant.selectionTransferredFromName = "";
        participant.selectionTransferredAt = null;
        participant.audienceVotes = 0;
        participant.finalScore = 0;
        participant.placement = null;
      });
      await DebateVote.deleteMany({ event: event._id });
      startPhaseTimer(event, 0);
    } else {
      return res.status(400).json({ success: false, message: "Unknown debate control" });
    }
    await event.save();
    return res.json({ success: true, event: serializeEvent(event, req.user, true) });
  } catch (error) {
    return next(error);
  }
};

const markDebateParticipantReady = async (req, res, next) => {
  try {
    const event = await getActiveEvent();
    const currentParticipant = getParticipantForTurn(event);
    if (!currentParticipant || !SPEECH_PHASES.has(event.phase)) {
      return res
        .status(400)
        .json({ success: false, message: "No participant is currently speaking." });
    }
    if (event.timerEndsAt && event.timerEndsAt.getTime() > Date.now()) {
      return res
        .status(400)
        .json({ success: false, message: "This speaker's timer is already running." });
    }
    const isCurrentParticipant = currentParticipant.user?.toString() === req.user?._id?.toString();
    if (req.user?.role !== "admin" && !isCurrentParticipant) {
      return res
        .status(403)
        .json({ success: false, message: "Only the current speaker can mark ready." });
    }

    startPhaseTimer(event, getPhaseSeconds(event, event.phase));
    await event.save();
    return res.json({
      success: true,
      event: serializeEvent(event, req.user, req.user?.role === "admin"),
      message: "Ready confirmed. Your speaking timer has started.",
    });
  } catch (error) {
    return next(error);
  }
};

const registerForDebate = async (req, res, next) => {
  try {
    const event = await getActiveEvent();
    const hasStarted = event.eventStartsAt
      ? event.eventStartsAt.getTime() <= Date.now()
      : !["scheduled", "welcome"].includes(event.phase);
    if (hasStarted) {
      return res.status(409).json({ success: false, message: "Debate registration is closed" });
    }
    const exists = event.participants.some(
      (participant) => participant.user?.toString() === req.user._id.toString()
    );
    if (!exists) {
      const participant = event.participants.create({
        user: req.user._id,
        name: req.user.name || req.user.email,
        position: String(req.body.position || "").trim(),
        country: req.user.country || req.user.location || "",
        profilePhoto: req.user.profilePhoto || req.user.avatar || "",
        raffleStatus: "registered",
      });
      event.participants.push(participant);
      await event.save();
      await sendDebateRegistrationMessage(participant, event);
    }
    return res.json({
      success: true,
      event: serializeEvent(event, req.user),
      message:
        "Contestant registered successfully. Please click: https://afrionet.com/profile#contact-messages",
    });
  } catch (error) {
    return next(error);
  }
};

const voteInDebate = async (req, res, next) => {
  try {
    const event = await getActiveEvent();
    if (event.phase !== "voting") {
      return res.status(409).json({ success: false, message: "Voting is not open" });
    }
    if (event.votingEndsAt && event.votingEndsAt.getTime() <= Date.now()) {
      event.phase = "results";
      event.votingClosedAt = event.votingClosedAt || new Date();
      calculateResults(event);
      startPhaseTimer(event, 0);
      await event.save();
      return res
        .status(409)
        .json({ success: false, message: "Voting has closed. Final results are now available." });
    }
    const participant = event.participants.id(req.body.participantId);
    if (!participant)
      return res.status(404).json({ success: false, message: "Participant not found" });
    if (hasRaffleRun(event) && participant.raffleStatus !== "selected") {
      return res
        .status(403)
        .json({ success: false, message: "Only selected debate participants can receive votes" });
    }
    await DebateVote.create({ event: event._id, participant: participant._id, user: req.user._id });
    await DebateEvent.updateOne(
      { _id: event._id, "participants._id": participant._id },
      { $inc: { "participants.$.audienceVotes": 1 } }
    );
    return res.json({ success: true, message: "Vote recorded", currentUserVote: participant._id });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "You have already voted" });
    }
    return next(error);
  }
};

const scoreDebateParticipant = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const participant = event.participants.id(req.params.participantId);
    if (!participant)
      return res.status(404).json({ success: false, message: "Participant not found" });
    participant.judgeScores = {
      argument: Number(req.body.argument || 0),
      evidence: Number(req.body.evidence || 0),
      rebuttal: Number(req.body.rebuttal || 0),
      delivery: Number(req.body.delivery || 0),
      timeDiscipline: Number(req.body.timeDiscipline || 0),
    };
    await event.save();
    return res.json({ success: true, event: serializeEvent(event, req.user, true) });
  } catch (error) {
    return next(error);
  }
};

const executeDebateRaffle = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const raffleResults = await runDebateRaffleForEvent(event, req.body?.maxParticipants);

    return res.json({
      success: true,
      event: serializeEvent(event, req.user, true),
      message: `Raffle complete. ${raffleResults.selected.length} participant${
        raffleResults.selected.length === 1 ? "" : "s"
      } selected.`,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

const deleteDebateParticipant = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const participant = event.participants.id(String(req.params.participantId || "").trim());
    if (!participant) {
      return res.status(404).json({ success: false, message: "Registered user not found" });
    }
    participant.deleteOne();
    await event.save();
    return res.json({
      success: true,
      event: serializeEvent(event, req.user, true),
      message: "Registered user deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
};

const getDebateParticipantWhatsAppLink = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const participant = event.participants.id(String(req.params.participantId || "").trim());
    if (!participant) {
      return res.status(404).json({ success: false, message: "Registered user not found" });
    }
    if (!participant.user) {
      return res
        .status(400)
        .json({ success: false, message: "This registration is not linked to a user profile." });
    }

    const user = await User.findById(participant.user).select("phone").lean();
    const rawPhone = String(user?.phone || "").trim();
    if (!rawPhone) {
      return res.status(400).json({
        success: false,
        message: `${participant.name || "This user"} has no registered phone number.`,
      });
    }

    const digits = rawPhone.replace(/\D/g, "").replace(/^00/, "");
    const hasCountryCode =
      rawPhone.startsWith("+") || rawPhone.startsWith("00") || !digits.startsWith("0");
    if (!hasCountryCode || digits.length < 8 || digits.length > 15) {
      return res.status(400).json({
        success: false,
        message: `${participant.name || "This user"}'s phone number needs an international country code before it can be opened in WhatsApp.`,
      });
    }

    const message = `Hi ${participant.name || "there"}, this is AfriOnet regarding the ${event.title || "Live Debate Event"}.`;
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      whatsappUrl: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
    });
  } catch (error) {
    return next(error);
  }
};

const contactDebateParticipants = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const { participantId, message, title } = req.body;
    const body = String(message || "").trim();
    const messageTitle = String(title || "Message from AfriOnet Debate").trim();
    if (!body) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const event = await getActiveEvent();
    const recipients = participantId
      ? event.participants.filter((participant) => participant._id.toString() === participantId)
      : event.participants;
    const contactableRecipients = recipients.filter((participant) => participant.user);

    if (!contactableRecipients.length) {
      return res.status(404).json({
        success: false,
        message: participantId ? "Registered user not found" : "No registered users to contact",
      });
    }

    await Promise.all(
      contactableRecipients.map((participant) =>
        createDebateProfileMessage({ participant, title: messageTitle, body })
      )
    );

    return res.json({
      success: true,
      event: serializeEvent(event, req.user, true),
      message: `Message sent to ${contactableRecipients.length} registered user${
        contactableRecipients.length === 1 ? "" : "s"
      }.`,
    });
  } catch (error) {
    return next(error);
  }
};

const transferDebateSlot = async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const event = await getActiveEvent();
    const selectedParticipant = event.participants.id(
      String(req.params.participantId || "").trim()
    );
    const replacementParticipant = event.participants.id(
      String(req.body?.replacementParticipantId || "").trim()
    );

    if (!hasRaffleRun(event)) {
      return res
        .status(400)
        .json({ success: false, message: "Run the raffle before transferring a selected slot." });
    }
    if (!selectedParticipant || selectedParticipant.raffleStatus !== "selected") {
      return res.status(400).json({
        success: false,
        message: "The user giving up the slot must currently be selected.",
      });
    }
    if (!replacementParticipant || replacementParticipant.raffleStatus !== "not-selected") {
      return res.status(400).json({
        success: false,
        message: "Choose a currently not-selected user as the replacement.",
      });
    }

    const transferredPosition = selectedParticipant.rafflePosition;
    selectedParticipant.raffleStatus = "not-selected";
    selectedParticipant.rafflePosition = null;
    selectedParticipant.raffleRandomNumber = null;
    selectedParticipant.selectionTransferredFromName = "";
    selectedParticipant.selectionTransferredAt = null;
    replacementParticipant.raffleStatus = "selected";
    replacementParticipant.rafflePosition = transferredPosition;
    replacementParticipant.raffleRandomNumber = null;
    replacementParticipant.selectionTransferredFromName = selectedParticipant.name || "Participant";
    replacementParticipant.selectionTransferredAt = new Date();

    await event.save();
    await Promise.all([
      createDebateProfileMessage({
        participant: selectedParticipant,
        title: "Debate participant slot transferred",
        body:
          `Hi ${selectedParticipant.name || "there"},\n\n` +
          `Your selected debate slot #${transferredPosition} has been transferred by the event administrator. You can still join and watch the live debate.\n\n` +
          `${ZOOM_EVENT_REMINDER}\n\n` +
          "Best regards,\nThe AfriOnet Team",
      }),
      createDebateProfileMessage({
        participant: replacementParticipant,
        title: "You were selected for the debate",
        body:
          `Hi ${replacementParticipant.name || "there"},\n\n` +
          `A selected debate slot has been transferred to you by the event administrator. Your debate position is #${transferredPosition}. Please be ready when your name is called.\n\n` +
          `${ZOOM_EVENT_REMINDER}\n\n` +
          "Best regards,\nThe AfriOnet Team",
      }),
    ]);

    return res.json({
      success: true,
      event: serializeEvent(event, req.user, true),
      message: `Slot #${transferredPosition} transferred from ${selectedParticipant.name} to ${replacementParticipant.name}.`,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getDebateEvent,
  getDebateEvents,
  createDebateEvent,
  updateDebateEvent,
  updateDebateEventById,
  activateDebateEvent,
  deleteDebateEvent,
  controlDebateEvent,
  registerForDebate,
  voteInDebate,
  markDebateParticipantReady,
  scoreDebateParticipant,
  executeDebateRaffle,
  deleteDebateParticipant,
  getDebateParticipantWhatsAppLink,
  contactDebateParticipants,
  transferDebateSlot,
};
