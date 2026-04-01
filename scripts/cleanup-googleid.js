/**
 * Cleanup GoogleId Null Values
 * Removes googleId field from users where it's set to null
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");

async function cleanupGoogleIds() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("✅ Connected to MongoDB\n");

    // Find all users with googleId: null
    const usersWithNullGoogleId = await User.find({ googleId: null });
    console.log(`Found ${usersWithNullGoogleId.length} users with googleId: null\n`);

    if (usersWithNullGoogleId.length === 0) {
      console.log("✅ No cleanup needed!");
      await mongoose.disconnect();
      return;
    }

    // Remove googleId field from these users
    console.log("Removing googleId: null from users...");
    const result = await User.updateMany({ googleId: null }, { $unset: { googleId: "" } });

    console.log(`✅ Updated ${result.modifiedCount} user(s)\n`);

    // Verify cleanup
    const remainingNulls = await User.find({ googleId: null });
    console.log(`Remaining users with googleId: null: ${remainingNulls.length}`);

    if (remainingNulls.length === 0) {
      console.log("✅ Cleanup successful! You can now sign up with support@afrionet.com");
    }

    await mongoose.disconnect();
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
cleanupGoogleIds();
