/**
 * Clear old pending payments
 * Run this script to clean up stuck pending payment records
 */

const mongoose = require('mongoose');
const Payment = require('../models/Payment');
require('dotenv').config();

async function clearPendingPayments() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/afrionet');
    console.log('✅ Connected to database');

    // Delete old pending payments (older than 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const result = await Payment.deleteMany({
      status: 'pending',
      createdAt: { $lt: tenMinutesAgo }
    });

    console.log(`✅ Deleted ${result.deletedCount} old pending payments`);

    // Also delete very recent pending payments (if you want to clear ALL pending)
    const allPendingResult = await Payment.deleteMany({
      status: 'pending'
    });

    console.log(`✅ Deleted ${allPendingResult.deletedCount} total pending payments`);

    await mongoose.disconnect();
    console.log('✅ Disconnected from database');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

clearPendingPayments();
