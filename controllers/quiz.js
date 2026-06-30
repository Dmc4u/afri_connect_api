const QuizQuestion = require("../models/QuizQuestion");
const QuizSession = require("../models/QuizSession");
const QuizAnswer = require("../models/QuizAnswer");
const User = require("../models/User");
const ContactMessage = require("../models/ContactMessage");
const MessageNotification = require("../models/MessageNotification");
const { performRaffle } = require("../utils/raffleSelection");

const MEETING_JOIN_WINDOW_SECONDS = 5 * 60;
const MEETING_JOINABLE_PHASES = new Set([
  "welcome",
  "rules",
  "contestants",
  "pick-number",
  "question",
  "winner",
]);
const DEFAULT_EVENT_RULES = [
  "Please install or open the Zoom app before the event. Zoom is required to watch the live event, and selected contestants must be ready to share their screen when it is their turn.",
  "Share the event once it is your turn to pick a number to reveal the next question on Zoom.",
  "Don't look around when answering to keep the event fun and fair for everyone.",
  "You will be disqualified if you cheat.",
  "Choose any available question number.",
  "Each number can only be selected once during the event.",
  "Answer using A, B, C or a written reply.",
  "Correct answers earn points.",
  "Each selected contestant picks their allowed number of questions before the next contestant takes a turn.",
  "The contestant with the most points at the end wins.",
];
const DEFAULT_EVENT_RULES_TEXT = DEFAULT_EVENT_RULES.join("\n");
const LEGACY_RULES_PLACEHOLDER =
  "Rules are presented for about 1-3 minutes. Read carefully before answering.";
const ZOOM_EVENT_REMINDER =
  "Important Reminder: This event will be held on Zoom. Please make sure you have the Zoom application installed and working on your device before the event date.\n\n" +
  "To avoid any last-minute issues, we recommend testing Zoom in advance and ensuring you have a stable internet connection.";

const getConfiguredAdminEmails = () =>
  String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

function normalizeSessionRules(rules) {
  const savedRules = String(rules || "").trim();
  if (!savedRules || savedRules.toLowerCase() === LEGACY_RULES_PLACEHOLDER.toLowerCase()) {
    return DEFAULT_EVENT_RULES_TEXT;
  }
  return savedRules;
}

function getValidContestantTimeZone(contestant) {
  const timeZone = String(contestant?.timeZone || "").trim();
  if (!timeZone) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function formatEventTimeForMessage(value, contestant) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const timeZone = getValidContestantTimeZone(contestant);
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
  const label = timeZone === "UTC" ? "UTC" : `your local time — ${timeZone}`;
  return `${formatted} (${label})`;
}

function getEventStartLabel(session, contestant) {
  if (session.eventStartsAt) {
    return formatEventTimeForMessage(session.eventStartsAt, contestant);
  }

  return String(session.eventStartsAtLabel || "").trim() || "the scheduled event time";
}

function getRaffleTimeLine(session, contestant) {
  if (!session.raffleRunsAt) {
    return "";
  }

  return `Raffle time: ${formatEventTimeForMessage(session.raffleRunsAt, contestant)}\n\n`;
}

async function createQuizProfileMessage({ contestant, title, body }) {
  if (!contestant?.user) {
    return;
  }

  try {
    const contactMessage = await ContactMessage.create({
      senderName: "AfriOnet Quiz",
      senderEmail: process.env.ADMIN_EMAIL || "support@afrionet.com",
      message: body,
      businessOwner: contestant.user,
      sender: null,
    });

    await MessageNotification.create({
      user: contestant.user,
      conversation: null,
      message: contactMessage._id,
      sender: null,
      type: "contact-form",
      title,
      body: body.slice(0, 100),
      isRead: false,
    });
  } catch (error) {
    console.warn("Quiz profile message notification failed:", error.message);
  }
}

async function sendQuizRegistrationMessage(contestant, session) {
  const eventStart = getEventStartLabel(session, contestant);
  const raffleTimeLine = getRaffleTimeLine(session, contestant);
  const name = contestant.name || "Contestant";
  const body = [
    `Hi ${name},`,
    "You have registered for the AfriOnet Live Q/A Event.",
    `Event start: ${eventStart}`,
    raffleTimeLine.trim(),
    ZOOM_EVENT_REMINDER,
    "Share the event once it is your turn to pick a number to reveal the next question on Zoom.",
    "You will receive another message here immediately after the raffle is run if you are selected as a contestant.",
    "If you need any additional information, you can reply to this message here or visit https://afrionet.com/contact.",
    "Best regards,\nThe AfriOnet Team",
  ]
    .filter(Boolean)
    .join("\n\n");

  await createQuizProfileMessage({
    contestant,
    title: "Q/A event registration confirmed",
    body,
  });
}

function getOrdinalNumber(number) {
  const value = Number(number);
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = value % 100;
  return `${value}${suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0]}`;
}

async function sendQuizSelectionMessages(registeredContestants, session) {
  await Promise.all(
    registeredContestants.map((contestant) => {
      const eventStart = getEventStartLabel(session, contestant);
      const raffleTimeLine = getRaffleTimeLine(session, contestant);
      const name = contestant.name || "Contestant";
      if (contestant.raffleStatus !== "selected") {
        const body =
          `Hi ${name},\n\n` +
          "Thank you for registering for the AfriOnet Live Q/A Event.\n\n" +
          "The raffle has now been completed, and you were not selected as one of the contestants for this event.\n\n" +
          "You can still join the live event on Zoom, support the contestants, and watch for the next opportunity.\n\n" +
          `${ZOOM_EVENT_REMINDER}\n\n` +
          "Best regards,\nThe AfriOnet Team";

        return createQuizProfileMessage({
          contestant,
          title: "Q/A event raffle result",
          body,
        });
      }

      const contestantNumber = contestant.rafflePosition
        ? `${contestant.rafflePosition} (${getOrdinalNumber(contestant.rafflePosition)} contestant)`
        : "assigned on the raffle list";
      const body = [
        `Hi ${name},`,
        "Congratulations! You were selected for the AfriOnet Live Q/A Event raffle.",
        `Your contestant number: ${contestantNumber}.`,
        `Event start: ${eventStart}`,
        raffleTimeLine.trim(),
        ZOOM_EVENT_REMINDER,
        "Join Zoom when the button opens 5 minutes before the event. Please be ready when your contestant number is called.",
        "When it is your turn, share your screen on Zoom, then pick a number to reveal the next question.",
        "If you need any additional information, you can reply to this message here or visit https://afrionet.com/contact.",
        "Best regards,\nThe AfriOnet Team",
      ]
        .filter(Boolean)
        .join("\n\n");

      return createQuizProfileMessage({
        contestant,
        title: "You were selected for the Q/A event",
        body,
      });
    })
  );
}

const DEFAULT_QUESTIONS = [
  {
    number: 1,
    text: "Which city is the capital of Nigeria?",
    type: "multiple-choice",
    choices: ["A. Lagos", "B. Abuja", "C. Kano"],
    correctAnswer: "B",
  },
  {
    number: 2,
    text: "Which planet is known as the Red Planet?",
    type: "multiple-choice",
    choices: ["A. Venus", "B. Saturn", "C. Mars"],
    correctAnswer: "C",
  },
  {
    number: 3,
    text: "Name one common author of the book 'Things Fall Apart'.",
    type: "text",
  },
  {
    number: 4,
    text: "What is the official language of Brazil?",
    type: "multiple-choice",
    choices: ["A. Spanish", "B. Portuguese", "C. French"],
    correctAnswer: "B",
  },
  {
    number: 5,
    text: "Which of the following is a renewable energy source?",
    type: "multiple-choice",
    choices: ["A. Coal", "B. Solar", "C. Oil"],
    correctAnswer: "B",
  },
  {
    number: 6,
    text: "Write the name of an African river that flows into the Atlantic Ocean.",
    type: "text",
  },
  {
    number: 7,
    text: "What is the smallest prime number?",
    type: "multiple-choice",
    choices: ["A. 1", "B. 2", "C. 3"],
    correctAnswer: "B",
  },
  {
    number: 8,
    text: "Which device is used to measure temperature?",
    type: "multiple-choice",
    choices: ["A. Thermometer", "B. Micrometer", "C. Barometer"],
    correctAnswer: "A",
  },
  {
    number: 9,
    text: "Name one continent where the Sahara Desert is located.",
    type: "text",
  },
  {
    number: 10,
    text: "Which language is most widely spoken in Ghana?",
    type: "multiple-choice",
    choices: ["A. Twi", "B. English", "C. Swahili"],
    correctAnswer: "B",
  },
  {
    number: 11,
    text: "Which of the following is a fruit?",
    type: "multiple-choice",
    choices: ["A. Carrot", "B. Apple", "C. Lettuce"],
    correctAnswer: "B",
  },
  {
    number: 12,
    text: "Write the name of a global video call platform used for live Q/A sessions.",
    type: "text",
  },
  {
    number: 13,
    text: "In which continent is the country of Kenya located?",
    type: "multiple-choice",
    choices: ["A. Africa", "B. Europe", "C. Asia"],
    correctAnswer: "A",
  },
  {
    number: 14,
    text: "Which animal is known as the king of the jungle?",
    type: "multiple-choice",
    choices: ["A. Lion", "B. Tiger", "C. Elephant"],
    correctAnswer: "A",
  },
  {
    number: 15,
    text: "Name a popular video conferencing tool starting with the letter 'Z'.",
    type: "text",
  },
  {
    number: 16,
    text: "Which organ pumps blood around the human body?",
    type: "multiple-choice",
    choices: ["A. Lung", "B. Liver", "C. Heart"],
    correctAnswer: "C",
  },
  {
    number: 17,
    text: "What color do you get when you mix red and blue?",
    type: "multiple-choice",
    choices: ["A. Purple", "B. Green", "C. Orange"],
    correctAnswer: "A",
  },
  {
    number: 18,
    text: "Name the continent that is home to the Amazon rainforest.",
    type: "text",
  },
  {
    number: 19,
    text: "Which season comes after winter?",
    type: "multiple-choice",
    choices: ["A. Spring", "B. Summer", "C. Autumn"],
    correctAnswer: "A",
  },
  {
    number: 20,
    text: "Write a word that starts with the letter 'Q'.",
    type: "text",
  },
];

async function ensureDefaultQuestions() {
  const existingCount = await QuizQuestion.countDocuments();
  if (existingCount > 0) {
    return;
  }

  await QuizQuestion.insertMany(DEFAULT_QUESTIONS);
}

function getFreshSessionFields(overrides = {}) {
  return {
    title: "Live Q/A Event",
    active: true,
    phase: "welcome",
    phaseStartedAt: new Date(),
    currentQuestionNumber: null,
    questionTimerSeconds: 30,
    welcomeSeconds: 90,
    rulesSeconds: 80,
    contestantsSeconds: 10,
    questionLimitPerContestant: 5,
    questionPoolSize: 20,
    questionDisplayStart: 1,
    questionDisplayEnd: 20,
    firstPlaceMinPoints: 0,
    secondPlaceMinPoints: 0,
    firstPlacePrize: "",
    secondPlacePrize: "",
    maxSelectedContestants: 5,
    currentTurnContestant: null,
    contestants: [],
    askedNumbers: [],
    bonusPending: false,
    raffleSeed: "",
    raffleExecutedAt: null,
    raffleRunsAt: null,
    meetingLinks: {
      zoom: "",
    },
    welcomeNote:
      "Welcome to the Q/A event. Take the opening moment to greet the participants and introduce the flow.",
    rules: DEFAULT_EVENT_RULES_TEXT,
    ...overrides,
  };
}

