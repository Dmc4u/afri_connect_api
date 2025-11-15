/**
 * 2Checkout Product Configuration
 *
 * These product IDs should match what you configure in your 2Checkout account.
 * Go to: 2Checkout Dashboard > Products > Add Product
 */

const PRODUCT_CODES = {
  Starter: 'afrionet-starter-monthly',
  Premium: 'afrionet-premium-monthly',
  Pro: 'afrionet-pro-monthly',
};

const PRODUCT_PRICES = {
  Starter: 7.00,   // $7 USD
  Premium: 15.00,  // $15 USD
  Pro: 42.00,      // $42 USD
};

/**
 * Get product code for a membership tier
 */
function getProductCode(tier) {
  return PRODUCT_CODES[tier] || null;
}

/**
 * Get product price for a membership tier
 */
function getProductPrice(tier) {
  return PRODUCT_PRICES[tier] || 0;
}

/**
 * Get product info for checkout
 */
function getProductInfo(tier) {
  return {
    productId: getProductCode(tier),
    price: getProductPrice(tier),
    name: `AfriOnet ${tier} Membership`,
    description: `Monthly ${tier} membership subscription`,
    currency: 'USD',
  };
}

module.exports = {
  PRODUCT_CODES,
  PRODUCT_PRICES,
  getProductCode,
  getProductPrice,
  getProductInfo,
};
