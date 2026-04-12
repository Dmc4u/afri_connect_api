/**
 * Fix Phone Index - Remove unique constraint and create sparse unique index
 *
 * Problem: Users doing quick signup (email/password only) are getting
 * "An account with this phone number already exists" error because
 * MongoDB has a unique index on phone field.
 *
 * When multiple users have phone: null/undefined, the unique index fails.
 *
 * Solution: Drop the existing unique index and create a SPARSE unique index
 * that only applies to documents where phone exists.
 */

const mongoose = require("mongoose");
const config = require("../utils/config");

async function fixPhoneIndex() {
  try {
    console.log("🔍 Connecting to MongoDB...");
    await mongoose.connect(config.MONGO_URL);
    console.log("✅ Connected to database");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    console.log("\n📋 Current indexes on users collection:");
    const currentIndexes = await usersCollection.indexes();
    currentIndexes.forEach((index) => {
      console.log(
        `  - ${index.name}:`,
        JSON.stringify(index.key),
        index.unique ? "(unique)" : "",
        index.sparse ? "(sparse)" : ""
      );
    });

    // Check if phone has a unique index
    const phoneIndex = currentIndexes.find(
      (idx) => idx.key.phone === 1 && idx.unique === true && !idx.sparse
    );

    if (phoneIndex) {
      console.log(`\n⚠️  Found problematic phone index: ${phoneIndex.name}`);
      console.log("   This index causes errors when multiple users have no phone number");

      console.log(`\n🗑️  Dropping index: ${phoneIndex.name}...`);
      await usersCollection.dropIndex(phoneIndex.name);
      console.log("✅ Old index dropped successfully");
    } else {
      console.log("\n✓ No problematic phone index found");
    }

    // Create sparse unique index on phone
    console.log("\n🔨 Creating SPARSE unique index on phone...");
    await usersCollection.createIndex(
      { phone: 1 },
      {
        unique: true,
        sparse: true, // Only enforce uniqueness for documents that have a phone value
        name: "phone_sparse_unique",
      }
    );
    console.log("✅ Sparse unique index created successfully");

    console.log("\n📋 Updated indexes:");
    const updatedIndexes = await usersCollection.indexes();
    updatedIndexes.forEach((index) => {
      console.log(
        `  - ${index.name}:`,
        JSON.stringify(index.key),
        index.unique ? "(unique)" : "",
        index.sparse ? "(sparse)" : ""
      );
    });

    console.log("\n✅ Fix completed successfully!");
    console.log("\nℹ️  What changed:");
    console.log("   - Old: Unique index on phone (failed when multiple users had no phone)");
    console.log(
      "   - New: SPARSE unique index (only checks uniqueness for users WITH phone numbers)"
    );
    console.log("\n✅ Users can now sign up without phone numbers!");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("\n🔌 Database connection closed");
    process.exit(0);
  }
}

fixPhoneIndex();
