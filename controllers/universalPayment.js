/**
 * Centralized Payment Controller
 * Handles all PayPal payments: membership, showcases, advertising, donations
 */

const Payment = require("../models/Payment");
const PaypalTransaction = require("../models/PaypalTransaction");
const User = require("../models/User");
const PricingSettings = require("../models/PricingSettings");
const { createOrder, captureOrder, getOrder } = require("../utils/paypal");

const VALID_PAYMENT_TYPES = [
  "membership",
  "showcase",
  "advertising",
  "donation",
  "listing",
  "featured",
];
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "ILS"];

const normalizeTier = (tier) => {
  if (!tier) return null;
  const t = String(tier).trim();
  const normalized = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  const allowed = new Set(["Starter", "Premium", "Pro"]);
  return allowed.has(normalized) ? normalized : null;
};

const toFiniteNumber = (value) => {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

const computeAdvertisingPricing = ({ placement, durationDays, videoDurationSec }) => {
  const placementDailyRates = {
    "homepage-banner": 3.33,
    "footer-banner": 3.33,
  };

  const days = Math.max(1, Math.min(90, parseInt(durationDays, 10) || 30));
  const dailyRate = placementDailyRates[placement] || placementDailyRates["homepage-banner"];
  const basePlanAmount = Math.round(dailyRate * days);

  let videoDurationAddon = 0;
  const vd = Math.max(0, parseInt(videoDurationSec, 10) || 0);
  if (vd > 0) {
    if (vd <= 15) videoDurationAddon = 0.5 * days;
    else if (vd <= 30) videoDurationAddon = 1 * days;
    else if (vd <= 60) videoDurationAddon = 2 * days;
    else if (vd <= 120) videoDurationAddon = 3 * days;
    else videoDurationAddon = 5 * days;
  }

  const totalAmount = basePlanAmount + Math.round(videoDurationAddon);
  return {
    days,
    basePlanAmount,
    videoDurationAddon: Math.round(videoDurationAddon),
    totalAmount,
  };
};

/**
 * Create a universal PayPal order
 * Handles different payment types with configurable amounts
 */
const createUniversalOrder = async (req, res) => {
  try {
    const { amount, currency = "USD", description, type, metadata = {} } = req.body;
    const userId = req.user?._id; // Optional for donations

    // For non-donation payments, require authentication
    if (type !== "donation" && !userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!type) {
      return res.status(400).json({ error: "Payment type is required" });
    }

    if (!VALID_PAYMENT_TYPES.includes(type)) {
      return res.status(400).json({ error: "Invalid payment type" });
    }

    const requestedCurrency = String(currency || "USD").toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(requestedCurrency)) {
      return res.status(400).json({ error: "Unsupported currency" });
    }

    // Build authoritative amount/currency/context. Never trust client values for privilege-granting purchases.
    let authoritativeAmount = null;
    let authoritativeCurrency = requestedCurrency;
    let tierUpgrade = null;
    // Persist a server-owned context object so capture does not need to trust any client-sent metadata.
    // Keep the original client fields at top-level for compatibility with existing effect handlers.
    const context = {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      type,
      description: description ? String(description).slice(0, 200) : undefined,
      _server: {
        createdAt: new Date().toISOString(),
      },
    };

    if (type === "membership") {
      const tier = normalizeTier(metadata?.tier);
      if (!tier) {
        return res.status(400).json({ error: "Membership tier is required" });
      }

      const tierHierarchy = { Free: 0, Starter: 1, Premium: 2, Pro: 3 };
      const currentTierLevel = tierHierarchy[req.user?.tier] ?? 0;
      const requestedTierLevel = tierHierarchy[tier];
      if (currentTierLevel >= requestedTierLevel) {
        return res.status(400).json({ error: `Invalid tier upgrade request` });
      }

      const pricing = await PricingSettings.findOne({ tier }).lean();
      if (!pricing || pricing.isActive === false) {
        return res.status(400).json({ error: "Pricing unavailable for requested tier" });
      }

      authoritativeAmount = toFiniteNumber(pricing.basePrice);
      authoritativeCurrency = "USD";
      tierUpgrade = {
        from: req.user?.tier || "Free",
        to: tier,
        duration: pricing.billingPeriod === "year" ? "yearly" : "monthly",
      };
      context.tier = tier;
      context.pricing = {
        tier,
        basePrice: pricing.basePrice,
        billingPeriod: pricing.billingPeriod,
      };
    } else if (type === "advertising") {
      // Compute advertising price on the server to prevent client-side manipulation.
      const placement = String(metadata?.placement || "").trim();
      const durationDays = metadata?.duration ?? metadata?.numberOfDays;
      const videoDurationSec = metadata?.videoDuration;
      if (!placement) {
        return res.status(400).json({ error: "Advertising placement is required" });
      }

      const pricing = computeAdvertisingPricing({ placement, durationDays, videoDurationSec });
      authoritativeAmount = pricing.totalAmount;
      authoritativeCurrency = "USD";
      context.advertising = {
        placement,
        durationDays: pricing.days,
        videoDuration: Math.max(0, parseInt(videoDurationSec, 10) || 0),
        basePlanAmount: pricing.basePlanAmount,
        videoDurationAddon: pricing.videoDurationAddon,
        totalAmount: pricing.totalAmount,
      };
    } else {
      // Donation/showcase/listing/featured: accept client amount but validate strictly.
      const parsed = toFiniteNumber(amount);
      if (!parsed || parsed <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      // Anti-abuse bounds (keep generous; adjust as needed)
      const max = type === "donation" ? 10000 : 50000;
      if (parsed > max) {
        return res.status(400).json({ error: "Amount exceeds maximum" });
      }
      authoritativeAmount = Math.round(parsed * 100) / 100;
    }

    if (!authoritativeAmount || authoritativeAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    console.log(`🔵 Creating ${type} order:`, {
      amount: authoritativeAmount,
      currency: authoritativeCurrency,
      userId,
    });

    // 🔑 Admin bypass (no PayPal call needed)
    // Opt-in only: enable via env var or explicit metadata flag.
    // Never bypass donations (so admins can test the real card/PayPal flow).
    const adminBypassEnabled =
      String(process.env.PAYMENTS_ADMIN_BYPASS || "").toLowerCase() === "true" ||
      metadata?.adminBypass === true;

    if (req.user?.role === "admin" && adminBypassEnabled && type !== "donation") {
      const fakeOrderId = `ADMIN-${Date.now()}-${type}`;

      const allowedTiers = new Set(["Free", "Starter", "Premium", "Pro"]);
      const effectiveTier = allowedTiers.has(metadata?.tier) ? metadata.tier : undefined;

      const integrityHash = tierUpgrade?.to
        ? Payment.computeIntegrityHash({
            userId: String(userId),
            tierTo: tierUpgrade.to,
            priceValue: authoritativeAmount,
            currency: authoritativeCurrency,
            duration: tierUpgrade.duration,
          })
        : undefined;

      await Payment.create({
        user: userId,
        orderId: fakeOrderId,
        paypalOrderId: fakeOrderId,
        amount: {
          currency: authoritativeCurrency,
          value: authoritativeAmount,
        },
        paymentType: type,
        tierUpgrade: tierUpgrade || undefined,
        integrityHash,
        paymentMethod: "manual",
        status: "completed",
        metadata: {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || "",
          referrer: req.get("referer") || null,
          discount: 0,
        },
        context: { ...context, adminBypass: true },
      });

      await PaypalTransaction.create({
        orderId: fakeOrderId,
        status: "COMPLETED",
        payerEmail: req.user.email || "admin@afrionet.com",
        ...(effectiveTier ? { tier: effectiveTier } : {}),
        payerId: "ADMIN",
        amount: 0,
        currency: currency,
        transaction_details: { adminBypass: true },
      });

      console.log("✅ Admin bypass activated");
      return res.json({ orderId: fakeOrderId, adminBypass: true });
    }

    // 🔒 Normal user flow - create PayPal order
    const seatType =
      type === "membership" && tierUpgrade?.to ? `membership-${tierUpgrade.to}` : type;
    const order = await createOrder(authoritativeAmount, seatType, authoritativeCurrency, userId, {
      returnUrl: process.env.PAYPAL_RETURN_URL || "http://localhost:3001",
      cancelUrl: process.env.PAYPAL_CANCEL_URL || "http://localhost:3001",
    });

    if (!order?.id) {
      return res.status(500).json({ error: "PayPal did not return an order ID" });
    }

    // Check for duplicate order ID
    const existing = await Payment.findOne({ orderId: order.id });
    if (existing) {
      return res.status(409).json({ error: "Duplicate PayPal order ID" });
    }

    const integrityHash = tierUpgrade?.to
      ? Payment.computeIntegrityHash({
          userId: String(userId),
          tierTo: tierUpgrade.to,
          priceValue: authoritativeAmount,
          currency: authoritativeCurrency,
          duration: tierUpgrade.duration,
        })
      : undefined;

    // Store payment record (including authoritative context)
    await Payment.create({
      user: userId || null, // Optional for donations
      orderId: order.id,
      paypalOrderId: order.id,
      amount: {
        currency: authoritativeCurrency,
        value: authoritativeAmount,
      },
      paymentType: type,
      tierUpgrade: tierUpgrade || undefined,
      integrityHash,
      paymentMethod: "paypal",
      status: "pending",
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || "",
        referrer: req.get("referer") || null,
        discount: 0,
      },
      context,
    });

    console.log("✅ PayPal order created:", order.id);
    res.json({ orderId: order.id });
  } catch (error) {
    console.error("❌ Create order error:", error);
    res.status(500).json({
      error: error.message || "Failed to create payment order",
    });
  }
};

/**
 * Capture a universal PayPal payment
 */
const captureUniversalOrder = async (req, res) => {
  try {
    const { orderId, metadata = {} } = req.body;
    const userId = req.user?._id; // Optional for donations

    if (!orderId) {
      return res.status(400).json({ error: "Order ID is required" });
    }

    console.log(`💳 Capturing order: ${orderId}`);

    // Idempotency guard: acquire capturing lock
    let payment = await Payment.findOneAndUpdate(
      { orderId, status: { $in: ["pending", "failed"] }, capturing: { $ne: true } },
      { $set: { capturing: true } },
      { new: true }
    );

    if (!payment) {
      const existing = await Payment.findOne({ orderId });
      if (existing?.status === "completed") {
        return res.json({ message: "Payment already processed", payment: existing });
      }
      return res.status(409).json({ error: "Payment is being processed or not found" });
    }

    // For non-donation payments, require authentication
    if (payment.paymentType !== "donation" && !req.user) {
      payment.capturing = false;
      await payment.save();
      return res.status(401).json({ error: "Authentication required" });
    }

    // Verify user owns this payment (or is admin)
    if (payment.user) {
      if (!req.user) {
        payment.capturing = false;
        await payment.save();
        return res.status(401).json({ error: "Authentication required" });
      }
      if (String(payment.user) !== String(userId) && req.user?.role !== "admin") {
        payment.capturing = false;
        await payment.save();
        return res.status(403).json({ error: "Unauthorized" });
      }
    }

    // Check if already captured
    if (payment.status === "completed") {
      console.log("⚠️ Payment already captured");
      payment.capturing = false;
      await payment.save();
      return res.json({
        message: "Payment already processed",
        payment: payment,
      });
    }

    // Admin bypass - mark as completed
    if (orderId.startsWith("ADMIN-")) {
      payment.status = "completed";
      payment.capturing = false;
      await payment.save();

      // Apply payment effects based on type
      await applyPaymentEffects(payment, req.user, payment.context || metadata);

      console.log("✅ Admin payment marked as completed");
      return res.json({
        message: "Payment processed successfully (Admin)",
        payment: payment,
      });
    }

    // Verify PayPal order details match expected amount/currency before capture
    try {
      const order = await getOrder(orderId);
      const unit = order?.purchase_units?.[0];
      const orderCurrency = unit?.amount?.currency_code;
      const orderAmount = parseFloat(unit?.amount?.value || "0");
      if (orderCurrency && orderCurrency !== payment.amount.currency) {
        throw new Error("Invalid order currency");
      }
      if (orderAmount && Math.abs(orderAmount - payment.amount.value) > 0.01) {
        throw new Error("Invalid order amount");
      }
      if (order?.status && !["APPROVED", "COMPLETED"].includes(order.status)) {
        throw new Error("Order not approved");
      }
    } catch (preErr) {
      payment.capturing = false;
      await payment.save();
      return res.status(400).json({ error: preErr.message || "Order verification failed" });
    }

    // 🔒 Normal flow - capture from PayPal
    console.log("📤 Calling PayPal capture API for:", orderId);
    const captureResult = await captureOrder(orderId);
    console.log("📥 PayPal capture result:", JSON.stringify(captureResult, null, 2));

    if (!captureResult || captureResult.status !== "COMPLETED") {
      console.error("❌ PayPal capture not completed. Status:", captureResult?.status);
      throw new Error(`PayPal capture failed with status: ${captureResult?.status || "unknown"}`);
    }

    // Basic integrity check: ensure returned purchase unit amount matches expected
    const purchaseUnit = captureResult?.purchase_units?.[0];
    const returnedValue = parseFloat(
      purchaseUnit?.amount?.value || purchaseUnit?.payments?.captures?.[0]?.amount?.value || "0"
    );
    if (returnedValue && Math.abs(returnedValue - payment.amount.value) > 0.01) {
      payment.status = "failed";
      payment.capturing = false;
      await payment.save();
      return res.status(400).json({ error: "Payment amount mismatch. Please contact support." });
    }

    // Update payment record
    payment.status = "completed";
    payment.paymentDetails = {
      ...(payment.paymentDetails || {}),
      transactionId: captureResult.id,
      payerInfo: {
        email: captureResult.payer?.email_address,
        payerId: captureResult.payer?.payer_id,
      },
    };
    payment.capturing = false;
    await payment.save();

    // Create transaction record for membership payments
    const effectiveContext = payment.context || metadata;
    const membershipTier = payment.tierUpgrade?.to || effectiveContext?.tier;
    if (payment.paymentType === "membership" && membershipTier) {
      await PaypalTransaction.create({
        orderId: orderId,
        status: "COMPLETED",
        payerEmail: captureResult.payer?.email_address || req.user.email,
        tier: membershipTier,
        payerId: captureResult.payer?.payer_id || "N/A",
        amount: payment.amount.value,
        currency: payment.amount.currency,
        transaction_details: captureResult,
      });
    }

    // Apply payment effects based on type
    await applyPaymentEffects(payment, req.user, effectiveContext);

    console.log("✅ Payment captured successfully");
    res.json({
      message: "Payment captured successfully",
      payment: payment,
    });
  } catch (error) {
    console.error("❌ Capture error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: error.message || "Failed to capture payment",
      details: error.toString(),
    });
  }
};

