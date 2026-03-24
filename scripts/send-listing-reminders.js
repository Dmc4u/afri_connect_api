#!/usr/bin/env node

/**
 * Script to send reminder emails to users who completed onboarding
 * but haven't created any business or talent listings.
 *
 * Usage:
 *   node scripts/send-listing-reminders.js [--dry-run] [--days=7]
 *
 * Options:
 *   --dry-run     Only show which users would be emailed (no emails sent)
 *   --days=N      Only remind users who registered N or more days ago (default: 7)
 *   --limit=N     Limit the number of emails to send (default: unlimited)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { sendReminderToCreateListing } = require("../utils/notifications");

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const daysArg = args.find((arg) => arg.startsWith("--days="));
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const minDaysOld = daysArg ? parseInt(daysArg.split("=")[1]) : 7;
const emailLimit = limitArg ? parseInt(limitArg.split("=")[1]) : null;

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

async function sendReminders() {
  try {
    console.log("\n🔍 Finding users to remind...\n");

    // Calculate cutoff date (users registered at least N days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minDaysOld);

    // Find users who:
    // 1. Registered at least N days ago
    // 2. Have no business listings
    // 3. Have no talent listings
    // 4. Have email notifications enabled (or not explicitly disabled)
    const users = await User.aggregate([
      {
        $match: {
          createdAt: { $lte: cutoffDate },
          "settings.emailNotifications": { $ne: false }, // Include users with enabled or undefined
        },
      },
      {
        $lookup: {
          from: "businesses",
          localField: "_id",
          foreignField: "user",
          as: "businesses",
        },
      },
      {
        $lookup: {
          from: "talents",
          localField: "_id",
          foreignField: "user",
          as: "talents",
        },
      },
      {
        $match: {
          $and: [
            { $or: [{ businesses: { $exists: false } }, { businesses: { $size: 0 } }] },
            { $or: [{ talents: { $exists: false } }, { talents: { $size: 0 } }] },
          ],
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          createdAt: 1,
          settings: 1,
        },
      },
      ...(emailLimit ? [{ $limit: emailLimit }] : []),
    ]);

    if (users.length === 0) {
      console.log("✅ No users found matching the criteria.");
      await mongoose.connection.close();
      return;
    }

    console.log(`📊 Found ${users.length} user(s) who need reminders:`);
    console.log(`   - Registered at least ${minDaysOld} days ago`);
    console.log(`   - No business or talent listings created`);
    console.log(`   - Email notifications enabled\n`);

    if (isDryRun) {
      console.log("🔍 DRY RUN MODE - No emails will be sent\n");
      console.log("Users who would receive reminders:");
      users.forEach((user, index) => {
        const daysAgo = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
        console.log(
          `  ${index + 1}. ${user.name} (${user.email}) - Registered ${daysAgo} days ago`
        );
      });
      console.log(`\n📧 ${users.length} emails would be sent.`);
    } else {
      console.log("📧 Sending reminder emails...\n");

      let successCount = 0;
      let failureCount = 0;
      let skippedCount = 0;

      for (const user of users) {
        const daysAgo = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
        process.stdout.write(`  Sending to ${user.name} (${user.email}) - ${daysAgo} days ago... `);

        try {
          const result = await sendReminderToCreateListing(user);

          if (result.skipped) {
            console.log(`⏭️  Skipped (${result.reason})`);
            skippedCount++;
          } else if (result.success) {
            console.log("✅ Sent");
            successCount++;
          } else {
            console.log(`❌ Failed: ${result.error}`);
            failureCount++;
          }

          // Add small delay to avoid overwhelming SMTP server
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.log(`❌ Error: ${error.message}`);
          failureCount++;
        }
      }

      console.log("\n" + "=".repeat(50));
      console.log("📊 Summary:");
      console.log(`   ✅ Sent successfully: ${successCount}`);
      console.log(`   ⏭️  Skipped: ${skippedCount}`);
      console.log(`   ❌ Failed: ${failureCount}`);
      console.log(`   📧 Total: ${users.length}`);
      console.log("=".repeat(50) + "\n");
    }

    await mongoose.connection.close();
    console.log("✅ Script completed successfully\n");
  } catch (error) {
    console.error("\n❌ Error running script:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
sendReminders();
