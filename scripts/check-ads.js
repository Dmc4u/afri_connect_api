const mongoose = require('mongoose');
require('dotenv').config();

// Import Advertisement model
const Advertisement = require('../models/Advertisement');
const { MONGO_URL } = require('../utils/config');

async function checkAdvertisements() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URL);
    console.log('Connected to MongoDB');

    // Find all advertisements
    const ads = await Advertisement.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log(`\n📊 Found ${ads.length} advertisements\n`);

    ads.forEach((ad, index) => {
      console.log(`\n--- Advertisement ${index + 1} ---`);
      console.log(`ID: ${ad._id}`);
      console.log(`Advertiser: ${ad.advertiser.name} (${ad.advertiser.email})`);
      console.log(`Title: ${ad.title}`);
      console.log(`Placement: ${ad.placement}`);
      console.log(`Status: ${ad.status}`);
      console.log(`Payment Status: ${ad.paymentStatus}`);
      console.log(`Start Date: ${ad.startDate}`);
      console.log(`End Date: ${ad.endDate}`);
      console.log(`Amount: $${ad.pricing.amount} USD`);
      console.log(`Image URL: ${ad.imageUrl || 'NOT SET'}`);
      console.log(`Media Files: ${ad.mediaFiles?.length || 0} file(s)`);

      if (ad.mediaFiles && ad.mediaFiles.length > 0) {
        ad.mediaFiles.forEach((file, i) => {
          console.log(`  File ${i + 1}: ${file.url || file.filename}`);
        });
      }

      if (ad.paymentDetails) {
        console.log(`Transaction ID: ${ad.paymentDetails.transactionId}`);
      }
    });

    // Check for active ads specifically
    const now = new Date();
    const activeAds = await Advertisement.find({
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).lean();

    console.log(`\n\n✅ Currently Active Ads: ${activeAds.length}`);

    // Check for ads missing imageUrl but having mediaFiles
    const adsNeedingFix = await Advertisement.find({
      imageUrl: { $in: [null, ''] },
      'mediaFiles.0': { $exists: true }
    }).lean();

    console.log(`\n⚠️  Ads missing imageUrl but have mediaFiles: ${adsNeedingFix.length}`);

    if (adsNeedingFix.length > 0) {
      console.log('\nThese ads need imageUrl populated from mediaFiles:');
      adsNeedingFix.forEach(ad => {
        console.log(`  - ${ad._id}: ${ad.title} (has ${ad.mediaFiles.length} media files)`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\nDisconnected from MongoDB');
  }
}

checkAdvertisements();
