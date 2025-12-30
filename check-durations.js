const mongoose = require('mongoose');
const TalentContestant = require('./models/TalentContestant');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/afri-connect_db')
  .then(async () => {
    const contestants = await TalentContestant.find({}).select('performanceTitle videoUrl videoDuration status');
    console.log(`Found ${contestants.length} total contestants\n`);
    console.log('Contestants with video durations:');
    contestants.forEach(c => {
      const durationMin = c.videoDuration ? (c.videoDuration / 60).toFixed(2) : 'NOT SET';
      console.log(`- [${c.status}] ${c.performanceTitle}: ${c.videoDuration || 0} seconds (${durationMin} min)`);
    });

    const total = contestants.reduce((sum, c) => sum + (c.videoDuration || 0), 0);
    console.log(`\nTotal duration: ${total} seconds (${(total/60).toFixed(2)} minutes)`);
    mongoose.connection.close();
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
