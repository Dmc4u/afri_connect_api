const mongoose = require('mongoose');
require('dotenv').config();

const TalentContestant = require('../models/TalentContestant');

async function checkContestant() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/africonnect');
    console.log('✅ Connected');

    // Find all contestants marked as winners
    const winners = await TalentContestant.find({ isWinner: true }).populate('user');

    console.log(`\n📊 Found ${winners.length} contestants marked as winners\n`);

    for (const winner of winners) {
      console.log('═'.repeat(60));
      console.log('ID:', winner._id);
      console.log('Title:', winner.performanceTitle);
      console.log('Performer:', winner.user?.name);
      console.log('Votes:', winner.votes);
      console.log('isWinner:', winner.isWinner);
      console.log('wonAt:', winner.wonAt);
      console.log('Showcase:', winner.showcase);

      // Get all contestants from same showcase
      const allContestants = await TalentContestant.find({ showcase: winner.showcase })
        .sort({ votes: -1 });

      const totalVotes = allContestants.reduce((sum, c) => sum + (c.votes || 0), 0);
      const highestVotes = allContestants[0]?.votes || 0;
      const tiedContestants = allContestants.filter(c => (c.votes || 0) === highestVotes);

      console.log('\nShowcase Stats:');
      console.log('  Total Votes:', totalVotes);
      console.log('  Highest Votes:', highestVotes);
      console.log('  Tied at top:', tiedContestants.length);

      console.log('\nAll contestants:');
      allContestants.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.performanceTitle} - ${c.votes} votes - isWinner: ${c.isWinner || false}`);
      });

      // Determine if this is a valid winner
      if (totalVotes === 0) {
        console.log('\n❌ INVALID: No votes cast');
      } else if (tiedContestants.length > 1 && winner.votes === highestVotes) {
        console.log(`\n❌ INVALID: Tie (${tiedContestants.length} contestants with ${highestVotes} votes)`);
      } else if (winner.votes < highestVotes) {
        console.log(`\n❌ INVALID: Not the highest (${winner.votes} vs ${highestVotes})`);
      } else {
        console.log('\n✅ VALID WINNER');
      }
    }

    // Also check for contestants with 0 votes but no isWinner flag
    const zeroVoteContestants = await TalentContestant.find({ votes: 0 });
    console.log(`\n📊 Found ${zeroVoteContestants.length} contestants with 0 votes (checking for incorrect isWinner flags)`);

    for (const c of zeroVoteContestants) {
      if (c.isWinner) {
        console.log(`❌ ${c.performanceTitle} - HAS isWinner:true WITH 0 VOTES`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkContestant();
