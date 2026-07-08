const crypto = require("crypto");
const {
  DIGITAL_SERVICES_PROVIDER,
  RELOADLY_CLIENT_ID,
  RELOADLY_CLIENT_SECRET,
  RELOADLY_ENV,
} = require("./config");

const RELOADLY_AUDIENCES = {
  topups: "https://topups.reloadly.com",
  giftCards: "https://giftcards.reloadly.com",
};

const tokenCache = new Map();

function ensureReloadlyConfigured() {
  if (!RELOADLY_CLIENT_ID || !RELOADLY_CLIENT_SECRET) {
    const error = new Error("Digital services provider is not configured");
    error.statusCode = 503;
    throw error;
  }
}

function getReloadlyBaseUrl(audienceKey) {
  const audience = RELOADLY_AUDIENCES[audienceKey];
  return RELOADLY_ENV === "live"
    ? audience
    : audience.replace(".reloadly.com", "-sandbox.reloadly.com");
}

async function parseProviderResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function requestReloadlyToken(audienceKey) {
  ensureReloadlyConfigured();
  const audience = getReloadlyBaseUrl(audienceKey);
  const cached = tokenCache.get(audience);
  if (cached && cached.expiresAt > Date.now() + 60 * 1000) {
    return cached.token;
  }

  const response = await fetch("https://auth.reloadly.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: RELOADLY_CLIENT_ID,
      client_secret: RELOADLY_CLIENT_SECRET,
      grant_type: "client_credentials",
      audience,
    }),
  });
  const data = await parseProviderResponse(response);

  if (!response.ok || !data.access_token) {
    const error = new Error(data.message || data.error || "Reloadly authentication failed");
    error.statusCode = response.status || 502;
    error.details = data;
    throw error;
  }

  tokenCache.set(audience, {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  });

  return data.access_token;
}

async function reloadlyRequest(audienceKey, path, options = {}) {
  const token = await requestReloadlyToken(audienceKey);
  const response = await fetch(`${getReloadlyBaseUrl(audienceKey)}${path}`, {
    ...options,
    headers: {
      Accept: "application/com.reloadly.topups-v1+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await parseProviderResponse(response);

  if (!response.ok) {
    const error = new Error(
      data.message || data.error || `Provider request failed (${response.status})`
    );
    error.statusCode = response.status || 502;
    error.details = data;
    throw error;
  }

  return data;
}

function buildReference(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
}

function getOperatorId(operator) {
  return operator?.operatorId || operator?.id;
}

function getAmountDescription(descriptions, amount) {
  if (!descriptions || typeof descriptions !== "object") return "";
  const amountKey = String(amount);
  return (
    descriptions[amountKey] ||
    descriptions[Number(amount)] ||
    descriptions[amountKey.replace(/\.0+$/, "")] ||
    ""
  );
}

function buildBundlesFromOperator(operator) {
  const operatorId = getOperatorId(operator);
  const operatorName = operator?.name || operator?.operatorName || "Data bundle";
  const fixedAmounts = Array.isArray(operator?.fixedAmounts)
    ? operator.fixedAmounts
    : [];
  const localFixedAmounts = Array.isArray(operator?.localFixedAmounts)
    ? operator.localFixedAmounts
    : [];
  const amounts = fixedAmounts.length > 0 ? fixedAmounts : localFixedAmounts;
  const descriptions =
    fixedAmounts.length > 0
      ? operator?.fixedAmountsDescriptions
      : operator?.localFixedAmountsDescriptions;

  return amounts
    .map((amount) => {
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
      const description = getAmountDescription(descriptions, amount);
      return {
        id: `amount:${numericAmount}`,
        packageCode: `amount:${numericAmount}`,
        name: description || `${operatorName} ${numericAmount}`,
        description: description || `${operatorName} data bundle`,
        amount: numericAmount,
        fixedAmount: numericAmount,
        operatorId,
        source: "operator-fixed-amount",
      };
    })
    .filter(Boolean);
}

function createDigitalServicesProvider() {
  if (DIGITAL_SERVICES_PROVIDER !== "reloadly") {
    throw new Error(`Unsupported digital services provider: ${DIGITAL_SERVICES_PROVIDER}`);
  }

  return {
    name: "reloadly",
    buildReference,
    getCountries() {
      return reloadlyRequest("topups", "/countries");
    },
    getOperators(countryCode) {
      return reloadlyRequest("topups", `/operators/countries/${encodeURIComponent(countryCode)}`);
    },
    getOperator(operatorId) {
      return reloadlyRequest("topups", `/operators/${encodeURIComponent(operatorId)}`);
    },
    async getDataBundles(operatorId) {
      const encodedOperatorId = encodeURIComponent(operatorId);
      try {
        return await reloadlyRequest("topups", `/operators/${encodedOperatorId}/packages`);
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }

      const operator = await reloadlyRequest("topups", `/operators/${encodedOperatorId}`);
      return buildBundlesFromOperator(operator);
    },
    sendAirtime(payload) {
      return reloadlyRequest("topups", "/topups", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    purchaseData(payload) {
      return reloadlyRequest("topups", "/topups", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    getGiftCards(countryCode) {
      const query = countryCode ? `?countryCode=${encodeURIComponent(countryCode)}` : "";
      return reloadlyRequest("giftCards", `/products${query}`, {
        headers: { Accept: "application/com.reloadly.giftcards-v1+json" },
      });
    },
    purchaseGiftCard(payload) {
      return reloadlyRequest("giftCards", "/orders", {
        method: "POST",
        headers: { Accept: "application/com.reloadly.giftcards-v1+json" },
        body: JSON.stringify(payload),
      });
    },
  };
}

module.exports = createDigitalServicesProvider();
