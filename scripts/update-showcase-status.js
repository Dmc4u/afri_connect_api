const mongoose = require('mongoose');
const TalentShowcase = require('../models/TalentShowcase');

async function updateShowcase() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/afrionet';
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const showcase = await TalentShowcase.findById('692f01b6f13c3502d9ceb5cb');

    if (!showcase) {
      console.log('❌ Showcase not found');
      process.exit(1);
    }

    console.log('\nBefore update:');
    console.log('Status:', showcase.status);
    console.log('Event Date:', showcase.eventDate);

    // Update status to upcoming and event date to future
    showcase.status = 'upcoming';
    showcase.eventDate = new Date('2025-12-05T19:00:00.000Z'); // Dec 5, 2025 at 7:00 PM UTC
    await showcase.save();

    console.log('\n✅ Updated successfully:');
    console.log('New Status:', showcase.status);
    console.log('New Event Date:', showcase.eventDate.toLocaleString());
    console.log('\n🎯 The event should now be visible at /live-talent-event');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

updateShowcase();
