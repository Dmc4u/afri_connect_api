/**
 * Live Debug Script
 * Checks database state when signup is attempted
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");

async function liveDebug() {
  try {
    console.log("Connecting to MongoDB...");
    console.log(`MongoDB URL: ${MONGO_URL}\n`);
    await mongoose.connect(MONGO_URL);
    console.log("✅ Connected to MongoDB\n");

    const targetEmail = "support@afrionet.com";

    // Try multiple search methods
    console.log(`=== Searching for: ${targetEmail} ===\n`);

    // Method 1: Exact match
    const exact = await User.findOne({ email: targetEmail });
    console.log(`1. findOne({ email: "${targetEmail}" })`);
    console.log(`   Result: ${exact ? "FOUND ✅" : "NOT FOUND ❌"}`);
    if (exact) {
      console.log(`   ID: ${exact._id}`);
      console.log(`   Email in DB: "${exact.email}"`);
    }

    // Method 2: Case-insensitive
    const caseInsensitive = await User.findOne({
      email: { $regex: new RegExp(`^${targetEmail}$`, "i") },
    });
    console.log(`\n2. findOne({ email: /^${targetEmail}$/i })`);
    console.log(`   Result: ${caseInsensitive ? "FOUND ✅" : "NOT FOUND ❌"}`);
    if (caseInsensitive) {
      console.log(`   ID: ${caseInsensitive._id}`);
      console.log(`   Email in DB: "${caseInsensitive.email}"`);
    }

    // Method 3: Check all emails in database
    const allUsers = await User.find({}).select("_id email name role createdAt");
    console.log(`\n3. All users in database (${allUsers.length} total):`);
    allUsers.forEach((u, i) => {
      const matches = u.email.toLowerCase() === targetEmail.toLowerCase();
      console.log(`   ${i + 1}. "${u.email}" ${matches ? "⚠️ MATCHES!" : ""}`);
      console.log(`      ID: ${u._id}, Role: ${u.role}, Created: ${u.createdAt}`);
    });

    // Method 4: Check for hidden characters
    console.log(`\n4. Checking for hidden characters in target email:`);
    console.log(`   Length: ${targetEmail.length}`);
    console.log(`   Hex: ${Buffer.from(targetEmail).toString("hex")}`);
    console.log(`   Char codes: ${[...targetEmail].map((c) => c.charCodeAt(0)).join(", ")}`);

    // Method 5: Count documents with this email
    const count = await User.countDocuments({ email: targetEmail });
    console.log(`\n5. countDocuments({ email: "${targetEmail}" }): ${count}`);

    // Method 6: Check database name
    console.log(`\n6. Current database: ${mongoose.connection.db.databaseName}`);
    console.log(`   Collections: ${Object.keys(mongoose.connection.collections).join(", ")}`);

    await mongoose.disconnect();
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

liveDebug();