async function getActiveSession() {
  let session = await QuizSession.findOne({ active: true }).sort({ updatedAt: -1, createdAt: -1 });
  if (!session) {
    session = await QuizSession.create(getFreshSessionFields());
  } else if (!session.phaseStartedAt) {
    session.phaseStartedAt = new Date();
    await session.save();
  }
  return session;
}

function getPhaseDurationSeconds(session) {
  if (session.phase === "scheduled") {
    if (!session.eventStartsAt || !session.phaseStartedAt) {
      return 0;
    }

    return Math.max(
      Math.ceil((session.eventStartsAt.getTime() - session.phaseStartedAt.getTime()) / 1000),
      0
    );
  }

  const durations = {
    welcome: session.welcomeSeconds || 90,
    rules: session.rulesSeconds || 80,
    contestants: session.contestantsSeconds || 10,
    question: session.questionTimerSeconds || 30,
  };
  return durations[session.phase] || 0;
}

function getNextPhase(phase) {
  const nextPhases = {
    scheduled: "welcome",
    welcome: "rules",
    rules: "contestants",
    contestants: "pick-number",
    question: "pick-number",
  };
  return nextPhases[phase] || phase;
}

function getRequestAudit(req) {
  return {
    userId: req.user?._id?.toString() || null,
    email: req.user?.email || null,
    ip: req.ip,
    userAgent: req.get?.("user-agent") || "",
  };
}

function logQuizSecurityEvent(event, req, details = {}) {
  console.warn("[QuizSecurity]", {
    event,
    ...getRequestAudit(req),
    ...details,
    at: new Date().toISOString(),
  });
}

function findContestantByUser(session, user) {
  if (!user?._id) {
    return null;
  }

  const userId = user._id.toString();
  const userEmail = String(user.email || "")
    .trim()
    .toLowerCase();

  const matches = session.contestants.filter((entry) => {
    const entryUserId = entry.user?.toString();
    const entryEmail = String(entry.email || "")
      .trim()
      .toLowerCase();
    return entryUserId === userId || (userEmail && entryEmail === userEmail);
  });

  // A transferred raffle slot may belong to a newer duplicate registration.
  // Always resolve the selected entry so that contestant can take their turn.
  return matches.find((entry) => entry.raffleStatus === "selected") || matches[0] || null;
}

function hasRaffleRun(session) {
  return Boolean(session.raffleExecutedAt);
}

function hasPlayedCompetitionData(session) {
  return (
    hasRaffleRun(session) ||
    (session.askedNumbers || []).length > 0 ||
    (session.contestants || []).some(
      (contestant) => (contestant.score || 0) > 0 || (contestant.answeredQuestions || []).length > 0
    )
  );
}

function resetSessionCompetitionData(session) {
  const quizSession = session;
  quizSession.currentQuestionNumber = null;
  quizSession.askedNumbers = [];
  quizSession.currentTurnContestant = null;
  quizSession.bonusPending = false;
  quizSession.raffleSeed = "";
  quizSession.raffleExecutedAt = null;
  quizSession.raffleRunsAt = null;
  quizSession.contestants = [];
}

async function runQuizRaffleForSession(session, maxContestants) {
  const quizSession = session;
  const contestantsNeeded = Number(maxContestants || quizSession.maxSelectedContestants || 5);

  if (contestantsNeeded < 1 || contestantsNeeded > 100) {
    const error = new Error("Selected contestants must be between 1 and 100");
    error.statusCode = 400;
    throw error;
  }

  // eslint-disable-next-line no-use-before-define
  const eligibleContestants = await getNonAdminContestants(quizSession);

  if (!eligibleContestants.length) {
    const error = new Error("No registered users are available for the raffle.");
    error.statusCode = 400;
    throw error;
  }

  const raffleResults = performRaffle(eligibleContestants, contestantsNeeded);
  const selectedById = new Map(
    raffleResults.selected.map((entry) => [entry.contestant.toString(), entry])
  );

  quizSession.contestants.forEach((contestant, index) => {
    const selectedEntry = selectedById.get(contestant._id.toString());
    if (selectedEntry) {
      quizSession.contestants[index].raffleStatus = "selected";
      quizSession.contestants[index].rafflePosition = selectedEntry.position;
      quizSession.contestants[index].raffleRandomNumber = selectedEntry.randomNumber;
    } else {
      quizSession.contestants[index].raffleStatus = "not-selected";
      quizSession.contestants[index].rafflePosition = null;
      quizSession.contestants[index].raffleRandomNumber = null;
    }
    quizSession.contestants[index].selectionTransferredFromName = "";
    quizSession.contestants[index].selectionTransferredAt = null;
  });

  quizSession.maxSelectedContestants = contestantsNeeded;
  // eslint-disable-next-line no-use-before-define
  const firstSelectedContestant = sortTurnContestants(
    quizSession.contestants.filter((contestant) => contestant.raffleStatus === "selected")
  )[0];
  quizSession.currentTurnContestant = firstSelectedContestant?._id || null;
  quizSession.raffleSeed = raffleResults.raffleSeed;
  quizSession.raffleExecutedAt = raffleResults.raffleTimestamp;
  await quizSession.save();

  // eslint-disable-next-line no-use-before-define
  await sendQuizSelectionMessages(await sortRegisteredContestants(quizSession), quizSession);

  return raffleResults;
}

function canContestantCompete(session, contestant) {
  if (!contestant) {
    return false;
  }

  return !hasRaffleRun(session) || contestant.raffleStatus === "selected";
}

function getContestantId(contestant) {
  return contestant?._id ? contestant._id.toString() : "";
}

function getCurrentTurnContestantId(session) {
  return session.currentTurnContestant ? session.currentTurnContestant.toString() : "";
}

