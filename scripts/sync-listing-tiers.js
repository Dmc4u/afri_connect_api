/**
 * Migration Script: Sync User Tiers to All Listings
 *
 * This script synchronizes the tier from User model to all Listing models owned by each user.
 * Run this ONCE after deploying the tier sync fixes to update existing data.
 *
 * Usage:
 *   cd afri_connect_api
 *   node scripts/sync-listing-tiers.js
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const Listing = require("../models/Listing");

async function syncListingTiers() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/afrionet";
    console.log("📡 Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB\n");

    // Get all users
    const users = await User.find({}).select("_id email tier");
    console.log(`📊 Found ${users.length} users\n`);

    let totalUpdated = 0;
    let totalProcessed = 0;
    const tierCounts = { Free: 0, Starter: 0, Premium: 0, Pro: 0 };

    // Process each user
    for (const user of users) {
      const userTier = user.tier || "Free";

      // Update all listings owned by this user
      const result = await Listing.updateMany({ owner: user._id }, { $set: { tier: userTier } });

      if (result.modifiedCount > 0) {
        console.log(
          `✅ User: ${user.email.padEnd(35)} | Tier: ${userTier.padEnd(10)} | Updated ${result.modifiedCount} listing(s)`
        );
        totalUpdated += result.modifiedCount;
        tierCounts[userTier] = (tierCounts[userTier] || 0) + result.modifiedCount;
      } else {
        // Count users with no listings that needed updates
        const listingCount = await Listing.countDocuments({ owner: user._id });
        if (listingCount === 0) {
          console.log(
            `ℹ️  User: ${user.email.padEnd(35)} | Tier: ${userTier.padEnd(10)} | No listings`
          );
        } else {
          console.log(
            `✓  User: ${user.email.padEnd(35)} | Tier: ${userTier.padEnd(10)} | Already synced (${listingCount} listing(s))`
          );
        }
      }

      totalProcessed++;
    }

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("📈 Migration Summary");
    console.log("=".repeat(80));
    console.log(`Total users processed:     ${totalProcessed}`);
    console.log(`Total listings updated:    ${totalUpdated}`);
    console.log("\nListings by tier:");
    console.log(`  🆓 Free:                 ${tierCounts.Free || 0}`);
    console.log(`  ⭐ Starter:              ${tierCounts.Starter || 0}`);
    console.log(`  💎 Premium:              ${tierCounts.Premium || 0}`);
    console.log(`  👑 Pro:                  ${tierCounts.Pro || 0}`);
    console.log("=".repeat(80));
    console.log("\n🎉 Migration completed successfully!");

    // Close connection
    await mongoose.connection.close();
    console.log("📡 MongoDB connection closed\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error during migration:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the migration
console.log("🚀 Starting Listing Tier Sync Migration...\n");
syncListingTiers();