/**
 * Apply payment effects based on payment type
 */
async function applyPaymentEffects(payment, user, metadata) {
  switch (payment.paymentType) {
    case "membership":
      if (!user) {
        throw new Error("Authenticated user required for membership upgrades");
      }
      if (payment.tierUpgrade?.to) {
        user.tier = payment.tierUpgrade.to;
        // Default membership term: 30 days (only extend, never shorten)
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        if (!user.tierExpiresAt || user.tierExpiresAt < newExpiry) {
          user.tierExpiresAt = newExpiry;
        }
        await user.save();
        console.log(`✅ User upgraded to ${payment.tierUpgrade.to}`);
      }
      break;

    case "showcase":
      // Handle showcase payment effects
      console.log("✅ Showcase payment processed");
      break;

    case "advertising":
      // Create Advertisement record from payment metadata
      if (metadata && (metadata.title || metadata.adData)) {
        const Advertisement = require("../models/Advertisement");

        // Support both old format (metadata.adData) and new format (metadata directly)
        const adSource = metadata.adData || metadata;

        // Skip if already created
        const existing = await Advertisement.findOne({
          "paymentDetails.transactionId": payment.orderId,
        });
        if (existing) {
          console.log("ℹ️ Advertisement already exists for payment:", payment.orderId);
          break;
        }

        // Extract imageUrl from mediaFiles (it might be an object with url property)
        let imageUrl = null;
        if (adSource.imageUrl) {
          imageUrl =
            typeof adSource.imageUrl === "string" ? adSource.imageUrl : adSource.imageUrl.url;
        } else if (adSource.mediaFiles && adSource.mediaFiles.length > 0) {
          const firstMedia = adSource.mediaFiles[0];
          imageUrl = typeof firstMedia === "string" ? firstMedia : firstMedia.url;
        }

        // Compute authoritative dates and duration (do not trust client-sent endDate)
        const requestedStart = adSource.startDate ? new Date(adSource.startDate) : new Date();
        const durationDays = adSource.duration || adSource.numberOfDays || adSource.durationDays;
        const pricing = computeAdvertisingPricing({
          placement: adSource.placement,
          durationDays,
          videoDurationSec: adSource.videoDuration || 0,
        });
        const startDate = isNaN(requestedStart.getTime()) ? new Date() : requestedStart;
        const endDate = new Date(startDate.getTime() + pricing.days * 24 * 60 * 60 * 1000);

        // Determine plan based on paid amount (simple mapping)
        let plan = "starter";
        const paid = payment.amount.value;
        if (paid >= 500) plan = "enterprise";
        else if (paid >= 300) plan = "professional";

        const adData = {
          title: adSource.title,
          description: adSource.description,
          targetUrl: adSource.targetUrl,
          placement: adSource.placement,
          advertiser: {
            userId: payment.user,
            name: adSource.name || user?.fullName || "Anonymous",
            email: adSource.email || user?.email,
            company: adSource.company,
            phone: adSource.phone,
          },
          mediaFiles: adSource.mediaFiles || [],
          imageUrl: imageUrl,
          startDate,
          endDate,
          videoDuration: adSource.videoDuration || 0,
          pricing: {
            amount: payment.amount.value,
            currency: payment.amount.currency,
            plan: plan,
            basePlanAmount: pricing.basePlanAmount,
            videoAddonAmount: pricing.videoDurationAddon,
            billingCycle: "monthly",
          },
          paymentDetails: {
            transactionId: payment.orderId,
            paymentMethod: "paypal",
            paidAt: new Date(),
          },
          status: "active",
          paymentStatus: "paid",
          createdBy: payment.user,
        };

        await Advertisement.create(adData);
        console.log("✅ Advertisement record created for payment:", payment.orderId);
        console.log("📢 Ad details:", {
          title: adData.title,
          placement: adData.placement,
          imageUrl: adData.imageUrl,
        });
      } else {
        console.log(
          "⚠️ Advertising payment processed but missing required ad data in metadata. Payment:",
          payment.orderId
        );
      }
      break;

    case "donation":
      // Handle donation effects
      console.log("✅ Donation processed");
      break;

    default:
      console.log(`✅ ${payment.paymentType} payment processed`);
  }
}

