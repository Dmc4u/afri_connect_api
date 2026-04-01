/**
 * Check MongoDB Indexes and Database State
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");

async function checkIndexes() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("✅ Connected\n");

    // Get all indexes on users collection
    const indexes = await User.collection.getIndexes();
    console.log("=== User Collection Indexes ===");
    Object.entries(indexes).forEach(([name, index]) => {
      console.log(`\n${name}:`);
      console.log(`  Keys: ${JSON.stringify(index.key)}`);
      if (index.unique) console.log(`  Unique: true`);
      if (index.sparse) console.log(`  Sparse: true`);
    });

    // Try to create a test user with support@afrionet.com
    console.log("\n\n=== Testing User Creation ===");
    const testEmail = "support@afrionet.com";

    try {
      const testUser = new User({
        name: "Test Admin",
        email: testEmail,
        password: "$2a$10$test",
        role: "admin",
        tier: "Pro",
        adminProvisioned: true,
        profileComplete: true,
        accountType: "business",
        settings: {
          emailNotifications: true,
          profileVisibility: true,
          phoneVisibility: false,
          twoFactorAuth: false,
        },
      });

      await testUser.validate();
      console.log("✅ Validation passed");

      //DO NOT SAVE - Just test
      console.log("✅ Would be able to save (not saving to keep DB clean)");
    } catch (err) {
      console.log("❌ Validation/Creation failed:");
      console.log(`   Error: ${err.message}`);
      console.log(`   Code: ${err.code}`);
      if (err.code === 11000) {
        console.log(`   Duplicate key: ${JSON.stringify(err.keyPattern)}`);
        console.log(`   Duplicate value: ${JSON.stringify(err.keyValue)}`);
      }
    }

    await mongoose.disconnect();
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkIndexes();
