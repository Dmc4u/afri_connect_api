const Payment = require("../models/Payment");
const PaypalTransaction = require("../models/PaypalTransaction"); // NEW
const { createOrder, captureOrder } = require("../utils/paypal");

const SEAT_PRICES = {
  general: 1, // $1 → $5 prize
  hot: 5, // $5 → $20 prize
};

/**
 * Create a PayPal order (admin gets bypass order)
 */
exports.createPayPalOrder = async (req, res) => {
  try {
    const { seatType } = req.body;
    const userId = req.user._id;

    if (!SEAT_PRICES[seatType]) {
      return res.status(400).json({ error: "Invalid seat type" });
    }

    const amount = SEAT_PRICES[seatType];

    // 🔑 Admin bypass (no PayPal call)
    if (req.user?.role === "admin") {
      const fakeOrderId = `ADMIN-${Date.now()}-${seatType}`;

      await Payment.create({
        userId,
        provider: "PayPal",
        orderId: fakeOrderId,
        seatType,
        amount: 0,
        status: "COMPLETED",
        consumed: false,
        fullResponse: { adminBypass: true },
      });

      await PaypalTransaction.create({
        orderId: fakeOrderId,
        status: "COMPLETED",
        payerEmail: "admin@uwin.local",
        payerId: "ADMIN",
        amount: 0,
        currency: "USD",
        transaction_details: { adminBypass: true },
      });

      return res.json({ id: fakeOrderId, adminBypass: true });
    }

    // 🔒 Normal user flow
    const order = await createOrder(amount, seatType); // utils/paypal.js puts seatType in custom_id
    if (!order?.id) {
      return res.status(500).json({ error: "PayPal did not return an order ID" });
    }

    // Prevent duplicate orderId
    const existing = await Payment.findOne({ orderId: order.id });
    if (existing) {
      return res.status(409).json({ error: "Duplicate PayPal orderId" });
    }

    await Payment.create({
      userId,
      provider: "PayPal",
      orderId: order.id,
      seatType,
      amount,
      status: "PENDING",
      consumed: false,
      fullResponse: order,
    });

    // log raw order in PaypalTransaction (status still pending)
    await PaypalTransaction.create({
      orderId: order.id,
      status: "PENDING",
      amount,
      currency: "USD",
      transaction_details: order,
    });

    res.json({ id: order.id });
  } catch (err) {
    console.error("❌ createPayPalOrder error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Capture a PayPal order (admin bypass auto-confirms)
 */
exports.capturePayPalOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.user._id;

    // 🔑 Admin bypass
    if (req.user?.role === "admin" && orderId.startsWith("ADMIN-")) {
      const payment = await Payment.findOne({ userId, orderId });
      if (!payment) {
        return res.status(404).json({ error: "Admin bypass payment not found" });
      }
      return res.json({
        success: true,
        orderId,
        seatType: payment.seatType,
        amount: payment.amount,
        status: payment.status,
        adminBypass: true,
      });
    }

    // 🔒 Normal user flow
    const capture = await captureOrder(orderId);

    // Update payment but keep original seatType if present
    let payment = await Payment.findOneAndUpdate(
      { userId, orderId },
      {
        status: "COMPLETED",
        consumed: false,
        fullResponse: capture,
      },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({ error: "Payment record not found" });
    }

    // 🚑 If seatType is missing, recover it from PayPal `custom_id`
    if (!payment.seatType) {
      const inferredSeatType =
        capture?.purchase_units?.[0]?.custom_id ||
        payment.fullResponse?.purchase_units?.[0]?.custom_id ||
        "general"; // fallback

      payment.seatType = inferredSeatType;
      await payment.save();
    }

    // Log into PaypalTransaction
    const payer = capture?.payer || {};
    await PaypalTransaction.findOneAndUpdate(
      { orderId },
      {
        orderId,
        status: "COMPLETED",
        payerEmail: payer.email_address,
        payerId: payer.payer_id,
        amount: payment.amount,
        currency: payment.currency || "USD",
        transaction_details: capture,
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      orderId,
      seatType: payment.seatType,
      amount: payment.amount,
      status: payment.status,
    });
  } catch (err) {
    console.error("❌ capturePayPalOrder error:", err);
    res.status(500).json({ error: err.message });
  }
};
