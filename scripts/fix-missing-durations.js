require('dotenv').config();
const mongoose = require('mongoose');
const TalentContestant = require('../models/TalentContestant');
const ShowcaseEventTimeline = require('../models/ShowcaseEventTimeline');
const { getYouTubeDuration } = require('../utils/youtubeUtils');

async function fixMissingDurations() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URL);
    console.log('✅ Connected to MongoDB\n');

    // Find all contestants with null videoDuration but with videoUrl
    const contestants = await TalentContestant.find({
      videoDuration: { $in: [null, undefined, 0] },
      videoUrl: { $exists: true, $ne: '' }
    });

    console.log(`📹 Found ${contestants.length} contestants with missing durations\n`);

    let fixed = 0;
    let failed = 0;

    for (const contestant of contestants) {
      try {
        console.log(`🎬 Processing: ${contestant.performanceTitle}`);
        console.log(`   URL: ${contestant.videoUrl}`);

        const duration = await getYouTubeDuration(contestant.videoUrl);

        if (duration && duration > 0) {
          contestant.videoDuration = duration;
          await contestant.save();
          console.log(`   ✅ Duration extracted: ${duration} seconds (${Math.floor(duration/60)}m ${duration%60}s)\n`);
          fixed++;
        } else {
          console.log(`   ❌ Failed to extract duration\n`);
          failed++;
        }
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}\n`);
        failed++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Fixed: ${fixed}`);
    console.log(`   ❌ Failed: ${failed}`);

    // Now reschedule performances for active showcases
    console.log(`\n🔄 Rescheduling performances for live showcases...`);

    const liveTimelines = await ShowcaseEventTimeline.find({
      isLive: true
    }).populate('showcase');

    for (const timeline of liveTimelines) {
      console.log(`\n📅 Timeline for showcase: ${timeline.showcase?.title || 'Unknown'}`);

      const showcaseContestants = await TalentContestant.find({
        showcase: timeline.showcase._id,
        status: 'selected'
      }).sort({ rafflePosition: 1 });

      console.log(`   Found ${showcaseContestants.length} selected contestants`);

      // Clear existing performances
      timeline.performances = [];

      // Reschedule
      timeline.schedulePerformances(showcaseContestants);
      await timeline.save();

      console.log(`   ✅ Performances rescheduled: ${timeline.performances.length}`);
    }

    console.log('\n✅ All done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixMissingDurations();
