// Exchange rate cache (updates daily)
let exchangeRateCache = {
  rates: {},
  lastUpdated: null,
  expiryHours: 24
};

/**
 * Fetch latest exchange rates from API
 * Using exchangerate-api.com (free tier: 1,500 requests/month)
 */
async function fetchExchangeRates() {
  try {
    // Free API - no key needed for basic usage
    // Using native fetch (Node.js 18+)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');

    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates');
    }

    const data = await response.json();

    exchangeRateCache = {
      rates: data.rates,
      lastUpdated: new Date(),
      expiryHours: 24
    };

    console.log('✅ Exchange rates updated successfully');
    return data.rates;
  } catch (error) {
    console.error('❌ Error fetching exchange rates:', error);
    // Return cached rates if available
    return exchangeRateCache.rates;
  }
}

/**
 * Get exchange rate for a specific currency
 * @param {string} currencyCode - ISO currency code (e.g., 'NGN', 'KES')
 * @returns {number} Exchange rate relative to USD
 */
async function getExchangeRate(currencyCode) {
  // Check if cache is expired
  const now = new Date();
  const cacheAge = exchangeRateCache.lastUpdated
    ? (now - exchangeRateCache.lastUpdated) / (1000 * 60 * 60)
    : 999;

  // Fetch new rates if cache is expired or empty
  if (cacheAge > exchangeRateCache.expiryHours || !exchangeRateCache.rates[currencyCode]) {
    await fetchExchangeRates();
  }

  return exchangeRateCache.rates[currencyCode] || 1;
}

/**
 * Get all exchange rates
 * @returns {object} All exchange rates
 */
async function getAllExchangeRates() {
  // Check if cache is expired
  const now = new Date();
  const cacheAge = exchangeRateCache.lastUpdated
    ? (now - exchangeRateCache.lastUpdated) / (1000 * 60 * 60)
    : 999;

  // Fetch new rates if cache is expired
  if (cacheAge > exchangeRateCache.expiryHours || Object.keys(exchangeRateCache.rates).length === 0) {
    await fetchExchangeRates();
  }

  return {
    rates: exchangeRateCache.rates,
    lastUpdated: exchangeRateCache.lastUpdated
  };
}

module.exports = {
  getExchangeRate,
  getAllExchangeRates,
  fetchExchangeRates
};