function sortTurnContestants(contestants) {
  return [...contestants].sort((a, b) => {
    const aPosition = a.rafflePosition || Number.MAX_SAFE_INTEGER;
    const bPosition = b.rafflePosition || Number.MAX_SAFE_INTEGER;
    if (aPosition !== bPosition) {
      return aPosition - bPosition;
    }

    const aRegisteredAt = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
    const bRegisteredAt = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
    if (aRegisteredAt !== bRegisteredAt) {
      return aRegisteredAt - bRegisteredAt;
    }

    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function isContestantTurn(session, contestant) {
  const currentTurnId = getCurrentTurnContestantId(session);
  return Boolean(contestant && currentTurnId && getContestantId(contestant) === currentTurnId);
}

function hasContestantReachedQuestionLimitByContestant(session, contestant) {
  const limit = Number(session.questionLimitPerContestant || 0);
  if (!limit || !contestant) {
    return false;
  }

  return (contestant.answeredQuestions || []).length >= limit;
}

function getQuestionDisplayRange(session) {
  const poolSize = Math.max(1, Number(session.questionPoolSize || 20));
  const start = Math.min(Math.max(1, Number(session.questionDisplayStart || 1)), poolSize);
  const end = Math.min(Math.max(start, Number(session.questionDisplayEnd || poolSize)), poolSize);
  return { start, end, poolSize };
}

function isQuestionInDisplayRange(session, questionNumber) {
  const { start, end } = getQuestionDisplayRange(session);
  return questionNumber >= start && questionNumber <= end;
}

async function getActiveQuestionCountForSession(session) {
  const { start, end } = getQuestionDisplayRange(session);
  return QuizQuestion.countDocuments({
    active: true,
    number: { $gte: start, $lte: end },
  });
}

function moveSessionToNextPhase(session) {
  const quizSession = session;
  const nextPhase = getNextPhase(quizSession.phase);
  if (nextPhase === quizSession.phase) {
    return false;
  }

  quizSession.phase = nextPhase;
  quizSession.phaseStartedAt = new Date();
  if (nextPhase === "pick-number") {
    quizSession.currentQuestionNumber = null;
  }
  return true;
}

function moveSessionToWinner(session) {
  const quizSession = session;
  quizSession.phase = "winner";
  quizSession.phaseStartedAt = new Date();
  quizSession.currentQuestionNumber = null;
  quizSession.currentTurnContestant = null;
  return quizSession;
}

async function syncSessionPhase(session) {
  const quizSession = session;

  if (
    quizSession.eventEndsAt &&
    !["winner", "finished"].includes(quizSession.phase) &&
    quizSession.eventEndsAt.getTime() <= Date.now()
  ) {
    moveSessionToWinner(quizSession);
    await quizSession.save();
    return quizSession;
  }

  if (
    quizSession.raffleRunsAt &&
    !hasRaffleRun(quizSession) &&
    quizSession.raffleRunsAt.getTime() <= Date.now()
  ) {
    try {
      await runQuizRaffleForSession(quizSession, quizSession.maxSelectedContestants);
    } catch (error) {
      if (error.statusCode !== 400) {
        throw error;
      }
    }
  }

  if (
    quizSession.phase === "scheduled" &&
    quizSession.eventStartsAt &&
    quizSession.eventStartsAt.getTime() <= Date.now()
  ) {
    quizSession.phase = "welcome";
    quizSession.phaseStartedAt = quizSession.eventStartsAt;
    await quizSession.save();
    return quizSession;
  }

  if (!quizSession.phaseStartedAt) {
    quizSession.phaseStartedAt = new Date();
    await quizSession.save();
    return quizSession;
  }

  let changed = false;
  let durationSeconds = getPhaseDurationSeconds(quizSession);

  while (durationSeconds > 0) {
    const elapsedSeconds = Math.floor((Date.now() - quizSession.phaseStartedAt.getTime()) / 1000);
    if (elapsedSeconds < durationSeconds) {
      break;
    }

    const nextPhase = getNextPhase(quizSession.phase);
    if (nextPhase === quizSession.phase) {
      break;
    }

    if (quizSession.phase === "question") {
      // eslint-disable-next-line no-await-in-loop, no-use-before-define
      await completeExpiredQuestion(quizSession);
    } else {
      quizSession.phase = nextPhase;
      quizSession.phaseStartedAt = new Date(
        quizSession.phaseStartedAt.getTime() + durationSeconds * 1000
      );
      if (nextPhase === "pick-number") {
        quizSession.currentQuestionNumber = null;
      }
    }
    changed = true;
    durationSeconds = getPhaseDurationSeconds(quizSession);
  }

  if (changed) {
    await quizSession.save();
  }

  return quizSession;
}

function getTimerRemainingSeconds(session) {
  if (session.phase === "scheduled" && session.eventStartsAt) {
    return Math.max(Math.ceil((session.eventStartsAt.getTime() - Date.now()) / 1000), 0);
  }

  const durationSeconds = getPhaseDurationSeconds(session);
  if (!durationSeconds || !session.phaseStartedAt) {
    return 0;
  }

  const elapsedSeconds = Math.floor((Date.now() - session.phaseStartedAt.getTime()) / 1000);
  return Math.max(durationSeconds - elapsedSeconds, 0);
}

function canExposeMeetingLinks(session) {
  if (MEETING_JOINABLE_PHASES.has(session.phase)) {
    return true;
  }

  if (session.phase !== "scheduled") {
    return false;
  }

  if (!session.eventStartsAt) {
    return false;
  }

  return session.eventStartsAt.getTime() - Date.now() <= MEETING_JOIN_WINDOW_SECONDS * 1000;
}

function serializeSession(session, options = {}) {
  const hasZoomMeeting = Boolean(session.meetingLinks?.zoom);
  const meetingLinks =
    options.includePrivateMeetingLinks || canExposeMeetingLinks(session)
      ? session.meetingLinks
      : { zoom: "" };

  return {
    id: session._id,
    title: session.title,
    phase: session.phase,
    eventStartsAt: session.eventStartsAt,
    eventStartsAtLabel: session.eventStartsAtLabel || "",
    eventEndsAt: session.eventEndsAt,
    phaseStartedAt: session.phaseStartedAt,
    serverNow: new Date(),
    timerRemainingSeconds: getTimerRemainingSeconds(session),
    currentQuestionNumber: session.currentQuestionNumber,
    questionTimerSeconds: session.questionTimerSeconds,
    welcomeSeconds: session.welcomeSeconds,
    rulesSeconds: session.rulesSeconds,
    contestantsSeconds: session.contestantsSeconds,
    questionLimitPerContestant: session.questionLimitPerContestant,
    questionPoolSize: session.questionPoolSize || 20,
    questionDisplayStart: getQuestionDisplayRange(session).start,
    questionDisplayEnd: getQuestionDisplayRange(session).end,
    firstPlaceMinPoints: session.firstPlaceMinPoints || 0,
    secondPlaceMinPoints: session.secondPlaceMinPoints || 0,
    firstPlacePrize: session.firstPlacePrize || "",
    secondPlacePrize: session.secondPlacePrize || "",
    maxSelectedContestants: session.maxSelectedContestants,
    currentTurnContestant: session.currentTurnContestant,
    raffleSeed: session.raffleSeed,
    raffleExecutedAt: session.raffleExecutedAt,
    raffleRunsAt: session.raffleRunsAt,
    welcomeNote: session.welcomeNote,
    rules: normalizeSessionRules(session.rules),
    askedNumbers: session.askedNumbers,
    hasZoomMeeting,
    meetingLinks,
  };
}

async function serializeEventSummary(session) {
  // sortRegisteredContestants is declared later with the contestant helper group.
  // eslint-disable-next-line no-use-before-define
  const registeredContestants = await sortRegisteredContestants(session);

  return {
    id: session._id,
    title: session.title || "Live Q/A Event",
    active: Boolean(session.active),
    phase: session.phase,
    eventStartsAt: session.eventStartsAt,
    eventStartsAtLabel: session.eventStartsAtLabel || "",
    eventEndsAt: session.eventEndsAt,
    raffleRunsAt: session.raffleRunsAt,
    raffleExecutedAt: session.raffleExecutedAt,
    questionTimerSeconds: session.questionTimerSeconds,
    welcomeSeconds: session.welcomeSeconds,
    rulesSeconds: session.rulesSeconds,
    contestantsSeconds: session.contestantsSeconds,
    questionLimitPerContestant: session.questionLimitPerContestant,
    questionPoolSize: session.questionPoolSize || 20,
    questionDisplayStart: getQuestionDisplayRange(session).start,
    questionDisplayEnd: getQuestionDisplayRange(session).end,
    firstPlaceMinPoints: session.firstPlaceMinPoints || 0,
    secondPlaceMinPoints: session.secondPlaceMinPoints || 0,
    firstPlacePrize: session.firstPlacePrize || "",
    secondPlacePrize: session.secondPlacePrize || "",
    maxSelectedContestants: session.maxSelectedContestants,
    welcomeNote: session.welcomeNote || "",
    rules: normalizeSessionRules(session.rules),
    meetingLinks: {
      zoom: session.meetingLinks?.zoom || "",
    },
    registeredCount: registeredContestants.length,
    selectedCount: registeredContestants.filter(
      (contestant) => contestant.raffleStatus === "selected"
    ).length,
    registeredContestants,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function serializePublicEventSummary(session, user = null) {
  return {
    id: session._id,
    title: session.title || "Live Q/A Event",
    active: Boolean(session.active),
    phase: session.phase,
    eventStartsAt: session.eventStartsAt,
    eventStartsAtLabel: session.eventStartsAtLabel || "",
    raffleExecutedAt: session.raffleExecutedAt,
    registeredCount: session.contestants?.length || 0,
    selectedCount:
      session.contestants?.filter((contestant) => contestant.raffleStatus === "selected").length ||
      0,
    firstPlaceMinPoints: session.firstPlaceMinPoints || 0,
    secondPlaceMinPoints: session.secondPlaceMinPoints || 0,
    firstPlacePrize: session.firstPlacePrize || "",
    secondPlacePrize: session.secondPlacePrize || "",
    hasZoomMeeting: Boolean(session.meetingLinks?.zoom),
    currentUserRegistered: Boolean(user && findContestantByUser(session, user)),
  };
}

async function getQuizEventSummaries() {
  const sessions = await QuizSession.find().sort({
    active: -1,
    eventStartsAt: -1,
    createdAt: -1,
  });
  return Promise.all(sessions.map((session) => serializeEventSummary(session)));
}

async function getPublicQuizEventSummaries(user = null) {
  const sessions = await QuizSession.find({
    eventStartsAt: { $ne: null },
    phase: { $ne: "finished" },
  }).sort({
    active: -1,
    eventStartsAt: 1,
    createdAt: 1,
  });
  return sessions.map((session) => serializePublicEventSummary(session, user));
}

function copySessionSettingsForNewEvent(sourceSession, overrides = {}) {
  const nextStart = overrides.eventStartsAt ? new Date(overrides.eventStartsAt) : null;
  const nextEnd = overrides.eventEndsAt ? new Date(overrides.eventEndsAt) : null;
  const nextRaffle = overrides.raffleRunsAt ? new Date(overrides.raffleRunsAt) : null;

  return getFreshSessionFields({
    title: overrides.title || sourceSession?.title || "Live Q/A Event",
    phase: nextStart && nextStart.getTime() > Date.now() ? "scheduled" : "welcome",
    eventStartsAt: nextStart,
    eventStartsAtLabel: String(overrides.eventStartsAtLabel || "")
      .trim()
      .slice(0, 120),
    eventEndsAt: nextEnd,
    raffleRunsAt: nextRaffle,
    questionTimerSeconds:
      overrides.questionTimerSeconds || sourceSession?.questionTimerSeconds || 30,
    welcomeSeconds: overrides.welcomeSeconds || sourceSession?.welcomeSeconds || 90,
    rulesSeconds: overrides.rulesSeconds || sourceSession?.rulesSeconds || 80,
    contestantsSeconds: overrides.contestantsSeconds || sourceSession?.contestantsSeconds || 10,
    questionLimitPerContestant:
      overrides.questionLimitPerContestant || sourceSession?.questionLimitPerContestant || 5,
    questionPoolSize: overrides.questionPoolSize || sourceSession?.questionPoolSize || 20,
    questionDisplayStart:
      overrides.questionDisplayStart || sourceSession?.questionDisplayStart || 1,
    questionDisplayEnd:
      overrides.questionDisplayEnd ||
      sourceSession?.questionDisplayEnd ||
      sourceSession?.questionPoolSize ||
      20,
    firstPlaceMinPoints: overrides.firstPlaceMinPoints ?? sourceSession?.firstPlaceMinPoints ?? 0,
    secondPlaceMinPoints:
      overrides.secondPlaceMinPoints ?? sourceSession?.secondPlaceMinPoints ?? 0,
    firstPlacePrize: overrides.firstPlacePrize ?? sourceSession?.firstPlacePrize ?? "",
    secondPlacePrize: overrides.secondPlacePrize ?? sourceSession?.secondPlacePrize ?? "",
    maxSelectedContestants:
      overrides.maxSelectedContestants || sourceSession?.maxSelectedContestants || 5,
    meetingLinks: {
      zoom: String(overrides.meetingLinks?.zoom ?? sourceSession?.meetingLinks?.zoom ?? "").trim(),
    },
    welcomeNote:
      overrides.welcomeNote ?? sourceSession?.welcomeNote ?? getFreshSessionFields().welcomeNote,
    rules: normalizeSessionRules(overrides.rules ?? sourceSession?.rules),
  });
}

async function getNonAdminContestants(session) {
  const contestants = session.contestants || [];
  const adminEmails = new Set(getConfiguredAdminEmails());
  const contestantUserIds = contestants
    .map((contestant) => contestant.user)
    .filter(Boolean)
    .map((userId) => userId.toString());

  const adminUsers =
    contestantUserIds.length > 0
      ? await User.find({
          _id: { $in: contestantUserIds },
          role: "admin",
        })
          .select("_id")
          .lean()
      : [];
  const adminUserIds = new Set(adminUsers.map((user) => user._id.toString()));

  const eligibleContestants = contestants.filter((contestant) => {
    const contestantEmail = String(contestant.email || "")
      .trim()
      .toLowerCase();
    const isLinkedAdmin = contestant.user && adminUserIds.has(contestant.user.toString());
    const isAdminEmail = contestantEmail && adminEmails.has(contestantEmail);
    return !isLinkedAdmin && !isAdminEmail;
  });

  const getIdentityKey = (contestant) => {
    const contestantEmail = String(contestant.email || "")
      .trim()
      .toLowerCase();
    const contestantUser = contestant.user ? contestant.user.toString() : "";
    return contestantEmail || contestantUser;
  };
  const getNameKey = (contestant) =>
    String(contestant.name || contestant.contestantName || "")
      .trim()
      .toLowerCase();
  const getCompletenessScore = (contestant) =>
    Number(contestant.raffleStatus === "selected") * 100 +
    Number(Boolean(contestant.user)) +
    Number(Boolean(contestant.email)) +
    Number(Boolean(contestant.country)) +
    Number(Boolean(contestant.profilePhoto)) +
    Number((contestant.answeredQuestions || []).length > 0) +
    Number((contestant.score || 0) > 0);
  const chooseBestContestant = (current, next) =>
    !current || getCompletenessScore(next) >= getCompletenessScore(current) ? next : current;

  const identityContestants = new Map();
  const anonymousContestantsByName = new Map();
  const identityKeysByName = new Map();

  eligibleContestants.forEach((contestant) => {
    const identityKey = getIdentityKey(contestant);
    const nameKey = getNameKey(contestant);

    if (identityKey) {
      identityContestants.set(
        identityKey,
        chooseBestContestant(identityContestants.get(identityKey), contestant)
      );
      if (nameKey) {
        const keys = identityKeysByName.get(nameKey) || new Set();
        keys.add(identityKey);
        identityKeysByName.set(nameKey, keys);
      }
      return;
    }

    if (nameKey) {
      anonymousContestantsByName.set(
        nameKey,
        chooseBestContestant(anonymousContestantsByName.get(nameKey), contestant)
      );
      return;
    }

    identityContestants.set(contestant._id.toString(), contestant);
  });

  anonymousContestantsByName.forEach((contestant, nameKey) => {
    const identityKeys = [...(identityKeysByName.get(nameKey) || [])];
    if (identityKeys.length === 1) {
      const identityKey = identityKeys[0];
      identityContestants.set(
        identityKey,
        chooseBestContestant(identityContestants.get(identityKey), contestant)
      );
      return;
    }

    identityContestants.set(`name:${nameKey}`, contestant);
  });

  return [...identityContestants.values()];
}

async function getTurnContestants(session) {
  const contestants = await getNonAdminContestants(session);
  const competingContestants = hasRaffleRun(session)
    ? contestants.filter((contestant) => contestant.raffleStatus === "selected")
    : contestants;

  return sortTurnContestants(competingContestants).filter(
    (contestant) => !hasContestantReachedQuestionLimitByContestant(session, contestant)
  );
}

async function ensureCurrentTurnContestant(session) {
  const quizSession = session;
  const turnContestants = await getTurnContestants(quizSession);
  if (!turnContestants.length) {
    quizSession.currentTurnContestant = null;
    return null;
  }

  const currentTurnId = getCurrentTurnContestantId(quizSession);
  const currentTurnContestant = turnContestants.find(
    (contestant) => getContestantId(contestant) === currentTurnId
  );

  if (currentTurnContestant) {
    return currentTurnContestant;
  }

  quizSession.currentTurnContestant = turnContestants[0]._id;
  return turnContestants[0];
}

async function advanceCurrentTurnContestant(session, answeredContestant) {
  const quizSession = session;
  if (!hasContestantReachedQuestionLimitByContestant(quizSession, answeredContestant)) {
    quizSession.currentTurnContestant = answeredContestant._id;
    return answeredContestant;
  }

  const contestants = await getNonAdminContestants(quizSession);
  const orderedContestants = sortTurnContestants(
    hasRaffleRun(quizSession)
      ? contestants.filter((contestant) => contestant.raffleStatus === "selected")
      : contestants
  );

  if (!orderedContestants.length) {
    quizSession.currentTurnContestant = null;
    return null;
  }

  const answeredContestantId = getContestantId(answeredContestant);
  const answeredIndex = orderedContestants.findIndex(
    (contestant) => getContestantId(contestant) === answeredContestantId
  );
  const startIndex = answeredIndex >= 0 ? answeredIndex + 1 : 0;

  for (let offset = 0; offset < orderedContestants.length; offset += 1) {
    const candidate = orderedContestants[(startIndex + offset) % orderedContestants.length];
    if (!hasContestantReachedQuestionLimitByContestant(quizSession, candidate)) {
      quizSession.currentTurnContestant = candidate._id;
      return candidate;
    }
  }

  quizSession.currentTurnContestant = null;
  return null;
}

async function completeQuestionForContestant(
  session,
  contestant,
  question,
  { points = 0, isCorrect = false, answer = "", user = null, recordAnswer = true } = {}
) {
  const quizSession = session;
  const answeredContestant = contestant;
  const questionNumber = Number(question?.number || session.currentQuestionNumber);
  if (!questionNumber || !answeredContestant) {
    return { completed: false };
  }

  quizSession.bonusPending = false;
  answeredContestant.score = Number(answeredContestant.score || 0) + points;
  answeredContestant.answeredQuestions = Array.from(
    new Set([...(answeredContestant.answeredQuestions || []), questionNumber])
  );
  answeredContestant.lastAnsweredAt = new Date();

  const nextAskedNumbers = Array.from(
    new Set([...(quizSession.askedNumbers || []), questionNumber])
  );
  quizSession.askedNumbers = nextAskedNumbers;
  quizSession.currentQuestionNumber = null;
  quizSession.phaseStartedAt = new Date();

  const activeQuestionCount = await getActiveQuestionCountForSession(quizSession);
  const { start, end } = getQuestionDisplayRange(quizSession);
  const usedDisplayedQuestionCount = nextAskedNumbers.filter(
    (number) => number >= start && number <= end
  ).length;
  if (activeQuestionCount > 0 && usedDisplayedQuestionCount >= activeQuestionCount) {
    quizSession.phase = "winner";
    quizSession.currentTurnContestant = null;
  } else {
    const nextTurnContestant = await advanceCurrentTurnContestant(quizSession, answeredContestant);
    quizSession.phase = nextTurnContestant ? "pick-number" : "winner";
  }

  if (recordAnswer && question?._id) {
    await QuizAnswer.create({
      session: quizSession._id,
      question: question._id,
      questionNumber,
      user: user?._id || answeredContestant.user || null,
      contestantName: answeredContestant.name,
      answer: String(answer || "").trim() || "Time's up",
      isCorrect,
      points,
      bonusAwarded: 0,
    });
  }

  return { completed: true, questionNumber };
}

async function completeExpiredQuestion(session) {
  const questionNumber = Number(session.currentQuestionNumber || 0);
  if (session.phase !== "question" || !questionNumber) {
    return { completed: false };
  }

  const contestant =
    session.contestants.id?.(session.currentTurnContestant) ||
    session.contestants.find(
      (entry) => getContestantId(entry) === getCurrentTurnContestantId(session)
    );
  if (!contestant || (session.askedNumbers || []).includes(questionNumber)) {
    return { completed: false };
  }

  const question = await QuizQuestion.findOne({ number: questionNumber, active: true });
  if (!question) {
    return { completed: false };
  }

  return completeQuestionForContestant(session, contestant, question, {
    points: 0,
    isCorrect: false,
    answer: "Time's up",
    user: contestant.user ? { _id: contestant.user } : null,
    recordAnswer: true,
  });
}

async function sortContestants(session) {
  const nonAdminContestants = await getNonAdminContestants(session);
  const contestants = hasRaffleRun(session)
    ? nonAdminContestants.filter((contestant) => contestant.raffleStatus === "selected")
    : nonAdminContestants;
  const firstPlaceMinPoints = Number(session.firstPlaceMinPoints || 0);
  const secondPlaceMinPoints = Number(session.secondPlaceMinPoints || 0);

  const sortedContestants = [...contestants].sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }
    const aTime = a.lastAnsweredAt ? new Date(a.lastAnsweredAt).getTime() : 0;
    const bTime = b.lastAnsweredAt ? new Date(b.lastAnsweredAt).getTime() : 0;
    return bTime - aTime;
  });
  const topScore = Number(sortedContestants[0]?.score || 0);
  const firstPlaceWinnerCount = sortedContestants.filter(
    (contestant) => Number(contestant.score || 0) === topScore
  ).length;
  const secondPlaceScore =
    firstPlaceWinnerCount === 1
      ? sortedContestants.find((contestant) => Number(contestant.score || 0) < topScore)?.score
      : null;

  return sortedContestants.map((contestant, index) => {
    const score = Number(contestant.score || 0);
    const earlierContestants = sortedContestants.slice(0, index);
    const competitionPosition =
      earlierContestants.filter((entry) => Number(entry.score || 0) > score).length + 1;
    const awardPosition =
      (score === topScore && score >= firstPlaceMinPoints && 1) ||
      (secondPlaceScore !== null &&
        score === Number(secondPlaceScore) &&
        score >= secondPlaceMinPoints &&
        2) ||
      null;

    return {
      ...(contestant.toObject?.() ?? contestant),
      position: competitionPosition,
      awardPosition,
    };
  });
}

async function sortRegisteredContestants(session) {
  const nonAdminContestants = await getNonAdminContestants(session);

  return [...nonAdminContestants]
    .sort((a, b) => {
      const aPosition = a.rafflePosition || Number.MAX_SAFE_INTEGER;
      const bPosition = b.rafflePosition || Number.MAX_SAFE_INTEGER;
      if (aPosition !== bPosition) {
        return aPosition - bPosition;
      }
      const aRegisteredAt = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
      const bRegisteredAt = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
      if (aRegisteredAt !== bRegisteredAt) {
        return aRegisteredAt - bRegisteredAt;
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .map((contestant) => contestant.toObject?.() ?? contestant);
}

async function buildSessionPayload(session, options = {}) {
  const currentQuestion =
    session.phase === "question" && session.currentQuestionNumber
      ? await QuizQuestion.findOne({
          number: session.currentQuestionNumber,
          active: true,
        }).select("number text type choices")
      : null;

  return {
    success: true,
    session: serializeSession(session, options),
    currentQuestion,
    contestants: await sortContestants(session),
    registeredContestants: await sortRegisteredContestants(session),
  };
}

async function moveSessionToWinnerIfComplete(session) {
  const quizSession = session;
  if (quizSession.phase === "winner" || quizSession.phase === "finished") {
    return quizSession;
  }

  const activeQuestionCount = await getActiveQuestionCountForSession(quizSession);
  const { start, end } = getQuestionDisplayRange(quizSession);
  const usedDisplayedQuestionCount = (quizSession.askedNumbers || []).filter(
    (number) => number >= start && number <= end
  ).length;
  if (activeQuestionCount > 0 && usedDisplayedQuestionCount >= activeQuestionCount) {
    quizSession.phase = "winner";
    quizSession.phaseStartedAt = new Date();
    quizSession.currentQuestionNumber = null;
    await quizSession.save();
  }

  return quizSession;
}

function getChoiceLabel(choice) {
  return String(choice || "")
    .trim()
    .slice(0, 1)
    .toUpperCase();
}

function normalizeCorrectAnswer(correctAnswer, choices = []) {
  const trimmedAnswer = String(correctAnswer || "").trim();
  if (!trimmedAnswer) {
    return "";
  }

  const directLabel = getChoiceLabel(trimmedAnswer);
  const matchingChoice = choices.find(
    (choice) => String(choice).trim().toUpperCase() === trimmedAnswer.toUpperCase()
  );

  return matchingChoice ? getChoiceLabel(matchingChoice) : directLabel;
}

function normalizeTextAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

const getQuizSession = async (req, res, next) => {
  try {
    await ensureDefaultQuestions();
    const session = await moveSessionToWinnerIfComplete(
      await syncSessionPhase(await getActiveSession())
    );
    if (session.phase === "pick-number") {
      await ensureCurrentTurnContestant(session);
      await session.save();
    }
    return res.status(200).json(await buildSessionPayload(session));
  } catch (error) {
    return next(error);
  }
};

const getPublicQuizEvents = async (req, res, next) => {
  try {
    await getActiveSession();
    return res.status(200).json({
      success: true,
      events: await getPublicQuizEventSummaries(req.user),
    });
  } catch (error) {
    return next(error);
  }
};

const getQuizEvents = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    await getActiveSession();
    return res.status(200).json({
      success: true,
      events: await getQuizEventSummaries(),
    });
  } catch (error) {
    return next(error);
  }
};

const createQuizEvent = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const activeSession = await getActiveSession();
    const eventCount = await QuizSession.countDocuments();
    const title = String(req.body?.title || `Live Q/A Event ${eventCount + 1}`)
      .trim()
      .slice(0, 120);
    const eventStartsAt = req.body?.eventStartsAt || null;
    const eventEndsAt = req.body?.eventEndsAt || null;
    const raffleRunsAt = req.body?.raffleRunsAt || null;

    const datesToValidate = [
      ["Event start date and time", eventStartsAt],
      ["Event end date and time", eventEndsAt],
      ["Raffle date and time", raffleRunsAt],
    ];

    const invalidDate = datesToValidate.find(
      ([, value]) => value && Number.isNaN(new Date(value).getTime())
    );

    if (invalidDate) {
      return res.status(400).json({
        success: false,
        message: `${invalidDate[0]} must be valid`,
      });
    }

    if (
      eventStartsAt &&
      eventEndsAt &&
      new Date(eventEndsAt).getTime() <= new Date(eventStartsAt).getTime()
    ) {
      return res.status(400).json({
        success: false,
        message: "Event end date and time must be after the event start time",
      });
    }

    await QuizSession.updateMany({ active: true }, { $set: { active: false } });
    const session = await QuizSession.create(
      copySessionSettingsForNewEvent(activeSession, {
        title,
        eventStartsAt,
        eventStartsAtLabel: req.body?.eventStartsAtLabel,
        eventEndsAt,
        raffleRunsAt,
        meetingLinks: req.body?.meetingLinks,
      })
    );

    return res.status(201).json({
      ...(await buildSessionPayload(session, {
        includePrivateMeetingLinks: true,
      })),
      events: await getQuizEventSummaries(),
      message: `${session.title} created and activated.`,
    });
  } catch (error) {
    return next(error);
  }
};

const updateQuizEvent = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await QuizSession.findById(req.params.eventId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Quiz event not found" });
    }

    const {
      title,
      questionTimerSeconds,
      welcomeSeconds,
      rulesSeconds,
      contestantsSeconds,
      questionLimitPerContestant,
      questionPoolSize,
      questionDisplayStart,
      questionDisplayEnd,
      firstPlaceMinPoints,
      secondPlaceMinPoints,
      firstPlacePrize,
      secondPlacePrize,
      maxSelectedContestants,
      eventStartsAt,
      eventStartsAtLabel,
      eventEndsAt,
      raffleRunsAt,
      meetingLinks,
      welcomeNote,
      rules,
    } = req.body;

    if (title !== undefined) {
      const nextTitle = String(title || "")
        .trim()
        .slice(0, 120);
      if (!nextTitle) {
        return res.status(400).json({ success: false, message: "Event title is required" });
      }
      session.title = nextTitle;
    }

    if (questionTimerSeconds !== undefined) {
      if (questionTimerSeconds < 5 || questionTimerSeconds > 300) {
        return res
          .status(400)
          .json({ success: false, message: "Question timer must be between 5 and 300 seconds" });
      }
      session.questionTimerSeconds = questionTimerSeconds;
    }

    if (welcomeSeconds !== undefined) {
      if (welcomeSeconds < 10 || welcomeSeconds > 600) {
        return res
          .status(400)
          .json({ success: false, message: "Welcome timer must be between 10 and 600 seconds" });
      }
      session.welcomeSeconds = welcomeSeconds;
    }

    if (rulesSeconds !== undefined) {
      if (rulesSeconds < 10 || rulesSeconds > 600) {
        return res
          .status(400)
          .json({ success: false, message: "Rules timer must be between 10 and 600 seconds" });
      }
      session.rulesSeconds = rulesSeconds;
    }

    if (contestantsSeconds !== undefined) {
      if (contestantsSeconds < 5 || contestantsSeconds > 600) {
        return res.status(400).json({
          success: false,
          message: "Contestants timer must be between 5 and 600 seconds",
        });
      }
      session.contestantsSeconds = contestantsSeconds;
    }

    if (questionLimitPerContestant !== undefined) {
      if (questionLimitPerContestant < 1 || questionLimitPerContestant > 100) {
        return res.status(400).json({
          success: false,
          message: "Question limit per contestant must be between 1 and 100",
        });
      }
      session.questionLimitPerContestant = questionLimitPerContestant;
    }

    if (questionPoolSize !== undefined) {
      if (questionPoolSize < 1 || questionPoolSize > 200) {
        return res.status(400).json({
          success: false,
          message: "Question pool size must be between 1 and 200",
        });
      }
      session.questionPoolSize = questionPoolSize;
    }

    if (questionDisplayStart !== undefined || questionDisplayEnd !== undefined) {
      const poolSize = Number(session.questionPoolSize || questionPoolSize || 20);
      const nextStart =
        questionDisplayStart !== undefined
          ? Number(questionDisplayStart)
          : Number(session.questionDisplayStart || 1);
      const nextEnd =
        questionDisplayEnd !== undefined
          ? Number(questionDisplayEnd)
          : Number(session.questionDisplayEnd || poolSize);

      if (!Number.isInteger(nextStart) || nextStart < 1 || nextStart > poolSize) {
        return res.status(400).json({
          success: false,
          message: `Display from must be between 1 and ${poolSize}`,
        });
      }

      if (!Number.isInteger(nextEnd) || nextEnd < nextStart || nextEnd > poolSize) {
        return res.status(400).json({
          success: false,
          message: `Display to must be between ${nextStart} and ${poolSize}`,
        });
      }

      session.questionDisplayStart = nextStart;
      session.questionDisplayEnd = nextEnd;
    }

    if (firstPlaceMinPoints !== undefined) {
      if (firstPlaceMinPoints < 0 || firstPlaceMinPoints > 10000) {
        return res.status(400).json({
          success: false,
          message: "1st place points must be between 0 and 10000",
        });
      }
      session.firstPlaceMinPoints = firstPlaceMinPoints;
    }

    if (secondPlaceMinPoints !== undefined) {
      if (secondPlaceMinPoints < 0 || secondPlaceMinPoints > 10000) {
        return res.status(400).json({
          success: false,
          message: "2nd place points must be between 0 and 10000",
        });
      }
      session.secondPlaceMinPoints = secondPlaceMinPoints;
    }

    if (firstPlacePrize !== undefined) {
      if (typeof firstPlacePrize !== "string") {
        return res.status(400).json({
          success: false,
          message: "1st place prize must be a string",
        });
      }
      session.firstPlacePrize = firstPlacePrize.trim().slice(0, 120);
    }

    if (secondPlacePrize !== undefined) {
      if (typeof secondPlacePrize !== "string") {
        return res.status(400).json({
          success: false,
          message: "2nd place prize must be a string",
        });
      }
      session.secondPlacePrize = secondPlacePrize.trim().slice(0, 120);
    }

    if (maxSelectedContestants !== undefined) {
      if (maxSelectedContestants < 1 || maxSelectedContestants > 100) {
        return res.status(400).json({
          success: false,
          message: "Selected contestants must be between 1 and 100",
        });
      }
      session.maxSelectedContestants = maxSelectedContestants;
    }

    if (eventStartsAt !== undefined) {
      if (eventStartsAt === null || eventStartsAt === "") {
        session.eventStartsAt = null;
        session.eventStartsAtLabel = "";
        if (session.phase === "scheduled") {
          session.phase = "welcome";
          session.phaseStartedAt = new Date();
        }
      } else {
        const scheduledStart = new Date(eventStartsAt);
        if (Number.isNaN(scheduledStart.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Event start date and time must be valid",
          });
        }

        const currentStartTime = session.eventStartsAt
          ? new Date(session.eventStartsAt).getTime()
          : null;
        const nextStartTime = scheduledStart.getTime();
        const startTimeChanged =
          currentStartTime === null || Math.abs(currentStartTime - nextStartTime) >= 60000;

        session.eventStartsAt = scheduledStart;
        session.eventStartsAtLabel = String(eventStartsAtLabel || "")
          .trim()
          .slice(0, 120);

        if (startTimeChanged) {
          session.phase = scheduledStart.getTime() > Date.now() ? "scheduled" : "welcome";
          session.phaseStartedAt = new Date();
          session.currentQuestionNumber = null;
          if (scheduledStart.getTime() > Date.now() && hasPlayedCompetitionData(session)) {
            resetSessionCompetitionData(session);
            await QuizAnswer.deleteMany({ session: session._id });
          }
        }
      }
    }

    if (eventEndsAt !== undefined) {
      if (eventEndsAt === null || eventEndsAt === "") {
        session.eventEndsAt = null;
      } else {
        const scheduledEnd = new Date(eventEndsAt);
        if (Number.isNaN(scheduledEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Event end date and time must be valid",
          });
        }

        if (session.eventStartsAt && scheduledEnd.getTime() <= session.eventStartsAt.getTime()) {
          return res.status(400).json({
            success: false,
            message: "Event end date and time must be after the event start time",
          });
        }

        session.eventEndsAt = scheduledEnd;
      }
    }

    if (raffleRunsAt !== undefined) {
      if (raffleRunsAt === null || raffleRunsAt === "") {
        session.raffleRunsAt = null;
      } else {
        const scheduledRaffle = new Date(raffleRunsAt);
        if (Number.isNaN(scheduledRaffle.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Raffle date and time must be valid",
          });
        }
        session.raffleRunsAt = scheduledRaffle;
      }
    }

    if (meetingLinks !== undefined) {
      const zoom = String(meetingLinks?.zoom || "").trim();
      if (zoom && !/^https:\/\/([\w-]+\.)?zoom\.us\/.+/i.test(zoom)) {
        return res.status(400).json({
          success: false,
          message: "Zoom meeting URL must be a valid zoom.us link",
        });
      }

      session.meetingLinks = {
        ...(session.meetingLinks?.toObject?.() ?? session.meetingLinks ?? {}),
        zoom,
      };
    }

    if (welcomeNote !== undefined) {
      if (typeof welcomeNote !== "string") {
        return res.status(400).json({ success: false, message: "Welcome note must be a string" });
      }
      session.welcomeNote = welcomeNote.trim();
    }

    if (rules !== undefined) {
      if (typeof rules !== "string") {
        return res.status(400).json({ success: false, message: "Rules must be a string" });
      }
      session.rules = rules.trim();
    }

    await session.save();

    const activeSession = await syncSessionPhase(await getActiveSession());
    return res.status(200).json({
      ...(await buildSessionPayload(activeSession, {
        includePrivateMeetingLinks: true,
      })),
      events: await getQuizEventSummaries(),
      message: `${session.title || "Quiz event"} updated successfully.`,
    });
  } catch (error) {
    return next(error);
  }
};

