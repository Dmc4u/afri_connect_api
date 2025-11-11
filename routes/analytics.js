const express = require("express");
const Listing = require("../models/Listing");
const ContactMessage = require("../models/ContactMessage");
const auth = require("../middlewares/auth");
const { requireAnalyticsAccess } = require("../middlewares/tierCheck");

const router = express.Router();

// Apply authentication to all routes
router.use(auth);

/**
 * Get user analytics
 * GET /analytics?range=7d|30d|90d|1y
 * Requires Starter tier or higher
 */
router.get("/", requireAnalyticsAccess, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { range = "30d" } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate, previousStartDate;

    switch (range) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        previousStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        previousStartDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        break;
      case "1y":
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        previousStartDate = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        previousStartDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    }

    // Get all listings for the user
    const listings = await Listing.find({
      owner: userId,
      status: "active",
    }).sort({ createdAt: -1 });

    // Calculate overview metrics
    const totalListings = listings.length;
    const totalViews = listings.reduce((sum, l) => sum + (l.views || 0), 0);

    // Get actual contact messages for this user (business owner)
    const contactMessages = await ContactMessage.find({
      businessOwner: userId,
    }).select("status replies createdAt listing");

    const totalContacts = contactMessages.length;
    const repliedContacts = contactMessages.filter((msg) => msg.status === "replied").length;

    // Debug logging
    console.log("📊 Analytics Debug:");
    console.log("  userId:", userId);
    console.log("  totalContacts:", totalContacts);
    console.log("  repliedContacts:", repliedContacts);
    console.log(
      "  Message statuses:",
      contactMessages.map((m) => m.status)
    );

  const conversionRate = totalViews > 0 ? ((totalContacts / totalViews) * 100).toFixed(2) : 0;

    // Get previous period data for comparison
    const previousListings = await Listing.find({
      owner: userId,
      status: "active",
      createdAt: { $gte: previousStartDate, $lt: startDate },
    });

    const previousViews = previousListings.reduce((sum, l) => sum + (l.views || 0), 0);
    const viewsGrowth =
      previousViews > 0 ? (((totalViews - previousViews) / previousViews) * 100).toFixed(1) : 0;

    // Generate views over time data (4 weeks)
  const viewsOverTime = generateTimeSeriesData(listings, range);
  const contactsOverTime = generateContactsDataFromMessages(contactMessages, range);

    // Get top 3 performing listings
    // Build contacts map per listing from messages
    const contactsByListing = contactMessages.reduce((acc, msg) => {
      if (msg.listing) {
        const key = String(msg.listing);
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    }, {});

    const topPerformers = listings
      .map((listing) => {
        const contacts = contactsByListing[String(listing._id)] || listing.contacts || 0;
        return {
          id: listing._id,
          title: listing.title,
          views: listing.views || 0,
          contacts,
          conversionRate: listing.views > 0 ? ((contacts / listing.views) * 100).toFixed(2) : 0,
          featured: !!listing.featured,
        };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 3);

    // Category breakdown
    const categoryStats = {};
    listings.forEach((listing) => {
      if (!categoryStats[listing.category]) {
        categoryStats[listing.category] = 0;
      }
      categoryStats[listing.category]++;
    });

    const categoryBreakdown = Object.entries(categoryStats)
      .map(([category, count]) => ({
        category,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Listing performance (bar chart data)
    const listingPerformance = listings.slice(0, 5).map((l) => ({
      title: l.title,
      views: l.views || 0,
    }));

    // Generate insights
    const insights = generateInsights({
      userId,
      totalViews,
      previousViews,
      viewsGrowth,
      totalContacts,
      listings,
      topPerformers,
    });

    // Format chart data
    const chartColors = [
      "#FF6384",
      "#36A2EB",
      "#FFCE56",
      "#4BC0C0",
      "#9966FF",
      "#FF9F40",
      "#FF6384",
      "#C9CBCF",
    ];

    res.json({
      overview: {
        totalListings,
        totalViews,
        totalContacts,
        repliedContacts,
        conversionRate: parseFloat(conversionRate),
      },
      growth: {
        viewsGrowth: parseFloat(viewsGrowth),
        previousViews,
      },
      viewsOverTime: {
        labels: viewsOverTime.labels,
        datasets: [
          {
            label: "Views",
            data: viewsOverTime.data,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            tension: 0.4,
            fill: true,
          },
        ],
      },
      contactsOverTime: {
        labels: contactsOverTime.labels,
        datasets: [
          {
            label: "Contacts",
            data: contactsOverTime.data,
            backgroundColor: "#10b981",
            borderColor: "#059669",
            tension: 0.4,
          },
        ],
      },
      listingPerformance: {
        labels: listingPerformance.map((l) => l.title.substring(0, 15)),
        datasets: [
          {
            label: "Views",
            data: listingPerformance.map((l) => l.views),
            backgroundColor: chartColors.slice(0, listingPerformance.length),
          },
        ],
      },
      categoryBreakdown: {
        labels: categoryBreakdown.map((c) => c.category),
        datasets: [
          {
            data: categoryBreakdown.map((c) => c.count),
            backgroundColor: chartColors.slice(0, categoryBreakdown.length),
          },
        ],
      },
      topPerformers,
      insights,
      timeRange: range,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    next(error);
  }
});

/**
 * Helper: Generate time series data
 */
function generateTimeSeriesData(listings, range) {
  const now = new Date();
  const periods = [];
  const data = [];

  let weeksBack = 4;
  if (range === "90d") weeksBack = 12;
  if (range === "1y") weeksBack = 52;

  for (let i = weeksBack; i > 0; i--) {
    const weekStart = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    periods.push(`Week ${weeksBack - i + 1}`);

    // Sum views for listings created in this period
    // For now, we'll distribute based on listing creation
    const periodViews =
      listings
        .filter((l) => new Date(l.createdAt) < weekEnd)
        .reduce((sum, l) => {
          // Simulate distributed views
          return sum + Math.floor((l.views || 0) / weeksBack);
        }, 0) + Math.floor(Math.random() * 50); // Add some variance

    data.push(Math.max(100, periodViews));
  }

  return { labels: periods, data };
}

/**
 * Helper: Generate contacts data
 */
function generateContactsData(listings, range) {
  const now = new Date();
  const periods = [];
  const data = [];

  let weeksBack = 4;
  if (range === "90d") weeksBack = 12;
  if (range === "1y") weeksBack = 52;

  for (let i = weeksBack; i > 0; i--) {
    const weekStart = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    periods.push(`Week ${weeksBack - i + 1}`);

    // Sum contacts for listings
    const periodContacts =
      listings
        .filter((l) => new Date(l.createdAt) < weekEnd)
        .reduce((sum, l) => {
          return sum + Math.floor((l.contacts || 0) / weeksBack);
        }, 0) + Math.floor(Math.random() * 5);

    data.push(Math.max(0, periodContacts));
  }

  return { labels: periods, data };
}

/**
 * Helper: Generate contacts data from actual messages
 */
function generateContactsDataFromMessages(messages, range) {
  const now = new Date();
  const periods = [];
  const data = [];

  let weeksBack = 4;
  if (range === "90d") weeksBack = 12;
  if (range === "1y") weeksBack = 52;

  for (let i = weeksBack; i > 0; i--) {
    const periodStart = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    periods.push(`Week ${weeksBack - i + 1}`);

    const count = messages.filter(
      (m) => new Date(m.createdAt) >= periodStart && new Date(m.createdAt) < periodEnd
    ).length;
    data.push(count);
  }

  return { labels: periods, data };
}

/**
 * Helper: Generate insights
 */
function generateInsights({
  userId,
  totalViews,
  previousViews,
  viewsGrowth,
  totalContacts,
  listings,
  topPerformers,
}) {
  const insights = [];

  // 1) Getting started / zero state
  if ((listings?.length || 0) === 0) {
    insights.push({
      type: "tip",
      title: "🚀 Create Your First Listing",
      message: "Add your first listing to start getting views and contacts.",
    });
    // Show a rotating professional tip
    insights.push(rotatingTip(userId));
    return insights;
  }

  // 2) Performance trend
  if (typeof viewsGrowth === "number") {
    if (viewsGrowth > 10) {
      insights.push({
        type: "positive",
        title: "🎉 Great Performance!",
        message: `Your listings received ${Math.round(viewsGrowth)}% more views this period compared to the last period.`,
      });
    } else if (viewsGrowth < -10) {
      insights.push({
        type: "neutral",
        title: "📉 Views Trending Down",
        message: `Views dropped by ${Math.round(Math.abs(viewsGrowth))}%. Refresh titles, update media, or share your listings.`,
      });
    } else {
      insights.push({
        type: "positive",
        title: "✅ Steady Performance",
        message: `Engagement is stable. Keep your listings updated to maintain momentum.`,
      });
    }
  }

  // 3) Contacts and conversion suggestions
  const conversionRate = totalViews > 0 ? (totalContacts / totalViews) * 100 : 0;
  if (totalViews > 0 && totalContacts === 0) {
    insights.push({
      type: "neutral",
      title: "💬 Turn Views Into Contacts",
      message: "Add clear calls-to-action and verify your contact details to encourage outreach.",
    });
  } else if (conversionRate > 5) {
    insights.push({
      type: "positive",
      title: "💬 Strong Conversion",
      message: `Your ${conversionRate.toFixed(1)}% conversion rate is excellent. Keep promoting your best listings!`,
    });
  }

  // 4) Media optimization
  const listingsWithoutMedia = listings.filter((l) => !l.mediaFiles || l.mediaFiles.length === 0)
    .length;
  if (listingsWithoutMedia > 0) {
    const percentage = Math.round((listingsWithoutMedia / listings.length) * 100);
    insights.push({
      type: "neutral",
      title: "📸 Add Media To Listings",
      message: `${percentage}% of your listings have no media. Photos typically double engagement.`,
    });
  } else if (totalViews > 0) {
    insights.push({
      type: "positive",
      title: "📸 Good Media Coverage",
      message: "All your listings include media. Great for attracting attention!",
    });
  }

  // 5) Top performer highlight (unique)
  if (topPerformers.length > 0) {
    const top = topPerformers[0];
    insights.push({
      type: "positive",
      title: "⭐ Top Performer",
      message: `"${top.title}" leads with ${top.views} views and ${top.contacts} contacts. Consider featuring it.`,
    });
  }

  // 6) Rotating professional tip (varies weekly/user)
  insights.push(rotatingTip(userId));

  // De-duplicate by title to avoid showing the same thing repeatedly
  const seenTitles = new Set();
  const unique = [];
  for (const i of insights) {
    if (!seenTitles.has(i.title)) {
      seenTitles.add(i.title);
      unique.push(i);
    }
    if (unique.length >= 3) break; // cap at 3
  }
  return unique;
}

function rotatingTip(userId) {
  const tips = [
    {
      type: "tip",
      title: "⏰ Pro Tip",
      message:
        "Peak viewing times are Tue–Thu, 2–4 PM. Refresh your listings during these times.",
    },
    {
      type: "tip",
      title: "🔎 Improve Discoverability",
      message: "Use specific keywords in titles and descriptions to match user searches.",
    },
    {
      type: "tip",
      title: "🔁 Keep It Fresh",
      message: "Update your photos or copy monthly—fresh content performs better.",
    },
    {
      type: "tip",
      title: "📣 Share Your Listings",
      message: "Share your best listings on social channels to drive targeted traffic.",
    },
  ];
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const hash = simpleHash(String(userId)) + weekNumber;
  const idx = Math.abs(hash) % tips.length;
  return tips[idx];
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

module.exports = router;
