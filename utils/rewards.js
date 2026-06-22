const Listing = require("../models/Listing");
const RewardLedger = require("../models/RewardLedger");
const User = require("../models/User");
const { isTalentCategory } = require("./categories");

const ENGAGEMENT_POINTS = { like: 1, follow: 3 };
const ENGAGEMENT_HOLD_DAYS = { like: 7, follow: 14 };

async function actorIsEligible(actorId) {
  return Listing.exists({ owner: actorId, status: "active" });
}

async function recordEngagementReward({ listing, actorId, type, active }) {
  if (!listing?.owner || String(listing.owner) === String(actorId)) return;
  if (!(await actorIsEligible(actorId))) return;

  const sourceKey = `engagement:${type}:${listing._id}:${actorId}`;
  if (!active) {
    await RewardLedger.updateOne(
      { sourceKey, status: { $in: ["pending", "available"] } },
      { $set: { status: "reversed", reversedAt: new Date() } }
    );
    return;
  }

  const availableAt = new Date(
    Date.now() + ENGAGEMENT_HOLD_DAYS[type] * 24 * 60 * 60 * 1000
  );
  await RewardLedger.findOneAndUpdate(
    { sourceKey },
    {
      $set: {
        user: listing.owner,
        amount: ENGAGEMENT_POINTS[type],
        bucket: "engagement",
        status: "pending",
        sourceType: type,
        description: `${type === "like" ? "Like" : "Follow"} received`,
        listing: listing._id,
        actor: actorId,
        availableAt,
        reversedAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

const NON_WEBSITE_HOSTS = [
  "facebook.com", "instagram.com", "linkedin.com", "wa.me", "whatsapp.com",
  "tiktok.com", "youtube.com", "youtu.be", "x.com", "twitter.com", "linktr.ee",
];
function isIndependentWebsite(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return !NON_WEBSITE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function qualifyReferralForListing(listing) {
  const referredUser = await User.findOne({
    _id: listing.owner?._id || listing.owner,
    referredBy: { $ne: null },
    referralQualifiedAt: null,
  });
  if (!referredUser) return false;

  const qualifies = isTalentCategory(listing.category)
    ? Boolean(String(listing.website || "").trim())
    : isIndependentWebsite(listing.website);
  if (!qualifies) return false;

  const updated = await User.findOneAndUpdate(
    { _id: referredUser._id, referralQualifiedAt: null },
    { $set: { referralQualifiedAt: new Date(), referralQualifiedListing: listing._id } },
    { new: true }
  );
  if (!updated) return false;

  await RewardLedger.create({
    user: updated.referredBy,
    amount: 100,
    bucket: "referral",
    status: "pending",
    sourceType: "qualified_referral",
    sourceKey: `referral:${updated._id}`,
    description: `Qualified referral: ${updated.name}`,
    listing: listing._id,
    actor: updated._id,
    availableAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });
  return true;
}

module.exports = { recordEngagementReward, qualifyReferralForListing };
