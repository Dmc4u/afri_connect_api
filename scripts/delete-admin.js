/**
 * Delete Admin Account Script
 * Deletes support@afrionet.com account to allow fresh signup
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");

const ADMIN_EMAIL = "support@afrionet.com";

async function deleteAdminAccount() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("✅ Connected to MongoDB\n");

    // Find and delete the admin user
    console.log(`Looking for user: ${ADMIN_EMAIL}...`);
    let user = await User.findOne({ email: ADMIN_EMAIL });

    if (!user) {
      // Try case-insensitive search
      user = await User.findOne({ email: new RegExp(`^${ADMIN_EMAIL}$`, "i") });
    }

    if (!user) {
      // Search for any user with "support" in email
      const similarUsers = await User.find({ email: /support/i }).select("email name role");

      if (similarUsers.length > 0) {
        console.log("❌ Exact match not found, but found similar users:");
        similarUsers.forEach((u) => {
          console.log(`  - ${u.email} (${u.name}, role: ${u.role})`);
        });
        console.log("\nDo you want to delete one of these instead?");
      } else {
        console.log("❌ User not found! Nothing to delete.");
      }

      await mongoose.disconnect();
      return;
    }

    console.log("✅ User found!");
    console.log(`Name: ${user.name}`);
    console.log(`Email: ${user.email}`);
    console.log(`Role: ${user.role}`);
    console.log(`Tier: ${user.tier}\n`);

    console.log("Deleting user...");
    await User.deleteOne({ email: ADMIN_EMAIL });

    console.log("✅ User deleted successfully!\n");
    console.log("You can now sign up with support@afrionet.com");
    console.log("It will be automatically created as an admin account.");

    await mongoose.disconnect();
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
deleteAdminAccount();
