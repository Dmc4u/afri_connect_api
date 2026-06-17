/**
 * Fix Phone Index - remove empty phone values and create a sparse unique index.
 *
 * Problem:
 * Some signup paths used to save phone as "", while MongoDB had a unique phone
 * index. That blocks later Google signups with duplicate key errors such as:
 *   E11000 duplicate key error index: phone_1 dup key: { phone: "" }
 *
 * Solution:
 * 1. Unset phone where it is an empty string.
 * 2. Drop old unique phone indexes.
 * 3. Create one sparse unique phone index so real phone numbers stay unique,
 *    while users without phone numbers can coexist.
 */

const mongoose = require("mongoose");
const config = require("../utils/config");

async function fixPhoneIndex() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(config.MONGO_URL);
    console.log("Connected to database");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    console.log("\nCurrent indexes on users collection:");
    const currentIndexes = await usersCollection.indexes();
    currentIndexes.forEach((index) => {
      console.log(
        `  - ${index.name}:`,
        JSON.stringify(index.key),
        index.unique ? "(unique)" : "",
        index.sparse ? "(sparse)" : "",
      );
    });

    console.log("\nRemoving empty phone values from existing users...");
    const emptyPhoneResult = await usersCollection.updateMany(
      { phone: "" },
      { $unset: { phone: "" } },
    );
    console.log(`Cleared empty phone on ${emptyPhoneResult.modifiedCount} user(s)`);

    const phoneIndexes = currentIndexes.filter(
      (idx) => idx.key.phone === 1 && idx.unique === true,
    );

    for (const phoneIndex of phoneIndexes) {
      console.log(`\nDropping old phone index: ${phoneIndex.name}...`);
      await usersCollection.dropIndex(phoneIndex.name);
      console.log("Old phone index dropped");
    }

    console.log("\nCreating sparse unique index on phone...");
    await usersCollection.createIndex(
      { phone: 1 },
      {
        unique: true,
        sparse: true,
        name: "phone_sparse_unique",
      },
    );
    console.log("Sparse unique index created successfully");

    console.log("\nUpdated indexes:");
    const updatedIndexes = await usersCollection.indexes();
    updatedIndexes.forEach((index) => {
      console.log(
        `  - ${index.name}:`,
        JSON.stringify(index.key),
        index.unique ? "(unique)" : "",
        index.sparse ? "(sparse)" : "",
      );
    });

    console.log("\nFix completed successfully");
  } catch (error) {
    console.error("\nError:", error.message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log("\nDatabase connection closed");
  }
}

fixPhoneIndex();
