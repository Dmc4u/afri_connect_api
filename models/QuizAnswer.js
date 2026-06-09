const mongoose = require("mongoose");

const quizAnswerSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuizSession",
      required: true,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuizQuestion",
      required: true,
    },
    questionNumber: {
      type: Number,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    contestantName: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    isCorrect: {
      type: Boolean,
      default: false,
    },
    points: {
      type: Number,
      default: 0,
    },
    bonusAwarded: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("QuizAnswer", quizAnswerSchema);