const activateQuizEvent = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await QuizSession.findById(req.params.eventId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Quiz event not found" });
    }

    await QuizSession.updateMany({ active: true }, { $set: { active: false } });
    session.active = true;
    await session.save();
    await syncSessionPhase(session);

    return res.status(200).json({
      ...(await buildSessionPayload(session, {
        includePrivateMeetingLinks: true,
      })),
      events: await getQuizEventSummaries(),
      message: `${session.title || "Quiz event"} is now active.`,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteQuizEvent = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await QuizSession.findById(req.params.eventId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Quiz event not found" });
    }

    const eventCount = await QuizSession.countDocuments();
    if (eventCount <= 1) {
      return res.status(400).json({
        success: false,
        message: "At least one quiz event must remain.",
      });
    }

    const wasActive = Boolean(session.active);
    await QuizAnswer.deleteMany({ session: session._id });
    await session.deleteOne();

    let nextSession = await QuizSession.findOne({ active: true }).sort({
      updatedAt: -1,
      createdAt: -1,
    });

    if (wasActive || !nextSession) {
      nextSession = await QuizSession.findOne().sort({ eventStartsAt: -1, createdAt: -1 });
      nextSession.active = true;
      await nextSession.save();
      await syncSessionPhase(nextSession);
    }

    return res.status(200).json({
      ...(await buildSessionPayload(nextSession, {
        includePrivateMeetingLinks: true,
      })),
      events: await getQuizEventSummaries(),
      message: "Quiz event deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
};

const advanceExpiredQuizSession = async (req, res, next) => {
  try {
    const session = await getActiveSession();
    await moveSessionToWinnerIfComplete(await syncSessionPhase(session));

    const requestedPhase = String(req.body?.phase || "").trim();
    const durationSeconds = getPhaseDurationSeconds(session);
    const nextPhase = getNextPhase(session.phase);
    const elapsedSeconds = session.phaseStartedAt
      ? Math.floor((Date.now() - session.phaseStartedAt.getTime()) / 1000)
      : 0;
    let timeoutResult = null;

    if (
      requestedPhase &&
      requestedPhase === session.phase &&
      durationSeconds > 0 &&
      nextPhase !== session.phase &&
      elapsedSeconds >= durationSeconds
    ) {
      if (session.phase === "question") {
        timeoutResult = await completeExpiredQuestion(session);
        await session.save();
      } else if (moveSessionToNextPhase(session)) {
        await session.save();
      }
    } else if (durationSeconds > 0 && nextPhase !== session.phase && session.phaseStartedAt) {
      if (elapsedSeconds >= durationSeconds) {
        if (session.phase === "question") {
          timeoutResult = await completeExpiredQuestion(session);
          await session.save();
        } else if (moveSessionToNextPhase(session)) {
          await session.save();
        }
      }
    }

    if (session.phase === "pick-number") {
      await ensureCurrentTurnContestant(session);
      await session.save();
    }

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      ...(timeoutResult?.completed && {
        message: "Time's up. You earned 0 points.",
        answerResult: "time-up",
        isCorrect: false,
        points: 0,
      }),
    });
  } catch (error) {
    return next(error);
  }
};

const getQuizQuestions = async (req, res, next) => {
  try {
    await ensureDefaultQuestions();
    const questions = await QuizQuestion.find({ active: true })
      .sort({ number: 1 })
      .select("number type choices text");
    return res.status(200).json({ success: true, questions });
  } catch (error) {
    return next(error);
  }
};

const getQuizQuestionByNumber = async (req, res, next) => {
  try {
    const questionNumber = Number(req.params.number);
    const question = await QuizQuestion.findOne({ number: questionNumber, active: true });
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    const displayRange = getQuestionDisplayRange(session);
    if (!isQuestionInDisplayRange(session, questionNumber)) {
      return res.status(400).json({
        success: false,
        message: `Please choose a question number between ${displayRange.start} and ${displayRange.end}.`,
      });
    }

    const contestant = findContestantByUser(session, req.user);
    if (contestant && !contestant.user) {
      contestant.user = req.user._id;
      await session.save();
    }

    if (req.user.role === "admin") {
      logQuizSecurityEvent("question_fetch_denied", req, {
        questionNumber,
        reason: "admin_cannot_pick",
      });
      return res.status(403).json({
        success: false,
        message:
          "Admins cannot pick questions. Only the current raffle-selected contestant can pick.",
      });
    }

    await moveSessionToWinnerIfComplete(session);
    if (session.phase === "winner") {
      return res.status(400).json({
        success: false,
        message: "This quiz is complete. The winner has been announced.",
      });
    }

    if (!["pick-number", "question"].includes(session.phase)) {
      logQuizSecurityEvent("question_fetch_denied", req, {
        questionNumber,
        phase: session.phase,
        reason: "phase_not_open",
      });
      return res.status(409).json({
        success: false,
        message: "Questions are not open yet.",
      });
    }

    if ((session.askedNumbers || []).includes(questionNumber)) {
      return res.status(400).json({
        success: false,
        message: "This question has already been used. Please choose another number.",
      });
    }

    if (!canContestantCompete(session, contestant)) {
      logQuizSecurityEvent("question_fetch_denied", req, {
        questionNumber,
        reason: hasRaffleRun(session) ? "not_raffle_selected" : "not_registered",
      });
      return res.status(403).json({
        success: false,
        message: hasRaffleRun(session)
          ? "Only raffle-selected contestants can pick questions in this event."
          : "Please register before picking a question.",
      });
    }

    if (hasContestantReachedQuestionLimitByContestant(session, contestant)) {
      return res.status(400).json({
        success: false,
        message: `You have reached the ${session.questionLimitPerContestant}-question limit.`,
      });
    }

    const currentTurnContestant = await ensureCurrentTurnContestant(session);
    if (currentTurnContestant && !isContestantTurn(session, contestant)) {
      logQuizSecurityEvent("question_fetch_denied", req, {
        questionNumber,
        currentTurnContestant: getContestantId(currentTurnContestant),
        reason: "not_contestant_turn",
      });
      await session.save();
      return res.status(403).json({
        success: false,
        message: `It is ${currentTurnContestant.name || "the next contestant"}'s turn to pick a question.`,
      });
    }

    if (
      session.phase === "question" &&
      session.currentQuestionNumber &&
      session.currentQuestionNumber !== questionNumber
    ) {
      logQuizSecurityEvent("question_fetch_denied", req, {
        questionNumber,
        activeQuestionNumber: session.currentQuestionNumber,
        reason: "another_question_active",
      });
      return res.status(409).json({
        success: false,
        message: "Another question is already active. Please wait for the next pick.",
      });
    }

    if (session.phase === "question" && session.currentQuestionNumber === questionNumber) {
      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        session: serializeSession(session),
        question: {
          number: question.number,
          text: question.text,
          type: question.type,
          choices: question.choices,
        },
      });
    }

    const activatedSession = await QuizSession.findOneAndUpdate(
      {
        _id: session._id,
        phase: "pick-number",
        currentQuestionNumber: null,
        askedNumbers: { $ne: questionNumber },
      },
      {
        $set: {
          phase: "question",
          phaseStartedAt: new Date(),
          currentQuestionNumber: questionNumber,
        },
      },
      { new: true }
    );

    let activeSession = activatedSession;
    if (!activeSession) {
      const latestSession = await syncSessionPhase(await QuizSession.findById(session._id));
      if (
        latestSession.phase !== "question" ||
        latestSession.currentQuestionNumber !== questionNumber
      ) {
        return res.status(409).json({
          success: false,
          message: "Another question is already active. Please wait for the next pick.",
        });
      }
      activeSession = latestSession;
    }

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      session: serializeSession(activeSession),
      question: {
        number: question.number,
        text: question.text,
        type: question.type,
        choices: question.choices,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const submitQuizAnswer = async (req, res, next) => {
  try {
    const { questionNumber, answer } = req.body;
    const trimmedAnswer = String(answer || "").trim();

    const question = await QuizQuestion.findOne({ number: questionNumber, active: true });
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    const contestant = findContestantByUser(session, req.user);

    if (!contestant) {
      logQuizSecurityEvent("answer_submit_denied", req, {
        questionNumber,
        reason: "not_registered",
      });
      return res.status(403).json({
        success: false,
        message: "Please register before submitting an answer.",
      });
    }

    if (!contestant.user) {
      contestant.user = req.user._id;
    }

    if (!canContestantCompete(session, contestant)) {
      logQuizSecurityEvent("answer_submit_denied", req, {
        questionNumber,
        reason: "not_raffle_selected",
      });
      return res.status(403).json({
        success: false,
        message: "Only raffle-selected contestants can submit answers in this event.",
      });
    }

    if (session.phase !== "question" || session.currentQuestionNumber !== questionNumber) {
      logQuizSecurityEvent("answer_submit_denied", req, {
        questionNumber,
        activeQuestionNumber: session.currentQuestionNumber,
        phase: session.phase,
        reason: "inactive_question",
      });
      return res.status(409).json({
        success: false,
        message: "This question is not currently active.",
      });
    }

    if ((session.askedNumbers || []).includes(questionNumber)) {
      return res.status(400).json({
        success: false,
        message: "This question has already been used. Please choose another number.",
      });
    }

    if (hasContestantReachedQuestionLimitByContestant(session, contestant)) {
      return res.status(400).json({
        success: false,
        message: `You have reached the ${session.questionLimitPerContestant}-question limit.`,
      });
    }

    await ensureCurrentTurnContestant(session);
    if (!isContestantTurn(session, contestant)) {
      return res.status(403).json({
        success: false,
        message: "It is another contestant's turn to answer.",
      });
    }

    const alreadyAnswered = await QuizAnswer.findOne({
      session: session._id,
      questionNumber,
      $or: [{ user: req.user._id }, { contestantName: contestant.name }],
    });

    if (alreadyAnswered) {
      return res.status(400).json({
        success: false,
        message: "You have already answered this question.",
      });
    }

    let points = 0;
    let isCorrect = false;
    let answerResult = "submitted";

    if (question.type === "multiple-choice") {
      const normalizedAnswer = trimmedAnswer.toUpperCase();
      const normalizedCorrectAnswer = normalizeCorrectAnswer(
        question.correctAnswer,
        question.choices
      );
      if (normalizedAnswer === normalizedCorrectAnswer) {
        isCorrect = true;
        points = 5;
      }
      answerResult = isCorrect ? "correct" : "wrong";
    } else if (question.type === "text" && question.correctAnswer) {
      isCorrect =
        normalizeTextAnswer(trimmedAnswer) === normalizeTextAnswer(question.correctAnswer);
      points = isCorrect ? 5 : 0;
      answerResult = isCorrect ? "correct" : "wrong";
    }

    await completeQuestionForContestant(session, contestant, question, {
      points,
      isCorrect,
      answer: trimmedAnswer,
      user: req.user,
      recordAnswer: true,
    });
    await session.save();

    const contestants = await sortContestants(session);
    const answerMessage =
      answerResult === "correct"
        ? `Correct answer. You earned ${points} points.`
        : "Answer received. Written answers are recorded without automatic points.";
    const resultMessage =
      answerResult === "wrong" ? "Wrong answer. You earned 0 points." : answerMessage;

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      message: resultMessage,
      answerResult,
      isCorrect,
      points,
      session: serializeSession(session),
      contestants,
      registeredContestants: await sortRegisteredContestants(session),
    });
  } catch (error) {
    return next(error);
  }
};

