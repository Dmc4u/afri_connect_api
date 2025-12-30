const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/afrionet').then(async () => {
  const ShowcaseEventTimeline = require('./models/ShowcaseEventTimeline');
  const timeline = await ShowcaseEventTimeline.findOne().sort({createdAt: -1}).populate('performances.contestant');
  
  if (timeline) {
    console.log('TIMELINE STATUS:');
    console.log('Performances count:', timeline.performances?.length || 0);
    console.log('Current phase:', timeline.currentPhase);
    console.log('Is Live:', timeline.isLive);
    
    if (timeline.performances && timeline.performances.length > 0) {
      console.log('\nPERFORMANCES:');
      timeline.performances.forEach((p, i) => {
        console.log(`[${i}] Status: ${p.status}, Duration: ${p.videoDuration}s, Contestant: ${p.contestant?._id || 'NULL'}`);
      });
    } else {
      console.log('\nNO PERFORMANCES SCHEDULED!');
    }
  } else {
    console.log('No timeline found');
  }
  process.exit(0);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
