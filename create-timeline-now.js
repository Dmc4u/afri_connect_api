require('dotenv').config();
const mongoose = require('mongoose');
const ShowcaseEventTimeline = require('./models/ShowcaseEventTimeline');
const TalentContestant = require('./models/TalentContestant');
const TalentShowcase = require('./models/TalentShowcase');

async function createTimeline() {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const showcaseId = '6956ad17a9d6a8a6d6868799';

    const showcase = await TalentShowcase.findById(showcaseId);
    console.log('📌 Showcase found:', showcase.title);

    const contestants = await TalentContestant.find({
      showcase: showcaseId,
      status: 'selected'
    }).sort({ rafflePosition: 1 });

    console.log('👥 Contestants:', contestants.length);
    contestants.forEach((c, i) => {
      console.log(`   ${i+1}. ${c.performanceTitle} - ${c.videoDuration}s`);
    });

    const timeline = new ShowcaseEventTimeline({
      showcase: showcaseId,
      config: {
        welcomeDuration: showcase.welcomeDuration || 1,
        performanceSlotDuration: showcase.performanceDuration || 5,
        commercialDuration: showcase.commercialDuration || 1,
        votingDuration: showcase.votingDisplayDuration || 2,
        winnerDeclarationDuration: showcase.winnerDisplayDuration || 1,
        thankYouDuration: showcase.thankYouDuration || 2
      },
      welcomeMessage: {
        title: showcase.welcomeMessage || 'Welcome!',
        message: showcase.rulesMessage || 'Get ready!',
        rules: showcase.rulesMessage ? showcase.rulesMessage.split('\n') : []
      },
      thankYouMessage: {
        title: 'Thank You!',
        message: showcase.thankYouMessage || 'Thank you!',
        nextEventDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    console.log('🏗️  Generating timeline phases...');
    timeline.generateTimeline();

    // Set the event start time before scheduling performances
    const eventStartTime = new Date(showcase.eventDate);
    timeline.actualStartTime = eventStartTime;

    // Initialize phase start times BEFORE scheduling performances
    let currentTime = new Date(eventStartTime);
    timeline.phases.forEach((phase, index) => {
      phase.startTime = new Date(currentTime);
      phase.endTime = new Date(currentTime.getTime() + phase.duration * 60000);
      currentTime = new Date(phase.endTime);
      phase.status = index === 0 ? 'active' : 'pending';
    });

    console.log('🎬 Scheduling performances...');
    timeline.schedulePerformances(contestants);
    console.log(`✅ Scheduled ${timeline.performances.length} performances`);

    console.log('🎬 Starting event...');
    timeline.isLive = true;
    timeline.currentPhase = 'welcome';
    timeline.eventStatus = 'live';

    await timeline.save();
    console.log('✅ Timeline created successfully!');
    console.log('📊 Performances:', timeline.performances.length);
    console.log('📊 Phases:', timeline.phases.map(p => `${p.name}:${p.status}`).join(', '));

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createTimeline();
