const mongoose = require('mongoose');

const showcaseVoteSchema = new mongoose.Schema({
  showcase: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TalentShowcase',
    required: true
  },
  contestant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TalentContestant',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: String,
  voteWeight: {
    type: Number,
    default: 1 // Premium users can have higher weight
  },
  country: String,
  votedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate votes
showcaseVoteSchema.index({ showcase: 1, contestant: 1, user: 1 }, { unique: true, sparse: true });
showcaseVoteSchema.index({ showcase: 1, contestant: 1, ipAddress: 1 });
showcaseVoteSchema.index({ showcase: 1, votedAt: 1 });

// Index for analytics
showcaseVoteSchema.index({ contestant: 1, votedAt: 1 });

module.exports = mongoose.model('ShowcaseVote', showcaseVoteSchema);
