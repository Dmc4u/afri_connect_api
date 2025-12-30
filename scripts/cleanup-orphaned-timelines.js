/**
 * Cleanup Orphaned Timelines
 * Removes timeline records that have no associated showcase
 */

const mongoose = require('mongoose');
const ShowcaseEventTimeline = require('../models/ShowcaseEventTimeline');
const TalentShowcase = require('../models/TalentShowcase');

// Load environment variables
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/afri_connect';

async function cleanupOrphanedTimelines() {
  try {
    console.log('🔌 Connecting to database...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to database\n');

    // Find all timelines
    const allTimelines = await ShowcaseEventTimeline.find({});
    console.log(`📊 Found ${allTimelines.length} total timelines\n`);

    let orphanedCount = 0;
    let validCount = 0;
    const orphanedIds = [];

    // Check each timeline
    for (const timeline of allTimelines) {
      const showcase = await TalentShowcase.findById(timeline.showcase);

      if (!showcase) {
        console.log(`⚠️  Orphaned Timeline Found:`);
        console.log(`   ID: ${timeline._id}`);
        console.log(`   Showcase ID: ${timeline.showcase}`);
        console.log(`   Status: ${timeline.eventStatus}`);
        console.log(`   Is Live: ${timeline.isLive}`);
        console.log(`   Created: ${timeline.createdAt || 'N/A'}`);
        console.log('');

        orphanedIds.push(timeline._id);
        orphanedCount++;
      } else {
        validCount++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   Valid timelines: ${validCount}`);
    console.log(`   Orphaned timelines: ${orphanedCount}`);

    if (orphanedIds.length > 0) {
      console.log(`\n🗑️  Deleting ${orphanedIds.length} orphaned timeline(s)...`);

      const result = await ShowcaseEventTimeline.deleteMany({
        _id: { $in: orphanedIds }
      });

      console.log(`✅ Deleted ${result.deletedCount} orphaned timeline(s)`);
    } else {
      console.log(`\n✨ No orphaned timelines found - database is clean!`);
    }

    console.log('\n✅ Cleanup completed successfully');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the cleanup
cleanupOrphanedTimelines();
