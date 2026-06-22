const crypto = require("crypto");
const User = require("../models/User");
const RewardLedger = require("../models/RewardLedger");
const RewardClaim = require("../models/RewardClaim");
const { BadRequestError, NotFoundError } = require("../utils/errors");

const CLAIM_COSTS = {
  featured_credit: 250,
  advertising_credit: 500,
  cash_review: 1000,
};

async function ensureReferralCode(user) {
  if (user.referralCode) return user.referralCode;
  user.referralCode = crypto.randomBytes(5).toString("hex").toUpperCase();
  await user.save();
  return user.referralCode;
}

async function matureRewards(userId) {
  await RewardLedger.updateMany(
    { user: userId, status: "pending", availableAt: { $lte: new Date() } },
    { $set: { status: "available" } }
  );
}

async function getRewardSummary(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    await ensureReferralCode(user);
    await matureRewards(user._id);

    const [totals, activity, claims, qualifiedReferrals, registeredReferrals] = await Promise.all([
      RewardLedger.aggregate([
        { $match: { user: user._id } },
        { $group: { _id: { bucket: "$bucket", status: "$status" }, points: { $sum: "$amount" } } },
      ]),
      RewardLedger.find({ user: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
      RewardClaim.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
      User.countDocuments({ referredBy: user._id, referralQualifiedAt: { $ne: null } }),
      User.countDocuments({ referredBy: user._id }),
    ]);

    const balance = { engagement: { pending: 0, available: 0 }, referral: { pending: 0, available: 0 } };
    totals.forEach((item) => {
      if (balance[item._id.bucket] && ["pending", "available"].includes(item._id.status)) {
        balance[item._id.bucket][item._id.status] = item.points;
      }
    });

    res.json({
      success: true,
      referralCode: user.referralCode,
      referralPath: `/join?ref=${user.referralCode}`,
      referrals: { registered: registeredReferrals, qualified: qualifiedReferrals, target: 10 },
      balance,
      claimCosts: CLAIM_COSTS,
      credits: user.rewardCredits || { featured: 0, advertising: 0 },
      activity,
      claims,
    });
  } catch (error) {
    next(error);
  }
}

async function createRewardClaim(req, res, next) {
  try {
    const rewardType = String(req.body.rewardType || "");
    const points = CLAIM_COSTS[rewardType];
    if (!points) throw new BadRequestError("Invalid reward type");

    await matureRewards(req.user._id);
    const bucket = rewardType === "cash_review" ? "referral" : "engagement";
    if (rewardType === "cash_review") {
      const qualified = await User.countDocuments({
        referredBy: req.user._id,
        referralQualifiedAt: { $ne: null },
      });
      if (qualified < 10) throw new BadRequestError("Ten qualified referrals are required");
    }

    const available = await RewardLedger.aggregate([
      { $match: { user: req.user._id, bucket, status: "available" } },
      { $group: { _id: null, points: { $sum: "$amount" } } },
    ]);
    const pendingClaims = await RewardClaim.aggregate([
      { $match: { user: req.user._id, status: "pending", rewardType: bucket === "referral" ? "cash_review" : { $in: ["featured_credit", "advertising_credit"] } } },
      { $group: { _id: null, points: { $sum: "$points" } } },
    ]);
    if ((available[0]?.points || 0) - (pendingClaims[0]?.points || 0) < points) {
      throw new BadRequestError(`You need ${points} available ${bucket} points`);
    }

    const claim = await RewardClaim.create({
      user: req.user._id,
      rewardType,
      points,
      note: req.body.note || "",
    });
    res.status(201).json({ success: true, claim });
  } catch (error) {
    next(error);
  }
}

async function listClaims(req, res, next) {
  try {
    const claims = await RewardClaim.find({ status: req.query.status || "pending" })
      .populate("user", "name email phone country")
      .sort({ createdAt: -1 });
    res.json({ success: true, claims });
  } catch (error) {
    next(error);
  }
}

async function reviewClaim(req, res, next) {
  try {
    const status = req.body.status;
    if (!["approved", "rejected"].includes(status)) {
      throw new BadRequestError("Status must be approved or rejected");
    }
    const claim = await RewardClaim.findById(req.params.id);
    if (!claim) throw new NotFoundError("Claim not found");
    if (claim.status !== "pending") throw new BadRequestError("Claim has already been reviewed");

    if (status === "approved") {
      const bucket = claim.rewardType === "cash_review" ? "referral" : "engagement";
      const current = await RewardLedger.aggregate([
        { $match: { user: claim.user, bucket, status: "available" } },
        { $group: { _id: null, points: { $sum: "$amount" } } },
      ]);
      if ((current[0]?.points || 0) < claim.points) {
        throw new BadRequestError("Available balance changed; reject this claim");
      }
      await RewardLedger.create({
        user: claim.user,
        amount: -claim.points,
        bucket,
        status: "available",
        sourceType: "claim_redemption",
        sourceKey: `claim:${claim._id}`,
        description: `${claim.rewardType.replaceAll("_", " ")} claimed`,
        availableAt: new Date(),
        redeemedAt: new Date(),
      });
    }

    if (status === "approved" && claim.rewardType === "featured_credit") {
      await User.updateOne({ _id: claim.user }, { $inc: { "rewardCredits.featured": 1 } });
    }
    if (status === "approved" && claim.rewardType === "advertising_credit") {
      await User.updateOne({ _id: claim.user }, { $inc: { "rewardCredits.advertising": 1 } });
    }

    claim.status = status;
    claim.reviewedBy = req.user._id;
    claim.reviewedAt = new Date();
    await claim.save();
    res.json({ success: true, claim });
  } catch (error) {
    next(error);
  }
}

module.exports = { getRewardSummary, createRewardClaim, listClaims, reviewClaim };
