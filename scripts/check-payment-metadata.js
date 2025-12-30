const mongoose = require('mongoose');
const Payment = require('../models/Payment');

async function checkPaymentMetadata() {
  try {
    await mongoose.connect('mongodb://localhost:27017/afriConnectDB');
    console.log('✅ Connected to database');

    const payment = await Payment.findById('695385e162ec76598a86ac0c').lean();

    if (payment) {
      console.log('\n=== Payment Details ===');
      console.log('Order ID:', payment.orderId);
      console.log('Payment Type:', payment.paymentType);
      console.log('Status:', payment.status);
      console.log('Amount:', payment.amount);
      console.log('\n=== Metadata ===');
      console.log(JSON.stringify(payment.metadata, null, 2));
    } else {
      console.log('Payment not found with ID: 695385e162ec76598a86ac0c');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPaymentMetadata();
