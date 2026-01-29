const fs = require("fs");
const path = require("path");

const CLIENT_FEATURE_FLAGS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "afri_connect_client",
  "src",
  "utils",
  "featureFlags.js"
);

const CLIENT_FAQ_JSON_PATH = path.join(
  __dirname,
  "..",
  "..",
  "afri_connect_client",
  "src",
  "data",
  "faqData.json"
);

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
  const stat = fs.statSync(CLIENT_FEATURE_FLAGS_PATH);
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
  const stat = fs.statSync(CLIENT_FAQ_JSON_PATH);
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
