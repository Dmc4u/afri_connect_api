const mongoose = require("mongoose");

const quizQuestionSchema = new mongoose.Schema(
  {
    number: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["multiple-choice", "text"],
      default: "multiple-choice",
    },
    choices: {
      type: [String],
      default: [],
    },
    correctAnswer: {
      type: String,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("QuizQuestion", quizQuestionSchema);
