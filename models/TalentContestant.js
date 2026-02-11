const mongoose = require("mongoose");

const talentContestantSchema = new mongoose.Schema(
  {
    showcase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TalentShowcase",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
    },
    performanceTitle: {
      type: String,
      required: true,
      trim: true,
    },
    performanceDescription: {
      type: String,
      required: true,
    },
    themeTitle: {
      type: String,
      trim: true,
    },
    themeCreator: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
    videoCloudinaryId: {
      type: String,
    },
    videoDuration: {
      type: Number, // Duration in seconds (extracted from actual video)
      default: 0,
    },
    thumbnailUrl: {
      type: String,
    },
    status: {
      type: String,
      enum: [
        "submitted",
        "pending-raffle",
        "selected",
        "waitlisted",
        "not-selected",
        "approved",
        "rejected",
        "withdrawn",
      ],
      default: "submitted",
    },
    raffleStatus: {
      type: String,
      enum: ["pending", "selected", "waitlisted", "not-selected"],
      default: "pending",
    },
    rafflePosition: {
      type: Number, // Position in raffle (selected or waitlist)
    },
    raffleRandomNumber: {
      type: Number, // Random number assigned during raffle
    },
    votes: {
      type: Number,
      default: 0,
    },
    judgeScores: [
      {
        judge: String,
        score: {
          type: Number,
          min: 0,
          max: 10,
        },
        comment: String,
      },
    ],
    totalJudgeScore: {
      type: Number,
      default: 0,
    },
    finalScore: {
      type: Number,
      default: 0,
    },
    rank: {
      type: Number,
    },
    isWinner: {
      type: Boolean,
      default: false,
    },
    wonAt: {
      type: Date,
    },
    entryFee: {
      paid: {
        type: Boolean,
        default: false,
      },
      amount: Number,
      transactionId: String,
      paidAt: Date,
    },
    socialMedia: {
      instagram: String,
      twitter: String,
      facebook: String,
      youtube: String,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual fields for frontend compatibility
talentContestantSchema.virtual("name").get(function () {
  return this.performanceTitle;
});

talentContestantSchema.virtual("bio").get(function () {
  return this.performanceDescription;
});

talentContestantSchema.virtual("mediaUrl").get(function () {
  return this.videoUrl;
});

talentContestantSchema.virtual("voteCount").get(function () {
  return this.votes;
});

talentContestantSchema.virtual("profileImage").get(function () {
  return this.thumbnailUrl || "/uploads/default-contestant.jpg";
});

// Index for querying by showcase and status
talentContestantSchema.index({ showcase: 1, status: 1 });
talentContestantSchema.index({ showcase: 1, votes: -1 });
talentContestantSchema.index({ user: 1, showcase: 1 });

// Method to calculate final score (votes + judge scores)
talentContestantSchema.methods.calculateFinalScore = function () {
  const voteWeight = 0.7; // 70% from public votes
  const judgeWeight = 0.3; // 30% from judges

  const normalizedVotes = this.votes; // Can be normalized based on total votes
  const judgeScore = this.totalJudgeScore || 0;

  this.finalScore = normalizedVotes * voteWeight + judgeScore * judgeWeight;
  return this.finalScore;
};

module.exports = mongoose.model("TalentContestant", talentContestantSchema);
