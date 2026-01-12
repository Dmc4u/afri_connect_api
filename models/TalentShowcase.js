const mongoose = require('mongoose');

const talentShowcaseSchema = new mongoose.Schema({
  showcaseType: {
    type: String,
    enum: ['legacy', 'structured'],
    default: 'structured',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Dance', 'Music', 'Comedy', 'Art', 'Fashion', 'Acting', 'Mixed']
  },
  competitionType: {
    type: String,
    required: true,
    enum: ['country-vs-country', 'talent-vs-talent', 'open-category'],
    default: 'talent-vs-talent'
  },
  themeTitle: {
    type: String,
    trim: true
  },
  themeCreator: {
    type: String,
    trim: true
  },
  // Legacy fields for backward compatibility
  themeSong: {
    type: String,
    trim: true
  },
  themeSongArtist: {
    type: String,
    trim: true
  },
  performanceDuration: {
    type: Number,
    default: 5 // minutes (max per performance)
  },
  votingDuration: {
    type: Number,
    default: 5 // minutes
  },
  oneVoteOnly: {
    type: Boolean,
    default: true
  },
  entryFee: {
    type: Number,
    default: 0
  },
  entryFeeCurrency: {
    type: String,
    default: 'USD'
  },
  // Registration and Submission Windows
  registrationStartDate: {
    type: Date,
    required: true
  },
  registrationEndDate: {
    type: Date,
    required: true
  },
  submissionDeadline: {
    type: Date,
    required: false
  },
  maxContestants: {
    type: Number,
    default: 5,
    min: 1
  },
  // Raffle Selection
  raffleScheduledDate: {
    type: Date // Scheduled raffle date/time (after registration closes)
  },
  raffleExecutedDate: {
    type: Date // When raffle was actually executed
  },
  raffleExecutedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  raffleSeed: {
    type: String // Random seed used for raffle (for transparency/verification)
  },
  raffleResults: [{
    contestant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TalentContestant'
    },
    position: Number, // Selected position (1-5 if maxContestants=5)
    randomNumber: Number, // The random number assigned during raffle
    selectedAt: Date
  }],
  waitlist: [{
    contestant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TalentContestant'
    },
    position: Number, // Waitlist position
    randomNumber: Number
  }],
  eventDate: {
    type: Date,
    required: true
  },
  // New 7-Stage Event Flow Fields
  welcomeMessage: {
    type: String,
    default: 'Welcome to our live talent showcase! Get ready for an amazing show!'
  },
  welcomeDuration: {
    type: Number,
    default: 5 // minutes
  },
  // Welcome phase transition timings (in seconds)
  welcomeMessageDuration: {
    type: Number,
    default: 5 // seconds - display welcome message
  },
  rulesDuration: {
    type: Number,
    default: 10 // seconds - display rules
  },
  contestantsIntroDuration: {
    type: Number,
    default: 3 // seconds - per contestant intro transition
  },
  musicUrl: {
    type: String,
    trim: true,
    default: null // Admin can set custom music for each event
  },
  musicPlaying: {
    type: Boolean,
    default: false // Admin controls via play/stop during live event
  },
  rulesMessage: {
    type: String,
    default: 'Please watch all performances before voting. Vote for your favorite act. Be respectful in chat.'
  },
  commercialDuration: {
    type: Number,
    default: 2 // minutes (2-3 minutes total, auto-calculated from commercials array)
  },
  commercialContent: {
    type: String,
    trim: true
  },
  // Legacy single commercial support (backward compatibility)
  commercialVideoUrl: {
    type: String,
    trim: true
  },
  // New multiple commercials support
  commercials: [{
    videoUrl: {
      type: String,
      required: true,
      trim: true
    },
    title: {
      type: String,
      trim: true,
      default: 'Advertisement'
    },
    duration: {
      type: Number, // in seconds (max 3 minutes per ad)
      required: true,
      max: 180
    },
    order: {
      type: Number,
      default: 0
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  votingDisplayDuration: {
    type: Number,
    default: 10 // minutes
  },
  winnerDisplayDuration: {
    type: Number,
    default: 5 // minutes
  },
  thankYouMessage: {
    type: String,
    default: 'Thank you for watching! See you at our next event!'
  },
  thankYouDuration: {
    type: Number,
    default: 2 // minutes
  },
  nextEventCountdown: {
    type: Boolean,
    default: false
  },
  // Legacy fields - kept for backward compatibility, made optional
  votingStartTime: {
    type: Date
  },
  votingEndTime: {
    type: Date
  },
  status: {
    type: String,
    enum: ['draft', 'registration-open', 'registration-closed', 'raffle-pending', 'raffle-completed', 'upcoming', 'nomination', 'live', 'voting', 'completed', 'cancelled'],
    default: 'draft'
  },
  streamUrl: {
    type: String,
    trim: true
  },
  thumbnailUrl: {
    type: String
  },
  // Alternative to live stream: static content options
  hasLiveStream: {
    type: Boolean,
    default: true
  },
  staticContentType: {
    type: String,
    enum: ['image', 'text', null],
    default: null
  },
  staticContent: {
    type: String,
    trim: true
  },
  contestants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TalentContestant'
  }],
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TalentContestant'
  },
  prizeDetails: {
    amount: Number,
    currency: {
      type: String,
      default: 'USD'
    },
    description: String,
    sponsor: String
  },
  totalVotes: {
    type: Number,
    default: 0
  },
  totalViewers: {
    type: Number,
    default: 0
  },
  featured: {
    type: Boolean,
    default: false
  },
  rules: {
    maxVotesPerUser: {
      type: Number,
      default: 1
    },
    premiumBonusVotes: {
      type: Number,
      default: 2
    },
    allowAnonymousVotes: {
      type: Boolean,
      default: false
    }
  },
  sponsors: [{
    name: String,
    logo: String,
    website: String,
    contributionAmount: Number
  }],
  judges: [{
    name: String,
    title: String,
    photo: String,
    bio: String
  }],
  chat: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  // Live Event Control Fields
  liveEventControl: {
    isPaused: {
      type: Boolean,
      default: false
    },
    pausedAt: Date,
    pausedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    currentStage: {
      type: String,
      enum: ['welcome', 'performance', 'commercial', 'voting', 'winner', 'thankYou', 'countdown', null],
      default: null
    },
    currentPerformanceIndex: {
      type: Number,
      default: 0
    },
    stageStartedAt: Date,
    timeExtensions: [{
      stage: String,
      additionalMinutes: Number,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      addedAt: Date
    }],
    manualOverride: {
      active: Boolean,
      stage: String,
      setBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      setAt: Date
    }
  },
  recordingUrl: {
    type: String
  },
  nextEventDate: {
    type: Date
  },
  nextEventTitle: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for querying active/upcoming events