/**
 * Get all donations for admin dashboard
 */
const getAdminDonations = async (req, res) => {
  try {
    console.log("📥 Admin fetching donations");

    const donations = await Payment.find({
      paymentType: "donation",
      status: "completed",
    })
      .populate("user", "fullName email profilePhoto")
      .sort({ createdAt: -1 })
      .lean();

    console.log(`✅ Found ${donations.length} donations`);

    res.json({
      donations: donations,
      totalAmount: donations.reduce((sum, d) => sum + (d.amount?.value || 0), 0),
      count: donations.length,
    });
  } catch (error) {
    console.error("❌ Fetch donations error:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch donations",
    });
  }
};

/**
 * Get all advertising records for admin dashboard
 */
const getAdminAdvertising = async (req, res) => {
  try {
    console.log("📥 Admin fetching advertising records");

    // Import Advertisement model
    const Advertisement = require("../models/Advertisement");

    const advertising = await Advertisement.find({
      status: { $in: ["active", "approved", "completed", "pending"] },
    })
      .populate("advertiser.userId", "fullName email profilePhoto")
      .sort({ createdAt: -1 })
      .lean();

    console.log(`✅ Found ${advertising.length} advertising records`);

    // Format the response to match the expected structure
    const formattedAds = advertising.map((ad) => ({
      _id: ad._id,
      user: ad.advertiser.userId,
      amount: {
        value: ad.pricing?.amount || 0,
      },
      orderId: ad.paymentDetails?.transactionId || ad._id.toString(),
      createdAt: ad.createdAt,
      status: ad.paymentStatus === "paid" ? "completed" : ad.status,
      activationDate: ad.startDate,
      expirationDate: ad.endDate,
      metadata: {
        adTitle: ad.title,
        placement: ad.placement,
        duration: Math.ceil(
          (new Date(ad.endDate) - new Date(ad.startDate)) / (1000 * 60 * 60 * 24)
        ),
        imageUrl:
          ad.imageUrl || (ad.mediaFiles && ad.mediaFiles.length > 0 ? ad.mediaFiles[0].url : null),
      },
    }));

    res.json({
      advertising: formattedAds,
      totalAmount: formattedAds.reduce((sum, ad) => sum + (ad.amount?.value || 0), 0),
      count: formattedAds.length,
    });
  } catch (error) {
    console.error("❌ Fetch advertising error:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch advertising records",
    });
  }
};

