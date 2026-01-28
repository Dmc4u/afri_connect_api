require("dotenv").config();
const mongoose = require("mongoose");
const { MONGO_URL } = require("../utils/config");

// Register models
require("../models/User");
const Listing = require("../models/Listing");
const TalentContestant = require("../models/TalentContestant");
const TalentShowcase = require("../models/TalentShowcase");

function isOldGenericWinnerDescription(description, performanceTitle) {
  const d = String(description || "").trim();
  const t = String(performanceTitle || "").trim();
  if (!d) return false;

  const candidates = new Set(
    [
      "Winner of Talent Showcase",
      "Winner of Talent Showcase",
      t ? `Winner of Talent Showcase - ${t}` : null,
      t ? `Winner of Talent Showcase - ${t}` : null,
    ].filter(Boolean)
  );

  const dl = d.toLowerCase();
  for (const c of candidates) {
    if (dl === String(c).toLowerCase()) return true;
  }
  return false;
}

async function resolveShowcaseTitle(contestant) {
  try {
    const showcase = contestant?.showcase;

    if (showcase && typeof showcase === "object" && showcase.title) {
      return String(showcase.title).trim() || "Talent Showcase";
    }

    if (showcase) {
      const doc = await TalentShowcase.findById(showcase).select("title").lean();
      const title = doc?.title ? String(doc.title).trim() : "";
      return title || "Talent Showcase";
    }

    return "Talent Showcase";
  } catch {
    return "Talent Showcase";
  }
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`🔌 Connecting to MongoDB...`);
  await mongoose.connect(MONGO_URL);

  try {
    console.log(`\n🔍 Finding winner contestants...`);

    const winners = await TalentContestant.find({ isWinner: true })
      .populate("listing")
      .populate("showcase", "title")
      .sort({ wonAt: -1, createdAt: -1 });

    console.log(`Found ${winners.length} winner contestant(s).`);

    let updated = 0;
    let skipped = 0;

    for (const contestant of winners) {
      const listing = contestant.listing;
      if (!listing) {
        skipped++;
        continue;
      }

      const showcaseTitle = await resolveShowcaseTitle(contestant);
      const winnerLabel = `Winner of #${showcaseTitle}`;

      if (!isOldGenericWinnerDescription(listing.description, contestant.performanceTitle)) {
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(
          `(dry-run) Would update listing ${listing._id}: "${listing.description}" -> "${winnerLabel}"`
        );
        updated++;
        continue;
      }

      await Listing.updateOne({ _id: listing._id }, { $set: { description: winnerLabel } });
      updated++;
    }

    console.log(`\n✅ Done.`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);

    if (dryRun) {
      console.log(`\nNote: This was a dry run. Re-run without --dry-run to apply changes.`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
