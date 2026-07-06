const mongoose = require("mongoose");
const DigitalServiceTransaction = require("../models/DigitalServiceTransaction");
const PlatformWallet = require("../models/PlatformWallet");
const PlatformWalletLedger = require("../models/PlatformWalletLedger");
const User = require("../models/User");
const WalletLedger = require("../models/WalletLedger");
const { getExchangeRate } = require("../utils/exchangeRates");
const provider = require("../utils/digitalServicesProvider");
const config = require("../utils/config");
const { createPayout } = require("../utils/paypal");
const { sendEmail } = require("../utils/notifications");
const { BadRequestError, NotFoundError } = require("../utils/errors");

const SUPPORTED_WALLET_CURRENCIES = new Set(["USD"]);
const FUNDING_WALLET_KEY = "digital-services";
const REVENUE_WALLET_KEY = "digital-services-revenue";
const PROVIDER_SUCCESS_STATUSES = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "COMPLETE"]);
const PROVIDER_FAILURE_STATUSES = new Set([
  "FAILED",
  "FAILURE",
  "DECLINED",
  "REJECTED",
  "CANCELLED",
]);

function getPayPalPayoutReadiness() {
  const nodeEnv = String(config.NODE_ENV || "development").toLowerCase();
  const paypalMode = String(config.PAYPAL_MODE || "sandbox").toLowerCase();
  const hasClientId = Boolean(String(config.PAYPAL_CLIENT_ID || "").trim());
  const hasClientSecret = Boolean(String(config.PAYPAL_CLIENT_SECRET || "").trim());
  const canAttemptLivePayout =
    nodeEnv === "production" && paypalMode === "live" && hasClientId && hasClientSecret;

  let message = "PayPal live payout readiness verified.";
  if (nodeEnv !== "production") {
    message = "Revenue payouts are blocked until the API runs with NODE_ENV=production.";
  } else if (paypalMode !== "live") {
    message = "Revenue payouts are blocked until PAYPAL_MODE=live is configured.";
  } else if (!hasClientId || !hasClientSecret) {
    message = "Revenue payouts are blocked until live PayPal client ID and secret are configured.";
  }

  return {
    nodeEnv,
    paypalMode,
    hasClientId,
    hasClientSecret,
    canAttemptLivePayout,
    message,
  };
}

function assertPayPalPayoutReadiness() {
  const readiness = getPayPalPayoutReadiness();
  if (!readiness.canAttemptLivePayout) {
    throw new BadRequestError(readiness.message);
  }
}

function getPositiveConfig(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DAILY_SPEND_LIMIT_USD = getPositiveConfig("DIGITAL_SERVICES_DAILY_SPEND_LIMIT_USD", 250);
const MAX_PURCHASE_AMOUNT_USD = getPositiveConfig("DIGITAL_SERVICES_MAX_PURCHASE_AMOUNT_USD", 100);
const MAX_GIFT_CARD_QUANTITY = getPositiveConfig("DIGITAL_SERVICES_MAX_GIFT_CARD_QUANTITY", 25);
const RELOADLY_OPERATOR_PRICING = {
  NG: {
    340: { discountPercent: 6, fxRate: 1206 },
    341: { discountPercent: 3, fxRate: 1244 },
    342: { discountPercent: 4, fxRate: 1206 },
    344: { discountPercent: 5, fxRate: 1206 },
    345: { discountPercent: 3, fxRate: 1244 },
    346: { discountPercent: 3, fxRate: 1244 },
    645: { discountPercent: 6, fxRate: 1206 },
    646: { discountPercent: 4, fxRate: 1206 },
    647: { discountPercent: 5, fxRate: 1206 },
    931: { discountPercent: 5, fxRate: 1206 },
    1213: { discountPercent: 1, fxRate: 1 },
    1214: { discountPercent: 1, fxRate: 1 },
    1256: { discountPercent: 4, fxRate: 1206 },
  },
  IL: {
    1160: { discountPercent: 4, fxRate: 2 },
    1161: { discountPercent: 4, fxRate: 2 },
    1162: { discountPercent: 4, fxRate: 2 },
    1163: { discountPercent: 4, fxRate: 2 },
  },
  RU: {
    402: { discountPercent: 5, fxRate: 62.475 },
    406: { discountPercent: 5, fxRate: 62.475 },
    409: { discountPercent: 5, fxRate: 62.475 },
    415: { discountPercent: 5, fxRate: 62.475 },
    1110: { discountPercent: 5, fxRate: 57.8 },
    1111: { discountPercent: 5, fxRate: 57.8 },
    1112: { discountPercent: 5, fxRate: 57.8 },
  },
};

function required(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new BadRequestError(`${label} is required`);
  }
}

function toMoney(value, label = "Amount") {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new BadRequestError(`${label} must be a positive number`);
  }
  return Math.round(number * 100) / 100;
}

function roundAccountingValue(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

function toPurchaseAmount(value, label = "Amount") {
  const amount = toMoney(value, label);
  if (amount > MAX_PURCHASE_AMOUNT_USD) {
    throw new BadRequestError(
      `${label} exceeds the maximum services purchase amount of USD ${MAX_PURCHASE_AMOUNT_USD.toFixed(
        2
      )}`
    );
  }
  return amount;
}

function toPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new BadRequestError(`${label} is invalid`);
  }
  return number;
}

function normalizeCurrency(value) {
  const currency = String(value || "USD")
    .trim()
    .toUpperCase();
  if (!SUPPORTED_WALLET_CURRENCIES.has(currency)) {
    throw new BadRequestError("Only USD wallet purchases are currently supported");
  }
  return currency;
}

function normalizeOptionalCurrencyCode(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const currency = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestError("Local currency code is invalid");
  }
  return currency;
}

function normalizeEmail(value, label = "Email") {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestError(`${label} is invalid`);
  }
  return email;
}

