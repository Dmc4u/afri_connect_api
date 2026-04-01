/**
 * Admin Account Diagnostic and Fix Script
 * Checks and fixes admin account configuration
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");

const ADMIN_EMAIL = "support@afrionet.com";
const NEW_PASSWORD = "Ademola4real$"; // Default password

async function checkAndFixAdmin() {
  try {
    // Connect to MongoDB
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("✅ Connected to MongoDB\n");

    // Find the admin user - check both exact match and case-insensitive
    console.log(`Looking for user: ${ADMIN_EMAIL}...`);
    let user = await User.findOne({ email: ADMIN_EMAIL }).select("+password");

    if (!user) {
      // Try case-insensitive search
      user = await User.findOne({ email: new RegExp(`^${ADMIN_EMAIL}$`, "i") }).select("+password");
    }

    if (!user) {
      console.log("❌ User not found!");

      // Check if email exists with different casing
      const allUsers = await User.find({}).select("name email role tier password googleId");
      console.log(`\nTotal users in database: ${allUsers.length}`);

      if (allUsers.length > 0) {
        console.log("\nAll users:");
        for (const u of allUsers) {
          console.log(`\n  Email: ${u.email}`);
          console.log(`  Name: ${u.name}`);
          console.log(`  Role: ${u.role}`);
          console.log(`  Tier: ${u.tier}`);
          console.log(`  Has Password: ${!!u.password}`);
          console.log(`  Has GoogleId: ${!!u.googleId}`);
        }
      }

      const adminUsers = allUsers.filter((u) => u.role === "admin");
      console.log(`\n\nAdmin users: ${adminUsers.length}`);
      if (adminUsers.length > 0) {
        console.log("Existing admin accounts:");
        adminUsers.forEach((u) => console.log(`  - ${u.email}`));
      }

      console.log("\n\n⚠️  The support@afrionet.com account doesn't exist.");
      console.log("Since support@afrionet.com is in ADMIN_EMAILS, you can sign up");
      console.log("on the website and it will automatically be created as admin.");

      await mongoose.disconnect();
      return;
    }

    // User exists - show details
    console.log("✅ User found!\n");
    console.log("Current status:");
    console.log(`- Name: ${user.name}`);
    console.log(`- Email: ${user.email}`);
    console.log(`- Role: ${user.role}`);
    console.log(`- Tier: ${user.tier}`);
    console.log(`- Admin Provisioned: ${user.adminProvisioned}`);
    console.log(`- Profile Complete: ${user.profileComplete}`);
    console.log(`- Account Type: ${user.accountType || "not set"}`);
    console.log(`- Has Password: ${!!user.password}`);
    console.log(`- Has Google ID: ${!!user.googleId}`);
    console.log(`- 2FA Enabled: ${user.settings?.twoFactorAuth || false}\n`);

    // Check if fixes are needed
    let needsSave = false;
    const issues = [];

    if (user.role !== "admin") {
      issues.push("Role is not admin");
      user.role = "admin";
      needsSave = true;
    }

    if (user.tier !== "Pro") {
      issues.push("Tier is not Pro");
      user.tier = "Pro";
      needsSave = true;
    }

    if (!user.adminProvisioned) {
      issues.push("Not marked as admin provisioned");
      user.adminProvisioned = true;
      needsSave = true;
    }

    if (!user.password) {
      issues.push("No password set (OAuth user)");
      const hash = await bcrypt.hash(NEW_PASSWORD, 10);
      user.password = hash;
      needsSave = true;
    }

    if (user.settings?.twoFactorAuth === true) {
      issues.push("2FA is enabled (will require OTP on login)");
      console.log("⚠️  2FA is enabled. To disable it for easier testing:");
      console.log("   Run this script with --disable-2fa flag\n");
    }

    if (!user.profileComplete) {
      issues.push("Profile not complete");
      user.profileComplete = true;
      needsSave = true;
    }

    if (!user.accountType) {
      issues.push("Account type not set");
      user.accountType = "business";
      needsSave = true;
    }

    // Apply fixes
    if (issues.length === 0) {
      console.log("✅ No issues found! Account is properly configured.\n");

      if (user.password && !user.googleId) {
        console.log("You can log in with:");
        console.log(`Email: ${ADMIN_EMAIL}`);
        console.log(`Password: (your current password)`);
      } else if (user.googleId) {
        console.log("This account uses Google OAuth.");
        console.log("Use 'Continue with Google' button to log in.");
      }
    } else {
      console.log("⚠️  Issues found:");
      issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
      console.log("\nApplying fixes...");

      await user.save();
      console.log("✅ Fixed!\n");

      console.log("You can now log in with:");
      console.log(`Email: ${ADMIN_EMAIL}`);
      console.log(`Password: ${NEW_PASSWORD}`);
    }

    // Check for --disable-2fa flag
    if (process.argv.includes("--disable-2fa") && user.settings?.twoFactorAuth === true) {
      console.log("\nDisabling 2FA...");
      user.settings.twoFactorAuth = false;
      await user.save();
      console.log("✅ 2FA disabled");
    }

    await mongoose.disconnect();
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
checkAndFixAdmin();
