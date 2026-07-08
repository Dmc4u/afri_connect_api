require("dotenv").config();

const mongoose = require("mongoose");
const DigitalServiceTransaction = require("../models/DigitalServiceTransaction");
const User = require("../models/User");
const { MONGO_URL } = require("../utils/config");
const provider = require("../utils/digitalServicesProvider");

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

const KNOWN_RELOADLY_PRICING_FIELD_PATHS = [
  "discountPercentage",
  "discountPercent",
  "discount",
  "senderDiscountPercentage",
  "senderDiscountPercent",
  "senderDiscount",
  "internationalDiscountPercentage",
  "internationalDiscountPercent",
  "internationalDiscount",
  "discounts.percentage",
  "discounts.sender",
  "discounts.international",
  "fxRate",
  "exchangeRate",
  "rate",
  "fx",
  "fx.rate",
  "fx.exchangeRate",
  "senderCurrencyRate",
  "destinationCurrencyRate",
  "localCurrencyRate",
];

const KNOWN_RELOADLY_PRICING_FIELD_SET = new Set(KNOWN_RELOADLY_PRICING_FIELD_PATHS);

function toMoney(value) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

function roundAccountingValue(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

function getArg(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const prefixed = process.argv.find((arg) => arg.startsWith(prefix));
  if (prefixed) return prefixed.slice(prefix.length);

  const index = process.argv.indexOf(exact);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }

  return null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function firstArg(...names) {
  return names.map((name) => getArg(name)).find((value) => value != null) || null;
}

function normalizeCountryCode(countryCode) {
  return String(countryCode || "")
    .trim()
    .toUpperCase();
}

function normalizeOperatorId(operatorId) {
  const normalized = Number(operatorId || 0);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function firstPositiveNumber(...values) {
  return (
    values
      .map((value) =>
        Number(
          String(value ?? "")
            .replace(/%/g, "")
            .trim()
        )
      )
      .find((number) => Number.isFinite(number) && number > 0) || null
  );
}

function getPathValue(source, path) {
  return path
    .split(".")
    .reduce((current, segment) => (current == null ? undefined : current[segment]), source);
}

function collectKnownPricingCandidateFields(operator) {
  if (!operator || typeof operator !== "object") {
    return {};
  }

  return KNOWN_RELOADLY_PRICING_FIELD_PATHS.reduce((fields, path) => {
    const value = getPathValue(operator, path);
    if (value == null || value === "" || (typeof value === "object" && !Array.isArray(value))) {
      return fields;
    }
    return {
      ...fields,
      [path]: value,
    };
  }, {});
}

function collectOtherPricingCandidateFields(operator) {
  if (!operator || typeof operator !== "object") {
    return {};
  }

  const pricingNamePattern = /(discount|rate|fx|exchange|currency|amount|fee|commission)/i;

  return Object.entries(operator).reduce((fields, [key, value]) => {
    const isNestedObject = typeof value === "object" && !Array.isArray(value);
    if (
      (KNOWN_RELOADLY_PRICING_FIELD_SET.has(key) && !isNestedObject) ||
      !pricingNamePattern.test(key) ||
      value == null ||
      value === ""
    ) {
      return fields;
    }
    if (isNestedObject) {
      const nested = Object.entries(value).reduce((nestedFields, [nestedKey, nestedValue]) => {
        const path = `${key}.${nestedKey}`;
        if (
          KNOWN_RELOADLY_PRICING_FIELD_SET.has(path) ||
          !pricingNamePattern.test(path) ||
          nestedValue == null ||
          nestedValue === "" ||
          typeof nestedValue === "object"
        ) {
          return nestedFields;
        }
        return {
          ...nestedFields,
          [path]: nestedValue,
        };
      }, {});

      return {
        ...fields,
        ...nested,
      };
    }

    return {
      ...fields,
      [key]: value,
    };
  }, {});
}

function getOperatorDynamicPricing(operator) {
  if (!operator || typeof operator !== "object") {
    return null;
  }

  const discountPercent = firstPositiveNumber(
    operator.discountPercentage,
    operator.discountPercent,
    operator.discount,
    operator.senderDiscountPercentage,
    operator.senderDiscountPercent,
    operator.senderDiscount,
    operator.internationalDiscountPercentage,
    operator.internationalDiscountPercent,
    operator.internationalDiscount,
    operator.discounts?.percentage,
    operator.discounts?.sender,
    operator.discounts?.international
  );
  const fxRate = firstPositiveNumber(
    operator.fxRate,
    operator.exchangeRate,
    operator.rate,
    operator.fx,
    operator.fx?.rate,
    operator.fx?.exchangeRate,
    operator.senderCurrencyRate,
    operator.destinationCurrencyRate,
    operator.localCurrencyRate
  );

  if (!discountPercent && !fxRate) {
    return null;
  }

  return {
    discountPercent: discountPercent || 0,
    fxRate,
    source: "reloadly-live-now",
  };
}

function getStaticReloadlyProviderPricing({ countryCode, operatorId }) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const normalizedOperatorId = String(operatorId || "");
  const pricing = RELOADLY_OPERATOR_PRICING[normalizedCountryCode]?.[normalizedOperatorId] || null;
  return pricing
    ? {
        ...pricing,
        source: "static-fallback-reference",
      }
    : null;
}

function buildArgs() {
  return {
    ref: firstArg("ref", "reference"),
    providerRef: firstArg("providerRef", "providerReference"),
    id: getArg("id"),
    user: getArg("user"),
    countryCode: firstArg("countryCode", "country"),
    operatorId: firstArg("operatorId", "operator"),
    serviceType: firstArg("type", "serviceType"),
    from: getArg("from"),
    to: getArg("to"),
    amountUsd: getArg("amountUsd"),
    providerAmount: getArg("providerAmount"),
    providerCurrency: getArg("providerCurrency"),
    noLive: hasFlag("no-live"),
    latest: hasFlag("latest"),
  };
}

function addDateFilters(query, args) {
  const createdAt = {};
  if (args.from) {
    createdAt.$gte = new Date(args.from);
  }
  if (args.to) {
    createdAt.$lte = new Date(args.to);
  }
  if (Object.keys(createdAt).length > 0) {
    query.createdAt = createdAt;
  }
}

async function findUserId(userArg) {
  if (!userArg) return null;
  if (mongoose.Types.ObjectId.isValid(userArg)) {
    return userArg;
  }

  const user = await User.findOne({
    $or: [{ email: userArg }, { phone: userArg }, { name: userArg }],
  })
    .select("_id email phone name")
    .lean();

  return user?._id || null;
}

async function findTransactionFromArgs(args) {
  if (args.ref) {
    return DigitalServiceTransaction.findOne({ reference: args.ref }).lean();
  }

  if (args.providerRef) {
    return DigitalServiceTransaction.findOne({ providerReference: args.providerRef }).lean();
  }

  if (args.id) {
    if (!mongoose.Types.ObjectId.isValid(args.id)) {
      throw new Error(`Invalid transaction id: ${args.id}`);
    }
    return DigitalServiceTransaction.findById(args.id).lean();
  }

  const query = {
    serviceType: { $in: ["airtime", "data"] },
  };

  if (args.serviceType) {
    query.serviceType = args.serviceType;
  }

  if (args.countryCode) {
    const countryCode = normalizeCountryCode(args.countryCode);
    query.$or = [{ "recipient.countryCode": countryCode }, { "product.countryCode": countryCode }];
  }

  if (args.operatorId) {
    query["recipient.operatorId"] = normalizeOperatorId(args.operatorId);
  }

  if (args.user) {
    const userId = await findUserId(args.user);
    if (!userId) {
      throw new Error(`No user found for --user=${args.user}`);
    }
    query.user = userId;
  }

  addDateFilters(query, args);

  return DigitalServiceTransaction.findOne(query).sort({ createdAt: -1 }).lean();
}

function hasManualPricingArgs(args) {
  return (
    args.amountUsd &&
    args.providerAmount &&
    args.providerCurrency &&
    args.countryCode &&
    args.operatorId
  );
}

function hasTransactionSelectorArgs(args) {
  return Boolean(args.ref || args.providerRef || args.id || args.user || args.latest);
}

function buildManualTraceTarget(args) {
  if (!hasManualPricingArgs(args)) return null;

  const customerAmount = toMoney(args.amountUsd);
  return {
    synthetic: true,
    reference: "manual-cli-input",
    createdAt: new Date(),
    serviceType: args.serviceType || "airtime",
    status: "manual",
    amount: {
      value: customerAmount,
      currency: "USD",
    },
    pricing: {
      customerAmount: {
        value: customerAmount,
        currency: "USD",
      },
      providerAmount: {
        value: toMoney(args.providerAmount),
        currency: String(args.providerCurrency || "USD").toUpperCase(),
      },
    },
    recipient: {
      countryCode: normalizeCountryCode(args.countryCode),
      operatorId: normalizeOperatorId(args.operatorId),
    },
  };
}

function resolveOperatorContext(traceTarget, args) {
  const countryCode = normalizeCountryCode(
    args.countryCode || traceTarget?.recipient?.countryCode || traceTarget?.product?.countryCode
  );
  const operatorId = normalizeOperatorId(args.operatorId || traceTarget?.recipient?.operatorId);
  const providerCurrency =
    traceTarget?.pricing?.providerAmount?.currency ||
    traceTarget?.amount?.currency ||
    args.providerCurrency ||
    "USD";

  return {
    countryCode,
    operatorId,
    providerCurrency: String(providerCurrency || "USD").toUpperCase(),
  };
}

async function getLiveOperatorPricing(operatorContext, args) {
  if (args.noLive || !operatorContext.operatorId) {
    return {
      pricing: null,
      operator: null,
      error: args.noLive ? "--no-live supplied" : "No operator id available",
    };
  }

  try {
    const operator = await provider.getOperator(operatorContext.operatorId);
    return {
      pricing: getOperatorDynamicPricing(operator),
      operator,
      error: null,
    };
  } catch (error) {
    return {
      pricing: null,
      operator: null,
      error: error.message,
    };
  }
}

function getCustomerAmountUsd(traceTarget, providerPricing) {
  const providerAmount = Number(traceTarget?.pricing?.providerAmount?.value || 0);
  const providerCurrency = String(traceTarget?.pricing?.providerAmount?.currency || "USD").toUpperCase();
  const fxRate = Number(providerPricing?.fxRate || 0);

  if (providerAmount > 0 && fxRate > 1 && providerCurrency !== "USD") {
    return roundAccountingValue(providerAmount / fxRate);
  }

  return roundAccountingValue(
    traceTarget?.pricing?.customerAmount?.value ||
      traceTarget?.amount?.value ||
      traceTarget?.pricing?.providerAmount?.value
  );
}

function calculatePricingTrace(traceTarget, providerPricing) {
  if (!providerPricing) return null;

  const customerAmountUsd = getCustomerAmountUsd(traceTarget, providerPricing);
  const discountPercent = Number(providerPricing.discountPercent || 0);
  const platformFeeUsd = roundAccountingValue(customerAmountUsd * (discountPercent / 100));
  const providerCostUsd = roundAccountingValue(customerAmountUsd - platformFeeUsd);

  return {
    source: providerPricing.source,
    customerAmountUsd,
    providerCostUsd,
    platformFeeUsd,
    providerDiscountPercent: discountPercent,
    fxRate: providerPricing.fxRate || null,
  };
}

function getSavedPricingSnapshot(traceTarget) {
  return {
    customerAmount: traceTarget?.pricing?.customerAmount || traceTarget?.amount || null,
    providerAmount: traceTarget?.pricing?.providerAmount || null,
    providerCostUsd: traceTarget?.pricing?.providerCostUsd ?? null,
    platformFeeUsd: traceTarget?.pricing?.platformFeeUsd ?? null,
    providerDiscountPercent: traceTarget?.pricing?.providerDiscountPercent ?? null,
    serviceAgent: traceTarget?.serviceAgent || null,
    wallet: traceTarget?.wallet || null,
  };
}

function compareAmounts(savedValue, recalculatedValue) {
  if (savedValue == null || recalculatedValue == null) return null;
  return roundAccountingValue(Number(savedValue) - Number(recalculatedValue));
}

function buildTraceReport({
  traceTarget,
  operatorContext,
  livePricing,
  liveOperator,
  liveError,
  staticPricing,
}) {
  const effectivePricing = livePricing || staticPricing;
  const saved = getSavedPricingSnapshot(traceTarget);
  const liveRecalculated = calculatePricingTrace(traceTarget, livePricing);
  const staticRecalculated = calculatePricingTrace(traceTarget, staticPricing);
  const effectiveRecalculated = calculatePricingTrace(traceTarget, effectivePricing);
  const knownLiveCandidateFields = collectKnownPricingCandidateFields(liveOperator);
  const otherLiveCandidateFields = collectOtherPricingCandidateFields(liveOperator);

  return {
    traceMode: traceTarget.synthetic ? "manual-cli-input" : "stored-transaction",
    transaction: {
      id: traceTarget._id || null,
      reference: traceTarget.reference,
      providerReference: traceTarget.providerReference || null,
      createdAt: traceTarget.createdAt,
      serviceType: traceTarget.serviceType,
      status: traceTarget.status,
      paymentStatus: traceTarget.paymentStatus || null,
    },
    operatorContext,
    savedAtSale: saved,
    pricingSources: {
      liveReloadlyNow: {
        available: Boolean(livePricing),
        pricing: livePricing,
        operatorSummary: liveOperator
          ? {
              id: liveOperator.operatorId || liveOperator.id || null,
              name: liveOperator.name || liveOperator.operatorName || null,
              countryCode: liveOperator.countryCode || null,
              destinationCurrencyCode: liveOperator.destinationCurrencyCode || null,
              senderCurrencyCode: liveOperator.senderCurrencyCode || null,
          }
          : null,
        rawPricingCandidateFields: liveOperator
          ? {
              checkedFieldsWithValues: knownLiveCandidateFields,
              otherPricingLikeFields: otherLiveCandidateFields,
              extractionStatus: livePricing
                ? "matched at least one checked pricing field"
                : "no checked pricing fields matched; inspect otherPricingLikeFields",
            }
          : null,
        error: liveError,
        note: livePricing
          ? "Live Reloadly pricing now; may differ from pricing at sale time."
          : "Live Reloadly pricing unavailable or disabled.",
      },
      staticFallbackReference: {
        available: Boolean(staticPricing),
        pricing: staticPricing,
        note: "Static fallback/reference only; not authoritative when live pricing is available.",
      },
      effectiveForProductionToday: {
        source: effectivePricing?.source || null,
        pricing: effectivePricing,
        note: livePricing
          ? "Dynamic live pricing would be used first today."
          : "Static fallback would be used only because live pricing is unavailable.",
      },
    },
    recalculated: {
      fromLiveReloadlyNow: liveRecalculated,
      fromStaticFallbackReference: staticRecalculated,
      fromEffectivePricingToday: effectiveRecalculated,
    },
    deltasAgainstSavedAtSale: effectiveRecalculated
      ? {
          providerCostUsd: compareAmounts(
            saved.providerCostUsd,
            effectiveRecalculated.providerCostUsd
          ),
          platformFeeUsd: compareAmounts(saved.platformFeeUsd, effectiveRecalculated.platformFeeUsd),
          providerDiscountPercent: compareAmounts(
            saved.providerDiscountPercent,
            effectiveRecalculated.providerDiscountPercent
          ),
        }
      : null,
    interpretation: [
      "Saved-at-sale values are the transaction record.",
      "Live Reloadly values are fetched now and can change after the sale.",
      "Static fallback values are reference/fallback only and can become stale.",
    ],
  };
}

async function main() {
  const args = buildArgs();
  await mongoose.connect(MONGO_URL);

  const manualTraceTarget =
    hasManualPricingArgs(args) && !hasTransactionSelectorArgs(args)
      ? buildManualTraceTarget(args)
      : null;
  const transaction = manualTraceTarget ? null : await findTransactionFromArgs(args);
  const traceTarget = transaction || manualTraceTarget;

  if (!traceTarget) {
    throw new Error(
      "No matching transaction found. Use --ref, --id, --user, filters, or manual args: --amountUsd --providerAmount --providerCurrency --countryCode --operatorId"
    );
  }

  const operatorContext = resolveOperatorContext(traceTarget, args);
  const live = await getLiveOperatorPricing(operatorContext, args);
  const staticPricing = getStaticReloadlyProviderPricing(operatorContext);
  const report = buildTraceReport({
    traceTarget,
    operatorContext,
    livePricing: live.pricing,
    liveOperator: live.operator,
    liveError: live.error,
    staticPricing,
  });

  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
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