const getQuizContestants = async (req, res, next) => {
  try {
    const session = await syncSessionPhase(await getActiveSession());
    const contestants = await sortContestants(session);
    return res.status(200).json({
      success: true,
      contestants,
      registeredContestants: await sortRegisteredContestants(session),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

/**
 * Admin-only: Update quiz session settings (timers, welcome note, rules)
 */
const updateQuizSessionSettings = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const {
      title,
      questionTimerSeconds,
      welcomeSeconds,
      rulesSeconds,
      contestantsSeconds,
      questionLimitPerContestant,
      questionPoolSize,
      questionDisplayStart,
      questionDisplayEnd,
      firstPlaceMinPoints,
      secondPlaceMinPoints,
      firstPlacePrize,
      secondPlacePrize,
      maxSelectedContestants,
      eventStartsAt,
      eventStartsAtLabel,
      eventEndsAt,
      raffleRunsAt,
      meetingLinks,
      welcomeNote,
      rules,
    } = req.body;
    const session = await syncSessionPhase(await getActiveSession());

    // Validate and update fields
    if (title !== undefined) {
      const nextTitle = String(title || "")
        .trim()
        .slice(0, 120);
      if (!nextTitle) {
        return res.status(400).json({ success: false, message: "Event title is required" });
      }
      session.title = nextTitle;
    }

    if (questionTimerSeconds !== undefined) {
      if (questionTimerSeconds < 5 || questionTimerSeconds > 300) {
        return res
          .status(400)
          .json({ success: false, message: "Question timer must be between 5 and 300 seconds" });
      }
      session.questionTimerSeconds = questionTimerSeconds;
    }

    if (welcomeSeconds !== undefined) {
      if (welcomeSeconds < 10 || welcomeSeconds > 600) {
        return res
          .status(400)
          .json({ success: false, message: "Welcome timer must be between 10 and 600 seconds" });
      }
      session.welcomeSeconds = welcomeSeconds;
    }

    if (rulesSeconds !== undefined) {
      if (rulesSeconds < 10 || rulesSeconds > 600) {
        return res
          .status(400)
          .json({ success: false, message: "Rules timer must be between 10 and 600 seconds" });
      }
      session.rulesSeconds = rulesSeconds;
    }

    if (contestantsSeconds !== undefined) {
      if (contestantsSeconds < 5 || contestantsSeconds > 600) {
        return res.status(400).json({
          success: false,
          message: "Contestants timer must be between 5 and 600 seconds",
        });
      }
      session.contestantsSeconds = contestantsSeconds;
    }

    if (questionLimitPerContestant !== undefined) {
      if (questionLimitPerContestant < 1 || questionLimitPerContestant > 100) {
        return res.status(400).json({
          success: false,
          message: "Question limit per contestant must be between 1 and 100",
        });
      }
      session.questionLimitPerContestant = questionLimitPerContestant;
    }

    if (questionPoolSize !== undefined) {
      if (questionPoolSize < 1 || questionPoolSize > 200) {
        return res.status(400).json({
          success: false,
          message: "Question pool size must be between 1 and 200",
        });
      }

      const highestUsedQuestion = Math.max(0, ...(session.askedNumbers || []));
      if (questionPoolSize < highestUsedQuestion) {
        return res.status(400).json({
          success: false,
          message: `Question pool size cannot be below already-used question ${highestUsedQuestion}`,
        });
      }

      session.questionPoolSize = questionPoolSize;
      if (Number(session.questionDisplayEnd || 0) > questionPoolSize) {
        session.questionDisplayEnd = questionPoolSize;
      }
      if (Number(session.questionDisplayStart || 1) > questionPoolSize) {
        session.questionDisplayStart = questionPoolSize;
      }
    }

    if (questionDisplayStart !== undefined || questionDisplayEnd !== undefined) {
      const poolSize = Number(session.questionPoolSize || questionPoolSize || 20);
      const nextStart =
        questionDisplayStart !== undefined
          ? Number(questionDisplayStart)
          : Number(session.questionDisplayStart || 1);
      const nextEnd =
        questionDisplayEnd !== undefined
          ? Number(questionDisplayEnd)
          : Number(session.questionDisplayEnd || poolSize);

      if (!Number.isInteger(nextStart) || nextStart < 1 || nextStart > poolSize) {
        return res.status(400).json({
          success: false,
          message: `Display from must be between 1 and ${poolSize}`,
        });
      }

      if (!Number.isInteger(nextEnd) || nextEnd < nextStart || nextEnd > poolSize) {
        return res.status(400).json({
          success: false,
          message: `Display to must be between ${nextStart} and ${poolSize}`,
        });
      }

      session.questionDisplayStart = nextStart;
      session.questionDisplayEnd = nextEnd;
    }

    if (firstPlaceMinPoints !== undefined) {
      if (firstPlaceMinPoints < 0 || firstPlaceMinPoints > 10000) {
        return res.status(400).json({
          success: false,
          message: "1st place points must be between 0 and 10000",
        });
      }
      session.firstPlaceMinPoints = firstPlaceMinPoints;
    }

    if (secondPlaceMinPoints !== undefined) {
      if (secondPlaceMinPoints < 0 || secondPlaceMinPoints > 10000) {
        return res.status(400).json({
          success: false,
          message: "2nd place points must be between 0 and 10000",
        });
      }
      session.secondPlaceMinPoints = secondPlaceMinPoints;
    }

    if (firstPlacePrize !== undefined) {
      if (typeof firstPlacePrize !== "string") {
        return res.status(400).json({
          success: false,
          message: "1st place prize must be a string",
        });
      }
      session.firstPlacePrize = firstPlacePrize.trim().slice(0, 120);
    }

    if (secondPlacePrize !== undefined) {
      if (typeof secondPlacePrize !== "string") {
        return res.status(400).json({
          success: false,
          message: "2nd place prize must be a string",
        });
      }
      session.secondPlacePrize = secondPlacePrize.trim().slice(0, 120);
    }

    if (maxSelectedContestants !== undefined) {
      if (maxSelectedContestants < 1 || maxSelectedContestants > 100) {
        return res.status(400).json({
          success: false,
          message: "Selected contestants must be between 1 and 100",
        });
      }
      session.maxSelectedContestants = maxSelectedContestants;
    }

    if (eventStartsAt !== undefined) {
      if (eventStartsAt === null || eventStartsAt === "") {
        const hadEventStart = Boolean(session.eventStartsAt);
        session.eventStartsAt = null;
        session.eventStartsAtLabel = "";
        if (hadEventStart && session.phase === "scheduled") {
          session.phase = "welcome";
          session.phaseStartedAt = new Date();
        }
      } else {
        const scheduledStart = new Date(eventStartsAt);
        if (Number.isNaN(scheduledStart.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Event start date and time must be valid",
          });
        }
        const currentStartTime = session.eventStartsAt
          ? new Date(session.eventStartsAt).getTime()
          : null;
        const nextStartTime = scheduledStart.getTime();
        const startTimeChanged =
          currentStartTime === null || Math.abs(currentStartTime - nextStartTime) >= 60000;

        if (startTimeChanged) {
          session.eventStartsAt = scheduledStart;
          session.eventStartsAtLabel = String(eventStartsAtLabel || "")
            .trim()
            .slice(0, 120);
          session.phase = scheduledStart.getTime() > Date.now() ? "scheduled" : "welcome";
          session.phaseStartedAt = new Date();
          session.currentQuestionNumber = null;
          if (scheduledStart.getTime() > Date.now() && hasPlayedCompetitionData(session)) {
            resetSessionCompetitionData(session);
            await QuizAnswer.deleteMany({ session: session._id });
          }
        } else {
          session.eventStartsAt = scheduledStart;
          if (eventStartsAtLabel !== undefined) {
            session.eventStartsAtLabel = String(eventStartsAtLabel || "")
              .trim()
              .slice(0, 120);
          }
        }
      }
    }

    if (eventEndsAt !== undefined) {
      if (eventEndsAt === null || eventEndsAt === "") {
        session.eventEndsAt = null;
      } else {
        const scheduledEnd = new Date(eventEndsAt);
        if (Number.isNaN(scheduledEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Event end date and time must be valid",
          });
        }

        if (session.eventStartsAt && scheduledEnd.getTime() <= session.eventStartsAt.getTime()) {
          return res.status(400).json({
            success: false,
            message: "Event end date and time must be after the event start time",
          });
        }

        session.eventEndsAt = scheduledEnd;
        if (
          !["winner", "finished"].includes(session.phase) &&
          scheduledEnd.getTime() <= Date.now()
        ) {
          moveSessionToWinner(session);
        }
      }
    }

    if (raffleRunsAt !== undefined) {
      if (raffleRunsAt === null || raffleRunsAt === "") {
        session.raffleRunsAt = null;
      } else {
        const scheduledRaffle = new Date(raffleRunsAt);
        if (Number.isNaN(scheduledRaffle.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Raffle date and time must be valid",
          });
        }
        const currentRaffleTime = session.raffleRunsAt
          ? new Date(session.raffleRunsAt).getTime()
          : null;
        const nextRaffleTime = scheduledRaffle.getTime();
        const raffleTimeChanged =
          currentRaffleTime === null || Math.abs(currentRaffleTime - nextRaffleTime) >= 60000;

        if (raffleTimeChanged && hasRaffleRun(session) && nextRaffleTime > Date.now()) {
          session.raffleSeed = "";
          session.raffleExecutedAt = null;
          session.currentTurnContestant = null;
          session.contestants.forEach((contestant, index) => {
            session.contestants[index].raffleStatus = "registered";
            session.contestants[index].rafflePosition = null;
            session.contestants[index].raffleRandomNumber = null;
          });
        }
        session.raffleRunsAt = scheduledRaffle;
      }
    }

    if (meetingLinks !== undefined) {
      const zoom = String(meetingLinks?.zoom || "").trim();
      if (zoom && !/^https:\/\/([\w-]+\.)?zoom\.us\/.+/i.test(zoom)) {
        return res.status(400).json({
          success: false,
          message: "Zoom meeting URL must be a valid zoom.us link",
        });
      }

      if (!zoom && session.meetingLinks?.zoom) {
        session.meetingLinks = {
          ...(session.meetingLinks?.toObject?.() ?? session.meetingLinks ?? {}),
        };
      } else {
        session.meetingLinks = {
          ...(session.meetingLinks?.toObject?.() ?? session.meetingLinks ?? {}),
          zoom,
        };
      }
    }

    if (welcomeNote !== undefined) {
      if (typeof welcomeNote !== "string") {
        return res.status(400).json({ success: false, message: "Welcome note must be a string" });
      }
      session.welcomeNote = welcomeNote.trim();
    }

    if (rules !== undefined) {
      if (typeof rules !== "string") {
        return res.status(400).json({ success: false, message: "Rules must be a string" });
      }
      session.rules = rules.trim();
    }

    await session.save();

    return res.status(200).json({
      ...(await buildSessionPayload(session, {
        includePrivateMeetingLinks: true,
      })),
      message: "Quiz session settings updated successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const executeQuizRaffle = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    const maxContestants = Number(req.body?.maxContestants || session.maxSelectedContestants || 5);

    const raffleResults = await runQuizRaffleForSession(session, maxContestants);

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: `Raffle complete. ${raffleResults.selected.length} contestant${
        raffleResults.selected.length === 1 ? "" : "s"
      } selected.`,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin-only: Restart the live quiz with a clean contestant pool.
 */
const restartQuizSession = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await getActiveSession();
    session.phase = "welcome";
    session.eventStartsAt = null;
    session.eventStartsAtLabel = "";
    session.eventEndsAt = null;
    session.phaseStartedAt = new Date();
    resetSessionCompetitionData(session);

    await QuizAnswer.deleteMany({ session: session._id });
    await session.save();

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: "Quiz event restarted successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const endQuizSession = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    moveSessionToWinner(session);
    await session.save();

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: "Quiz event ended. Final winners are now shown.",
    });
  } catch (error) {
    return next(error);
  }
};