talentShowcaseSchema.index({ status: 1, eventDate: 1 });
talentShowcaseSchema.index({ category: 1, status: 1 });

// Virtual for checking if event is live
talentShowcaseSchema.virtual('isLive').get(function() {
  const now = new Date();
  // Calculate voting times if using new flow
  const votingStart = this.votingStartTime || this.calculateVotingStartTime();
  const votingEnd = this.votingEndTime || this.calculateVotingEndTime();
  return now >= votingStart && now <= votingEnd && this.status === 'live';
});

// Virtual for checking if voting is open
talentShowcaseSchema.virtual('isVotingOpen').get(function() {
  const now = new Date();
  const votingStart = this.votingStartTime || this.calculateVotingStartTime();
  const votingEnd = this.votingEndTime || this.calculateVotingEndTime();
  return now >= votingStart && now <= votingEnd &&
         (this.status === 'live' || this.status === 'voting');
});

// Method to calculate voting start time based on event flow
talentShowcaseSchema.methods.calculateVotingStartTime = function() {
  if (this.votingStartTime) return this.votingStartTime;

  const eventStart = new Date(this.eventDate);
  // Welcome (0 min) + Performances (dynamic) + Commercial
  const totalPerformances = this.contestants?.length ?? 0;
  const performanceDuration = this.performanceDuration ?? 5; // default 5 min per performance
  const commercialDuration = this.commercialDuration ?? 2;

  const minutesUntilVoting = (totalPerformances * performanceDuration) + commercialDuration;
  return new Date(eventStart.getTime() + (minutesUntilVoting * 60 * 1000));
};

// Method to calculate voting end time
talentShowcaseSchema.methods.calculateVotingEndTime = function() {
  if (this.votingEndTime) return this.votingEndTime;

  const votingStart = this.calculateVotingStartTime();
  const votingDuration = this.votingDisplayDuration ?? 10;
  return new Date(votingStart.getTime() + (votingDuration * 60 * 1000));
};

// Method to get time remaining
talentShowcaseSchema.methods.getTimeRemaining = function() {
  const now = new Date();
  const votingStart = this.votingStartTime || this.calculateVotingStartTime();
  const votingEnd = this.votingEndTime || this.calculateVotingEndTime();

  if (now < votingStart) {
    return { phase: 'upcoming', milliseconds: votingStart - now };
  } else if (now <= votingEnd) {
    return { phase: 'live', milliseconds: votingEnd - now };
  } else {
    return { phase: 'ended', milliseconds: 0 };
  }
};

module.exports = mongoose.model('TalentShowcase', talentShowcaseSchema);