async function sendRevenueWithdrawalReceipt({
  initiatedBy,
  recipientEmail,
  amount,
  currency,
  reference,
  note,
}) {
  const recipients = [recipientEmail, initiatedBy?.email]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  if (!recipients.length) {
    return;
  }

  const displayName = initiatedBy?.name || initiatedBy?.email || "Admin";
  const subject = `Revenue withdrawal paid out - ${config.APP_NAME}`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;">
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #27AE60 0%, #2D9CDB 100%); padding: 30px 20px; text-align: center;">
        <h1 style="color: #ffffff; margin:0; font-size: 32px; font-weight: 700; letter-spacing: 1px;">${config.APP_NAME}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Revenue withdrawal confirmation</p>
      </div>
      <div style="padding: 20px;">
        <h2>Revenue withdrawal sent</h2>
        <p>Hello ${displayName},</p>
        <p>Your AfriOnet platform revenue withdrawal has been sent through PayPal.</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top:0;">Payout details</h3>
          <p><strong>Amount:</strong> ${currency} ${Number(amount || 0).toFixed(2)}</p>
          <p><strong>Recipient:</strong> ${recipientEmail}</p>
          <p><strong>Reference:</strong> ${reference}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          ${note ? `<p><strong>Note:</strong> ${note}</p>` : ""}
        </div>
        <p>PayPal may take a few moments to reflect this payout in the recipient account.</p>
        <p>Best regards,<br/>The ${config.APP_NAME} Team</p>
      </div>
    </div>
  </body></html>`;

  await Promise.all(
    recipients.map(async (email) => {
      const result = await sendEmail(email, subject, html);
      if (!result?.success) {
        console.error("Failed to send revenue withdrawal receipt:", result?.error || email);
      }
    })
  );
}

async function convertAmountToUsd(amount, currencyCode) {
  const normalizedCurrencyCode = normalizeOptionalCurrencyCode(currencyCode) || "USD";
  const normalizedAmount = toMoney(amount, "Provider amount");
  if (normalizedCurrencyCode === "USD") {
    return normalizedAmount;
  }

  const exchangeRate = Number(await getExchangeRate(normalizedCurrencyCode));
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new BadRequestError(`Exchange rate unavailable for ${normalizedCurrencyCode}`);
  }
  return roundAccountingValue(normalizedAmount / exchangeRate);
}

function getReloadlyProviderPricing({ countryCode, operatorId }) {
  if (!countryCode) return null;
  const normalizedCountryCode = String(countryCode).trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(normalizedCountryCode)) {
    return null;
  }
  return RELOADLY_OPERATOR_PRICING[normalizedCountryCode]?.[String(operatorId)] || null;
}

function toPercent(value) {
  const normalized = Number(
    String(value ?? "")
      .replace(/%/g, "")
      .trim()
  );
  if (!Number.isFinite(normalized) || normalized < 0) {
    return 0;
  }
  return normalized;
}

function getGiftCardProductId(product) {
  return product?.productId || product?.id;
}

function getGiftCardDiscountPercent(product) {
  return toPercent(
    product?.discountPercentage ??
      product?.discount ??
      product?.senderDiscountPercentage ??
      product?.discounts?.percentage ??
      product?.discounts?.sender ??
      product?.senderDiscount
  );
}

function getGiftCardCurrencyCode(product) {
  return (
    normalizeOptionalCurrencyCode(
      product?.senderCurrencyCode ||
        product?.senderCurrency ||
        product?.currencyCode ||
        product?.currency ||
        product?.recipientCurrencyCode
    ) || "USD"
  );
}

async function getGiftCardProviderPricing({ countryCode, productId }) {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) {
    return null;
  }

  const sources = countryCode ? [countryCode, undefined] : [undefined];
  const results = await Promise.all(
    sources.map((sourceCountryCode) => provider.getGiftCards(sourceCountryCode))
  );
  const product = results
    .flatMap((products) => (Array.isArray(products) ? products : []))
    .find((item) => String(getGiftCardProductId(item)) === normalizedProductId);

  if (product) {
    return {
      discountPercent: getGiftCardDiscountPercent(product),
      currencyCode: getGiftCardCurrencyCode(product),
    };
  }

  return null;
}

async function buildTransactionPricing({
  countryCode,
  operatorId,
  providerAmount,
  providerCurrencyCode,
  walletCurrency = "USD",
  providerDiscountPercent = 0,
  providerFxRate = null,
}) {
  const normalizedProviderCurrencyCode =
    normalizeOptionalCurrencyCode(providerCurrencyCode) || walletCurrency;
  const normalizedProviderAmount = toMoney(providerAmount, "Provider amount");
  const operatorPricing = getReloadlyProviderPricing({ countryCode, operatorId });
  const providerPricing = operatorPricing || {
    discountPercent: toPercent(providerDiscountPercent),
    fxRate: Number(providerFxRate || 0) || null,
  };

  let customerAmountUsd;
  if (
    providerPricing?.fxRate &&
    providerPricing.fxRate > 1 &&
    normalizedProviderCurrencyCode !== "USD"
  ) {
    customerAmountUsd = roundAccountingValue(normalizedProviderAmount / providerPricing.fxRate);
  } else {
    customerAmountUsd = await convertAmountToUsd(
      normalizedProviderAmount,
      normalizedProviderCurrencyCode
    );
  }

  const customerAmount = toPurchaseAmount(customerAmountUsd);
  const appliedProviderDiscountPercent = Number(providerPricing?.discountPercent || 0);
  const platformFeeUsd = roundAccountingValue(
    customerAmount * (appliedProviderDiscountPercent / 100)
  );
  const providerCostUsd = roundAccountingValue(customerAmount - platformFeeUsd);

  return {
    customerAmount,
    customerCurrency: walletCurrency,
    providerAmount: normalizedProviderAmount,
    providerCurrency: normalizedProviderCurrencyCode,
    providerCostUsd,
    platformFeeUsd,
    providerDiscountPercent: appliedProviderDiscountPercent,
    feePercent: 0,
    fixedFeeUsd: 0,
    minimumFeeUsd: 0,
  };
}

function normalizePhone(value) {
  const phone = String(value || "").trim();
  if (!/^\+?[\d\s\-()]{5,24}$/.test(phone)) {
    throw new BadRequestError("Recipient phone number is invalid");
  }
  return phone;
}

function normalizeCountryCode(value) {
  const countryCode = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryCode)) {
    throw new BadRequestError("Country code is invalid");
  }
  return countryCode;
}

function getIdempotencyKey(req) {
  const key = String(req.get("Idempotency-Key") || req.body.clientRequestId || "")
    .trim()
    .slice(0, 120);
  return key || null;
}

function getProviderReference(data) {
  return data?.transactionId || data?.id || data?.orderId || data?.referenceId || null;
}

function normalizeProviderStatus(data) {
  return String(data?.status || data?.transactionStatus || data?.orderStatus || "")
    .trim()
    .toUpperCase();
}

function numbersMatch(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return true;
  }
  return Math.round(leftNumber * 100) === Math.round(rightNumber * 100);
}

function valuesMatch(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return true;
  }
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function getResponseAmount(data) {
  return (
    data?.amount ||
    data?.requestedAmount ||
    data?.deliveredAmount ||
    data?.recipient?.amount ||
    data?.order?.amount ||
    data?.totalAmount
  );
}

function getResponseCurrency(data) {
  return (
    data?.currencyCode ||
    data?.currency ||
    data?.requestedCurrencyCode ||
    data?.deliveredAmountCurrencyCode ||
    data?.recipient?.currencyCode ||
    data?.order?.currencyCode
  );
}

function getResponseOperatorId(data) {
  return data?.operatorId || data?.operator?.operatorId || data?.operator?.id;
}

function getResponseProductId(data) {
  return data?.productId || data?.product?.productId || data?.product?.id;
}

function usesLocalProviderAmount(transaction) {
  return transaction?.requestPayload?.useLocalAmount === true;
}

function getExpectedProviderAmount(transaction) {
  if (usesLocalProviderAmount(transaction)) {
    return transaction?.requestPayload?.amount;
  }
  return transaction?.amount?.value;
}

function getExpectedProviderCurrency(transaction) {
  if (usesLocalProviderAmount(transaction)) {
    return transaction?.requestPayload?.localCurrencyCode || null;
  }
  return transaction?.amount?.currency;
}

function validateProviderResponse(result, transaction) {
  const providerReference = getProviderReference(result);
  const providerStatus = normalizeProviderStatus(result);
  const reviewReasons = [];

  if (!providerReference) {
    reviewReasons.push("Provider response is missing a transaction reference");
  }

  if (!providerStatus) {
    reviewReasons.push("Provider response is missing a final status");
  } else if (PROVIDER_FAILURE_STATUSES.has(providerStatus)) {
    return {
      outcome: "failed",
      providerReference,
      message: `Provider returned ${providerStatus}`,
    };
  } else if (!PROVIDER_SUCCESS_STATUSES.has(providerStatus)) {
    reviewReasons.push(`Provider status is ${providerStatus}`);
  }

  const responseAmount = getResponseAmount(result);
  if (!numbersMatch(responseAmount, getExpectedProviderAmount(transaction))) {
    reviewReasons.push("Provider amount does not match the requested amount");
  }

  const responseCurrency = getResponseCurrency(result);
  if (!valuesMatch(responseCurrency, getExpectedProviderCurrency(transaction))) {
    reviewReasons.push("Provider currency does not match the requested currency");
  }

  const responseOperatorId = getResponseOperatorId(result);
  if (!valuesMatch(responseOperatorId, transaction.recipient?.operatorId)) {
    reviewReasons.push("Provider operator does not match the requested operator");
  }

  const responseProductId = getResponseProductId(result);
  if (
    transaction.serviceType === "gift-card" &&
    !valuesMatch(responseProductId, transaction.product?.id)
  ) {
    reviewReasons.push("Provider product does not match the requested product");
  }

  if (reviewReasons.length > 0) {
    return {
      outcome: "manual-review",
      providerReference,
      message: reviewReasons.join("; "),
    };
  }

  return {
    outcome: "completed",
    providerReference,
    message: null,
  };
}

function isAmbiguousProviderError(error) {
  const message = String(error.message || "").toLowerCase();
  if (message.includes("provider is not configured") || message.includes("authentication failed")) {
    return false;
  }
  if (!error.statusCode) return true;
  return error.statusCode >= 500;
}

async function getVerifiedUserWalletBalance(userId, currency = "USD") {
  const walletCurrency = normalizeCurrency(currency);
  const [entries, fundingDebits] = await Promise.all([
    WalletLedger.find({ user: userId, currency: walletCurrency })
      .select("type amount reference")
      .lean(),
    PlatformWalletLedger.find({
      walletKey: FUNDING_WALLET_KEY,
      type: "debit",
      currency: walletCurrency,
    })
      .select("reference")
      .lean(),
  ]);

  const fundedReferences = new Set(fundingDebits.map((entry) => String(entry.reference || "")));

  const verifiedBalance = entries.reduce((balance, entry) => {
    const amount = Number(entry.amount || 0);
    const reference = String(entry.reference || "");
    if (entry.type === "credit") {
      return reference.startsWith("payment_") || fundedReferences.has(reference)
        ? balance + amount
        : balance;
    }
    if (entry.type === "refund") {
      return balance + amount;
    }
    if (entry.type === "debit") {
      return balance - amount;
    }
    return balance;
  }, 0);

  return Math.max(0, Math.round(verifiedBalance * 100) / 100);
}

async function syncVerifiedUserWallet(userId, currency = "USD") {
  const walletCurrency = normalizeCurrency(currency);
  const balance = await getVerifiedUserWalletBalance(userId, walletCurrency);
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "digitalWallet.balance": balance,
        "digitalWallet.currency": walletCurrency,
        "digitalWallet.updatedAt": new Date(),
      },
    }
  );
  return { balance, currency: walletCurrency, updatedAt: new Date() };
}

function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

async function assertDailySpendLimit({ userId, amount, currency = "USD" }) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  const [summary] = await DigitalServiceTransaction.aggregate([
    {
      $match: {
        user: userId,
        createdAt: { $gte: getStartOfToday() },
        status: { $in: ["processing", "completed", "manual-review"] },
        paymentStatus: "paid",
        "amount.currency": walletCurrency,
      },
    },
    { $group: { _id: null, total: { $sum: "$amount.value" } } },
  ]);

  const spentToday = Number(summary?.total || 0);
  if (spentToday + walletAmount > DAILY_SPEND_LIMIT_USD) {
    throw new BadRequestError(
      `Daily services spend limit exceeded. Limit is ${walletCurrency} ${DAILY_SPEND_LIMIT_USD.toFixed(
        2
      )}`
    );
  }
}

async function assertWalletCanCover({ userId, amount, currency = "USD" }) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  const wallet = await syncVerifiedUserWallet(userId, walletCurrency);
  if (Number(wallet.balance || 0) < walletAmount) {
    throw new BadRequestError("Insufficient wallet balance");
  }
  return wallet;
}

async function findExistingIdempotentTransaction(req) {
  const idempotencyKey = getIdempotencyKey(req);
  if (!idempotencyKey) return null;
  return DigitalServiceTransaction.findOne({
    user: req.user._id,
    idempotencyKey,
  });
}

async function getWallet(req, res, next) {
  try {
    const user = await User.findById(req.user._id).select("digitalWallet").lean();
    const wallet = await syncVerifiedUserWallet(
      req.user._id,
      user?.digitalWallet?.currency || "USD"
    );
    res.json({
      success: true,
      wallet,
    });
  } catch (error) {
    next(error);
  }
}

async function createWalletLedger({
  userId,
  type,
  amount,
  currency,
  balanceAfter,
  reference,
  transactionId = null,
  note = "",
  createdBy = null,
}) {
  return WalletLedger.create({
    user: userId,
    type,
    amount,
    currency,
    balanceAfter,
    reference,
    transaction: transactionId,
    note,
    createdBy,
  });
}

async function getFundingWallet() {
  const wallet = await PlatformWallet.findOneAndUpdate(
    { key: FUNDING_WALLET_KEY },
    {
      $setOnInsert: {
        key: FUNDING_WALLET_KEY,
        name: "AfriOnet digital services funding wallet",
        balance: 0,
        currency: "USD",
      },
    },
    { new: true, upsert: true }
  ).lean();

  const entries = await PlatformWalletLedger.find({
    walletKey: FUNDING_WALLET_KEY,
  })
    .select("type amount reference")
    .lean();

  const verifiedBalance = entries.reduce((balance, entry) => {
    const amount = Number(entry.amount || 0);
    const reference = String(entry.reference || "");
    if (entry.type === "credit" && reference.startsWith("payment_")) {
      return balance + amount;
    }
    if (entry.type === "debit") {
      return balance - amount;
    }
    if (entry.type === "refund") {
      return balance + amount;
    }
    return balance;
  }, 0);

  const balance = Math.max(0, Math.round(verifiedBalance * 100) / 100);
  if (Number(wallet.balance || 0) !== balance) {
    await PlatformWallet.updateOne(
      { key: FUNDING_WALLET_KEY },
      { $set: { balance, updatedAt: new Date() } }
    );
  }

  return { ...wallet, balance };
}

async function getRevenueWallet() {
  const wallet = await PlatformWallet.findOneAndUpdate(
    { key: REVENUE_WALLET_KEY },
    {
      $setOnInsert: {
        key: REVENUE_WALLET_KEY,
        name: "AfriOnet digital services revenue wallet",
        balance: 0,
        currency: "USD",
      },
    },
    { new: true, upsert: true }
  ).lean();

  const [revenueTotals, entries] = await Promise.all([
    DigitalServiceTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$pricing.platformFeeUsd" } } },
    ]),
    PlatformWalletLedger.find({ walletKey: REVENUE_WALLET_KEY }).select("type amount").lean(),
  ]);

  const accruedRevenue = roundAccountingValue(Number(revenueTotals[0]?.total || 0));
  const ledgerDelta = entries.reduce((total, entry) => {
    const amount = Number(entry.amount || 0);
    if (entry.type === "debit") {
      return total - amount;
    }
    if (entry.type === "credit" || entry.type === "refund" || entry.type === "adjustment") {
      return total + amount;
    }
    return total;
  }, 0);

  const balance = Math.max(0, roundAccountingValue(accruedRevenue + ledgerDelta));
  if (Number(wallet.balance || 0) !== balance) {
    await PlatformWallet.updateOne(
      { key: REVENUE_WALLET_KEY },
      { $set: { balance, updatedAt: new Date() } }
    );
  }

  return {
    ...wallet,
    balance,
    accruedRevenue,
  };
}

async function createFundingLedger({
  type,
  amount,
  currency,
  balanceAfter,
  reference,
  note = "",
  user = null,
  createdBy = null,
}) {
  return PlatformWalletLedger.create({
    walletKey: FUNDING_WALLET_KEY,
    type,
    amount,
    currency,
    balanceAfter,
    reference,
    note,
    user,
    createdBy,
  });
}

async function createRevenueLedger({
  type,
  amount,
  currency,
  balanceAfter,
  reference,
  note = "",
  createdBy = null,
}) {
  return PlatformWalletLedger.create({
    walletKey: REVENUE_WALLET_KEY,
    type,
    amount,
    currency,
    balanceAfter,
    reference,
    note,
    createdBy,
  });
}

async function debitFundingWallet({
  amount,
  currency = "USD",
  reference,
  note = "",
  user = null,
  createdBy = null,
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  await getFundingWallet();

  const wallet = await PlatformWallet.findOneAndUpdate(
    {
      key: FUNDING_WALLET_KEY,
      balance: { $gte: walletAmount },
      currency: walletCurrency,
    },
    {
      $inc: { balance: -walletAmount },
      $set: { updatedAt: new Date() },
    },
    { new: true }
  );

  if (!wallet) {
    throw new BadRequestError("Insufficient AfriOnet funding wallet balance");
  }

  const ledger = await createFundingLedger({
    type: "debit",
    amount: walletAmount,
    currency: walletCurrency,
    balanceAfter: Number(wallet.balance || 0),
    reference,
    note,
    user,
    createdBy,
  });

  return { wallet, ledger };
}

async function withdrawRevenue({
  amount,
  currency = "USD",
  note = "",
  createdBy = null,
  recipientEmail,
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  const payoutRecipientEmail = normalizeEmail(recipientEmail, "Payout recipient email");
  assertPayPalPayoutReadiness();
  await getRevenueWallet();

  const wallet = await PlatformWallet.findOneAndUpdate(
    {
      key: REVENUE_WALLET_KEY,
      balance: { $gte: walletAmount },
      currency: walletCurrency,
    },
    {
      $inc: { balance: -walletAmount },
      $set: { updatedAt: new Date() },
    },
    { new: true }
  );

  if (!wallet) {
    throw new BadRequestError("Insufficient platform revenue available to withdraw");
  }

  let payout;
  try {
    payout = await createPayout({
      recipientEmail: payoutRecipientEmail,
      amount: walletAmount,
      currency: walletCurrency,
      note: note || "AfriOnet digital services revenue withdrawal",
    });
  } catch (error) {
    await PlatformWallet.updateOne(
      { key: REVENUE_WALLET_KEY },
      { $inc: { balance: walletAmount }, $set: { updatedAt: new Date() } }
    );
    throw error;
  }

  const payoutBatchId = payout?.batch_header?.payout_batch_id || provider.buildReference("revenue");

  const ledger = await createRevenueLedger({
    type: "debit",
    amount: walletAmount,
    currency: walletCurrency,
    balanceAfter: Number(wallet.balance || 0),
    reference: payoutBatchId,
    note: `${note || "Platform revenue withdrawal"} -> ${payoutRecipientEmail}`,
    createdBy,
  });

  return { wallet, ledger, payout };
}

async function creditWallet({
  userId,
  amount,
  currency = "USD",
  type = "credit",
  reference,
  transactionId = null,
  note = "",
  createdBy = null,
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $inc: { "digitalWallet.balance": walletAmount },
      $set: {
        "digitalWallet.currency": walletCurrency,
        "digitalWallet.updatedAt": new Date(),
      },
    },
    { new: true }
  ).select("digitalWallet");

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const ledger = await createWalletLedger({
    userId,
    type,
    amount: walletAmount,
    currency: walletCurrency,
    balanceAfter: Number(user.digitalWallet?.balance || 0),
    reference,
    transactionId,
    note,
    createdBy,
  });

  return { user, ledger };
}

async function debitWallet({
  userId,
  amount,
  currency = "USD",
  reference,
  transactionId,
  note = "",
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  await syncVerifiedUserWallet(userId, walletCurrency);
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "digitalWallet.balance": { $gte: walletAmount },
      $or: [
        { "digitalWallet.currency": walletCurrency },
        { "digitalWallet.currency": { $exists: false } },
        { "digitalWallet.currency": null },
      ],
    },
    {
      $inc: { "digitalWallet.balance": -walletAmount },
      $set: {
        "digitalWallet.currency": walletCurrency,
        "digitalWallet.updatedAt": new Date(),
      },
    },
    { new: true }
  ).select("digitalWallet");

  if (!user) {
    throw new BadRequestError("Insufficient wallet balance");
  }

  const ledger = await createWalletLedger({
    userId,
    type: "debit",
    amount: walletAmount,
    currency: walletCurrency,
    balanceAfter: Number(user.digitalWallet?.balance || 0),
    reference,
    transactionId,
    note,
  });

  return { user, ledger };
}

async function refundWallet({ transaction, reason }) {
  const currentTransaction = transaction;
  if (
    !currentTransaction.wallet?.debited ||
    currentTransaction.wallet?.refunded >= currentTransaction.wallet.debited
  ) {
    return null;
  }

  const refundAmount = toMoney(
    currentTransaction.wallet.debited - (currentTransaction.wallet.refunded || 0)
  );
  const { ledger } = await creditWallet({
    userId: currentTransaction.user,
    amount: refundAmount,
    currency: currentTransaction.wallet.currency || currentTransaction.amount.currency || "USD",
    type: "refund",
    reference: `${currentTransaction.reference}_refund`,
    transactionId: currentTransaction._id,
    note: reason,
  });

  currentTransaction.wallet.refunded = toMoney(
    (currentTransaction.wallet.refunded || 0) + refundAmount
  );
  currentTransaction.wallet.refundLedger = ledger._id;
  currentTransaction.paymentStatus = "refunded";
  return ledger;
}

async function createPendingTransaction({
  req,
  serviceType,
  reference,
  amount,
  currency,
  pricing,
  payload,
  recipient,
  product,
}) {
  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const existing = await DigitalServiceTransaction.findOne({
      user: req.user._id,
      idempotencyKey,
    });
    if (existing) {
      return { transaction: existing, duplicate: true };
    }
  }

  const transaction = await DigitalServiceTransaction.create({
    user: req.user._id,
    serviceType,
    provider: provider.name,
    reference,
    idempotencyKey,
    recipient,
    amount: { value: amount, currency },
    pricing: pricing
      ? {
          customerAmount: {
            value: pricing.customerAmount,
            currency: pricing.customerCurrency || currency,
          },
          providerAmount: {
            value: pricing.providerAmount,
            currency: pricing.providerCurrency || currency,
          },
          providerCostUsd: pricing.providerCostUsd,
          platformFeeUsd: pricing.platformFeeUsd,
          providerDiscountPercent: pricing.providerDiscountPercent,
          feePercent: pricing.feePercent,
          fixedFeeUsd: pricing.fixedFeeUsd,
          minimumFeeUsd: pricing.minimumFeeUsd,
        }
      : {
          customerAmount: { value: amount, currency },
          providerAmount: { value: amount, currency },
          providerCostUsd: amount,
          platformFeeUsd: 0,
          providerDiscountPercent: 0,
          feePercent: 0,
          fixedFeeUsd: 0,
          minimumFeeUsd: 0,
        },
    wallet: { currency },
    product,
    requestPayload: payload,
    status: "pending",
    paymentStatus: "unpaid",
  });

  return { transaction, duplicate: false };
}

async function chargeAndRunProvider({ transaction, providerCall, debitNote }) {
  const currentTransaction = transaction;
  if (currentTransaction.status === "completed") {
    return {
      transaction: currentTransaction,
      result: currentTransaction.providerResponse,
      duplicate: true,
    };
  }

  if (currentTransaction.status !== "pending") {
    throw new BadRequestError("Transaction cannot be processed again");
  }

  let ledger;
  try {
    ({ ledger } = await debitWallet({
      userId: currentTransaction.user,
      amount: currentTransaction.amount.value,
      currency: currentTransaction.amount.currency,
      reference: currentTransaction.reference,
      transactionId: currentTransaction._id,
      note: debitNote,
    }));
  } catch (error) {
    currentTransaction.status = "failed";
    currentTransaction.paymentStatus = "unpaid";
    currentTransaction.failureMessage = error.message;
    await currentTransaction.save();
    throw error;
  }

  currentTransaction.status = "processing";
  currentTransaction.paymentStatus = "paid";
  currentTransaction.wallet.debited = currentTransaction.amount.value;
  currentTransaction.wallet.currency = currentTransaction.amount.currency;
  currentTransaction.wallet.debitLedger = ledger._id;
  await currentTransaction.save();

  try {
    const result = await providerCall();
    const validation = validateProviderResponse(result, currentTransaction);
    currentTransaction.status = validation.outcome;
    currentTransaction.failureMessage = validation.outcome === "failed" ? validation.message : null;
    currentTransaction.reviewNote =
      validation.outcome === "manual-review" ? validation.message : null;
    currentTransaction.providerReference = validation.providerReference;
    currentTransaction.providerResponse = result;

    if (validation.outcome === "failed") {
      await refundWallet({ transaction: currentTransaction, reason: validation.message });
      await currentTransaction.save();
      const error = new BadRequestError(validation.message);
      error.statusCode = 502;
      error.details = result;
      error.providerFailureHandled = true;
      throw error;
    }

    await currentTransaction.save();
    return { transaction: currentTransaction, result, duplicate: false };
  } catch (error) {
    if (error.providerFailureHandled) {
      throw error;
    }
    if (isAmbiguousProviderError(error)) {
      currentTransaction.status = "manual-review";
      currentTransaction.failureMessage = null;
      currentTransaction.reviewNote = error.message;
      currentTransaction.providerResponse = error.details || null;
      await currentTransaction.save();
      return {
        transaction: currentTransaction,
        result: currentTransaction.providerResponse,
        duplicate: false,
      };
    }
    currentTransaction.status = "failed";
    currentTransaction.failureMessage = error.message;
    currentTransaction.reviewNote = null;
    currentTransaction.providerResponse = error.details || null;
    await refundWallet({ transaction: currentTransaction, reason: error.message });
    await currentTransaction.save();
    throw error;
  }
}

async function listAirtimeCountries(req, res, next) {
  try {
    const countries = await provider.getCountries();
    res.json({ success: true, countries });
  } catch (error) {
    next(error);
  }
}

async function listAirtimeOperators(req, res, next) {
  try {
    const country = String(req.params.country || "")
      .trim()
      .toUpperCase();
    required(country, "Country code");
    const operators = await provider.getOperators(country);
    res.json({ success: true, operators });
  } catch (error) {
    next(error);
  }
}

async function sendAirtime(req, res, next) {
  try {
    const {
      operatorId,
      amount,
      localAmount,
      localCurrencyCode,
      recipientPhone,
      senderPhone,
      countryCode,
    } = req.body;
    required(operatorId, "Operator");
    required(amount, "Amount");
    required(recipientPhone, "Recipient phone");
    const normalizedOperatorId = toPositiveInteger(operatorId, "Operator");
    const normalizedCountryCode = normalizeCountryCode(countryCode);
    const normalizedPhone = normalizePhone(recipientPhone);
    const providerAmount =
      localAmount === undefined || localAmount === null || localAmount === ""
        ? toMoney(amount, "Amount")
        : toMoney(localAmount, "Local amount");
    const currency = normalizeCurrency(req.body.currency || "USD");
    const normalizedLocalCurrencyCode = normalizeOptionalCurrencyCode(localCurrencyCode);
    const pricing = await buildTransactionPricing({
      countryCode: normalizedCountryCode,
      operatorId: normalizedOperatorId,
      providerAmount,
      providerCurrencyCode: normalizedLocalCurrencyCode || currency,
      walletCurrency: currency,
    });
    const purchaseAmount = pricing.customerAmount;
    const existingTransaction = await findExistingIdempotentTransaction(req);
    if (existingTransaction) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        transaction: existingTransaction,
      });
    }
    await assertDailySpendLimit({
      userId: req.user._id,
      amount: purchaseAmount,
      currency,
    });
    await assertWalletCanCover({
      userId: req.user._id,
      amount: purchaseAmount,
      currency,
    });

    const reference = provider.buildReference("airtime");
    const payload = {
      operatorId: normalizedOperatorId,
      amount: providerAmount,
      useLocalAmount: true,
      localCurrencyCode: normalizedLocalCurrencyCode,
      customIdentifier: reference,
      recipientPhone: { countryCode: normalizedCountryCode, number: normalizedPhone },
      senderPhone: {
        countryCode: normalizedCountryCode,
        number: senderPhone ? normalizePhone(senderPhone) : normalizedPhone,
      },
    };

    const { transaction, duplicate } = await createPendingTransaction({
      req,
      serviceType: "airtime",
      reference,
      amount: purchaseAmount,
      currency,
      pricing,
      payload,
      recipient: {
        phone: normalizedPhone,
        countryCode: normalizedCountryCode,
        operatorId: normalizedOperatorId,
      },
    });

    if (duplicate) {
      return res.status(200).json({ success: true, duplicate: true, transaction });
    }

    const { result } = await chargeAndRunProvider({
      transaction,
      providerCall: () => provider.sendAirtime(payload),
      debitNote: "Airtime purchase",
    });

    return res.status(201).json({ success: true, transaction, result });
  } catch (error) {
    return next(error);
  }
}

async function listDataBundles(req, res, next) {
  try {
    const { operatorId } = req.query;
    required(operatorId, "Operator");
    const normalizedOperatorId = toPositiveInteger(operatorId, "Operator");
    const bundles = await provider.getDataBundles(normalizedOperatorId);
    return res.json({ success: true, bundles });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.json({
        success: true,
        bundles: [],
        message: "No data bundles found for this operator",
      });
    }
    return next(error);
  }
}

async function purchaseData(req, res, next) {
  try {
    const {
      operatorId,
      packageCode,
      recipientPhone,
      senderPhone,
      countryCode,
      amount,
      localAmount,
      localCurrencyCode,
    } = req.body;
    required(operatorId, "Operator");
    required(recipientPhone, "Recipient phone");
    required(amount, "Amount");
    const normalizedOperatorId = toPositiveInteger(operatorId, "Operator");
    const normalizedCountryCode = normalizeCountryCode(countryCode);
    const normalizedPhone = normalizePhone(recipientPhone);
    const providerAmount =
      localAmount === undefined || localAmount === null || localAmount === ""
        ? toMoney(amount, "Amount")
        : toMoney(localAmount, "Local amount");
    const currency = normalizeCurrency(req.body.currency || "USD");
    const normalizedLocalCurrencyCode = normalizeOptionalCurrencyCode(localCurrencyCode);
    const pricing = await buildTransactionPricing({
      countryCode: normalizedCountryCode,
      operatorId: normalizedOperatorId,
      providerAmount,
      providerCurrencyCode: normalizedLocalCurrencyCode || currency,
      walletCurrency: currency,
    });
    const purchaseAmount = pricing.customerAmount;
    const existingTransaction = await findExistingIdempotentTransaction(req);
    if (existingTransaction) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        transaction: existingTransaction,
      });
    }
    await assertDailySpendLimit({
      userId: req.user._id,
      amount: purchaseAmount,
      currency,
    });
    await assertWalletCanCover({
      userId: req.user._id,
      amount: purchaseAmount,
      currency,
    });

    const reference = provider.buildReference("data");
    const payload = {
      operatorId: normalizedOperatorId,
      amount: providerAmount,
      useLocalAmount: true,
      localCurrencyCode: normalizedLocalCurrencyCode,
      customIdentifier: reference,
      recipientPhone: { countryCode: normalizedCountryCode, number: normalizedPhone },
      senderPhone: {
        countryCode: normalizedCountryCode,
        number: senderPhone ? normalizePhone(senderPhone) : normalizedPhone,
      },
    };
    if (packageCode && !String(packageCode).startsWith("amount:")) {
      payload.data = { packageCode };
    }

    const { transaction, duplicate } = await createPendingTransaction({
      req,
      serviceType: "data",
      reference,
      amount: purchaseAmount,
      currency,
      pricing,
      payload,
      recipient: {
        phone: normalizedPhone,
        countryCode: normalizedCountryCode,
        operatorId: normalizedOperatorId,
      },
      product: {
        id: packageCode || operatorId,
        name: req.body.packageName || "Data bundle",
        countryCode: normalizedCountryCode,
      },
    });

    if (duplicate) {
      return res.status(200).json({ success: true, duplicate: true, transaction });
    }

    const { result } = await chargeAndRunProvider({
      transaction,
      providerCall: () => provider.purchaseData(payload),
      debitNote: "Data bundle purchase",
    });

    return res.status(201).json({ success: true, transaction, result });
  } catch (error) {
    return next(error);
  }
}

async function listGiftCards(req, res, next) {
  try {
    const products = await provider.getGiftCards(req.query.countryCode);
    res.json({ success: true, products });
  } catch (error) {
    next(error);
  }
}

async function purchaseGiftCard(req, res, next) {
  try {
    const {
      productId,
      quantity = 1,
      unitPrice,
      recipientEmail,
      senderName,
      countryCode,
    } = req.body;
    required(productId, "Gift card");
    required(unitPrice, "Unit price");
    required(recipientEmail, "Recipient email");
    const normalizedProductId = toPositiveInteger(productId, "Gift card");
    const requestedQuantity = toPositiveInteger(quantity, "Quantity");
    if (requestedQuantity > MAX_GIFT_CARD_QUANTITY) {
      throw new BadRequestError(
        `Quantity exceeds the maximum allowed value of ${MAX_GIFT_CARD_QUANTITY}`
      );
    }
    const normalizedUnitPrice = toMoney(unitPrice, "Unit price");
    const currency = normalizeCurrency(req.body.currency || "USD");
    const normalizedCountryCode = countryCode ? normalizeCountryCode(countryCode) : undefined;
    const providerPricing = await getGiftCardProviderPricing({
      countryCode: normalizedCountryCode,
      productId: normalizedProductId,
    });
    const pricing = await buildTransactionPricing({
      countryCode: normalizedCountryCode,
      providerAmount: normalizedUnitPrice * requestedQuantity,
      providerCurrencyCode: providerPricing?.currencyCode || currency,
      walletCurrency: currency,
      providerDiscountPercent: providerPricing?.discountPercent || 0,
    });
    const purchaseAmount = pricing.customerAmount;
    const existingTransaction = await findExistingIdempotentTransaction(req);
    if (existingTransaction) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        transaction: existingTransaction,
      });
    }
    await assertDailySpendLimit({
      userId: req.user._id,
      amount: purchaseAmount,
      currency,
    });
    await assertWalletCanCover({
      userId: req.user._id,
      amount: purchaseAmount,
      currency,
    });

    const reference = provider.buildReference("gift");
    const payload = {
      productId: normalizedProductId,
      quantity: requestedQuantity,
      unitPrice: normalizedUnitPrice,
      customIdentifier: reference,
      senderName: senderName || "AfriOnet",
      recipientEmail,
    };

    const { transaction, duplicate } = await createPendingTransaction({
      req,
      serviceType: "gift-card",
      reference,
      amount: purchaseAmount,
      currency,
      pricing,
      payload,
      recipient: { email: recipientEmail, countryCode: normalizedCountryCode },
      product: { id: productId, name: req.body.productName, countryCode: normalizedCountryCode },
    });

    if (duplicate) {
      return res.status(200).json({ success: true, duplicate: true, transaction });
    }

    const { result } = await chargeAndRunProvider({
      transaction,
      providerCall: () => provider.purchaseGiftCard(payload),
      debitNote: "Gift card purchase",
    });

    return res.status(201).json({ success: true, transaction, result });
  } catch (error) {
    return next(error);
  }
}

async function listTransactions(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const transactions = await DigitalServiceTransaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, transactions });
  } catch (error) {
    next(error);
  }
}

async function listAdminTransactions(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.serviceType) query.serviceType = req.query.serviceType;

    const findTransactions = (criteria, max) =>
      DigitalServiceTransaction.find(criteria)
        .populate("user", "name email digitalWallet")
        .populate("resolvedBy", "name email")
        .sort({ createdAt: -1 })
        .limit(max)
        .lean();

    let transactions;
    if (req.query.status) {
      transactions = await findTransactions(query, limit);
    } else {
      const manualReviewTransactions = await findTransactions(
        { ...query, status: "manual-review" },
        limit
      );
      const remainingLimit = Math.max(limit - manualReviewTransactions.length, 0);
      const recentTransactions =
        remainingLimit > 0
          ? await findTransactions({ ...query, status: { $ne: "manual-review" } }, remainingLimit)
          : [];
      transactions = [...manualReviewTransactions, ...recentTransactions];
    }

    const fundingWallet = await getFundingWallet();
    const revenueWallet = await getRevenueWallet();
    const fundingEntries = await PlatformWalletLedger.find({
      walletKey: FUNDING_WALLET_KEY,
      $or: [{ type: { $ne: "credit" } }, { reference: /^payment_/ }],
    })
      .populate("user", "name email")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const fundedReferences = new Set(
      fundingEntries
        .filter((entry) => entry.type === "debit")
        .map((entry) => String(entry.reference))
    );

    const walletCredits = (
      await WalletLedger.find({ type: "credit" })
        .populate("user", "name email digitalWallet")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
    ).map((credit) => ({
      ...credit,
      sourceVerified: fundedReferences.has(String(credit.reference)),
    }));

    const revenueEntries = await PlatformWalletLedger.find({
      walletKey: REVENUE_WALLET_KEY,
    })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      transactions,
      walletCredits,
      fundingWallet,
      fundingEntries,
      revenueWallet,
      revenueEntries,
      paymentEnvironment: getPayPalPayoutReadiness(),
    });
  } catch (error) {
    next(error);
  }
}

async function adminResolveTransaction(req, res, next) {
  try {
    const { status, note = "" } = req.body;
    const resolutionStatus = String(status || "")
      .trim()
      .toLowerCase();
    if (!["completed", "failed"].includes(resolutionStatus)) {
      throw new BadRequestError("Resolution status must be completed or failed");
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.transactionId)) {
      throw new NotFoundError("Transaction not found");
    }

    const transaction = await DigitalServiceTransaction.findById(req.params.transactionId);
    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }
    if (transaction.status !== "manual-review") {
      throw new BadRequestError("Only manual-review transactions can be resolved");
    }

    transaction.status = resolutionStatus;
    transaction.resolutionNote = String(note || "").trim() || null;
    transaction.resolvedAt = new Date();
    transaction.resolvedBy = req.user._id;

    if (resolutionStatus === "completed") {
      // Wallet settlement already happened before manual review; reassert paid on successful resolution.
      transaction.paymentStatus = "paid";
      transaction.failureMessage = null;
    } else {
      transaction.failureMessage = transaction.resolutionNote || "Manual review failed";
      await refundWallet({
        transaction,
        reason: transaction.failureMessage,
      });
    }

    transaction.reviewNote = null;
    await transaction.save();

    const resolvedTransaction = await DigitalServiceTransaction.findById(transaction._id)
      .populate("user", "name email digitalWallet")
      .populate("resolvedBy", "name email")
      .lean();

    res.json({
      success: true,
      transaction: resolvedTransaction,
    });
  } catch (error) {
    next(error);
  }
}

async function adminCreditWallet(req, res, next) {
  try {
    const { userId, amount, currency = "USD", note = "Admin wallet credit" } = req.body;
    required(userId, "User");
    const reference = provider.buildReference("wallet");
    const recipient = await User.findById(userId).select("_id").lean();
    if (!recipient) {
      throw new NotFoundError("User not found");
    }

    const sourceDebit = await debitFundingWallet({
      amount,
      currency,
      reference,
      note: `Funded user wallet: ${note}`,
      user: userId,
      createdBy: req.user._id,
    });

    const { user, ledger } = await creditWallet({
      userId,
      amount,
      currency,
      reference,
      note,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      fundingWallet: sourceDebit.wallet,
      fundingLedger: sourceDebit.ledger,
      wallet: user.digitalWallet,
      ledger,
    });
  } catch (error) {
    next(error);
  }
}

async function adminWithdrawRevenue(req, res, next) {
  try {
    const {
      amount,
      currency = "USD",
      note = "Platform revenue withdrawal",
      recipientEmail,
    } = req.body;
    const result = await withdrawRevenue({
      amount,
      currency,
      note,
      createdBy: req.user._id,
      recipientEmail: recipientEmail || req.user.email,
    });

    await sendRevenueWithdrawalReceipt({
      initiatedBy: req.user,
      recipientEmail: recipientEmail || req.user.email,
      amount,
      currency,
      reference: result.ledger?.reference,
      note,
    });

    res.status(201).json({
      success: true,
      revenueWallet: result.wallet,
      revenueLedger: result.ledger,
      payout: result.payout,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWallet,
  listAirtimeCountries,
  listAirtimeOperators,
  sendAirtime,
  listDataBundles,
  purchaseData,
  listGiftCards,
  purchaseGiftCard,
  listTransactions,
  listAdminTransactions,
  adminResolveTransaction,
  adminCreditWallet,
  adminWithdrawRevenue,
};
