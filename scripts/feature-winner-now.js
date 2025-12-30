require('dotenv').config();
const mongoose = require('mongoose');
const { MONGO_URL } = require('../utils/config');

// Require models first to register schemas
const User = require('../models/User');
const Listing = require('../models/Listing');
const TalentContestant = require('../models/TalentContestant');
const FeaturedPlacement = require('../models/FeaturedPlacement');
const TalentShowcase = require('../models/TalentShowcase');

// Connect to MongoDB
mongoose.connect(MONGO_URL);

async function featureCurrentWinner() {
  try {
    const { autoFeatureWinner } = require('../utils/featuredHelper');

    console.log('🔍 Finding latest winner...\n');

    // Find contestants sorted by votes
    const topContestants = await TalentContestant.find({})
      .populate('user')
      .populate('listing')
      .sort({ votes: -1, createdAt: -1 })
      .limit(10);

    console.log(`Found ${topContestants.length} contestants:\n`);
    topContestants.forEach((c, i) => {
      console.log(`${i + 1}. ${c.performanceTitle} - ${c.votes} votes (${c.user?.name || 'Unknown'})`);
    });

    if (topContestants.length === 0) {
      console.log('\n❌ No contestants found');
      process.exit(0);
    }

    // Feature the top contestant
    const winner = topContestants[0];
    console.log(`\n🏆 Auto-featuring top contestant: ${winner.performanceTitle}`);

    const result = await autoFeatureWinner(winner);

    console.log('\n✅ Winner featured successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

featureCurrentWinner();
