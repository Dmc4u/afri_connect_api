const fs = require("fs");
const path = require("path");

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function resolveAppContentPaths() {
  const baseDir = process.env.APP_CONTENT_DIR ? String(process.env.APP_CONTENT_DIR) : null;
  const featureFlagsPathEnv = process.env.FEATURE_FLAGS_PATH
    ? String(process.env.FEATURE_FLAGS_PATH)
    : null;
  const faqJsonPathEnv = process.env.FAQ_JSON_PATH ? String(process.env.FAQ_JSON_PATH) : null;

  // 1) Explicit env overrides
  const featureFlagsPathFromEnv =
    featureFlagsPathEnv || (baseDir ? path.join(baseDir, "featureFlags.js") : null);
  const faqJsonPathFromEnv =
    faqJsonPathEnv || (baseDir ? path.join(baseDir, "faqData.json") : null);

  // 2) Default dev layout: sibling frontend repo checkout
  const featureFlagsPathDefault = path.join(
    __dirname,
    "..",
    "..",
    "afri_connect_client",
    "src",
    "utils",
    "featureFlags.js"
  );
  const faqJsonPathDefault = path.join(
    __dirname,
    "..",
    "..",
    "afri_connect_client",
    "src",
    "data",
    "faqData.json"
  );

  // Use env path if it exists; otherwise fall back to default if it exists.
  const resolvedFeatureFlagsPath =
    (featureFlagsPathFromEnv && safeStat(featureFlagsPathFromEnv) && featureFlagsPathFromEnv) ||
    (safeStat(featureFlagsPathDefault) && featureFlagsPathDefault) ||
    featureFlagsPathFromEnv ||
    featureFlagsPathDefault;

  const resolvedFaqJsonPath =
    (faqJsonPathFromEnv && safeStat(faqJsonPathFromEnv) && faqJsonPathFromEnv) ||
    (safeStat(faqJsonPathDefault) && faqJsonPathDefault) ||
    faqJsonPathFromEnv ||
    faqJsonPathDefault;

  return {
    featureFlagsPath: resolvedFeatureFlagsPath,
    faqJsonPath: resolvedFaqJsonPath,
  };
}

const { featureFlagsPath: CLIENT_FEATURE_FLAGS_PATH, faqJsonPath: CLIENT_FAQ_JSON_PATH } =
  resolveAppContentPaths();

let cachedFlags = null;
let cachedFlagsMtimeMs = null;

let cachedFaq = null;
let cachedFaqMtimeMs = null;

function parseExportedConsts(sourceText) {
  const result = {};

  // Supports: export const FLAG = true;
  // Also supports numbers and strings.
  const re =
    /export\s+const\s+([A-Z0-9_]+)\s*=\s*(true|false|-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*;?/g;

  let match;
  while ((match = re.exec(sourceText))) {
    const key = match[1];
    const raw = match[2];

    if (raw === "true") result[key] = true;
    else if (raw === "false") result[key] = false;
    else if (raw.startsWith('"') || raw.startsWith("'")) {
      result[key] = raw.slice(1, -1);
    } else {
      const asNumber = Number(raw);
      if (!Number.isNaN(asNumber)) result[key] = asNumber;
    }
  }

  return result;
}

function getClientFeatureFlags() {
  const stat = safeStat(CLIENT_FEATURE_FLAGS_PATH);
  if (!stat) {
    return {
      flags: {},
      sourcePath: CLIENT_FEATURE_FLAGS_PATH,
      mtimeMs: 0,
      missing: true,
    };
  }
  if (!cachedFlags || cachedFlagsMtimeMs !== stat.mtimeMs) {
    const text = fs.readFileSync(CLIENT_FEATURE_FLAGS_PATH, "utf8");
    cachedFlags = parseExportedConsts(text);
    cachedFlagsMtimeMs = stat.mtimeMs;
  }

  return {
    flags: cachedFlags,
    sourcePath: CLIENT_FEATURE_FLAGS_PATH,
    mtimeMs: cachedFlagsMtimeMs,
  };
}

function getClientFaqJson() {
  const stat = safeStat(CLIENT_FAQ_JSON_PATH);
  if (!stat) {
    return {
      faq: [],
      sourcePath: CLIENT_FAQ_JSON_PATH,
      mtimeMs: 0,
      missing: true,
    };
  }
  if (!cachedFaq || cachedFaqMtimeMs !== stat.mtimeMs) {
    const text = fs.readFileSync(CLIENT_FAQ_JSON_PATH, "utf8");
    cachedFaq = JSON.parse(text);
    cachedFaqMtimeMs = stat.mtimeMs;
  }

  return {
    faq: cachedFaq,
    sourcePath: CLIENT_FAQ_JSON_PATH,
    mtimeMs: cachedFaqMtimeMs,
  };
}

module.exports = {
  getClientFeatureFlags,
  getClientFaqJson,
  CLIENT_FEATURE_FLAGS_PATH,
  CLIENT_FAQ_JSON_PATH,
};
