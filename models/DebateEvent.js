const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true },
    position: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    profilePhoto: { type: String, trim: true, default: "" },
    raffleStatus: {
      type: String,
      enum: ["registered", "selected", "not-selected"],
      default: "registered",
    },
    rafflePosition: { type: Number, default: null },
    raffleRandomNumber: { type: Number, default: null },
    selectionTransferredFromName: { type: String, trim: true, default: "" },
    selectionTransferredAt: { type: Date, default: null },
    judgeScores: {
      argument: { type: Number, min: 0, max: 30, default: 0 },
      evidence: { type: Number, min: 0, max: 25, default: 0 },
      rebuttal: { type: Number, min: 0, max: 20, default: 0 },
      delivery: { type: Number, min: 0, max: 15, default: 0 },
      timeDiscipline: { type: Number, min: 0, max: 10, default: 0 },
    },
    audienceVotes: { type: Number, min: 0, default: 0 },
    finalScore: { type: Number, min: 0, default: 0 },
    placement: { type: Number, default: null },
  },
  { timestamps: true }
);

const debateEventSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: true },
    title: { type: String, trim: true, default: "AfriOnet Live Debate" },
    topic: { type: String, trim: true, default: "The debate topic will be announced soon." },
    openingPrompt: {
      type: String,
      trim: true,
      default: "Please Introduce yourself.",
    },
    mainQuestion: { type: String, trim: true, default: "" },
    closingPrompt: {
      type: String,
      trim: true,
      default: "Give your final word and closing position.",
    },
    firstPlacePrize: { type: String, trim: true, maxlength: 120, default: "" },
    secondPlacePrize: { type: String, trim: true, maxlength: 120, default: "" },
    rules: {
      type: String,
      trim: true,
      default: "Respect every speaker. Stay on topic. Stop when your time ends.",
    },
    phase: {
      type: String,
      enum: [
        "scheduled",
        "welcome",
        "round1",
        "commercial1",
        "question",
        "round2",
        "commercial2",
        "round3",
        "voting",
        "results",
        "finished",
      ],
      default: "scheduled",
    },
    phaseStartedAt: { type: Date, default: Date.now },
    currentTurnIndex: { type: Number, min: 0, default: 0 },
    timerEndsAt: { type: Date, default: null },
    paused: { type: Boolean, default: false },
    pausedRemainingSeconds: { type: Number, min: 0, default: 0 },
    eventStartsAt: { type: Date, default: null },
    eventEndsAt: { type: Date, default: null },
    firstPlaceMinPoints: { type: Number, min: 0, default: 0 },
    secondPlaceMinPoints: { type: Number, min: 0, default: 0 },
    openingSeconds: { type: Number, min: 30, max: 1800, default: 120 },
    questionDisplaySeconds: { type: Number, min: 15, max: 600, default: 60 },
    responseSeconds: { type: Number, min: 60, max: 3600, default: 300 },
    closingSeconds: { type: Number, min: 30, max: 600, default: 120 },
    commercialSeconds: { type: Number, min: 10, max: 600, default: 45 },
    votingSeconds: { type: Number, min: 30, max: 3600, default: 300 },
    votingEndsAt: { type: Date, default: null },
    selectedParticipantSlots: { type: Number, min: 1, max: 50, default: 2 },
    raffleSeed: { type: String, trim: true, default: "" },
    raffleExecutedAt: { type: Date, default: null },
    raffleRunsAt: { type: Date, default: null },
    judgingMode: {
      type: String,
      enum: ["judges", "audience", "hybrid"],
      default: "audience",
    },
    judgeWeight: { type: Number, min: 0, max: 100, default: 70 },
    audienceWeight: { type: Number, min: 0, max: 100, default: 30 },
    sponsor: {
      name: { type: String, trim: true, default: "" },
      message: { type: String, trim: true, default: "" },
      logoUrl: { type: String, trim: true, default: "" },
    },
    meetingLinks: { zoom: { type: String, trim: true, default: "" } },
    participants: { type: [participantSchema], default: [] },
    votingOpenedAt: { type: Date, default: null },
    votingClosedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DebateEvent", debateEventSchema);
