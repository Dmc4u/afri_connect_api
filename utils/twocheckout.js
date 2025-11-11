const crypto = require("crypto");
const cfg = require("./config");

/**
 * 2Checkout (Verifone) signature helpers
 * Notes:
 * - Return (success/cancel) pages for classic 2CO often include MD5 `HASH` based on Secret Word + Seller ID + Order Number + Total.
 * - INS/Webhook uses HMAC-SHA256 computed over the request payload with the INS Secret as key.
 *
 * Depending on your 2CO account settings, field names can vary (HASH, signature, x_signature, etc.).
 */

function md5Hex(input) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex").toUpperCase();
}

/**
 * Verify classic return signature.
 * Expects one of the following param sets (case-insensitive):
 * - { HASH, order_number, total } (legacy 2CO)
 * - { signature, orderNumber, total } (alias)
 */
function verifyReturnSignature(params = {}) {
  const secretWord = cfg.TWOCHECKOUT_SECRET_WORD || "";
  const sellerId = cfg.TWOCHECKOUT_SELLER_ID || "";
  if (!secretWord || !sellerId) return false;

  // Normalize fields
  const signature = params.HASH || params.hash || params.signature || params.SIGNATURE || "";
  const orderNumber =
    params.order_number || params.orderNumber || params.ORDERNUMBER || params.ORDER_NUMBER || "";
  const total = String(
    params.total || params.total_amount || params.amount || params.TOTAL || params.TOTALAMOUNT || 0
  );

  if (!signature || !orderNumber || !total) return false;

  // Classic formula: MD5(secretWord + sellerId + orderNumber + total)
  const expected = md5Hex(`${secretWord}${sellerId}${orderNumber}${total}`);
  return expected === String(signature).toUpperCase();
}

/**
 * Verify INS/Webhook signature using HMAC-SHA256.
 * Prefer exact raw payload if available; otherwise fallback to JSON stringified body.
 */
function verifyInsSignature({ raw, body, signature }) {
  const insSecret = cfg.TWOCHECKOUT_INS_SECRET || "";
  if (!insSecret || !signature) return false;

  const payload = typeof raw === "string" || Buffer.isBuffer(raw) ? raw : JSON.stringify(body || {});
  const digest = crypto.createHmac("sha256", insSecret).update(payload, "utf8").digest("hex");

  // timing-safe compare (lowercase hex)
  const a = Buffer.from(digest.toLowerCase(), "utf8");
  const b = Buffer.from(String(signature).toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Build the minimum parameters the frontend may need to initiate a 2CO redirect.
 * This does NOT create an order at 2CO; it returns metadata to include in the hosted checkout.
 */
function buildCheckoutInit({ orderId, amount, currency = "USD", returnUrl, description }) {
  return {
    sellerId: cfg.TWOCHECKOUT_SELLER_ID,
    sandbox: !!cfg.TWOCHECKOUT_SANDBOX,
    merchantOrderId: orderId,
    amount: Number(amount),
    currency,
    returnUrl: returnUrl || cfg.TWOCHECKOUT_RETURN_URL,
    description: description || "AfriOnet purchase",
  };
}

module.exports = {
  verifyReturnSignature,
  verifyInsSignature,
  buildCheckoutInit,
};
