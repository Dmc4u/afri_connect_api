const mongoose = require('mongoose');
const { MONGO_URL } = require('../utils/config');

// Import Advertisement model
const Advertisement = require('../models/Advertisement');

async function fixAdvertisementImages() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URL);
    console.log('Connected to MongoDB\n');

    // Find all ads missing imageUrl but having mediaFiles
    const adsToFix = await Advertisement.find({
      $or: [
        { imageUrl: { $exists: false } },
        { imageUrl: null },
        { imageUrl: '' }
      ],
      'mediaFiles.0': { $exists: true }
    });

    console.log(`Found ${adsToFix.length} advertisement(s) needing imageUrl fix\n`);

    let fixedCount = 0;
    let errors = 0;

    for (const ad of adsToFix) {
      try {
        // Extract imageUrl from first media file
        const imageUrl = ad.mediaFiles[0].url || ad.mediaFiles[0];

        // Update the advertisement
        await Advertisement.findByIdAndUpdate(
          ad._id,
          { $set: { imageUrl: imageUrl } },
          { new: true }
        );

        console.log(`✅ Fixed: ${ad.title}`);
        console.log(`   ID: ${ad._id}`);
        console.log(`   Set imageUrl: ${imageUrl}`);
        console.log('');

        fixedCount++;
      } catch (err) {
        console.error(`❌ Error fixing ${ad.title}: ${err.message}`);
        errors++;
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total ads found: ${adsToFix.length}`);
    console.log(`Successfully fixed: ${fixedCount}`);
    console.log(`Errors: ${errors}`);

  } catch (error) {
    console.error('Migration error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\nDisconnected from MongoDB');
  }
}

fixAdvertisementImages();
