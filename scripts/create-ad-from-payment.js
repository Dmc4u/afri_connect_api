const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Advertisement = require('../models/Advertisement');
const config = require('../utils/config');

async function createAdFromPayment() {
  try {
    await mongoose.connect(config.MONGO_URL);
    console.log('Connected to MongoDB');

    // Find the payment
    const payment = await Payment.findOne({
      paypalOrderId: '7Y450225P0192540N',
      paymentType: 'advertising',
      status: 'completed'
    }).lean(); // Use lean() instead of populate to avoid User model dependency

    console.log('\n📦 Payment found:', {
      id: payment._id,
      orderId: payment.orderId,
      amount: payment.amount.value,
      user: payment.user
    });

    // Check if ad already exists
    const existingAd = await Advertisement.findOne({
      'paymentDetails.transactionId': payment.orderId
    });

    if (existingAd) {
      console.log('\n✅ Advertisement already exists!');
      console.log({
        id: existingAd._id,
        title: existingAd.title,
        placement: existingAd.placement,
        status: existingAd.status
      });
      return;
    }

    // Since metadata is incomplete, we need to create a placeholder ad
    // or manually enter the details
    console.log('\n⚠️  Payment metadata:', payment.metadata);
    console.log('\n❌ Cannot create advertisement - metadata is incomplete (missing title, description, targetUrl, etc.)');
    console.log('\n💡 The ad details were not saved during payment. You will need to:');
    console.log('   1. Contact the user to get the ad details again, OR');
    console.log('   2. Create a new ad with proper payment, OR');
    console.log('   3. Manually create the ad in the database with the missing information');

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    await mongoose.disconnect();
  }
}

createAdFromPayment();
