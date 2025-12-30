const mongoose = require('mongoose');
const TalentContestant = require('../models/TalentContestant');
const FeaturedPlacement = require('../models/FeaturedPlacement');
const Listing = require('../models/Listing');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/afri_connect', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function checkWinner() {
  try {
    console.log('🔍 Checking winner status...\n');

    // First check current showcase
    const TalentShowcase = require('../models/TalentShowcase');
    const currentShowcase = await TalentShowcase.findOne({})
      .populate({
        path: 'winner',
        populate: [
          { path: 'user' },
          { path: 'listing' }
        ]
      })
      .sort({ createdAt: -1 });

    if (!currentShowcase) {
      console.log('❌ No showcase found');
      process.exit(0);
    }

    console.log('📊 Showcase Status:', currentShowcase.status);
    console.log('📊 Current Phase:', currentShowcase.currentPhase);

    if (!currentShowcase.winner) {
      console.log('❌ Showcase has no winner set');

      // Check for contestants with votes
      const contestants = await TalentContestant.find({
        showcase: currentShowcase._id
      }).populate('user').sort({ votes: -1 }).limit(5);

      console.log(`\n🎯 Top contestants:`);
      contestants.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.performanceTitle} - ${c.votes} votes (${c.user?.name})`);
      });

      process.exit(0);
    }

    const winner = currentShowcase.winner;

    console.log('🏆 Winner found:');
    console.log(`   Name: ${winner.user?.name}`);
    console.log(`   Performance: ${winner.performanceTitle}`);
    console.log(`   Votes: ${winner.votes}`);
    console.log(`   Won At: ${winner.wonAt}`);
    console.log(`   Has Listing: ${winner.listing ? 'Yes' : 'No'}`);

    if (winner.listing) {
      const listing = winner.listing._id ? winner.listing : await Listing.findById(winner.listing);
      console.log(`\n📄 Listing Details:`);
      console.log(`   ID: ${listing._id}`);
      console.log(`   Title: ${listing.title}`);
      console.log(`   Category: ${listing.category}`);
      console.log(`   Featured: ${listing.featured}`);
      console.log(`   Featured Until: ${listing.featuredUntil}`);
      console.log(`   Status: ${listing.status}`);

      // Check for featured placement
      const placement = await FeaturedPlacement.findOne({ listingId: listing._id })
        .sort({ createdAt: -1 });

      if (placement) {
        console.log(`\n⭐ Featured Placement:`);
        console.log(`   ID: ${placement._id}`);
        console.log(`   Start: ${placement.startDate || placement.startAt}`);
        console.log(`   End: ${placement.endDate || placement.endAt}`);
        console.log(`   Active: ${placement.isActive || placement.status === 'approved'}`);
        console.log(`   Type: ${placement.placementType || placement.offerType}`);
      } else {
        console.log(`\n❌ No FeaturedPlacement found for this listing!`);
        console.log(`   This is why it's not appearing on homepage.`);
      }

      // Check all active featured placements with Talent category
      const allTalentPlacements = await FeaturedPlacement.find({
        isActive: true,
        endDate: { $gt: new Date() }
      }).populate('listingId');

      const talentPlacements = allTalentPlacements.filter(p =>
        p.listingId && p.listingId.category === 'Talent'
      );

      console.log(`\n📊 Active Talent Featured Placements: ${talentPlacements.length}`);
      talentPlacements.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.listingId?.title || 'Unknown'} (${p.listingId?._id})`);
      });

    } else {
      console.log(`\n❌ Winner has no listing - needs to be created!`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkWinner();
