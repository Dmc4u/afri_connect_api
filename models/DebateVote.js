const mongoose = require("mongoose");

const debateVoteSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "DebateEvent", required: true },
    participant: { type: mongoose.Schema.Types.ObjectId, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

debateVoteSchema.index({ event: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("DebateVote", debateVoteSchema);