const skipCurrentQuizContestant = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    if (!["pick-number", "question"].includes(session.phase)) {
      return res.status(400).json({
        success: false,
        message: "A contestant can only be skipped during the pick or answer stage.",
      });
    }

    if (session.phase === "question" && session.currentQuestionNumber) {
      await completeExpiredQuestion(session);
    }

    const turnContestants = await getTurnContestants(session);
    if (!turnContestants.length) {
      moveSessionToWinner(session);
      await session.save();
      return res.status(200).json({
        ...(await buildSessionPayload(session)),
        message: "No available contestants remain. Final winners are now shown.",
      });
    }

    const currentTurnId = getCurrentTurnContestantId(session);
    const foundCurrentIndex = turnContestants.findIndex(
      (contestant) => getContestantId(contestant) === currentTurnId
    );
    const currentIndex = foundCurrentIndex >= 0 ? foundCurrentIndex : -1;

    const nextContestant =
      turnContestants.length > 1
        ? turnContestants[(currentIndex + 1) % turnContestants.length]
        : null;

    if (!nextContestant) {
      moveSessionToWinner(session);
      await session.save();
      return res.status(200).json({
        ...(await buildSessionPayload(session)),
        message: "No other contestant is available. Final winners are now shown.",
      });
    }

    session.currentTurnContestant = nextContestant._id;
    session.currentQuestionNumber = null;
    session.phase = "pick-number";
    session.phaseStartedAt = new Date();
    await session.save();

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: `${nextContestant.name || "The next contestant"} can pick now.`,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteQuizContestant = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    const contestantId = String(req.params.contestantId || "").trim();
    const contestant = session.contestants.id(contestantId);

    if (!contestant) {
      return res.status(404).json({ success: false, message: "Registered user not found" });
    }

    const wasCurrentTurn = getCurrentTurnContestantId(session) === contestantId;
    contestant.deleteOne();

    if (wasCurrentTurn) {
      await ensureCurrentTurnContestant(session);
    }

    await session.save();

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: "Registered user deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
};

