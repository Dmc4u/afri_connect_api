/* eslint-disable no-console */

require("dotenv").config();
const mongoose = require("mongoose");

const ShowcaseEventTimeline = require("../models/ShowcaseEventTimeline");
const TalentShowcase = require("../models/TalentShowcase");

function getMongoUri() {
  return process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const getValue = (flag, fallback) => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return fallback;
    return argv[idx + 1] ?? fallback;
  };

  return {
    doDelete: args.has("--delete"),
    includeMissingDate: args.has("--include-missing-date"),
    limit: Number(getValue("--limit", "500")),
    eventStatus: getValue("--eventStatus", "scheduled"),
    isLive: getValue("--isLive", "false") === "true",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = getMongoUri();

  if (!mongoUri) {
    throw new Error(
      "Missing MongoDB connection string. Set MONGODB_URI (or MONGO_URI/MONGO_URL) in your environment/.env"
    );
  }

  console.log("Connecting to Mongo...");
  await mongoose.connect(mongoUri);
  console.log("Connected.");

  const timelines = await ShowcaseEventTimeline.find({
    eventStatus: options.eventStatus,
    isLive: options.isLive,
  })
    .select("_id showcase eventStatus isLive currentPhase")
    .limit(options.limit)
    .lean();

  const missingShowcaseRef = timelines.filter((t) => !t.showcase);
  const withShowcaseRef = timelines.filter((t) => t.showcase);

  const showcaseIds = [...new Set(withShowcaseRef.map((t) => String(t.showcase)))];

  const showcases = await TalentShowcase.find({ _id: { $in: showcaseIds } })
    .select("_id eventDate title")
    .lean();

  const showcaseById = new Map(showcases.map((s) => [String(s._id), s]));

  const danglingShowcaseRef = [];
  const showcaseMissingEventDate = [];

  for (const t of withShowcaseRef) {
    const showcase = showcaseById.get(String(t.showcase));
    if (!showcase) {
      danglingShowcaseRef.push(t);
      continue;
    }
    if (!showcase.eventDate) {
      showcaseMissingEventDate.push({ timeline: t, showcase });
    }
  }

  console.log("\nOrphan timeline report");
  console.log("---------------------");
  console.log(`Scanned: ${timelines.length}`);
  console.log(`Missing showcase ref: ${missingShowcaseRef.length}`);
  console.log(`Dangling showcase ref: ${danglingShowcaseRef.length}`);
  console.log(`Showcase missing eventDate: ${showcaseMissingEventDate.length}`);

  const printIds = (label, items) => {
    if (items.length === 0) return;
    console.log(`\n${label} IDs:`);
    for (const item of items) console.log(`- ${item._id}`);
  };

  printIds("Missing showcase ref", missingShowcaseRef);
  printIds("Dangling showcase ref", danglingShowcaseRef);

  if (showcaseMissingEventDate.length > 0) {
    console.log("\nShowcase missing eventDate:");
    for (const { timeline, showcase } of showcaseMissingEventDate) {
      console.log(
        `- timeline=${timeline._id} showcase=${showcase._id} title=${showcase.title || "(untitled)"}`
      );
    }
  }

  if (!options.doDelete) {
    console.log(
      "\nDry-run only. Re-run with --delete to remove timelines with missing/dangling showcase refs."
    );
    console.log(
      "Add --include-missing-date if you also want to delete timelines whose showcase exists but is missing eventDate."
    );
    return;
  }

  const deletableTimelineIds = [
    ...missingShowcaseRef.map((t) => t._id),
    ...danglingShowcaseRef.map((t) => t._id),
  ];

  if (options.includeMissingDate) {
    deletableTimelineIds.push(...showcaseMissingEventDate.map(({ timeline }) => timeline._id));
  }

  if (deletableTimelineIds.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  console.log(`\nDeleting ${deletableTimelineIds.length} timeline(s)...`);
  const result = await ShowcaseEventTimeline.deleteMany({
    _id: { $in: deletableTimelineIds },
  });
  console.log("Delete result:", result);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    console.log("Done.");
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exitCode = 1;
  });
