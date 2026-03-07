const User = require("../models/User");
const Payment = require("../models/Payment");
const { isAdminEmail } = require("./adminCheck");

const isLegacyAutoAdminTierUser = (user) => {
  if (!user) return false;

  return (
    user.tier === "Pro" &&
    user.adminProvisioned !== true &&
    !user.tierExpiresAt &&
    !user.subscriptionId &&
    !user.subscriptionStatus
  );
};

const syncAdminProvisioning = (user) => {
  const expectedRole = isAdminEmail(user.email) ? "admin" : "user";

  if (expectedRole === "admin") {
    user.role = "admin";
    if (user.tier === "Free" || user.adminProvisioned === true) {
      user.tier = "Pro";
    }
    user.adminProvisioned = true;
    return expectedRole;
  }

  if (user.adminProvisioned === true || isLegacyAutoAdminTierUser(user)) {
    user.role = "user";
    if (user.tier === "Pro") {
      user.tier = "Free";
    }
    user.adminProvisioned = false;
    return expectedRole;
  }

  user.role = "user";
  return expectedRole;
};

const bulkCorrectLegacyAutoProUsers = async () => {
  const paidProUserIds = await Payment.distinct("user", {
    status: "completed",
    "tierUpgrade.to": "Pro",
  });

  const candidates = await User.find({
    tier: "Pro",
    adminProvisioned: { $exists: false },
    tierExpiresAt: null,
    subscriptionId: null,
    subscriptionStatus: null,
    _id: { $nin: paidProUserIds },
  }).select("email tier role adminProvisioned tierExpiresAt subscriptionId subscriptionStatus");

  let correctedCount = 0;

  for (const user of candidates) {
    if (isAdminEmail(user.email)) {
      if (user.role !== "admin" || user.adminProvisioned !== true) {
        user.role = "admin";
        user.adminProvisioned = true;
        await user.save();
      }
      continue;
    }

    if (!isLegacyAutoAdminTierUser(user)) {
      continue;
    }

    user.role = "user";
    user.tier = "Free";
    user.adminProvisioned = false;
    await user.save();
    correctedCount += 1;
  }

  return correctedCount;
};

module.exports = {
  isLegacyAutoAdminTierUser,
  syncAdminProvisioning,
  bulkCorrectLegacyAutoProUsers,
};
