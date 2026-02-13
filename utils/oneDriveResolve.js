function isHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function mergeParams(searchParams, hash) {
  const out = new URLSearchParams(searchParams);
  const hashValue = String(hash || "").replace(/^#/, "");
  if (!hashValue) return out;

  // OneDrive sometimes puts params after '#'
  const hashParams = new URLSearchParams(
    hashValue.startsWith("?") ? hashValue.slice(1) : hashValue
  );
  for (const [key, value] of hashParams.entries()) {
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function extractShareParamsFromPhotosData(photosDataValue) {
  const decoded = safeDecodeURIComponent(photosDataValue);
  if (!decoded) return null;

  // Observed formats:
  // - "/share/<resid>?ithint=video&e=..."
  // - "https://photos.onedrive.com/share/...?..."
  let queryString = "";
  if (decoded.includes("?")) {
    queryString = decoded.split("?").slice(1).join("?");
  }

  if (!queryString) return null;
  const sp = new URLSearchParams(queryString);
  const e = sp.get("e") || null;
  const authkey = sp.get("authkey") || sp.get("authKey") || null;
  const ithint = sp.get("ithint") || null;
  return { e, authkey, ithint };
}

function buildOneDriveEmbedUrl(finalUrl) {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    return null;
  }

  const host = String(url.hostname || "").toLowerCase();
  const isOneDriveHost =
    host === "onedrive.live.com" ||
    host.endsWith(".onedrive.live.com") ||
    host === "photos.onedrive.com";

  if (!isOneDriveHost) {
    return null;
  }

  const params = mergeParams(url.searchParams, url.hash);
  const resid =
    params.get("resid") ||
    params.get("resId") ||
    params.get("resID") ||
    // Some OneDrive share links (especially photos.onedrive.com / allmyphotos)
    // use `id` instead of `resid`.
    params.get("id") ||
    null;
  // For modern OneDrive share links, the share token is often `e=` (not `authkey`).
  // Some `onedrive.live.com/?qt=allmyphotos` URLs store the share URL in `photosData`.
  const photosData = params.get("photosData") || null;
  const extracted = photosData ? extractShareParamsFromPhotosData(photosData) : null;
  const e = params.get("e") || extracted?.e || null;
  const ithint = params.get("ithint") || extracted?.ithint || null;
  const authkey = params.get("authkey") || params.get("authKey") || extracted?.authkey || null;
  const cid = params.get("cid") || null;

  if (!resid) return null;

  const embed = new URL("https://onedrive.live.com/embed");
  if (cid) embed.searchParams.set("cid", cid);
  embed.searchParams.set("resid", resid);
  if (authkey) embed.searchParams.set("authkey", authkey);
  if (e) embed.searchParams.set("e", e);
  if (ithint) embed.searchParams.set("ithint", ithint);
  // Some embeds work better with em=2.
  embed.searchParams.set("em", "2");
  return embed.toString();
}

function buildOneDriveDirectDownloadUrl(finalUrl) {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    return null;
  }

  const host = String(url.hostname || "").toLowerCase();
  const isOneDriveHost =
    host === "onedrive.live.com" ||
    host.endsWith(".onedrive.live.com") ||
    host === "photos.onedrive.com";

  if (!isOneDriveHost) return null;

  const params = mergeParams(url.searchParams, url.hash);
  const resid =
    params.get("resid") || params.get("resId") || params.get("resID") || params.get("id") || null;

  const photosData = params.get("photosData") || null;
  const extracted = photosData ? extractShareParamsFromPhotosData(photosData) : null;
  const e = params.get("e") || extracted?.e || null;
  const authkey = params.get("authkey") || params.get("authKey") || extracted?.authkey || null;

  let cid = params.get("cid") || null;
  if (!cid && resid && resid.includes("!")) {
    cid = resid.split("!")[0] || null;
  }

  if (!resid) return null;

  // This endpoint often produces a direct, playable MP4 response for public shares.
  const download = new URL("https://onedrive.live.com/download");
  if (cid) download.searchParams.set("cid", cid);
  download.searchParams.set("resid", resid);
  if (authkey) download.searchParams.set("authkey", authkey);
  if (e) download.searchParams.set("e", e);
  return download.toString();
}

function buildSharePointDirectDownloadUrl(finalUrl) {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    return null;
  }

  const host = String(url.hostname || "").toLowerCase();
  if (!host.includes("sharepoint.com")) return null;

  // Many SharePoint/OneDrive-for-Business share links support a direct download
  // by adding `download=1`.
  if (!url.searchParams.has("download")) {
    url.searchParams.set("download", "1");
  }

  return url.toString();
}

const getFetch = () => {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then((mod) => (mod.default || mod)(...args));
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const fetchFn = getFetch();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isLikelyOneDriveUrl(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return (
    raw.includes("1drv.ms/") ||
    raw.includes("onedrive.live.com") ||
    raw.includes("photos.onedrive.com") ||
    raw.includes("sharepoint.com")
  );
}

async function resolveOneDriveEmbedUrl(rawUrl, timeoutMs = 6500) {
  const inputUrl = String(rawUrl || "").trim();
  if (!inputUrl) return null;
  if (!isHttpUrl(inputUrl)) return null;
  if (!isLikelyOneDriveUrl(inputUrl)) return null;

  // If the URL is already a OneDrive/SharePoint host, we can build embed/direct
  // URLs without doing any network fetch. This also avoids failures when the
  // remote host is temporarily unreachable.
  let host = "";
  try {
    host = new URL(inputUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }

  let finalUrl = inputUrl;
  const isAlreadyFinalHost =
    host === "onedrive.live.com" ||
    host.endsWith(".onedrive.live.com") ||
    host === "photos.onedrive.com" ||
    host.includes("sharepoint.com");

  if (!isAlreadyFinalHost) {
    // Follow redirects server-side (1drv.ms short links need this)
    const response = await fetchWithTimeout(
      inputUrl,
      { method: "GET", redirect: "follow" },
      timeoutMs
    );
    finalUrl = response?.url || inputUrl;
  }
  const embedUrl = buildOneDriveEmbedUrl(finalUrl);
  const directUrl =
    buildSharePointDirectDownloadUrl(finalUrl) || buildOneDriveDirectDownloadUrl(finalUrl);

  return {
    finalUrl,
    embedUrl: embedUrl || null,
    directUrl: directUrl || null,
  };
}

module.exports = {
  isHttpUrl,
  isLikelyOneDriveUrl,
  buildOneDriveEmbedUrl,
  buildOneDriveDirectDownloadUrl,
  buildSharePointDirectDownloadUrl,
  resolveOneDriveEmbedUrl,
};
