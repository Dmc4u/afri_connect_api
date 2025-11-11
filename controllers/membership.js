const User = require("../models/User");
const Payment = require("../models/Payment");
const PaypalTransaction = require("../models/PaypalTransaction");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");
const { createOrder, captureOrder, getOrder } = require("../utils/paypal");
const PaymentModel = require('../models/Payment');
const { NODE_ENV } = require("../utils/config");
const { logActivity } = require("../utils/activityLogger");

// Get membership tiers (public)
const getMembershipTiers = async (req, res, next) => {
  try {
    const tiers = [
      {
        name: "Free",
        price: 0,
        currency: "USD",
        interval: "forever",
        features: [
          "Browse business listings",
          "Basic profile creation",
          "Community forum access",
          "Basic search functionality",
          "Email support (48hr response)",
          "Upgrade anytime to create listings",
        ],
        limits: {
          listings: 0,
          mediaPerListing: 0,
          profileImages: 1,
          forumAccess: true,
          apiAccess: false,
          analytics: false,
        },
      },
      {
        name: "Starter",
        price: 1.0,
        currency: "USD",
        interval: "month",
        features: [
          "Up to 5 business listings",
          "Enhanced profile with logo",
          "Photo gallery (up to 5 images)",
          "Social media links",
          "Priority search placement",
          "Email support (24hr response)",
          "Basic analytics dashboard",
        ],
        limits: {
          listings: 5,
          mediaPerListing: 5,
          profileImages: 3,
          forumAccess: true,
          apiAccess: false,
          analytics: true,
        },
      },
      {
        name: "Premium",
        price: 7.0,
        currency: "USD",
        interval: "month",
        features: [
          "Unlimited business listings",
          "Premium profile with media",
          "Photo & video gallery (unlimited)",
          "Featured badge on listings",
          "Top search results placement",
          "Advanced analytics & insights",
          "Social media integration",
          "Priority support (12hr response)",
          "Monthly performance reports",
          "Remove AfriOnet branding",
        ],
        limits: {
          listings: -1,
          mediaPerListing: 25,
          profileImages: 5,
          forumAccess: true,
          apiAccess: true,
          analytics: true,
          featured: true,
          removeAfriBranding: true,
        },
        popular: true,
      },
      {
        name: "Pro",
        price: 20.0,
        currency: "USD",
        interval: "month",
        features: [
          "Everything in Premium",
          "Top-tier featured placement",
          "Verified business badge",
          "API access for integrations",
          "Advanced advertising tools",
          "Custom business page design",
          "Lead generation tools",
          "Dedicated account manager",
          "Priority 24/7 support",
          "Quarterly business strategy calls",
          "Featured in newsletters",
          "Cross-platform promotion",
        ],
        limits: {
          listings: -1,
          mediaPerListing: 25,
          profileImages: 10,
          forumAccess: true,
          apiAccess: true,
          analytics: true,
          featured: true,
          removeAfriBranding: true,
          verified: true,
          dedicatedManager: true,
          prioritySupport: true,
          leadGeneration: true,
        },
      },
    ];

    res.json({
      success: true,
      tiers,
    });
  } catch (error) {
    next(error);
  }
};

