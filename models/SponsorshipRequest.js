const mongoose = require('mongoose');

const sponsorshipRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  companyName: {
    type: String,
    trim: true
  },
  contributionAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'KES', 'GHS']
  },
  message: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  website: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['completed', 'contacted'],
    default: 'completed'
  },
  adminNotes: {
    type: String
  },
  viewedByAdmin: {
    type: Boolean,
    default: false
  },
  viewedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for faster queries
sponsorshipRequestSchema.index({ status: 1, createdAt: -1 });
sponsorshipRequestSchema.index({ viewedByAdmin: 1 });
sponsorshipRequestSchema.index({ user: 1 });

module.exports = mongoose.model('SponsorshipRequest', sponsorshipRequestSchema);
