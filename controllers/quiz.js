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

function getEventStartLabel(session) {
  return (
    String(session.eventStartsAtLabel || "").trim() ||
    (session.eventStartsAt ? new Date(session.eventStartsAt).toLocaleString() : "") ||
    "the scheduled event time"
  );
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
  const eventStart = getEventStartLabel(session);
  const name = contestant.name || "Contestant";
  const body =
    `Hi ${name},\n\n` +
    "You have registered for the AfriOnet Live Q/A Event.\n\n" +
    `Event start: ${eventStart}\n\n` +
    "You will receive another message here immediately after the raffle is run if you are selected as a contestant.\n\n" +
    "If you need any additional information, you can reply to this message here or visit https://afrionet.com/contact.\n\n" +
    "Best regards,\nThe AfriOnet Team";

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
  const eventStart = getEventStartLabel(session);

  await Promise.all(
    registeredContestants.map((contestant) => {
      const name = contestant.name || "Contestant";
      if (contestant.raffleStatus !== "selected") {
        const body =
          `Hi ${name},\n\n` +
          "Thank you for registering for the AfriOnet Live Q/A Event.\n\n" +
          "The raffle has now been completed, and you were not selected as one of the contestants for this event.\n\n" +
          "You can still join the live event, support the contestants, and watch for the next opportunity.\n\n" +
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
      const body =
        `Hi ${name},\n\n` +
        "Congratulations! You were selected for the AfriOnet Live Q/A Event raffle.\n\n" +
        `Your contestant number: ${contestantNumber}.\n\n` +
        `Event start: ${eventStart}\n\n` +
        "Join Zoom when the button opens 5 minutes before the event. Please be ready when your contestant number is called.\n\n" +
        "If you need any additional information, you can reply to this message here or visit https://afrionet.com/contact.\n\n" +
        "Best regards,\nThe AfriOnet Team";

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

async function getActiveSession() {
  let session = await QuizSession.findOne({ active: true });
  if (!session) {
    session = await QuizSession.create({
      phase: "welcome",
      phaseStartedAt: new Date(),
      currentQuestionNumber: null,
      questionTimerSeconds: 30,
      welcomeSeconds: 90,
      rulesSeconds: 80,
      contestantsSeconds: 10,
      questionLimitPerContestant: 5,
      questionPoolSize: 20,
      firstPlaceMinPoints: 0,
      secondPlaceMinPoints: 0,
      maxSelectedContestants: 5,
      currentTurnContestant: null,
      contestants: [],
      askedNumbers: [],
      bonusPending: false,
      meetingLinks: {
        zoom: "",
      },
    });
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

  return session.contestants.find((entry) => {
    const entryUserId = entry.user?.toString();
    const entryEmail = String(entry.email || "")
      .trim()
      .toLowerCase();
    return entryUserId === userId || (userEmail && entryEmail === userEmail);
  });
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

    quizSession.phase = nextPhase;
    quizSession.phaseStartedAt = new Date(
      quizSession.phaseStartedAt.getTime() + durationSeconds * 1000
    );
    if (nextPhase === "pick-number") {
      quizSession.currentQuestionNumber = null;
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

async function sortContestants(session) {
  const nonAdminContestants = await getNonAdminContestants(session);
  const contestants = hasRaffleRun(session)
    ? nonAdminContestants.filter((contestant) => contestant.raffleStatus === "selected")
    : nonAdminContestants;
  const firstPlaceMinPoints = Number(session.firstPlaceMinPoints || 0);
  const secondPlaceMinPoints = Number(session.secondPlaceMinPoints || 0);

  return [...contestants]
    .sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      const aTime = a.lastAnsweredAt ? new Date(a.lastAnsweredAt).getTime() : 0;
      const bTime = b.lastAnsweredAt ? new Date(b.lastAnsweredAt).getTime() : 0;
      return bTime - aTime;
    })
    .map((contestant, index) => ({
      ...(contestant.toObject?.() ?? contestant),
      position: index + 1,
      awardPosition:
        (index === 0 && (contestant.score || 0) >= firstPlaceMinPoints && 1) ||
        (index === 1 && (contestant.score || 0) >= secondPlaceMinPoints && 2) ||
        null,
    }));
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

  const activeQuestionCount = await QuizQuestion.countDocuments({ active: true });
  if (activeQuestionCount > 0 && (quizSession.askedNumbers || []).length >= activeQuestionCount) {
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

    if (
      requestedPhase &&
      requestedPhase === session.phase &&
      durationSeconds > 0 &&
      nextPhase !== session.phase &&
      elapsedSeconds >= durationSeconds - 1
    ) {
      if (moveSessionToNextPhase(session)) {
        await session.save();
      }
    } else if (durationSeconds > 0 && nextPhase !== session.phase && session.phaseStartedAt) {
      if (elapsedSeconds >= durationSeconds - 1) {
        if (moveSessionToNextPhase(session)) {
          await session.save();
        }
      }
    }

    if (session.phase === "pick-number") {
      await ensureCurrentTurnContestant(session);
      await session.save();
    }

    return res.status(200).json(await buildSessionPayload(session));
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
    if (questionNumber > Number(session.questionPoolSize || 20)) {
      return res.status(400).json({
        success: false,
        message: `Please choose a question number between 1 and ${session.questionPoolSize || 20}.`,
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

    session.phase = "question";
    session.phaseStartedAt = new Date();
    session.currentQuestionNumber = questionNumber;
    await session.save();

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
    }

    session.bonusPending = false;

    contestant.score += points;
    contestant.answeredQuestions = Array.from(
      new Set([...(contestant.answeredQuestions || []), questionNumber])
    );
    contestant.lastAnsweredAt = new Date();

    session.currentQuestionNumber = questionNumber;
    const nextAskedNumbers = Array.from(new Set([...(session.askedNumbers || []), questionNumber]));
    session.askedNumbers = nextAskedNumbers;
    const activeQuestionCount = await QuizQuestion.countDocuments({ active: true });

    session.phaseStartedAt = new Date();
    if (nextAskedNumbers.length >= activeQuestionCount) {
      session.phase = "winner";
      session.currentTurnContestant = null;
    } else {
      const nextTurnContestant = await advanceCurrentTurnContestant(session, contestant);
      session.phase = nextTurnContestant ? "pick-number" : "winner";
    }

    await session.save();
    await QuizAnswer.create({
      session: session._id,
      question: question._id,
      questionNumber,
      user: req.user._id,
      contestantName: contestant.name,
      answer: trimmedAnswer,
      isCorrect,
      points,
      bonusAwarded: 0,
    });

    const contestants = await sortContestants(session);

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      success: true,
      message: isCorrect ? "Answer submitted successfully." : "Answer received.",
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
      questionTimerSeconds,
      welcomeSeconds,
      rulesSeconds,
      contestantsSeconds,
      questionLimitPerContestant,
      questionPoolSize,
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

    // Find or create question
    let question = await QuizQuestion.findOne({ number });

    if (!question) {
      question = new QuizQuestion({ number });
    }

    const trimmedChoices = type === "multiple-choice" ? choices.map((c) => c.trim()) : [];

    question.text = text.trim();
    question.type = type;
    question.correctAnswer =
      type === "multiple-choice" ? normalizeCorrectAnswer(correctAnswer, trimmedChoices) : null;
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
        correctAnswer: question.type === "multiple-choice" ? question.correctAnswer : undefined,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/** Register a new contestant for the quiz session */
const registerContestant = async (req, res, next) => {
  try {
    const { name, email, country, profilePhoto } = req.body;

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

    const session = await syncSessionPhase(await getActiveSession());
    if (!session.eventStartsAt) {
      logQuizSecurityEvent("registration_denied", req, {
        reason: "event_not_scheduled",
      });
      return res.status(403).json({
        success: false,
        message: "Registration is not open because no live Q/A event has been scheduled yet.",
      });
    }

    if (hasRaffleRun(session)) {
      logQuizSecurityEvent("registration_denied", req, {
        reason: "raffle_already_run",
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
      contestant.registeredAt = contestant.registeredAt || new Date();
      await session.save();
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        message: "You have already registered for this event.",
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
        "Contestant registered successfully. Please check Profile > Contact Messages for confirmation.",
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
        correctAnswer: q.type === "multiple-choice" ? q.correctAnswer : undefined,
        active: q.active,
      })),
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getQuizSession,
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
  contactQuizContestants,
  setQuizQuestion,
  registerContestant,
  getAllQuizQuestions,
};