// Get user's current membership (protected)
const getCurrentMembership = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select("tier tierExpiresAt payments")
      .populate({
        path: "payments",
        match: { status: "completed" },
        options: { sort: { createdAt: -1 }, limit: 5 },
      });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Get active subscription
    const activePayment = await Payment.findOne({
      user: req.user._id,
      status: "completed",
      type: "subscription",
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      membership: {
        currentTier: user.tier || "Free",
        expiresAt: user.tierExpiresAt,
        isActive: user.tierExpiresAt ? user.tierExpiresAt > new Date() : user.tier === "Free",
        activeSubscription: activePayment,
        recentPayments: user.payments,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Upgrade membership (protected)
const upgradeMembership = async (req, res, next) => {
  try {
    const { tier, paymentMethod } = req.body;

    const validTiers = ["Starter", "Premium", "Pro"];
    if (!validTiers.includes(tier)) {
      throw new BadRequestError("Invalid tier selected");
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Admin bypass: Allow admins to upgrade/downgrade without restrictions
    if (user.role === "admin") {
      user.tier = tier;
      user.tierExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year for admin
      await user.save();

      return res.json({
        success: true,
        message: "Admin bypass: Membership updated successfully",
        membership: {
          tier: user.tier,
          expiresAt: user.tierExpiresAt,
        },
      });
    }

    // Check if user is already on this tier or higher
    const tierHierarchy = { Free: 0, Starter: 1, Premium: 2, Pro: 3 };
    const currentTierLevel = tierHierarchy[user.tier] || 0;
    const requestedTierLevel = tierHierarchy[tier];

    console.log(
      `[Membership] User ${user._id} current tier: ${user.tier} (level ${currentTierLevel}), requested: ${tier} (level ${requestedTierLevel})`
    );

    // Allow upgrades to higher tiers only
    // Note: Users cannot downgrade; if they need to switch to a lower tier, they should contact support
    if (currentTierLevel > requestedTierLevel) {
      console.log(
        `[Membership] Downgrade attempt blocked: ${currentTierLevel} > ${requestedTierLevel}`
      );
      throw new BadRequestError(
        "You cannot downgrade your membership tier. Please contact support for downgrades."
      );
    }

    // Check if already on exact tier
    if (currentTierLevel === requestedTierLevel) {
      console.log(`[Membership] Same tier selected: ${tier}`);
      throw new BadRequestError(`You are already on the ${tier} tier`);
    }

    // Authoritative tier pricing (do NOT trust any client-supplied amount)
    const tierPricing = {
      Starter: { price: 1.0, currency: "USD" },
      Premium: { price: 7.0, currency: "USD" },
      Pro: { price: 20.0, currency: "USD" },
    };
    const pricing = tierPricing[tier];
    if (!pricing) throw new BadRequestError("Pricing unavailable for requested tier");

    // Anti‑tampering: ensure user cannot call upgrade repeatedly within a short window to spam orders
    const recentPending = await Payment.find({
      user: req.user._id,
      status: "pending",
      "tierUpgrade.to": tier,
      createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) } // last 5 minutes
    }).countDocuments();
    if (recentPending > 2) {
      throw new BadRequestError("Too many pending upgrade attempts. Please wait a few minutes.");
    }

    // Create PayPal order for membership upgrade
    console.log(`Creating PayPal order for ${tier} tier - Amount: $${pricing.price}`);
  // Create PayPal order using authoritative server price only
  const order = await createOrder(pricing.price, `membership-${tier}`, pricing.currency, req.user._id);

    if (!order?.id) {
      throw new BadRequestError("Failed to create PayPal order");
    }

    console.log(`✅ PayPal order created: ${order.id}`);

    // Create payment record
    const integrityHash = PaymentModel.computeIntegrityHash({
      userId: String(req.user._id),
      tierTo: tier,
      priceValue: pricing.price,
      currency: pricing.currency,
      duration: 'monthly'
    });

    const payment = await Payment.create({
      user: req.user._id,
      orderId: order.id,
      paypalOrderId: order.id,
      amount: {
        value: pricing.price,
        currency: pricing.currency,
      },
      tierUpgrade: {
        from: user.tier,
        to: tier,
        duration: "monthly",
      },
      integrityHash,
      paymentMethod: "paypal",
      status: "pending",
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || '',
        referrer: req.get('referer') || null,
        discount: 0
      }
    });

    // Log PayPal transaction
    await PaypalTransaction.create({
      orderId: order.id,
      status: "PENDING",
      tier: tier,
      amount: pricing.price,
      currency: "USD",
      transaction_details: order,
    });

    res.status(201).json({
      success: true,
      message: "PayPal order created",
      orderId: order.id,
      payment: {
        id: payment._id,
        amount: payment.amount,
        currency: payment.currency,
        tier: payment.tier,
        status: payment.status,
      },
    });
  } catch (error) {
    console.error("❌ Membership upgrade error:", error);
    next(error);
  }
};

// Capture membership payment (complete PayPal transaction)
const captureMembershipPayment = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      throw new BadRequestError("Order ID is required");
    }

    // Find payment record
    // Idempotency guard: acquire capturing lock
    let payment = await Payment.findOneAndUpdate(
      { user: req.user._id, orderId, status: { $in: ['pending','failed'] }, capturing: { $ne: true } },
      { $set: { capturing: true } },
      { new: true }
    );
    if (!payment) {
      // If already completed, return early; else block duplicates
      const existing = await Payment.findOne({ user: req.user._id, orderId });
      if (existing?.status === 'completed') {
        return res.json({ success: true, message: 'Payment already completed', membership: { tier: (await User.findById(req.user._id)).tier } });
      }
      throw new BadRequestError('Payment is being processed or not found');
    }

    if (!payment) {
      throw new NotFoundError("Payment record not found");
    }

    if (payment.status === "completed") {
      throw new BadRequestError("Payment already completed");
    }

    // Verify payment integrity hash before any remote calls
    const expectedHash = PaymentModel.computeIntegrityHash({
      userId: String(req.user._id),
      tierTo: payment.tierUpgrade.to,
      priceValue: payment.amount.value,
      currency: payment.amount.currency,
      duration: payment.tierUpgrade.duration
    });
    if (payment.integrityHash && payment.integrityHash !== expectedHash) {
      payment.capturing = false;
      await payment.save();
      throw new BadRequestError('Integrity verification failed');
    }

    // Optional pre-check: ensure order is APPROVED and matches expected amount before capture
    try {
      const order = await getOrder(orderId);
      const unit = order?.purchase_units?.[0];
      const expected = payment.amount.value;
      const orderAmount = parseFloat(unit?.amount?.value || '0');
      if (orderAmount && Math.abs(orderAmount - expected) > 0.01) {
        console.warn('[Membership] Order amount mismatch pre-capture', orderAmount, expected);
        throw new BadRequestError('Invalid order amount.');
      }
      if (order?.status && !['APPROVED','COMPLETED'].includes(order.status)) {
        throw new BadRequestError('Order not approved.');
      }
    } catch (preErr) {
      payment.capturing = false;
      await payment.save();
      return next(preErr);
    }

    // Capture PayPal order (server authoritative)
    const capture = await captureOrder(orderId);

    // Basic integrity check: ensure returned purchase unit amount matches expected
    const purchaseUnit = capture?.purchase_units?.[0];
    const returnedValue = parseFloat(purchaseUnit?.amount?.value || purchaseUnit?.payments?.captures?.[0]?.amount?.value || '0');
    if (returnedValue && Math.abs(returnedValue - payment.amount.value) > 0.01) {
      console.warn('[Membership] Mismatch between expected amount and PayPal capture', returnedValue, payment.amount.value);
      payment.status = 'failed';
      payment.capturing = false;
      await payment.save();
      throw new BadRequestError('Payment amount mismatch. Please contact support.');
    }

    // Update payment status
    payment.status = "completed";
    payment.paymentDetails = {
      transactionId: capture.id,
    };
  payment.capturing = false;
  await payment.save();

    // Update user tier
    const user = await User.findById(req.user._id);
    user.tier = payment.tierUpgrade.to;
    // Set tier expiration (30 days) only if higher than existing expiry or user was Free
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (!user.tierExpiresAt || user.tierExpiresAt < newExpiry) {
      user.tierExpiresAt = newExpiry;
    }
    await user.save();

    // Update PayPal transaction
  const payer = capture?.payer || {};
    await PaypalTransaction.findOneAndUpdate(
      { orderId },
      {
        status: "COMPLETED",
        payerEmail: payer.email_address,
        payerId: payer.payer_id,
        transaction_details: capture,
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: "Membership upgraded successfully",
      membership: {
        tier: user.tier,
        expiresAt: user.tierExpiresAt,
        payment: {
          id: payment._id,
          amount: payment.amount,
          status: payment.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Cancel membership (protected)
const cancelMembership = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.tier === "Free") {
      throw new BadRequestError("You are already on the free tier");
    }

    // Find active subscription
    const activePayment = await Payment.findOne({
      user: req.user._id,
      status: "completed",
      type: "subscription",
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!activePayment) {
      throw new NotFoundError("No active subscription found");
    }

    // Mark subscription as cancelled (but let it expire naturally)
    activePayment.status = "cancelled";
    activePayment.cancelledAt = new Date();
    await activePayment.save();

    res.json({
      success: true,
      message: "Membership cancelled successfully. Access will continue until expiration date.",
      expiresAt: user.tierExpiresAt,
    });
  } catch (error) {
    next(error);
  }
};

// Get membership benefits (public)
const getMembershipBenefits = async (req, res, next) => {
  try {
    const { tier } = req.params;

    const benefits = {
      Free: {
        listings: {
          count: 0,
          mediaPerListing: 0,
          featured: false,
        },
        profile: {
          images: 1,
          customization: "basic",
        },
        support: "standard",
        forum: false,
        api: false,
        analytics: false,
      },
      Starter: {
        listings: {
          count: 5,
          mediaPerListing: 5,
          featured: false,
        },
        profile: {
          images: 3,
          customization: "enhanced",
        },
        support: "email",
        forum: false,
        api: false,
        analytics: "basic",
      },
      Premium: {
        listings: {
          count: 5,
          mediaPerListing: 10,
          featured: true,
        },
        profile: {
          images: 5,
          customization: "enhanced",
        },
        support: "priority",
        forum: true,
        api: true,
        analytics: "basic",
      },
      Pro: {
        listings: {
          count: -1, // Unlimited
          mediaPerListing: 25,
          featured: true,
          priority: true,
        },
        profile: {
          images: 10,
          customization: "premium",
          branding: true,
        },
        support: "dedicated",
        forum: true,
        api: true,
        analytics: "advanced",
      },
    };

    const tierBenefits = benefits[tier];

    if (!tierBenefits) {
      throw new BadRequestError("Invalid tier specified");
    }

    res.json({
      success: true,
      tier,
      benefits: tierBenefits,
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all membership statistics (admin only)
const getMembershipStats = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      throw new ForbiddenError("Admin access required");
    }

    // Get user distribution by tier
    const tierDistribution = await User.aggregate([
      {
        $group: {
          _id: "$tier",
          count: { $sum: 1 },
          activeUsers: {
            $sum: {
              $cond: [{ $eq: ["$status", "active"] }, 1, 0],
            },
          },
        },
      },
    ]);

    // Get revenue statistics
    const revenueStats = await Payment.aggregate([
      {
        $match: {
          status: "completed",
          type: "subscription",
        },
      },
      {
        $group: {
          _id: {
            tier: "$tier",
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
          },
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.tier",
          totalRevenue: { $sum: "$revenue" },
          totalSubscriptions: { $sum: "$count" },
          monthlyData: {
            $push: {
              month: "$_id.month",
              year: "$_id.year",
              revenue: "$revenue",
              count: "$count",
            },
          },
        },
      },
    ]);

    // Get recent membership changes
    const recentChanges = await Payment.find({
      status: { $in: ["completed", "cancelled"] },
      type: "subscription",
    })
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      stats: {
        tierDistribution,
        revenue: revenueStats,
        recentChanges,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Set a user's membership tier (upgrade authorization or downgrade)
const adminSetUserTier = async (req, res, next) => {
  try {
    // Only admins can perform this action
    if (!req.user || req.user.role !== "admin") {
      throw new ForbiddenError("Admin access required");
    }

    const { userId, tier, reason } = req.body;

    const validTiers = ["Free", "Starter", "Premium", "Pro"];
    if (!userId || !tier || !validTiers.includes(tier)) {
      throw new BadRequestError("userId and a valid tier are required");
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      throw new NotFoundError("Target user not found");
    }

    const previousTier = targetUser.tier || "Free";
    targetUser.tier = tier;
    await targetUser.save();

    // Optional: mark any active subscription as cancelled when downgrading to Free
    if (previousTier !== "Free" && tier === "Free") {
      try {
        await Payment.updateMany(
          { user: targetUser._id, isActive: true, status: "completed" },
          {
            $set: { isActive: false, status: "cancelled" },
            $push: {
              auditLog: {
                action: "cancelled",
                details: { by: "admin", reason: reason || "downgrade" },
                timestamp: new Date(),
                performedBy: req.user._id,
              },
            },
          }
        );
      } catch (subErr) {
        console.warn(
          "[AdminSetUserTier] Failed to cancel active subscriptions for user",
          targetUser._id,
          subErr.message
        );
      }
    }

    // Log admin action
    await logActivity({
      type: "membership",
      description: "Admin updated user tier",
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      action: "admin_update_tier",
      targetType: "user",
      targetId: targetUser._id,
      details: { previousTier, newTier: tier, reason: reason || null },
    });

    res.json({
      success: true,
      message: "User membership tier updated",
      user: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        tier: targetUser.tier,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMembershipTiers,
  getCurrentMembership,
  upgradeMembership,
  captureMembershipPayment,
  cancelMembership,
  getMembershipBenefits,
  getMembershipStats,
  adminSetUserTier,
};
