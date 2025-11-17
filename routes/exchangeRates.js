const express = require('express');
const router = express.Router();
const { getAllExchangeRates } = require('../utils/exchangeRates');

/**
 * GET /exchange-rates
 * Get current exchange rates for all currencies
 */
router.get('/', async (req, res) => {
  try {
    const data = await getAllExchangeRates();

    res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Exchange rates fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange rates',
      error: error.message
    });
  }
});

module.exports = router;