/**
 * Delete a donation record
 */
const deleteDonation = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Admin deleting donation: ${id}`);

    const donation = await Payment.findById(id);

    if (!donation) {
      return res.status(404).json({ error: "Donation not found" });
    }

    if (donation.paymentType !== "donation") {
      return res.status(400).json({ error: "Not a donation record" });
    }

    await Payment.findByIdAndDelete(id);
    console.log("✅ Donation deleted successfully");

    res.json({ message: "Donation deleted successfully" });
  } catch (error) {
    console.error("❌ Delete donation error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete donation",
    });
  }
};

/**
 * Delete an advertising record
 */
const deleteAdvertising = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Admin deleting advertising: ${id}`);

    const ad = await Payment.findById(id);

    if (!ad) {
      return res.status(404).json({ error: "Advertising record not found" });
    }

    if (ad.paymentType !== "advertising") {
      return res.status(400).json({ error: "Not an advertising record" });
    }

    await Payment.findByIdAndDelete(id);
    console.log("✅ Advertising record deleted successfully");

    res.json({ message: "Advertising record deleted successfully" });
  } catch (error) {
    console.error("❌ Delete advertising error:", error);
    res.status(500).json({
      error: error.message || "Failed to delete advertising record",
    });
  }
};

module.exports = {
  createUniversalOrder,
  captureUniversalOrder,
  getAdminDonations,
  getAdminAdvertising,
  deleteDonation,
  deleteAdvertising,
};
