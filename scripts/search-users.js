/**
 * Search All Users Script
 * Searches for all users matching an email pattern
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");

async function searchUsers() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("✅ Connected to MongoDB\n");

    // Find all users
    const allUsers = await User.find({}).select(
      "_id name email googleId phone role tier profileComplete accountType createdAt"
    );

    console.log(`Total users in database: ${allUsers.length}\n`);

    if (allUsers.length > 0) {
      console.log("All users:");
      allUsers.forEach((u, index) => {
        console.log(`\n${index + 1}. User ID: ${u._id}`);
        console.log(`   Email: ${u.email}`);
        console.log(`   Name: ${u.name}`);
        console.log(`   Role: ${u.role}`);
        console.log(`   Tier: ${u.tier}`);
        console.log(`   Profile Complete: ${u.profileComplete}`);
        console.log(`   Account Type: ${u.accountType || "not set"}`);
        console.log(`   Has GoogleId: ${!!u.googleId}`);
        console.log(`   Created: ${u.createdAt}`);
      });
    }

    // Now search specifically for support@afrionet.com with various methods
    console.log("\n\n=== Specific Search for support@afrionet.com ===");

    const exact = await User.findOne({ email: "support@afrionet.com" });
    console.log(`Exact match: ${exact ? "FOUND" : "NOT FOUND"}`);
    if (exact) {
      console.log(`  ID: ${exact._id}`);
      console.log(`  Email: ${exact.email}`);
    }

    const caseInsensitive = await User.findOne({ email: /^support@afrionet\.com$/i });
    console.log(`Case-insensitive match: ${caseInsensitive ? "FOUND" : "NOT FOUND"}`);
    if (caseInsensitive) {
      console.log(`  ID: ${caseInsensitive._id}`);
      console.log(`  Email: ${caseInsensitive.email}`);
    }

    const contains = await User.find({ email: /support/i });
    console.log(`Contains "support": ${contains.length} found`);
    contains.forEach((u) => {
      console.log(`  - ${u.email} (${u.name})`);
    });

    await mongoose.disconnect();
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
searchUsers();