const getQuizContestantWhatsAppLink = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await getActiveSession();
    const contestant = session.contestants.id(String(req.params.contestantId || "").trim());
    if (!contestant) {
      return res.status(404).json({ success: false, message: "Registered user not found" });
    }
    if (!contestant.user) {
      return res.status(400).json({
        success: false,
        message: "This registration is not linked to a user profile.",
      });
    }

    const user = await User.findById(contestant.user).select("phone").lean();
    const rawPhone = String(user?.phone || "").trim();
    if (!rawPhone) {
      return res.status(400).json({
        success: false,
        message: `${contestant.name || "This user"} has no registered phone number.`,
      });
    }

    const digits = rawPhone.replace(/\D/g, "").replace(/^00/, "");
    const hasCountryCode =
      rawPhone.startsWith("+") || rawPhone.startsWith("00") || !digits.startsWith("0");
    if (!hasCountryCode || digits.length < 8 || digits.length > 15) {
      return res.status(400).json({
        success: false,
        message: `${contestant.name || "This user"}'s phone number needs an international country code before it can be opened in WhatsApp.`,
      });
    }

    const message = `Hi ${contestant.name || "there"}, this is AfriOnet regarding the ${session.title || "Live Q/A Event"}.`;
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      whatsappUrl: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
    });
  } catch (error) {
    return next(error);
  }
};

