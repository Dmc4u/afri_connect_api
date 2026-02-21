/**
 * Fix Showcase Duration Values Script
 * This script updates existing showcases that have missing or incorrect phase duration values
 * Run with: node scripts/fixShowcaseDurations.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const TalentShowcase = require("../models/TalentShowcase");
const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");

async function fixShowcaseDurations() {
  try {
    console.log("🔧 Starting showcase duration fix...");

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/afriOnet");
    console.log("✅ Connected to database");

    // Find all showcases
    const showcases = await TalentShowcase.find({});
    console.log(`📊 Found ${showcases.length} showcases`);

    let updatedCount = 0;
    let timelineUpdatedCount = 0;

    for (const showcase of showcases) {
      let needsUpdate = false;
      const updates = {};

      // Check and fix each duration field
      if (showcase.welcomeDuration === undefined || showcase.welcomeDuration === null) {
        updates.welcomeDuration = 5; // Default from model
        needsUpdate = true;
      }

      if (showcase.votingDisplayDuration === undefined || showcase.votingDisplayDuration === null) {
        updates.votingDisplayDuration = 10; // Default from model
        needsUpdate = true;
      }

      if (showcase.winnerDisplayDuration === undefined || showcase.winnerDisplayDuration === null) {
        updates.winnerDisplayDuration = 5; // Default from model
        needsUpdate = true;
      }

      if (showcase.thankYouDuration === undefined || showcase.thankYouDuration === null) {
        updates.thankYouDuration = 2; // Default from model
        needsUpdate = true;
      }

      if (showcase.commercialDuration === undefined || showcase.commercialDuration === null) {
        updates.commercialDuration = 2; // Default from model
        needsUpdate = true;
      }

      if (showcase.performanceDuration === undefined || showcase.performanceDuration === null) {
        updates.performanceDuration = 5; // Default from model
        needsUpdate = true;
      }

      if (needsUpdate) {
        await TalentShowcase.findByIdAndUpdate(showcase._id, updates);
        console.log(`✅ Updated showcase: ${showcase.title}`);
        console.log(`   Updates: ${JSON.stringify(updates, null, 2)}`);
        updatedCount++;

        // Also update the timeline if it exists
        const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });
        if (timeline) {
          let timelineNeedsUpdate = false;
          const timelineUpdates = {};

          // Update timeline config to match showcase
          if (
            updates.welcomeDuration !== undefined &&
            timeline.config.welcomeDuration !== updates.welcomeDuration
          ) {
            timeline.config.welcomeDuration = updates.welcomeDuration;
            timelineNeedsUpdate = true;
          }

          if (
            updates.votingDisplayDuration !== undefined &&
            timeline.config.votingDuration !== updates.votingDisplayDuration
          ) {
            timeline.config.votingDuration = updates.votingDisplayDuration;
            timelineNeedsUpdate = true;
          }

          if (
            updates.winnerDisplayDuration !== undefined &&
            timeline.config.winnerDeclarationDuration !== updates.winnerDisplayDuration
          ) {
            timeline.config.winnerDeclarationDuration = updates.winnerDisplayDuration;
            timelineNeedsUpdate = true;
          }

          if (
            updates.thankYouDuration !== undefined &&
            timeline.config.thankYouDuration !== updates.thankYouDuration
          ) {
            timeline.config.thankYouDuration = updates.thankYouDuration;
            timelineNeedsUpdate = true;
          }

          if (
            updates.commercialDuration !== undefined &&
            timeline.config.commercialDuration !== updates.commercialDuration
          ) {
            timeline.config.commercialDuration = updates.commercialDuration;
            timelineNeedsUpdate = true;
          }

          if (timelineNeedsUpdate) {
            // Regenerate timeline with new durations
            timeline.showcase = showcase; // Ensure showcase reference is available
            timeline.generateTimeline();
            await timeline.save();
            console.log(`   ✅ Timeline config updated and regenerated`);
            timelineUpdatedCount++;
          }
        }
      }
    }

    console.log(`\n🎉 Showcase duration fix complete!`);
    console.log(`   Showcases updated: ${updatedCount}`);
    console.log(`   Timelines updated: ${timelineUpdatedCount}`);

    await mongoose.connection.close();
    console.log("✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error fixing showcase durations:", error);
    process.exit(1);
  }
}

// Run the fix
fixShowcaseDurations();
