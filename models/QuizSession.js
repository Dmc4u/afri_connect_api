const mongoose = require("mongoose");

const quizSessionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "Live Q/A Event",
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    phase: {
      type: String,
      enum: [
        "scheduled",
        "welcome",
        "rules",
        "contestants",
        "pick-number",
        "question",
        "winner",
        "finished",
      ],
      default: "welcome",
    },
    eventStartsAt: {
      type: Date,
      default: null,
    },
    eventStartsAtLabel: {
      type: String,
      default: "",
      trim: true,
    },
    eventEndsAt: {
      type: Date,
      default: null,
    },
    phaseStartedAt: {
      type: Date,
      default: Date.now,
    },
    currentQuestionNumber: {
      type: Number,
      default: null,
    },
    questionTimerSeconds: {
      type: Number,
      default: 30,
    },
    welcomeSeconds: {
      type: Number,
      default: 90,
    },
    rulesSeconds: {
      type: Number,
      default: 80,
    },
    contestantsSeconds: {
      type: Number,
      default: 10,
    },
    questionLimitPerContestant: {
      type: Number,
      default: 5,
    },
    questionPoolSize: {
      type: Number,
      default: 20,
    },
    firstPlaceMinPoints: {
      type: Number,
      default: 0,
    },
    secondPlaceMinPoints: {
      type: Number,
      default: 0,
    },
    firstPlacePrize: {
      type: String,
      default: "",
      trim: true,
    },
    secondPlacePrize: {
      type: String,
      default: "",
      trim: true,
    },
    maxSelectedContestants: {
      type: Number,
      default: 5,
    },
    raffleSeed: {
      type: String,
      default: "",
    },
    raffleExecutedAt: {
      type: Date,
      default: null,
    },
    raffleRunsAt: {
      type: Date,
      default: null,
    },
    currentTurnContestant: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    welcomeNote: {
      type: String,
      default:
        "Welcome to the Q/A event. Take the opening moment to greet the participants and introduce the flow.",
      trim: true,
    },
    rules: {
      type: String,
      default: [
        "Share the event once it is your turn to pick a number to reveal the next question on Zoom.",
        "Don't look around when answering to keep the event fun and fair for everyone.",
        "You will be disqualified if you cheat.",
        "Choose any available question number.",
        "Each number can only be selected once during the event.",
        "Answer using A, B, C or a written reply.",
        "Correct answers earn points.",
        "Each selected contestant picks their allowed number of questions before the next contestant takes a turn.",
        "The contestant with the most points at the end wins.",
      ].join("\n"),
      trim: true,
    },
    contestants: {
      type: [
        {
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
          name: { type: String, required: true, trim: true },
          email: { type: String, lowercase: true, trim: true },
          country: { type: String, trim: true },
          profilePhoto: { type: String, trim: true },
          registeredAt: { type: Date, default: Date.now },
          raffleStatus: {
            type: String,
            enum: ["registered", "selected", "not-selected"],
            default: "registered",
          },
          rafflePosition: { type: Number, default: null },
          raffleRandomNumber: { type: Number, default: null },
          score: { type: Number, default: 0 },
          bonusPoints: { type: Number, default: 0 },
          answeredQuestions: { type: [Number], default: [] },
          lastAnsweredAt: { type: Date },
        },
      ],
      default: [],
    },
    askedNumbers: {
      type: [Number],
      default: [],
    },
    bonusPending: {
      type: Boolean,
      default: false,
    },
    meetingLinks: {
      zoom: {
        type: String,
        default: "",
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("QuizSession", quizSessionSchema);
