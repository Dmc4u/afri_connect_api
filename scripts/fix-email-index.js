/**
 * Fix MongoDB email index corruption
 * Run this script if you're getting "email already exists" errors for emails not in the database
 *
 * Usage: node scripts/fix-email-index.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const MONGODB_URI = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/afri-connect_db";

async function fixEmailIndex() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    // Get current indexes
    console.log("\n📋 Current indexes:");
    const indexes = await usersCollection.indexes();
    indexes.forEach((idx) => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });

    // Drop the email index if it exists
    try {
      console.log("\n🗑️  Dropping email_1 index...");
      await usersCollection.dropIndex("email_1");
      console.log("✅ Email index dropped");
    } catch (err) {
      if (err.code === 27) {
        console.log("⚠️  Email index does not exist (already dropped)");
      } else {
        throw err;
      }
    }

    // Recreate the email index
    console.log("\n🔨 Creating fresh email index...");
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    console.log("✅ Email index created with unique constraint");

    // Verify
    console.log("\n📋 Updated indexes:");
    const newIndexes = await usersCollection.indexes();
    newIndexes.forEach((idx) => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });

    // Test query
    console.log("\n🔍 Testing query for support@afrionet.com...");
    const testUser = await usersCollection.findOne({ email: "support@afrionet.com" });
    if (testUser) {
      console.log("✅ User found:", testUser.email);
    } else {
      console.log("✅ No user found with that email (index is clean)");
    }

    console.log("\n✅ Email index fix completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

fixEmailIndex();
