const Listing = require('../models/Listing');
const FeaturedPlacement = require('../models/FeaturedPlacement');

/**
 * Convert YouTube URL to embed format
 */
function getYouTubeEmbedUrl(url) {
  if (!url) return null;

  // Already an embed URL
  if (url.includes('youtube.com/embed/')) return url;

  // Extract video ID from various YouTube URL formats
  let videoId = null;

  // Format: youtube.com/watch?v=VIDEO_ID (with or without playlist/radio params)
  if (url.includes('youtube.com/watch')) {
    try {
      const urlObj = new URL(url.replace('http://', 'https://'));
      videoId = urlObj.searchParams.get('v');
    } catch (e) {
      // Fallback parsing
      const match = url.match(/[?&]v=([^&#]+)/);
      videoId = match ? match[1] : null;
    }
  }
  // Format: youtu.be/VIDEO_ID or youtu.be/VIDEO_ID?si=xxx
  else if (url.includes('youtu.be/')) {
    const path = url.split('youtu.be/')[1];
    videoId = path ? path.split('?')[0].split('&')[0] : null;
  }
  // Format: youtube.com/v/VIDEO_ID
  else if (url.includes('youtube.com/v/')) {
    videoId = url.split('youtube.com/v/')[1]?.split('?')[0]?.split('&')[0];
  }

  return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
}

/**
 * Auto-feature a talent showcase winner on the homepage for 30 days
 */
async function autoFeatureWinner(contestant) {
  try {
    console.log(`\n🏆 Auto-featuring winner: ${contestant.performanceTitle}`);

    // Get or create listing
    let listing = contestant.listing;

    if (!listing) {
      // Create new listing for the winner
      const userId = contestant.user._id || contestant.user;
      const userCountry = contestant.user.country || 'Kenya';
      const userCity = contestant.user.city || '';

      // Prepare media files array with performance video
      const mediaFiles = [];
      if (contestant.videoUrl) {
        const isYouTube = contestant.videoUrl.includes('youtube.com') || contestant.videoUrl.includes('youtu.be');
        const embedUrl = isYouTube ? getYouTubeEmbedUrl(contestant.videoUrl) : contestant.videoUrl;

        mediaFiles.push({
          url: embedUrl,
          type: isYouTube ? 'youtube' : 'video',
          filename: contestant.videoUrl.split('/').pop() || 'performance-video',
          originalname: 'Performance Video',
          mimetype: isYouTube ? 'video/youtube' : 'video/mp4',
          size: 0,
          thumbnail: contestant.thumbnailUrl || undefined,
          description: `${contestant.performanceTitle} - Winner Performance`
        });
      }

      listing = new Listing({
        owner: userId,
        category: 'Talent',
        title: contestant.performanceTitle,
        description: `Winner of Talent Showcase - ${contestant.performanceTitle}`,
        location: userCity ? `${userCity}, ${userCountry}` : userCountry,
        mediaFiles: mediaFiles,
        status: 'active',
        featured: true
      });

      await listing.save();
      console.log(`✅ Created new listing for winner: ${listing._id}`);

      // Update contestant with listing reference
      contestant.listing = listing._id;
      await contestant.save();
    } else {
      // Update existing listing with performance video if not already present
      if (contestant.videoUrl) {
        const isYouTube = contestant.videoUrl.includes('youtube.com') || contestant.videoUrl.includes('youtu.be');
        const embedUrl = isYouTube ? getYouTubeEmbedUrl(contestant.videoUrl) : contestant.videoUrl;
        const hasVideo = listing.mediaFiles && listing.mediaFiles.some(m =>
          m.url === embedUrl || m.url === contestant.videoUrl
        );

        if (!hasVideo) {
          const videoMedia = {
            url: embedUrl,
            type: isYouTube ? 'youtube' : 'video',
            filename: contestant.videoUrl.split('/').pop() || 'performance-video',
            originalname: 'Performance Video',
            mimetype: isYouTube ? 'video/youtube' : 'video/mp4',
            size: 0,
            thumbnail: contestant.thumbnailUrl || undefined,
            description: `${contestant.performanceTitle} - Winner Performance`
          };

          listing.mediaFiles = listing.mediaFiles || [];
          listing.mediaFiles.unshift(videoMedia); // Add video as first item
          console.log(`✅ Added performance video to listing (embed URL)`);
        }
      }

      listing.featured = true;
      listing.status = 'active';
      await listing.save();
      console.log(`✅ Updated existing listing: ${listing._id}`);
    }

    // Create featured placement for homepage
    const userId = contestant.user._id || contestant.user;
    const now = new Date();
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const existingPlacement = await FeaturedPlacement.findOne({
      listingId: listing._id,
      status: 'approved',
      endAt: { $gt: now }
    });

    if (!existingPlacement) {
      const featuredPlacement = new FeaturedPlacement({
        listingId: listing._id,
        ownerId: userId,
        startAt: now,
        endAt: endDate,
        status: 'approved',
        offerType: 'premium',
        paymentProvider: 'none',
        notes: `Auto-featured as Talent Showcase winner: ${contestant.performanceTitle} (${contestant.votes || 0} votes)`
      });

      await featuredPlacement.save();
      console.log(`✅ Created featured placement for 30 days: ${featuredPlacement._id}`);

      return {
        listing: listing._id,
        placement: featuredPlacement._id,
        duration: '30 days'
      };
    } else {
      // Update existing placement
      existingPlacement.endAt = endDate;
      existingPlacement.status = 'approved';
      await existingPlacement.save();
      console.log(`✅ Extended existing placement: ${existingPlacement._id}`);

      return {
        listing: listing._id,
        placement: existingPlacement._id,
        duration: '30 days (extended)'
      };
    }
  } catch (error) {
    console.error('❌ Error auto-featuring winner:', error);
    throw error;
  }
}

module.exports = {
  autoFeatureWinner
};
