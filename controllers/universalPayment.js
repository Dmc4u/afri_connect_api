/**
 * Centralized Payment Controller
 * Handles all PayPal payments: membership, showcases, advertising, donations
 */

const Payment = require("../models/Payment");
const PaypalTransaction = require("../models/PaypalTransaction");
const User = require("../models/User");
const { createOrder, captureOrder } = require("../utils/paypal");

/**
 * Create a universal PayPal order
 * Handles different payment types with configurable amounts
 */
const createUniversalOrder = async (req, res) => {
  try {
    const { amount, currency = 'USD', description, type, metadata = {} } = req.body;
    const userId = req.user?._id; // Optional for donations

    // For non-donation payments, require authentication
    if (type !== 'donation' && !userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Validate inputs
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!type) {
      return res.status(400).json({ error: "Payment type is required" });
    }

    const validTypes = ['membership', 'showcase', 'advertising', 'donation', 'listing', 'featured'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid payment type" });
    }

    console.log(`🔵 Creating ${type} order:`, { amount, currency, userId, metadata });

    // 🔑 Admin bypass (no PayPal call needed)
    if (req.user?.role === "admin") {
      const fakeOrderId = `ADMIN-${Date.now()}-${type}`;

      await Payment.create({
        user: userId,
        orderId: fakeOrderId,
        paypalOrderId: fakeOrderId,
        amount: {
          currency: currency,
          value: 0
        },
        paymentType: type,
        metadata: { ...metadata, adminBypass: true },
        status: "completed"
      });

      await PaypalTransaction.create({
        orderId: fakeOrderId,
        status: "COMPLETED",
        payerEmail: req.user.email || "admin@afrionet.com",
        tier: metadata.tier || "N/A",
        payerId: "ADMIN",
        amount: 0,
        currency: currency,
        transaction_details: { adminBypass: true },
      });

      console.log('✅ Admin bypass activated');
      return res.json({ orderId: fakeOrderId, adminBypass: true });
    }

    // 🔒 Normal user flow - create PayPal order
    const order = await createOrder(amount, type, currency, userId, {
      returnUrl: process.env.PAYPAL_RETURN_URL || 'http://localhost:3001',
      cancelUrl: process.env.PAYPAL_CANCEL_URL || 'http://localhost:3001'
    });

    if (!order?.id) {
      return res.status(500).json({ error: "PayPal did not return an order ID" });
    }

    // Check for duplicate order ID
    const existing = await Payment.findOne({ orderId: order.id });
    if (existing) {
      return res.status(409).json({ error: "Duplicate PayPal order ID" });
    }

    // Store payment record
    await Payment.create({
      user: userId || null, // Optional for donations
      orderId: order.id,
      paypalOrderId: order.id,
      amount: {
        currency: currency,
        value: amount
      },
      paymentType: type,
      metadata: metadata,
      status: "pending"
    });

    console.log('✅ PayPal order created:', order.id);
    res.json({ orderId: order.id });

  } catch (error) {
    console.error('❌ Create order error:', error);
    res.status(500).json({
      error: error.message || "Failed to create payment order"
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

    // Find payment record
    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      return res.status(404).json({ error: "Payment record not found" });
    }

    // Verify user owns this payment (or is admin, or it's a donation)
    if (payment.user && userId) {
      if (String(payment.user) !== String(userId) && req.user?.role !== 'admin') {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }

    // Check if already captured
    if (payment.status === "completed") {
      console.log('⚠️ Payment already captured');
      return res.json({
        message: "Payment already processed",
        payment: payment
      });
    }

    // Admin bypass - mark as completed
    if (orderId.startsWith('ADMIN-')) {
      payment.status = "completed";
      payment.capturedAt = new Date();
      await payment.save();

      // Apply payment effects based on type
      await applyPaymentEffects(payment, req.user, metadata);

      console.log('✅ Admin payment marked as completed');
      return res.json({
        message: "Payment processed successfully (Admin)",
        payment: payment
      });
    }

    // 🔒 Normal flow - capture from PayPal
    console.log('📤 Calling PayPal capture API for:', orderId);
    const captureResult = await captureOrder(orderId);
    console.log('📥 PayPal capture result:', JSON.stringify(captureResult, null, 2));

    if (!captureResult || captureResult.status !== 'COMPLETED') {
      console.error('❌ PayPal capture not completed. Status:', captureResult?.status);
      throw new Error(`PayPal capture failed with status: ${captureResult?.status || 'unknown'}`);
    }

    // Update payment record
    payment.status = "completed";
    payment.capturedAt = new Date();
    payment.paypalResponse = captureResult;
    await payment.save();

    // Create transaction record (only for membership payments that have a tier)
    if (payment.paymentType === 'membership' && metadata.tier) {
      await PaypalTransaction.create({
        orderId: orderId,
        status: "COMPLETED",
        payerEmail: captureResult.payer?.email_address || req.user.email,
        tier: metadata.tier,
        payerId: captureResult.payer?.payer_id || "N/A",
        amount: payment.amount.value,
        currency: payment.amount.currency,
        transaction_details: captureResult,
      });
    }

    // Apply payment effects based on type
    await applyPaymentEffects(payment, req.user, metadata);

    console.log('✅ Payment captured successfully');
    res.json({
      message: "Payment captured successfully",
      payment: payment
    });

  } catch (error) {
    console.error('❌ Capture error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: error.message || "Failed to capture payment",
      details: error.toString()
    });
  }
};

/**
 * Apply payment effects based on payment type
 */
async function applyPaymentEffects(payment, user, metadata) {
  switch (payment.paymentType) {
    case 'membership':
      if (metadata.tier) {
        user.tier = metadata.tier;
        await user.save();
        console.log(`✅ User upgraded to ${metadata.tier}`);
      }
      break;

    case 'showcase':
      // Handle showcase payment effects
      console.log('✅ Showcase payment processed');
      break;

    case 'advertising':
      // Create Advertisement record from payment metadata
      if (metadata && (metadata.title || metadata.adData)) {
        const Advertisement = require('../models/Advertisement');

        // Support both old format (metadata.adData) and new format (metadata directly)
        const adSource = metadata.adData || metadata;

        // Skip if already created
        const existing = await Advertisement.findOne({ 'paymentDetails.transactionId': payment.orderId });
        if (existing) {
          console.log('ℹ️ Advertisement already exists for payment:', payment.orderId);
          break;
        }

        // Extract imageUrl from mediaFiles (it might be an object with url property)
        let imageUrl = null;
        if (adSource.imageUrl) {
          imageUrl = typeof adSource.imageUrl === 'string' ? adSource.imageUrl : adSource.imageUrl.url;
        } else if (adSource.mediaFiles && adSource.mediaFiles.length > 0) {
          const firstMedia = adSource.mediaFiles[0];
          imageUrl = typeof firstMedia === 'string' ? firstMedia : firstMedia.url;
        }

        // Determine plan based on amount (simple mapping)
        let plan = 'starter';
        const amount = payment.amount.value;
        if (amount >= 500) plan = 'enterprise';
        else if (amount >= 300) plan = 'professional';
        else plan = 'starter';

        const adData = {
          title: adSource.title,
          description: adSource.description,
          targetUrl: adSource.targetUrl,
          placement: adSource.placement,
          advertiser: {
            userId: payment.user,
            name: adSource.name || user?.fullName || 'Anonymous',
            email: adSource.email || user?.email,
            company: adSource.company,
            phone: adSource.phone
          },
          mediaFiles: adSource.mediaFiles || [],
          imageUrl: imageUrl,
          startDate: adSource.startDate ? new Date(adSource.startDate) : new Date(),
          endDate: adSource.endDate ? new Date(adSource.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          videoDuration: adSource.videoDuration || 0,
          pricing: {
            amount: payment.amount.value,
            currency: payment.amount.currency,
            plan: plan,
            basePlanAmount: adSource.basePlanAmount || payment.amount.value,
            videoAddonAmount: adSource.videoDurationAddon || 0,
            billingCycle: 'monthly'
          },
          paymentDetails: {
            transactionId: payment.orderId,
            paymentMethod: 'paypal',
            paidAt: new Date()
          },
          status: 'active',
          paymentStatus: 'paid',
          createdBy: payment.user
        };

        await Advertisement.create(adData);
        console.log('✅ Advertisement record created for payment:', payment.orderId);
        console.log('📢 Ad details:', { title: adData.title, placement: adData.placement, imageUrl: adData.imageUrl });
      } else {
        console.log('⚠️ Advertising payment processed but missing required ad data in metadata. Payment:', payment.orderId);
      }
      break;

    case 'donation':
      // Handle donation effects
      console.log('✅ Donation processed');
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
    console.log('📥 Admin fetching donations');

    const donations = await Payment.find({
      paymentType: 'donation',
      status: 'completed'
    })
    .populate('user', 'fullName email profilePhoto')
    .sort({ createdAt: -1 })
    .lean();

    console.log(`✅ Found ${donations.length} donations`);

    res.json({
      donations: donations,
      totalAmount: donations.reduce((sum, d) => sum + (d.amount?.value || 0), 0),
      count: donations.length
    });

  } catch (error) {
    console.error('❌ Fetch donations error:', error);
    res.status(500).json({
      error: error.message || "Failed to fetch donations"
    });
  }
};

/**
 * Get all advertising records for admin dashboard
 */
const getAdminAdvertising = async (req, res) => {
  try {
    console.log('📥 Admin fetching advertising records');

    // Import Advertisement model
    const Advertisement = require('../models/Advertisement');

    const advertising = await Advertisement.find({
      status: { $in: ['active', 'approved', 'completed', 'pending'] }
    })
    .populate('advertiser.userId', 'fullName email profilePhoto')
    .sort({ createdAt: -1 })
    .lean();

    console.log(`✅ Found ${advertising.length} advertising records`);

    // Format the response to match the expected structure
    const formattedAds = advertising.map(ad => ({
      _id: ad._id,
      user: ad.advertiser.userId,
      amount: {
        value: ad.pricing?.amount || 0
      },
      orderId: ad.paymentDetails?.transactionId || ad._id.toString(),
      createdAt: ad.createdAt,
      status: ad.paymentStatus === 'paid' ? 'completed' : ad.status,
      activationDate: ad.startDate,
      expirationDate: ad.endDate,
      metadata: {
        adTitle: ad.title,
        placement: ad.placement,
        duration: Math.ceil((new Date(ad.endDate) - new Date(ad.startDate)) / (1000 * 60 * 60 * 24)),
        imageUrl: ad.imageUrl || (ad.mediaFiles && ad.mediaFiles.length > 0 ? ad.mediaFiles[0].url : null)
      }
    }));

    res.json({
      advertising: formattedAds,
      totalAmount: formattedAds.reduce((sum, ad) => sum + (ad.amount?.value || 0), 0),
      count: formattedAds.length
    });

  } catch (error) {
    console.error('❌ Fetch advertising error:', error);
    res.status(500).json({
      error: error.message || "Failed to fetch advertising records"
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
      return res.status(404).json({ error: 'Donation not found' });
    }

    if (donation.paymentType !== 'donation') {
      return res.status(400).json({ error: 'Not a donation record' });
    }

    await Payment.findByIdAndDelete(id);
    console.log('✅ Donation deleted successfully');

    res.json({ message: 'Donation deleted successfully' });
  } catch (error) {
    console.error('❌ Delete donation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to delete donation'
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
      return res.status(404).json({ error: 'Advertising record not found' });
    }

    if (ad.paymentType !== 'advertising') {
      return res.status(400).json({ error: 'Not an advertising record' });
    }

    await Payment.findByIdAndDelete(id);
    console.log('✅ Advertising record deleted successfully');

    res.json({ message: 'Advertising record deleted successfully' });
  } catch (error) {
    console.error('❌ Delete advertising error:', error);
    res.status(500).json({
      error: error.message || 'Failed to delete advertising record'
    });
  }
};

module.exports = {
  createUniversalOrder,
  captureUniversalOrder,
  getAdminDonations,
  getAdminAdvertising,
  deleteDonation,
  deleteAdvertising
};
