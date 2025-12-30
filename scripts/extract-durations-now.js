require('dotenv').config();
const mongoose = require('mongoose');
const TalentContestant = require('../models/TalentContestant');
const ShowcaseEventTimeline = require('../models/ShowcaseEventTimeline');
const { getYouTubeDuration } = require('../utils/youtubeUtils');

async function extractDurations() {
  try {
    console.log('✅ Connected to MongoDB\n');

    // Find all contestants with null duration and YouTube URLs
    const contestants = await TalentContestant.find({
      videoDuration: null,
      videoUrl: { $regex: /youtube\.com|youtu\.be/i }
    });

    console.log(`📋 Found ${contestants.length} contestants with YouTube URLs and no duration\n`);

    let fixed = 0;
    let failed = 0;

    for (const contestant of contestants) {
      console.log(`📹 Processing: ${contestant.performanceTitle}`);
      console.log(`   URL: ${contestant.videoUrl}`);

      try {
        const duration = await getYouTubeDuration(contestant.videoUrl);

        if (duration && duration > 0) {
          contestant.videoDuration = duration;
          await contestant.save();
          console.log(`   ✅ Extracted and saved: ${duration}s (${(duration/60).toFixed(2)} min)\n`);
          fixed++;
        } else {
          console.log(`   ❌ Could not extract duration\n`);
          failed++;
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
        failed++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Fixed: ${fixed}`);
    console.log(`   ❌ Failed: ${failed}`);

    if (fixed > 0) {
      console.log(`\n⏱️  Rescheduling performances for live showcases...`);

      const liveTimelines = await ShowcaseEventTimeline.find({
        isLive: true
      }).populate('showcase');

      for (const timeline of liveTimelines) {
        const contestants = await TalentContestant.find({
          showcase: timeline.showcase._id,
          status: { $in: ['approved', 'selected'] },
          videoDuration: { $ne: null, $gt: 0 }
        });

        if (contestants.length > 0) {
          console.log(`\n📺 Rescheduling for: ${timeline.showcase.title}`);
          timeline.performances = [];
          timeline.schedulePerformances(contestants);
          await timeline.save();
          console.log(`   ✅ Scheduled ${timeline.performances.length} performances`);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

mongoose.connect(process.env.MONGO_URL)
  .then(() => extractDurations())
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
