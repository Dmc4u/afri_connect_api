#!/usr/bin/env node
/**
 * 2Checkout Integration Test Script
 *
 * This script verifies that your 2Checkout configuration is set up correctly.
 * Run: node scripts/test-2checkout.js
 */

require('dotenv').config();
const cfg = require('../utils/config');

console.log('\n🧪 2Checkout Configuration Test\n');
console.log('='.repeat(50));

// Check required environment variables
const checks = [
  { name: 'TWOCHECKOUT_SELLER_ID', value: cfg.TWOCHECKOUT_SELLER_ID },
  { name: 'TWOCHECKOUT_SECRET_WORD', value: cfg.TWOCHECKOUT_SECRET_WORD },
  { name: 'TWOCHECKOUT_INS_SECRET', value: cfg.TWOCHECKOUT_INS_SECRET },
  { name: 'TWOCHECKOUT_SANDBOX', value: cfg.TWOCHECKOUT_SANDBOX },
  { name: 'TWOCHECKOUT_RETURN_URL', value: cfg.TWOCHECKOUT_RETURN_URL },
  { name: 'TWOCHECKOUT_WEBHOOK_URL', value: cfg.TWOCHECKOUT_WEBHOOK_URL },
];

let allPassed = true;

checks.forEach(check => {
  const status = check.value ? '✅ PASS' : '❌ FAIL';
  const displayValue = check.value
    ? (check.name.includes('SECRET') || check.name.includes('WORD')
        ? '***' + String(check.value).slice(-4)
        : check.value)
    : 'NOT SET';

  console.log(`${status} ${check.name}: ${displayValue}`);

  if (!check.value) allPassed = false;
});

console.log('='.repeat(50));

if (allPassed) {
  console.log('\n✅ All checks passed! Your 2Checkout configuration looks good.\n');
  console.log('Next steps:');
  console.log('1. Make sure you have created products in 2Checkout dashboard');
  console.log('2. Configure webhook URL in 2Checkout dashboard');
  console.log('3. Test with a sandbox transaction');
  console.log('\nSandbox Mode:', cfg.TWOCHECKOUT_SANDBOX ? 'ENABLED ✅' : 'DISABLED ⚠️');
} else {
  console.log('\n❌ Some configuration values are missing.');
  console.log('Please update your .env file with the required values.\n');
  console.log('Get your credentials from:');
  console.log('https://secure.2checkout.com/cpanel/ > Integrations > API\n');
  process.exit(1);
}

// Test signature generation
console.log('\n📝 Testing signature generation...');
const { verifyReturnSignature } = require('../utils/twocheckout');

const testParams = {
  order_number: '12345678',
  total: '7.00',
  key: 'test_key'
};

try {
  const verified = verifyReturnSignature(testParams);
  console.log('Signature verification test:', verified ? '✅ Working' : '⚠️  Not verified (expected in test mode)');
} catch (error) {
  console.error('❌ Signature test failed:', error.message);
}

console.log('\n' + '='.repeat(50) + '\n');
