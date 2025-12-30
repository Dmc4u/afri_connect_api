const mongoose = require('mongoose');
require('dotenv').config();

const TalentShowcase = require('./models/TalentShowcase');
const TalentContestant = require('./models/TalentContestant');
const ShowcaseEventTimeline = require('./models/ShowcaseEventTimeline');

async function diagnose() {
  try {
    const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/afri-connect_db';
    await mongoose.connect(mongoUrl);
    console.log('✅ Connected to MongoDB\n');

    // Find the most recent showcase
    const showcase = await TalentShowcase.findOne()
      .sort({ createdAt: -1 });

    if (!showcase) {
      console.log('❌ No showcase found');
      return;
    }

    console.log('📋 Showcase:', showcase.title);
    console.log('   ID:', showcase._id);
    console.log('   Status:', showcase.status);
    console.log('   Event Date:', showcase.eventDate);

    // Get contestants
    const contestants = await TalentContestant.find({
      showcase: showcase._id,
      status: { $in: ['selected', 'approved'] }
    });

    console.log('\n👥 Contestants:', contestants.length);
    contestants.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.performanceTitle}`);
      console.log(`      Video: ${c.videoUrl}`);
      console.log(`      Duration: ${c.videoDuration} seconds`);
      console.log(`      Status: ${c.status}`);
    });

    // Get timeline
    const timeline = await ShowcaseEventTimeline.findOne({
      showcase: showcase._id
    }).populate({
      path: 'performances.contestant',
      populate: {
        path: 'user',
        select: 'name'
      }
    });

    if (!timeline) {
      console.log('\n❌ NO TIMELINE FOUND!');
      console.log('   👉 Timeline needs to be created for this showcase');
      return;
    }

    console.log('\n⏱️  Timeline:');
    console.log('   ID:', timeline._id);
    console.log('   Is Live:', timeline.isLive);
    console.log('   Current Phase:', timeline.currentPhase);
    console.log('   Event Status:', timeline.eventStatus);

    console.log('\n🎭 Performances:', timeline.performances?.length || 0);
    if (timeline.performances && timeline.performances.length > 0) {
      timeline.performances.forEach((perf, i) => {
        console.log(`   ${i + 1}. Order: ${perf.performanceOrder}`);
        console.log(`      Status: ${perf.status}`);
        console.log(`      Duration: ${perf.videoDuration} seconds`);
        console.log(`      Contestant: ${perf.contestant?.performanceTitle || 'NULL'}`);
        console.log(`      Contestant ID: ${perf.contestant?._id || 'NULL'}`);
        console.log(`      Video URL: ${perf.contestant?.videoUrl || 'NULL'}`);
      });
    } else {
      console.log('   ❌ NO PERFORMANCES SCHEDULED!');
      console.log('   👉 Need to call timeline.schedulePerformances()');
    }

    console.log('\n🎬 Current Performer:');
    if (timeline.currentPerformer) {
      console.log('   ✅ EXISTS');
      console.log('   Title:', timeline.currentPerformer);
    } else {
      console.log('   ❌ NULL - No current performer set!');
    }

    console.log('\n📊 Phases:', timeline.phases?.length || 0);
    timeline.phases?.forEach((phase, i) => {
      console.log(`   ${i + 1}. ${phase.name} - ${phase.status} (${phase.duration} min)`);
    });

    // Check if we need to schedule performances
    if (!timeline.performances || timeline.performances.length === 0) {
      if (contestants.length > 0) {
        console.log('\n🔧 FIXING: Scheduling performances now...');
        timeline.schedulePerformances(contestants);
        await timeline.save();
        console.log('✅ Performances scheduled!');
      } else {
        console.log('\n⚠️  Cannot schedule - no contestants yet');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

diagnose();