const replaceSelectedQuizContestant = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    const selectedContestantId = String(req.params.contestantId || "").trim();
    const replacementContestantId = String(req.body?.replacementContestantId || "").trim();
    const selectedContestant = session.contestants.id(selectedContestantId);
    const replacementContestant = session.contestants.id(replacementContestantId);

    if (!hasRaffleRun(session)) {
      return res.status(400).json({
        success: false,
        message: "Run the raffle before transferring a selected slot.",
      });
    }

    if (!selectedContestant || selectedContestant.raffleStatus !== "selected") {
      return res.status(400).json({
        success: false,
        message: "The user giving up the slot must currently be selected.",
      });
    }

    if (!replacementContestant || replacementContestant.raffleStatus !== "not-selected") {
      return res.status(400).json({
        success: false,
        message: "Choose a currently not-selected user as the replacement.",
      });
    }

    const competitionStarted =
      (session.askedNumbers || []).length > 0 ||
      (session.contestants || []).some(
        (contestant) =>
          (contestant.score || 0) > 0 || (contestant.answeredQuestions || []).length > 0
      );
    if (competitionStarted) {
      return res.status(409).json({
        success: false,
        message: "A selected slot cannot be transferred after quiz play has started.",
      });
    }

    const transferredPosition = selectedContestant.rafflePosition;
    const wasCurrentTurn = getCurrentTurnContestantId(session) === selectedContestantId;

    selectedContestant.raffleStatus = "not-selected";
    selectedContestant.rafflePosition = null;
    selectedContestant.raffleRandomNumber = null;
    selectedContestant.selectionTransferredFromName = "";
    selectedContestant.selectionTransferredAt = null;
    replacementContestant.raffleStatus = "selected";
    replacementContestant.rafflePosition = transferredPosition;
    replacementContestant.raffleRandomNumber = null;
    replacementContestant.selectionTransferredFromName = selectedContestant.name || "Contestant";
    replacementContestant.selectionTransferredAt = new Date();

    if (wasCurrentTurn) {
      session.currentTurnContestant = replacementContestant._id;
    }

    await session.save();

    await Promise.all([
      createQuizProfileMessage({
        contestant: selectedContestant,
        title: "Q/A event contestant slot transferred",
        body: `Hi ${selectedContestant.name || "Contestant"},\n\nYour selected contestant slot #${transferredPosition} has been transferred by the event administrator. You can still join the live event on Zoom and watch the competition.\n\nBest regards,\nThe AfriOnet Team`,
      }),
      createQuizProfileMessage({
        contestant: replacementContestant,
        title: "You were selected for the Q/A event",
        body: `Hi ${replacementContestant.name || "Contestant"},\n\nA selected contestant slot has been transferred to you by the event administrator. Your contestant number is ${transferredPosition}. Please be ready when your number is called.\n\nBest regards,\nThe AfriOnet Team`,
      }),
    ]);

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: `Slot #${transferredPosition} transferred from ${selectedContestant.name} to ${replacementContestant.name}.`,
    });
  } catch (error) {
    return next(error);
  }
};

const contactQuizContestants = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { contestantId, message, title } = req.body;
    const body = String(message || "").trim();
    const messageTitle = String(title || "Message from AfriOnet Quiz").trim();

    if (!body) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const session = await syncSessionPhase(await getActiveSession());
    const registeredContestants = await sortRegisteredContestants(session);
    const recipients = contestantId
      ? registeredContestants.filter((contestant) => getContestantId(contestant) === contestantId)
      : registeredContestants;

    if (!recipients.length) {
      return res.status(404).json({
        success: false,
        message: contestantId ? "Registered user not found" : "No registered users to contact",
      });
    }

    const contactableRecipients = recipients.filter((contestant) => contestant.user);

    if (!contactableRecipients.length) {
      return res.status(400).json({
        success: false,
        message: "No selected recipient has a linked profile for direct messages.",
      });
    }

    await Promise.all(
      contactableRecipients.map((contestant) =>
        createQuizProfileMessage({
          contestant,
          title: messageTitle,
          body,
        })
      )
    );

    return res.status(200).json({
      ...(await buildSessionPayload(session)),
      message: `Message sent to ${contactableRecipients.length} registered user${
        contactableRecipients.length === 1 ? "" : "s"
      }.`,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin-only: Set or update a quiz question for a specific number
 */
const setQuizQuestion = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const { number, text, type, choices, correctAnswer } = req.body;

    // Validate required fields
    if (!number || number < 1 || number > 200) {
      return res
        .status(400)
        .json({ success: false, message: "Question number must be between 1 and 200" });
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Question text is required" });
    }

    if (!type || !["multiple-choice", "text"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Type must be 'multiple-choice' or 'text'" });
    }

    if (type === "multiple-choice") {
      if (!choices || !Array.isArray(choices) || choices.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "Choices are required for multiple-choice questions" });
      }
      if (!correctAnswer || typeof correctAnswer !== "string") {
        return res.status(400).json({
          success: false,
          message: "Correct answer is required for multiple-choice questions",
        });
      }
    }

    if (
      type === "text" &&
      (!correctAnswer || typeof correctAnswer !== "string" || !correctAnswer.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Correct answer is required for text questions",
      });
    }

    // Find or create question
    let question = await QuizQuestion.findOne({ number });

    if (!question) {
      question = new QuizQuestion({ number });
    }

    const trimmedChoices = type === "multiple-choice" ? choices.map((c) => c.trim()) : [];

    question.text = text.trim();
    question.type = type;
    question.correctAnswer =
      type === "multiple-choice"
        ? normalizeCorrectAnswer(correctAnswer, trimmedChoices)
        : correctAnswer.trim();
    question.choices = trimmedChoices;
    question.active = true;

    await question.save();

    return res.status(200).json({
      success: true,
      message: "Question updated successfully",
      question: {
        number: question.number,
        text: question.text,
        type: question.type,
        choices: question.choices,
        correctAnswer: question.correctAnswer,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/** Register a new contestant for the quiz session */
const registerContestant = async (req, res, next) => {
  try {
    const { name, email, country, profilePhoto, eventId, timeZone } = req.body;

    const requestedEmail = String(req.user.email || email || "")
      .trim()
      .toLowerCase();

    if (req.user.role === "admin" || getConfiguredAdminEmails().includes(requestedEmail)) {
      logQuizSecurityEvent("registration_denied", req, {
        reason: "admin_user",
      });
      return res.status(403).json({
        success: false,
        message: "Admins manage the event and cannot register as contestants.",
      });
    }

    let session = null;
    if (eventId) {
      session = await QuizSession.findById(eventId);
      if (!session) {
        logQuizSecurityEvent("registration_denied", req, {
          reason: "event_not_found",
          eventId,
        });
        return res.status(404).json({
          success: false,
          message: "The selected Q/A event was not found.",
        });
      }
      await syncSessionPhase(session);
    } else {
      session = await syncSessionPhase(await getActiveSession());
    }

    if (!session.eventStartsAt) {
      logQuizSecurityEvent("registration_denied", req, {
        reason: "event_not_scheduled",
        eventId: session._id?.toString(),
      });
      return res.status(403).json({
        success: false,
        message: "Registration is not open because no live Q/A event has been scheduled yet.",
      });
    }

    if (hasRaffleRun(session)) {
      logQuizSecurityEvent("registration_denied", req, {
        reason: "raffle_already_run",
        eventId: session._id?.toString(),
      });
      return res.status(403).json({
        success: false,
        message: "Registration is closed because the raffle has already run.",
      });
    }

    const profileName = String(req.user.name || name || "").trim();
    const normalizedEmail = requestedEmail;
    const profileCountry = String(req.user.country || req.user.location || country || "").trim();
    const profileAvatar = String(
      req.user.profilePhoto || req.user.avatar || profilePhoto || ""
    ).trim();
    const contestantTimeZone = getValidContestantTimeZone({ timeZone });
    const contestant = session.contestants.find(
      (entry) =>
        (entry.user && entry.user.toString() === req.user._id.toString()) ||
        (entry.email && entry.email.toLowerCase() === normalizedEmail)
    );

    if (contestant) {
      contestant.user = req.user._id;
      contestant.name = profileName;
      contestant.email = normalizedEmail;
      contestant.country = profileCountry;
      contestant.profilePhoto = profileAvatar;
      contestant.timeZone = contestantTimeZone;
      contestant.registeredAt = contestant.registeredAt || new Date();
      await session.save();
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        message: "You have already registered for this event.",
        session: serializePublicEventSummary(session, req.user),
        events: await getPublicQuizEventSummaries(req.user),
        contestants: await sortContestants(session),
        registeredContestants: await sortRegisteredContestants(session),
      });
    }

    session.contestants.push({
      user: req.user._id,
      name: profileName,
      email: normalizedEmail,
      country: profileCountry,
      profilePhoto: profileAvatar,
      timeZone: contestantTimeZone,
      registeredAt: new Date(),
      raffleStatus: "registered",
      rafflePosition: null,
      raffleRandomNumber: null,
      score: 0,
      bonusPoints: 0,
      answeredQuestions: [],
      lastAnsweredAt: null,
    });

    await session.save();
    await sendQuizRegistrationMessage(session.contestants[session.contestants.length - 1], session);

    return res.status(201).json({
      success: true,
      alreadyRegistered: false,
      message:
        "Contestant registered successfully. Please click: https://afrionet.com/profile#contact-messages",
      session: serializePublicEventSummary(session, req.user),
      events: await getPublicQuizEventSummaries(req.user),
      contestants: await sortContestants(session),
      registeredContestants: await sortRegisteredContestants(session),
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin-only: Get all quiz questions (including inactive ones)
 */
const getAllQuizQuestions = async (req, res, next) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    const questions = await QuizQuestion.find().sort({ number: 1 });

    return res.status(200).json({
      success: true,
      questions: questions.map((q) => ({
        number: q.number,
        text: q.text,
        type: q.type,
        choices: q.choices,
        correctAnswer: q.correctAnswer,
        active: q.active,
      })),
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getQuizSession,
  getPublicQuizEvents,
  getQuizEvents,
  createQuizEvent,
  updateQuizEvent,
  activateQuizEvent,
  deleteQuizEvent,
  advanceExpiredQuizSession,
  getQuizQuestions,
  getQuizQuestionByNumber,
  submitQuizAnswer,
  getQuizContestants,
  updateQuizSessionSettings,
  executeQuizRaffle,
  restartQuizSession,
  endQuizSession,
  skipCurrentQuizContestant,
  deleteQuizContestant,
  getQuizContestantWhatsAppLink,
  replaceSelectedQuizContestant,
  contactQuizContestants,
  setQuizQuestion,
  registerContestant,
  getAllQuizQuestions,
};
