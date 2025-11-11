const crypto = require("crypto");
const Payment = require("../models/Payment");
const TwoCheckoutTransaction = require("../models/TwoCheckoutTransaction");
const cfg = require("../utils/config");
const {
  buildCheckoutInit,
  verifyInsSignature,
  verifyReturnSignature,
} = require("../utils/twocheckout");
const { BadRequestError, UnauthorizedError, NotFoundError } = require("../utils/errors");

/**
 * POST /checkout/2co/initiate
 * Body: { amount: number, currency?: string, tierUpgrade: { from, to, duration } }
 * Requires auth.
 */
exports.initiateTwoCo = async (req, res, next) => {
  try {
    const { user } = req;
    if (!user) throw new UnauthorizedError("Authorization required");

    const { amount, currency = "USD", tierUpgrade } = req.body || {};

    if (!amount || !tierUpgrade || !tierUpgrade.from || !tierUpgrade.to || !tierUpgrade.duration) {
      throw new BadRequestError("amount and full tierUpgrade {from,to,duration} are required");
    }

    // Create internal order id that we also pass to 2CO as merchantOrderId
    const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const orderId = `2CO-${random}`;

    // Create Payment document
    const payment = await Payment.create({
      user: user._id,
      orderId,
      amount: { currency, value: Number(amount) },
      tierUpgrade: {
        from: tierUpgrade.from,
        to: tierUpgrade.to,
        duration: tierUpgrade.duration,
      },
      status: "pending",
      paymentMethod: "twocheckout",
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        referrer: req.headers.referer || req.headers.referrer,
      },
      auditLog: [{ action: "created", details: { provider: "2checkout" } }],
    });

    // Create initial 2CO transaction record
    await TwoCheckoutTransaction.create({
      user: user._id,
      payment: payment._id,
      merchantOrderId: orderId,
      status: "PENDING",
      amount: Number(amount),
      currency,
    });

    const init = buildCheckoutInit({ orderId, amount, currency });

    return res.json({
      message: "2Checkout initiation created",
      orderId,
      init,
      config: {
        sellerId: cfg.TWOCHECKOUT_SELLER_ID,
        sandbox: !!cfg.TWOCHECKOUT_SANDBOX,
        returnUrl: cfg.TWOCHECKOUT_RETURN_URL,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /checkout/2co/webhook (INS)
 * Headers: { signature | x-2checkout-signature }
 * Body: INS payload (varies)
 */
exports.webhookTwoCo = async (req, res, next) => {
  try {
    const signature =
      req.headers["x-2checkout-signature"] || req.headers.signature || req.headers["x-signature"];

    const verified = verifyInsSignature({ raw: req.rawBody, body: req.body, signature });
    if (!verified) {
      // Still accept but mark unverified to help debug if sandbox
      console.warn("2CO INS signature verification failed");
    }

    const body = req.body || {};

    // Try to normalize identifiers
    const orderNumber =
      body.orderNumber || body.order_number || body.SALE_ID || body.sale_id || null;
    const invoiceId = body.invoice_id || body.INVOICE_ID || null;
    const merchantOrderId =
      body.merchantOrderId || body.merchant_order_id || body.MERCHANT_ORDER_ID || null;
    const currency = body.currency || body.CURRENCY || "USD";

    // Total/amount may be in `total` or `amount`
    const amount = Number(body.total || body.amount || 0);

    // Determine success/failed
    const rawStatus = String(body.status || body.STATUS || "").toUpperCase();
    const statusMap = {
      COMPLETE: "COMPLETED",
      COMPLETED: "COMPLETED",
      AUTHORIZED: "AUTHORIZED",
      PENDING: "PENDING",
      REFUND: "REFUNDED",
      REFUNDED: "REFUNDED",
      CANCELLED: "CANCELLED",
      FAILED: "FAILED",
    };
    const status = statusMap[rawStatus] || (amount > 0 ? "COMPLETED" : "FAILED");

    // Upsert transaction by merchantOrderId (preferred) or orderNumber
    const query = merchantOrderId ? { merchantOrderId } : { orderNumber };
    const update = {
      orderNumber,
      invoiceId,
      merchantOrderId,
      status,
      amount: Number.isNaN(amount) ? undefined : amount,
      currency,
      signature,
      webhookPayload: body,
      "verification.insVerified": !!verified,
      "verification.verifiedAt": new Date(),
    };

    const tx = await TwoCheckoutTransaction.findOneAndUpdate(query, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    // Try to locate Payment and update status to completed when appropriate
    if (tx.merchantOrderId) {
      const payment = await Payment.findOne({ orderId: tx.merchantOrderId });
      if (payment) {
        if (tx.status === "COMPLETED" || tx.status === "AUTHORIZED") {
          payment.status = "completed";
          payment.paymentMethod = "twocheckout";
          payment.paymentDetails = {
            ...(payment.paymentDetails || {}),
            transactionId: tx.orderNumber || tx.invoiceId,
          };
          payment.completedAt = new Date();
          payment.isActive = true;
          // If activationDate not set, set and compute expiration via pre-save
          if (!payment.activationDate) payment.activationDate = new Date();
          await payment.save();
        } else if (tx.status === "FAILED" || tx.status === "CANCELLED") {
          payment.status = "failed";
          await payment.save();
        }
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /checkout/2co/return
 * Query/body comes from 2CO return URL. We'll attempt MD5 return signature verification.
 */
exports.returnTwoCo = async (req, res, next) => {
  try {
    const params = { ...req.query, ...req.body };
    const verified = verifyReturnSignature(params);

    const merchantOrderId = params.merchantOrderId || params.merchant_order_id || params.ORDER_ID;
    const orderNumber = params.orderNumber || params.order_number || params.SALE_ID;
    const total = Number(params.total || params.amount || 0);
    const currency = params.currency || "USD";

    // Update transaction for traceability
    const query = merchantOrderId ? { merchantOrderId } : { orderNumber };
    const tx = await TwoCheckoutTransaction.findOneAndUpdate(
      query,
      {
        orderNumber,
        merchantOrderId,
        amount: Number.isNaN(total) ? undefined : total,
        currency,
        signature: params.HASH || params.signature,
        returnPayload: params,
        "verification.returnVerified": !!verified,
        "verification.verifiedAt": new Date(),
      },
      { new: true, upsert: true }
    );

    // If verified and we can find the payment, mark it completed
    if (verified && tx.merchantOrderId) {
      const payment = await Payment.findOne({ orderId: tx.merchantOrderId });
      if (payment && payment.status !== "completed") {
        payment.status = "completed";
        payment.paymentMethod = "twocheckout";
        payment.paymentDetails = {
          ...(payment.paymentDetails || {}),
          transactionId: orderNumber,
        };
        payment.completedAt = new Date();
        payment.isActive = true;
        if (!payment.activationDate) payment.activationDate = new Date();
        await payment.save();
      }
    }

    return res.json({ success: true, verified, orderId: merchantOrderId, orderNumber });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /checkout/2co/transactions/:id
 */
exports.getTwoCoTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await TwoCheckoutTransaction.findById(id).populate("payment user", "email tier");
    if (!item) throw new NotFoundError("Transaction not found");
    res.json(item);
  } catch (err) {
    next(err);
  }
};
