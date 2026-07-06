require("dotenv").config();

const mongoose = require("mongoose");
const DigitalServiceTransaction = require("../models/DigitalServiceTransaction");
const { MONGO_URL } = require("../utils/config");

const RELOADLY_NIGERIA_OPERATOR_PRICING = {
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
};

function toMoney(value) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

function roundAccountingValue(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function getReloadlyProviderPricing(countryCode, operatorId) {
  const normalizedCountryCode = String(countryCode || "")
    .trim()
    .toUpperCase();
  if (normalizedCountryCode !== "NG") {
    return null;
  }
  return RELOADLY_NIGERIA_OPERATOR_PRICING[String(operatorId)] || null;
}

function traceComputedPricing({
  amountUsd,
  providerAmount,
  providerCurrency,
  countryCode,
  operatorId,
}) {
  const providerPricing = getReloadlyProviderPricing(countryCode, operatorId);
  const customerAmount = toMoney(amountUsd);
  const platformFeeUsd = roundAccountingValue(
    customerAmount * (Number(providerPricing?.discountPercent || 0) / 100)
  );
  const providerCostUsd = roundAccountingValue(customerAmount - platformFeeUsd);

  return {
    input: {
      amountUsd: customerAmount,
      providerAmount: toMoney(providerAmount),
      providerCurrency: String(providerCurrency || "USD").toUpperCase(),
      countryCode: String(countryCode || "").toUpperCase(),
      operatorId: Number(operatorId || 0),
    },
    providerPricing,
    storedPricing: {
      customerAmount,
      providerAmount: toMoney(providerAmount),
      providerCurrency: String(providerCurrency || "USD").toUpperCase(),
      providerCostUsd,
      platformFeeUsd,
      providerDiscountPercent: Number(providerPricing?.discountPercent || 0),
    },
  };
}

async function traceLatestStoredTransaction() {
  await mongoose.connect(MONGO_URL);
  const transaction = await DigitalServiceTransaction.findOne({
    serviceType: { $in: ["airtime", "data"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!transaction) {
    throw new Error("No digital service transactions found");
  }

  const providerPricing = getReloadlyProviderPricing(
    transaction.recipient?.countryCode || transaction.product?.countryCode,
    transaction.recipient?.operatorId
  );
  const expected = providerPricing
    ? traceComputedPricing({
        amountUsd: transaction.amount?.value,
        providerAmount: transaction.pricing?.providerAmount?.value,
        providerCurrency: transaction.pricing?.providerAmount?.currency,
        countryCode: transaction.recipient?.countryCode || transaction.product?.countryCode,
        operatorId: transaction.recipient?.operatorId,
      })
    : null;

  console.log(
    JSON.stringify(
      {
        reference: transaction.reference,
        createdAt: transaction.createdAt,
        status: transaction.status,
        amount: transaction.amount,
        recipient: transaction.recipient,
        storedPricing: transaction.pricing,
        expectedPricing: expected?.storedPricing || null,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

async function main() {
  const amountUsd = getArg("amountUsd");
  const providerAmount = getArg("providerAmount");
  const providerCurrency = getArg("providerCurrency");
  const countryCode = getArg("countryCode");
  const operatorId = getArg("operatorId");

  if (amountUsd && providerAmount && providerCurrency && countryCode && operatorId) {
    console.log(
      JSON.stringify(
        traceComputedPricing({
          amountUsd,
          providerAmount,
          providerCurrency,
          countryCode,
          operatorId,
        }),
        null,
        2
      )
    );
    return;
  }

  await traceLatestStoredTransaction();
}

main().catch(async (error) => {
  console.error("Trace failed:", error);
  process.exitCode = 1;
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect failures during process exit
  }
});
