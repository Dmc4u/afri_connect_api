#!/usr/bin/env node
/**
 * Production Agent Setup Script
 * Sets up the admin user as an agent in production
 */

require("dotenv").config();
const mongoose = require("mongoose");

mongoose
  .connect(process.env.MONGO_URL)
  .then(async () => {
    const User = require("./models/User.js");
    const Agent = require("./models/Agent.js");

    // Find admin user
    const admin = await User.findOne({ role: "admin" });
    if (!admin) {
      console.error("❌ No admin user found");
      process.exit(1);
    }

    console.log("Found admin:", admin.email);

    // Check if agent profile already exists
    let agent = await Agent.findOne({ userId: admin._id });

    if (!agent) {
      // Create agent profile
      agent = await Agent.create({
        userId: admin._id,
        role: "support",
        department: "customer_support",
        status: "offline",
        maxConcurrentChats: 5,
        skills: ["general", "technical", "billing"],
        languages: ["en"],
        timezone: "UTC",
        availability: {
          monday: { start: "09:00", end: "17:00", available: true },
          tuesday: { start: "09:00", end: "17:00", available: true },
          wednesday: { start: "09:00", end: "17:00", available: true },
          thursday: { start: "09:00", end: "17:00", available: true },
          friday: { start: "09:00", end: "17:00", available: true },
          saturday: { start: "09:00", end: "17:00", available: false },
          sunday: { start: "09:00", end: "17:00", available: false },
        },
      });
      console.log("✅ Created agent profile:", agent._id);
    } else {
      console.log("✅ Agent profile already exists:", agent._id);
    }

    // Update user with agent flag
    admin.isAgent = true;
    admin.agentProfile = agent._id;
    await admin.save();

    console.log("\n✅ Setup complete!");
    console.log("User ID:", admin._id);
    console.log("Agent ID:", agent._id);
    console.log("isAgent:", admin.isAgent);
    console.log("\nThe admin user can now access /agent/dashboard");

    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
