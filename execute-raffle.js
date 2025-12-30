const mongoose = require('mongoose');
const TalentShowcase = require('./models/TalentShowcase');
const TalentContestant = require('./models/TalentContestant');
const User = require('./models/User'); // Need to load User model for populate
const { performRaffle } = require('./utils/raffleSelection');

mongoose.connect('mongodb://127.0.0.1:27017/afri-connect_db');

setTimeout(async () => {
  try {
    const showcase = await TalentShowcase.findOne({ title: /LIVE.*Talent/i }).sort({ eventDate: 1 });

    console.log('🎲 Executing raffle for:', showcase.title);

    const contestants = await TalentContestant.find({
      showcase: showcase._id,
      status: { $in: ['submitted', 'pending-raffle'] }
    }).populate('user', 'name email country');

    console.log('Found', contestants.length, 'contestants for raffle');

    const maxContestants = showcase.maxContestants || 2;
    console.log('Max contestants:', maxContestants);

    const raffleResults = performRaffle(contestants, maxContestants);

    console.log('\n✅ Raffle results:');
    console.log('Selected:', raffleResults.selected.length);
    raffleResults.selected.forEach(s => {
      const contestant = contestants.find(c => c._id.toString() === s.contestant.toString());
      console.log(`  Position ${s.position} - ${contestant.performanceTitle} - Random: ${s.randomNumber.toFixed(6)}`);
    });

    console.log('\nWaitlisted:', raffleResults.waitlist.length);

    // Update selected contestants
    for (const selected of raffleResults.selected) {
      await TalentContestant.findByIdAndUpdate(selected.contestant, {
        raffleStatus: 'selected',
        rafflePosition: selected.position,
        raffleRandomNumber: selected.randomNumber,
        status: 'selected'
      });
    }

    // Delete unselected contestants
    const selectedIds = raffleResults.selected.map(s => s.contestant.toString());
    const deleteResult = await TalentContestant.deleteMany({
      showcase: showcase._id,
      _id: { $nin: selectedIds }
    });

    console.log(`\n🗑️  Deleted ${deleteResult.deletedCount} unselected contestants`);

    // Update showcase
    showcase.raffleExecutedDate = new Date();
    showcase.status = 'raffle-completed';
    showcase.raffleSeed = raffleResults.raffleSeed;
    await showcase.save();

    console.log('\n✅ Raffle executed successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error executing raffle:', error);
    process.exit(1);
  }
}, 2000);
