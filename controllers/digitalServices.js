const mongoose = require("mongoose");
const DigitalServiceTransaction = require("../models/DigitalServiceTransaction");
const PlatformWallet = require("../models/PlatformWallet");
const PlatformWalletLedger = require("../models/PlatformWalletLedger");
const User = require("../models/User");
const WalletLedger = require("../models/WalletLedger");
const ServiceWalletLedger = require("../models/ServiceWalletLedger");
const MessageNotification = require("../models/MessageNotification");
const { getExchangeRate } = require("../utils/exchangeRates");
const provider = require("../utils/digitalServicesProvider");
const config = require("../utils/config");
const { createPayout } = require("../utils/paypal");
const { sendEmail } = require("../utils/notifications");
const { BadRequestError, NotFoundError } = require("../utils/errors");

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
const DEFAULT_SERVICE_AGENT_COMMISSION_PERCENT = getPositiveConfig(
  "SERVICE_AGENT_COMMISSION_PERCENT",
  0
);
const DEFAULT_SERVICE_AGENT_DISCOUNT_PERCENT = Number(
  process.env.SERVICE_AGENT_DISCOUNT_PERCENT || 0
);
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
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestError("Wallet currency is invalid");
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

function normalizeOptionalCountryCode(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeCountryCode(value);
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

async function convertUsdToAmount(amount, currencyCode) {
  const normalizedCurrencyCode = normalizeOptionalCurrencyCode(currencyCode) || "USD";
  const normalizedAmount = toMoney(amount, "Amount");
  if (normalizedCurrencyCode === "USD") {
    return normalizedAmount;
  }

  const exchangeRate = Number(await getExchangeRate(normalizedCurrencyCode));
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new BadRequestError(`Exchange rate unavailable for ${normalizedCurrencyCode}`);
  }
  return roundAccountingValue(normalizedAmount * exchangeRate, 2);
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

function clampPercent(value, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(max, number);
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

  toPurchaseAmount(customerAmountUsd);
  const customerAmount =
    walletCurrency === "USD"
      ? customerAmountUsd
      : walletCurrency === normalizedProviderCurrencyCode
      ? normalizedProviderAmount
      : await convertUsdToAmount(customerAmountUsd, walletCurrency);
  const appliedProviderDiscountPercent = Number(providerPricing?.discountPercent || 0);
  const platformFeeUsd = roundAccountingValue(
    customerAmountUsd * (appliedProviderDiscountPercent / 100)
  );
  const providerCostUsd = roundAccountingValue(customerAmountUsd - platformFeeUsd);

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
        || reference.startsWith("agent_profit_")
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

  return Math.max(0, roundAccountingValue(verifiedBalance, 6));
}

async function syncVerifiedUserWallet(userId, currency = "USD") {
  const walletCurrency = normalizeCurrency(currency);
  const balance = await getVerifiedUserWalletBalance(userId, walletCurrency);
  const now = new Date();
  const user = await User.findById(userId).select("digitalWallet digitalWallets");
  if (!user) {
    throw new NotFoundError("User not found");
  }

  const wallets = Array.isArray(user.digitalWallets) ? user.digitalWallets : [];
  const existingWallet = wallets.find((entry) => entry.currency === walletCurrency);
  if (existingWallet) {
    existingWallet.balance = balance;
    existingWallet.updatedAt = now;
    if (!existingWallet.status) existingWallet.status = "active";
  } else {
    wallets.push({
      currency: walletCurrency,
      balance,
      lockedBalance: 0,
      status: "active",
      updatedAt: now,
    });
    user.digitalWallets = wallets;
  }

  user.digitalWallet = {
    balance,
    currency: walletCurrency,
    updatedAt: now,
  };
  await user.save();

  return { balance, currency: walletCurrency, updatedAt: now };
}

function isServiceAgentUser(user) {
  return Boolean(
    user?.isServiceAgent ||
      user?.role === "serviceAgent" ||
      user?.serviceAgent?.status === "active"
  );
}

function getServiceAgentConfig(user) {
  const commissionPercent = Number(
    user?.serviceAgent?.commissionPercent ?? DEFAULT_SERVICE_AGENT_COMMISSION_PERCENT
  );
  const discountPercent = Number(
    user?.serviceAgent?.discountPercent ?? DEFAULT_SERVICE_AGENT_DISCOUNT_PERCENT
  );

  return {
    commissionPercent: clampPercent(commissionPercent),
    discountPercent: clampPercent(discountPercent),
  };
}

function buildServiceAgentPricing({ req, pricing, currency }) {
  const amount = Number(pricing?.customerAmount || 0);
  if (!req.body.useAgentWallet) {
    return {
      purchaseAmount: amount,
      serviceAgent: null,
    };
  }

  if (!isServiceAgentUser(req.user)) {
    throw new BadRequestError("Service agent access required");
  }

  const { commissionPercent, discountPercent } = getServiceAgentConfig(req.user);
  const platformRevenue = roundAccountingValue(
    amount * (Number(pricing?.providerDiscountPercent || 0) / 100),
    6
  );
  const requestedDiscount = roundAccountingValue(amount * (discountPercent / 100), 6);
  const agentDiscount = Math.min(requestedDiscount, platformRevenue);
  const remainingPlatformRevenue = Math.max(
    0,
    roundAccountingValue(platformRevenue - agentDiscount, 6)
  );
  const purchaseAmount = Math.max(0.01, roundAccountingValue(amount - agentDiscount, 2));
  const commissionAmount = roundAccountingValue(
    remainingPlatformRevenue * (commissionPercent / 100),
    6
  );

  return {
    purchaseAmount,
    serviceAgent: {
      agent: req.user._id,
      commissionPercent,
      discountPercent,
      commissionAmount,
      profitAmount: roundAccountingValue(commissionAmount + agentDiscount, 6),
      platformRevenue,
      currency,
    },
  };
}

function getServiceAgentProfit(transaction) {
  const storedProfit = Number(transaction.serviceAgent?.profitAmount || 0);
  if (storedProfit > 0) return storedProfit;

  const amount = Number(transaction.amount?.value || transaction.pricing?.customerAmount?.value || 0);
  const providerDiscountPercent = Number(transaction.pricing?.providerDiscountPercent || 0);
  const commissionPercent = Number(transaction.serviceAgent?.commissionPercent || 0);
  const discountPercent = Number(transaction.serviceAgent?.discountPercent || 0);
  if (!amount || !providerDiscountPercent || (!commissionPercent && !discountPercent)) {
    return 0;
  }

  const platformRevenue = roundAccountingValue(amount * (providerDiscountPercent / 100), 6);
  const requestedDiscount = roundAccountingValue(amount * (discountPercent / 100), 6);
  const agentDiscount = Math.min(requestedDiscount, platformRevenue);
  const remainingPlatformRevenue = Math.max(
    0,
    roundAccountingValue(platformRevenue - agentDiscount, 6)
  );
  const commissionAmount = roundAccountingValue(
    remainingPlatformRevenue * (commissionPercent / 100),
    6
  );
  return roundAccountingValue(commissionAmount + agentDiscount, 6);
}

async function createServiceWalletLedger({
  agentId,
  type,
  amount,
  currency,
  balanceAfter,
  reference,
  transactionId = null,
  note = "",
  createdBy = null,
  country = null,
}) {
  return ServiceWalletLedger.create({
    agent: agentId,
    type,
    amount,
    currency,
    country,
    balanceAfter,
    reference,
    transaction: transactionId,
    note,
    createdBy,
  });
}

function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

async function assertDailySpendLimit({ userId, amount, amountUsd = null, currency = "USD" }) {
  const walletCurrency = normalizeCurrency(currency);
  const limitAmount = toMoney(amountUsd ?? amount);
  const [summary] = await DigitalServiceTransaction.aggregate([
    {
      $match: {
        user: userId,
        createdAt: { $gte: getStartOfToday() },
        status: { $in: ["processing", "completed", "manual-review"] },
        paymentStatus: "paid",
      },
    },
    { $group: { _id: null, total: { $sum: "$pricing.providerCostUsd" } } },
  ]);

  const spentToday = Number(summary?.total || 0);
  if (spentToday + limitAmount > DAILY_SPEND_LIMIT_USD) {
    throw new BadRequestError(
      `Daily services spend limit exceeded. Limit is USD ${DAILY_SPEND_LIMIT_USD.toFixed(
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
    const user = await User.findById(req.user._id).select("digitalWallet digitalWallets").lean();
    const requestedCurrency = req.query.currency || user?.digitalWallet?.currency || "USD";
    const wallet = await syncVerifiedUserWallet(req.user._id, requestedCurrency);
    const refreshedUser = await User.findById(req.user._id).select("digitalWallets").lean();
    res.json({
      success: true,
      wallet,
      wallets: refreshedUser?.digitalWallets || [wallet],
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
  country = null,
}) {
  return WalletLedger.create({
    user: userId,
    type,
    amount,
    currency,
    country,
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
    .select("type amount reference currency country")
    .lean();

  const balancesByCurrency = entries.reduce((balances, entry) => {
    const amount = Number(entry.amount || 0);
    const reference = String(entry.reference || "");
    const currency = normalizeCurrency(entry.currency || "USD");
    const current = balances.get(currency) || {
      currency,
      country: entry.country || null,
      balance: 0,
      updatedAt: new Date(),
    };
    if (entry.type === "credit" && reference.startsWith("payment_")) {
      current.balance += amount;
    }
    if (entry.type === "debit") {
      current.balance -= amount;
    }
    if (entry.type === "refund") {
      current.balance += amount;
    }
    current.balance = roundAccountingValue(current.balance, 2);
    if (entry.country) current.country = entry.country;
    balances.set(currency, current);
    return balances;
  }, new Map());

  if (!balancesByCurrency.has("USD")) {
    balancesByCurrency.set("USD", {
      currency: "USD",
      country: null,
      balance: Number(wallet.balance || 0),
      updatedAt: new Date(),
    });
  }

  const balances = Array.from(balancesByCurrency.values()).map((entry) => ({
    ...entry,
    balance: Math.max(0, roundAccountingValue(entry.balance, 2)),
    updatedAt: new Date(),
  }));
  const usdBalance = balances.find((entry) => entry.currency === "USD")?.balance || 0;

  await PlatformWallet.updateOne(
    { key: FUNDING_WALLET_KEY },
    {
      $set: {
        balance: usdBalance,
        currency: "USD",
        balances,
        updatedAt: new Date(),
      },
    }
  );

  return { ...wallet, balance: usdBalance, currency: "USD", balances };
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
  country = null,
}) {
  const walletCountry = normalizeOptionalCountryCode(country);
  return PlatformWalletLedger.create({
    walletKey: FUNDING_WALLET_KEY,
    type,
    amount,
    currency,
    country: walletCountry,
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
  country = null,
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  await getFundingWallet();
  const walletCountry = normalizeOptionalCountryCode(country);

  const wallet = await PlatformWallet.findOneAndUpdate(
    {
      key: FUNDING_WALLET_KEY,
      balances: {
        $elemMatch: {
          currency: walletCurrency,
          balance: { $gte: walletAmount },
        },
      },
    },
    {
      $inc: { "balances.$.balance": -walletAmount },
      $set: {
        "balances.$.country": walletCountry,
        "balances.$.updatedAt": new Date(),
        updatedAt: new Date(),
      },
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
    country: walletCountry,
    balanceAfter: Number(
      wallet.balances?.find((entry) => entry.currency === walletCurrency)?.balance || 0
    ),
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
  country = null,
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  const walletCountry = normalizeOptionalCountryCode(country);
  await syncVerifiedUserWallet(userId, walletCurrency);

  const user = await User.findOneAndUpdate(
    { _id: userId, "digitalWallets.currency": walletCurrency },
    {
      $inc: { "digitalWallets.$.balance": walletAmount },
      $set: {
        "digitalWallets.$.country": walletCountry,
        "digitalWallets.$.status": "active",
        "digitalWallets.$.updatedAt": new Date(),
      },
    },
    { new: true }
  ).select("digitalWallet digitalWallets");

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const creditedWallet = user.digitalWallets.find((entry) => entry.currency === walletCurrency);
  user.digitalWallet = {
    balance: Number(creditedWallet?.balance || 0),
    currency: walletCurrency,
    updatedAt: new Date(),
  };
  await user.save();

  const ledger = await createWalletLedger({
    userId,
    type,
    amount: walletAmount,
    currency: walletCurrency,
    country: walletCountry,
    balanceAfter: Number(creditedWallet?.balance || 0),
    reference,
    transactionId,
    note,
    createdBy,
  });

  return { user, ledger };
}

async function creditAgentProfitToWallet({ transaction }) {
  if (!transaction?.serviceAgent?.agent || transaction.status !== "completed") {
    return null;
  }

  const profitAmount = roundAccountingValue(getServiceAgentProfit(transaction), 6);
  if (!Number.isFinite(profitAmount) || profitAmount < 0.000001) {
    return null;
  }

  const walletCurrency = normalizeCurrency(
    transaction.serviceAgent?.currency || transaction.amount?.currency || "USD"
  );
  const reference = `agent_profit_${transaction.reference}`;
  const existingLedger = await WalletLedger.findOne({
    user: transaction.serviceAgent.agent,
    type: "credit",
    reference,
  }).lean();
  if (existingLedger) {
    return existingLedger;
  }

  await syncVerifiedUserWallet(transaction.serviceAgent.agent, walletCurrency);
  const user = await User.findOneAndUpdate(
    { _id: transaction.serviceAgent.agent, "digitalWallets.currency": walletCurrency },
    {
      $inc: { "digitalWallets.$.balance": profitAmount },
      $set: {
        "digitalWallets.$.status": "active",
        "digitalWallets.$.updatedAt": new Date(),
      },
    },
    { new: true }
  ).select("digitalWallet digitalWallets");

  if (!user) {
    throw new NotFoundError("Service agent not found");
  }

  const creditedWallet = user.digitalWallets.find((entry) => entry.currency === walletCurrency);
  user.digitalWallet = {
    balance: Number(creditedWallet?.balance || 0),
    currency: walletCurrency,
    updatedAt: new Date(),
  };
  await user.save();

  const note = `Agent profit from ${transaction.serviceType} sale`;
  const ledger = await createWalletLedger({
    userId: transaction.serviceAgent.agent,
    type: "credit",
    amount: profitAmount,
    currency: walletCurrency,
    balanceAfter: Number(creditedWallet?.balance || 0),
    reference,
    transactionId: transaction._id,
    note,
  });

  await createServiceWalletLedger({
    agentId: transaction.serviceAgent.agent,
    type: "commission",
    amount: profitAmount,
    currency: walletCurrency,
    balanceAfter: Number(creditedWallet?.balance || 0),
    reference,
    transactionId: transaction._id,
    note,
    country: transaction.recipient?.countryCode || transaction.product?.countryCode,
  });

  return ledger;
}

async function debitWallet({
  userId,
  amount,
  currency = "USD",
  reference,
  transactionId,
  note = "",
  country = null,
}) {
  const walletCurrency = normalizeCurrency(currency);
  const walletAmount = toMoney(amount);
  const walletCountry = normalizeOptionalCountryCode(country);
  await syncVerifiedUserWallet(userId, walletCurrency);
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      digitalWallets: {
        $elemMatch: {
          currency: walletCurrency,
          balance: { $gte: walletAmount },
          status: { $ne: "suspended" },
        },
      },
    },
    {
      $inc: { "digitalWallets.$.balance": -walletAmount },
      $set: {
        "digitalWallets.$.country": walletCountry,
        "digitalWallets.$.updatedAt": new Date(),
      },
    },
    { new: true }
  ).select("digitalWallet digitalWallets");

  if (!user) {
    throw new BadRequestError("Insufficient wallet balance");
  }

  const debitedWallet = user.digitalWallets.find((entry) => entry.currency === walletCurrency);
  user.digitalWallet = {
    balance: Number(debitedWallet?.balance || 0),
    currency: walletCurrency,
    updatedAt: new Date(),
  };
  await user.save();

  const ledger = await createWalletLedger({
    userId,
    type: "debit",
    amount: walletAmount,
    currency: walletCurrency,
    country: walletCountry,
    balanceAfter: Number(debitedWallet?.balance || 0),
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
    country: currentTransaction.recipient?.countryCode || currentTransaction.product?.countryCode,
  });

  currentTransaction.wallet.refunded = toMoney(
    (currentTransaction.wallet.refunded || 0) + refundAmount
  );
  currentTransaction.wallet.refundLedger = ledger._id;
  if (currentTransaction.serviceAgent?.agent) {
    await createServiceWalletLedger({
      agentId: currentTransaction.serviceAgent.agent,
      type: "refund",
      amount: refundAmount,
      currency: currentTransaction.wallet.currency || currentTransaction.amount.currency || "USD",
      balanceAfter: Number(ledger.balanceAfter || 0),
      reference: `${currentTransaction.reference}_refund`,
      transactionId: currentTransaction._id,
      note: reason,
      country: currentTransaction.recipient?.countryCode || currentTransaction.product?.countryCode,
    });
  }
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
  serviceAgent = null,
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
    serviceAgent: serviceAgent || undefined,
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
      country: currentTransaction.recipient?.countryCode || currentTransaction.product?.countryCode,
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

  if (currentTransaction.serviceAgent?.agent) {
    const serviceLedger = await createServiceWalletLedger({
      agentId: currentTransaction.serviceAgent.agent,
      type: "debit",
      amount: currentTransaction.amount.value,
      currency: currentTransaction.amount.currency,
      balanceAfter: Number(ledger.balanceAfter || 0),
      reference: currentTransaction.reference,
      transactionId: currentTransaction._id,
      note: debitNote,
      country: currentTransaction.recipient?.countryCode || currentTransaction.product?.countryCode,
    });
    currentTransaction.serviceAgent.ledger = serviceLedger._id;
  }

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

    if (validation.outcome === "completed") {
      await creditAgentProfitToWallet({ transaction: currentTransaction });
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
    const agentPricing = buildServiceAgentPricing({
      req,
      pricing,
      currency,
    });
    const purchaseAmount = agentPricing.purchaseAmount;
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
      amountUsd: pricing.providerCostUsd + pricing.platformFeeUsd,
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
      serviceAgent: agentPricing.serviceAgent,
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
    const agentPricing = buildServiceAgentPricing({
      req,
      pricing,
      currency,
    });
    const purchaseAmount = agentPricing.purchaseAmount;
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
      amountUsd: pricing.providerCostUsd + pricing.platformFeeUsd,
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
      serviceAgent: agentPricing.serviceAgent,
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
      amountUsd: pricing.providerCostUsd + pricing.platformFeeUsd,
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

async function getServiceAgentDashboard(req, res, next) {
  try {
    if (!isServiceAgentUser(req.user)) {
      throw new BadRequestError("Service agent access required");
    }

    const userId = req.user._id;
    let wallets = [];
    const existingWallets = Array.isArray(req.user.digitalWallets)
      ? req.user.digitalWallets
      : [];

    for (const wallet of existingWallets) {
      wallets.push(await syncVerifiedUserWallet(userId, wallet.currency || "USD"));
    }

    if (wallets.length === 0) {
      wallets.push(await syncVerifiedUserWallet(userId, req.user.digitalWallet?.currency || "USD"));
    }

    const [transactions, ledger] = await Promise.all([
      DigitalServiceTransaction.find({ "serviceAgent.agent": userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      ServiceWalletLedger.find({ agent: userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    const normalizedTransactions = transactions.map((transaction) => {
      const profitAmount = getServiceAgentProfit(transaction);
      return {
        ...transaction,
        serviceAgent: {
          ...(transaction.serviceAgent || {}),
          profitAmount,
        },
      };
    });
    await Promise.all(
      normalizedTransactions
        .filter((transaction) => transaction.status === "completed")
        .map((transaction) => creditAgentProfitToWallet({ transaction }))
    );

    const walletCurrencies = new Set(
      [
        ...existingWallets.map((wallet) => wallet.currency),
        ...normalizedTransactions.map((transaction) => transaction.serviceAgent?.currency),
        req.user.digitalWallet?.currency,
        "USD",
      ].filter(Boolean)
    );
    wallets = [];
    for (const currency of walletCurrencies) {
      wallets.push(await syncVerifiedUserWallet(userId, currency));
    }

    const totals = normalizedTransactions.reduce(
      (acc, transaction) => {
        if (transaction.status === "completed") {
          acc.sales += 1;
          acc.volume += Number(transaction.amount?.value || 0);
          acc.profit += getServiceAgentProfit(transaction);
        }
        if (transaction.status === "failed" || transaction.status === "refunded") {
          acc.failed += 1;
        }
        return acc;
      },
      { sales: 0, failed: 0, volume: 0, profit: 0 }
    );

    res.json({
      success: true,
      agent: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        serviceAgent: req.user.serviceAgent,
      },
      wallets,
      transactions: normalizedTransactions,
      ledger,
      totals,
      config: getServiceAgentConfig(req.user),
    });
  } catch (error) {
    next(error);
  }
}

async function requestServiceAgentAccess(req, res, next) {
  try {
    if (isServiceAgentUser(req.user)) {
      return res.json({
        success: true,
        status: "active",
        message: "Your account is already active as a service agent.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          isServiceAgent: false,
          "serviceAgent.status": "pending",
          "serviceAgent.requestedAt": new Date(),
        },
      },
      { new: true }
    ).select("name email phone role isServiceAgent serviceAgent");

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const admins = await User.find({ role: "admin" }).select("_id").lean();
    const title = "Service agent request";
    const body = `${user.name || user.email || "A user"} requested service agent activation. Open /admin/services to review and activate.`;

    await Promise.all(
      admins.map((admin) =>
        MessageNotification.create({
          user: admin._id,
          sender: user._id,
          type: "contact-form",
          title,
          body,
          deliveryChannels: { inApp: true, email: false, push: false },
        })
      )
    );

    res.status(201).json({
      success: true,
      status: "pending",
      message: "Your service agent request has been sent to admin.",
      user,
    });
  } catch (error) {
    next(error);
  }
}

async function listPendingServiceAgentRequests(req, res, next) {
  try {
    const users = await User.find({ "serviceAgent.status": "pending" })
      .select("name fullName email phone role isServiceAgent serviceAgent digitalWallet digitalWallets")
      .sort({ "serviceAgent.requestedAt": -1, createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    next(error);
  }
}

function addCurrencyTotal(target, currency, amount) {
  const normalizedCurrency = normalizeCurrency(currency || "USD");
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return;
  target[normalizedCurrency] = toMoney(Number(target[normalizedCurrency] || 0) + value);
}

function normalizeAgentWallets(user) {
  const wallets = new Map();
  const addWallet = (wallet) => {
    if (!wallet?.currency) return;
    wallets.set(normalizeCurrency(wallet.currency), {
      currency: normalizeCurrency(wallet.currency),
      balance: Number(wallet.balance || 0),
      country: wallet.country || null,
      updatedAt: wallet.updatedAt || null,
    });
  };

  if (Array.isArray(user?.digitalWallets)) {
    user.digitalWallets.forEach(addWallet);
  }
  addWallet(user?.digitalWallet);
  return Array.from(wallets.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

async function listAdminServiceAgents(req, res, next) {
  try {
    const transactionLimit = Math.min(Number(req.query.transactionLimit) || 500, 1000);
    const ledgerLimit = Math.min(Number(req.query.ledgerLimit) || 500, 1000);

    const [serviceUsers, recentTransactions, recentLedger] = await Promise.all([
      User.find({
        $or: [
          { isServiceAgent: true },
          { role: "serviceAgent" },
          { "serviceAgent.status": { $in: ["active", "pending", "suspended"] } },
        ],
      })
        .select("name fullName email phone role isServiceAgent serviceAgent digitalWallet digitalWallets")
        .sort({ "serviceAgent.activatedAt": -1, "serviceAgent.requestedAt": -1, createdAt: -1 })
        .limit(200)
        .lean(),
      DigitalServiceTransaction.find({ "serviceAgent.agent": { $exists: true, $ne: null } })
        .populate("user", "name email phone")
        .sort({ createdAt: -1 })
        .limit(transactionLimit)
        .lean(),
      ServiceWalletLedger.find({})
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .limit(ledgerLimit)
        .lean(),
    ]);

    const agentIds = new Set();
    serviceUsers.forEach((user) => agentIds.add(String(user._id)));
    recentTransactions.forEach((transaction) => {
      if (transaction.serviceAgent?.agent) {
        agentIds.add(String(transaction.serviceAgent.agent));
      }
    });
    recentLedger.forEach((entry) => {
      if (entry.agent) agentIds.add(String(entry.agent));
    });

    const knownUserIds = new Set(serviceUsers.map((user) => String(user._id)));
    const missingAgentIds = Array.from(agentIds).filter((id) => !knownUserIds.has(id));
    const extraUsers =
      missingAgentIds.length > 0
        ? await User.find({ _id: { $in: missingAgentIds } })
            .select("name fullName email phone role isServiceAgent serviceAgent digitalWallet digitalWallets")
            .lean()
        : [];

    const agentsById = new Map(
      [...serviceUsers, ...extraUsers].map((user) => {
        const id = String(user._id);
        return [
          id,
          {
            _id: user._id,
            name: user.name || user.fullName || "",
            email: user.email || "",
            phone: user.phone || "",
            role: user.role,
            isServiceAgent: Boolean(user.isServiceAgent),
            serviceAgent: user.serviceAgent || {},
            wallets: normalizeAgentWallets(user),
            totals: {
              completedSales: 0,
              failedSales: 0,
              totalSales: 0,
              volumeByCurrency: {},
              profitByCurrency: {},
              platformRevenueByCurrency: {},
              creditedByCurrency: {},
              debitedByCurrency: {},
            },
            recentTransactions: [],
            recentLedger: [],
            lastActivityAt: user.serviceAgent?.activatedAt || user.serviceAgent?.requestedAt || null,
          },
        ];
      })
    );

    recentTransactions.forEach((transaction) => {
      const agentId = String(transaction.serviceAgent?.agent || "");
      const agent = agentsById.get(agentId);
      if (!agent) return;

      agent.totals.totalSales += 1;
      if (transaction.status === "completed") {
        agent.totals.completedSales += 1;
        addCurrencyTotal(
          agent.totals.volumeByCurrency,
          transaction.amount?.currency,
          transaction.amount?.value
        );
        addCurrencyTotal(
          agent.totals.profitByCurrency,
          transaction.serviceAgent?.currency || transaction.amount?.currency,
          getServiceAgentProfit(transaction)
        );
        addCurrencyTotal(
          agent.totals.platformRevenueByCurrency,
          transaction.serviceAgent?.currency || transaction.amount?.currency,
          transaction.serviceAgent?.platformRevenue
        );
      }
      if (transaction.status === "failed" || transaction.status === "refunded") {
        agent.totals.failedSales += 1;
      }
      agent.recentTransactions.push({
        _id: transaction._id,
        serviceType: transaction.serviceType,
        status: transaction.status,
        amount: transaction.amount,
        product: transaction.product,
        recipient: transaction.recipient,
        reference: transaction.reference,
        customer: transaction.user,
        createdAt: transaction.createdAt,
        serviceAgent: {
          platformRevenue: transaction.serviceAgent?.platformRevenue || 0,
          profitAmount: getServiceAgentProfit(transaction),
          currency: transaction.serviceAgent?.currency || transaction.amount?.currency || "USD",
        },
      });
      if (!agent.lastActivityAt || new Date(transaction.createdAt) > new Date(agent.lastActivityAt)) {
        agent.lastActivityAt = transaction.createdAt;
      }
    });

    recentLedger.forEach((entry) => {
      const agentId = String(entry.agent || "");
      const agent = agentsById.get(agentId);
      if (!agent) return;

      if (entry.type === "credit") {
        addCurrencyTotal(agent.totals.creditedByCurrency, entry.currency, entry.amount);
      }
      if (["debit", "adjustment"].includes(entry.type)) {
        addCurrencyTotal(agent.totals.debitedByCurrency, entry.currency, entry.amount);
      }
      agent.recentLedger.push({
        _id: entry._id,
        type: entry.type,
        amount: entry.amount,
        currency: entry.currency,
        balanceAfter: entry.balanceAfter,
        reference: entry.reference,
        note: entry.note,
        createdAt: entry.createdAt,
        createdBy: entry.createdBy,
      });
      if (!agent.lastActivityAt || new Date(entry.createdAt) > new Date(agent.lastActivityAt)) {
        agent.lastActivityAt = entry.createdAt;
      }
    });

    const agents = Array.from(agentsById.values())
      .map((agent) => ({
        ...agent,
        recentTransactions: agent.recentTransactions.slice(0, 5),
        recentLedger: agent.recentLedger.slice(0, 5),
      }))
      .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0));

    res.json({
      success: true,
      agents,
      totals: agents.reduce(
        (acc, agent) => {
          acc.agents += 1;
          if (agent.serviceAgent?.status === "active" || agent.isServiceAgent || agent.role === "serviceAgent") {
            acc.activeAgents += 1;
          }
          acc.completedSales += agent.totals.completedSales;
          return acc;
        },
        { agents: 0, activeAgents: 0, completedSales: 0 }
      ),
    });
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

async function adminDeleteTransactionEntry(req, res, next) {
  try {
    const { entryType, entryId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      throw new NotFoundError("Transaction entry not found");
    }

    let deletedEntry = null;
    if (entryType === "service") {
      deletedEntry = await DigitalServiceTransaction.findByIdAndDelete(entryId).lean();
      if (deletedEntry) {
        await Promise.all([
          WalletLedger.deleteMany({ transaction: entryId }),
          ServiceWalletLedger.deleteMany({ transaction: entryId }),
          PlatformWalletLedger.deleteMany({ reference: deletedEntry.reference }),
        ]);
      }
    } else if (entryType === "wallet") {
      deletedEntry = await WalletLedger.findByIdAndDelete(entryId).lean();
    } else if (entryType === "funding") {
      deletedEntry = await PlatformWalletLedger.findOneAndDelete({
        _id: entryId,
        walletKey: FUNDING_WALLET_KEY,
      }).lean();
    } else if (entryType === "revenue") {
      deletedEntry = await PlatformWalletLedger.findOneAndDelete({
        _id: entryId,
        walletKey: REVENUE_WALLET_KEY,
      }).lean();
    } else {
      throw new BadRequestError("Unsupported transaction entry type");
    }

    if (!deletedEntry) {
      throw new NotFoundError("Transaction entry not found");
    }

    res.json({
      success: true,
      deleted: {
        type: entryType,
        id: entryId,
      },
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
      country: req.body.countryCode,
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

async function adminSetServiceAgent(req, res, next) {
  try {
    const {
      userId,
      enabled = true,
      commissionPercent = DEFAULT_SERVICE_AGENT_COMMISSION_PERCENT,
      discountPercent = DEFAULT_SERVICE_AGENT_DISCOUNT_PERCENT,
    } = req.body;
    required(userId, "User");

    const status = enabled ? "active" : "inactive";
    const update = {
      $set: {
        isServiceAgent: Boolean(enabled),
        "serviceAgent.status": status,
        "serviceAgent.commissionPercent": clampPercent(commissionPercent),
        "serviceAgent.discountPercent": clampPercent(discountPercent),
        "serviceAgent.activatedAt": enabled ? new Date() : null,
        "serviceAgent.activatedBy": enabled ? req.user._id : null,
      },
    };
    if (enabled) {
      update.$unset = { "serviceAgent.requestedAt": "" };
    }

    const user = await User.findByIdAndUpdate(
      userId,
      update,
      { new: true }
    ).select("name email role isServiceAgent serviceAgent digitalWallet digitalWallets");

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (enabled) {
      await MessageNotification.deleteMany({
        sender: user._id,
        title: "Service agent request",
      });
    }

    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

async function adminAdjustServiceAgentWallet(req, res, next) {
  try {
    const {
      userId,
      amount,
      currency = "USD",
      countryCode,
      type = "credit",
      note = "Service agent wallet adjustment",
    } = req.body;
    required(userId, "User");

    const agent = await User.findById(userId).select("isServiceAgent role serviceAgent");
    if (!agent) {
      throw new NotFoundError("User not found");
    }
    if (!isServiceAgentUser(agent)) {
      throw new BadRequestError("User is not an active service agent");
    }

    const reference = provider.buildReference("agent");
    const adjustmentType = String(type || "credit").toLowerCase();
    let walletResult;

    if (adjustmentType === "credit") {
      await debitFundingWallet({
        amount,
        currency,
        reference,
        note: `Funded service agent wallet: ${note}`,
        user: userId,
        createdBy: req.user._id,
        country: countryCode,
      });
      walletResult = await creditWallet({
        userId,
        amount,
        currency,
        reference,
        note,
        createdBy: req.user._id,
        country: countryCode,
      });
    } else if (adjustmentType === "debit") {
      walletResult = await debitWallet({
        userId,
        amount,
        currency,
        reference,
        note,
        country: countryCode,
      });
    } else {
      throw new BadRequestError("Adjustment type must be credit or debit");
    }

    const wallet = walletResult.user.digitalWallet;
    const ledger = await createServiceWalletLedger({
      agentId: userId,
      type: adjustmentType === "credit" ? "credit" : "adjustment",
      amount: toMoney(amount),
      currency: normalizeCurrency(currency),
      country: countryCode,
      balanceAfter: Number(wallet?.balance || 0),
      reference,
      note,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      wallet,
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
  getServiceAgentDashboard,
  requestServiceAgentAccess,
  listPendingServiceAgentRequests,
  listAdminServiceAgents,
  listAdminTransactions,
  adminResolveTransaction,
  adminDeleteTransactionEntry,
  adminSetServiceAgent,
  adminAdjustServiceAgentWallet,
  adminCreditWallet,
  adminWithdrawRevenue,
};
