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

function normalizeCurrencyCode(value, fallback = "USD") {
  return String(value || fallback)
    .trim()
    .toUpperCase();
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

function recalculatePricing(transaction) {
  const providerAmount = toMoney(transaction.pricing?.providerAmount?.value || 0);
  const providerCurrency = normalizeCurrencyCode(
    transaction.pricing?.providerAmount?.currency || transaction.amount?.currency,
    "USD"
  );
  const operatorId = transaction.recipient?.operatorId;
  const countryCode = transaction.recipient?.countryCode || transaction.product?.countryCode;
  const providerPricing = getReloadlyProviderPricing(countryCode, operatorId);

  if (!providerPricing || providerPricing.fxRate <= 1 || providerCurrency === "USD") {
    return null;
  }

  const customerAmount = toMoney(transaction.amount?.value || 0);
  const platformFeeUsd = roundAccountingValue(
    customerAmount * (Number(providerPricing.discountPercent || 0) / 100)
  );
  const providerCostUsd = roundAccountingValue(customerAmount - platformFeeUsd);

  return {
    customerAmount,
    providerAmount,
    providerCurrency,
    providerDiscountPercent: Number(providerPricing.discountPercent || 0),
    platformFeeUsd,
    providerCostUsd,
  };
}

async function main() {
  const commit = process.argv.includes("--commit");

  try {
    await mongoose.connect(MONGO_URL);
    console.log("Connected to MongoDB");

    const transactions = await DigitalServiceTransaction.find({
      serviceType: { $in: ["airtime", "data"] },
      "pricing.providerAmount.value": { $gt: 0 },
      "recipient.countryCode": "NG",
    }).sort({ createdAt: -1 });

    const updates = transactions
      .map((transaction) => {
        const recalculated = recalculatePricing(transaction);
        if (!recalculated) {
          return null;
        }

        const currentPlatformFee = Number(transaction.pricing?.platformFeeUsd || 0);
        const currentProviderCost = Number(transaction.pricing?.providerCostUsd || 0);
        const nextPlatformFee = Number(recalculated.platformFeeUsd || 0);
        const nextProviderCost = Number(recalculated.providerCostUsd || 0);
        const currentDiscountPercent = Number(transaction.pricing?.providerDiscountPercent || 0);

        if (
          currentPlatformFee === nextPlatformFee &&
          currentProviderCost === nextProviderCost &&
          currentDiscountPercent === recalculated.providerDiscountPercent
        ) {
          return null;
        }

        return {
          transaction,
          update: {
            reference: transaction.reference,
            status: transaction.status,
            amount: transaction.amount?.value,
            providerAmount: transaction.pricing?.providerAmount,
            before: {
              providerCostUsd: currentProviderCost,
              platformFeeUsd: currentPlatformFee,
              providerDiscountPercent: currentDiscountPercent,
            },
            after: recalculated,
          },
        };
      })
      .filter(Boolean);

    updates.forEach(({ update }) => {
      console.log(JSON.stringify(update, null, 2));
    });

    if (commit) {
      await Promise.all(
        updates.map(({ transaction, update }) => {
          return DigitalServiceTransaction.updateOne(
            { _id: transaction._id },
            {
              $set: {
                "pricing.providerCostUsd": Number(update.after.providerCostUsd || 0),
                "pricing.platformFeeUsd": Number(update.after.platformFeeUsd || 0),
                "pricing.providerDiscountPercent": Number(
                  update.after.providerDiscountPercent || 0
                ),
              },
            }
          );
        })
      );
    }

    console.log(
      `Inspected ${transactions.length} transaction(s). ${commit ? "Updated" : "Would update"} ${updates.length}.`
    );
    await mongoose.disconnect();
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
    try {
      await mongoose.disconnect();
    } catch {
      // ignore disconnect failures during process exit
    }
  }
}

main();
