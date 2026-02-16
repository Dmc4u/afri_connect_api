let ytdl;

// Prevent @distube/ytdl-core from writing `*-player-script.js` debug artifacts to disk.
// This is safe: it only disables saving the debug file; it does not block fetching video info.
if (process.env.YTDL_NO_DEBUG_FILE === undefined) {
  process.env.YTDL_NO_DEBUG_FILE = "1";
}

try {
  // Preferred fork (often more up-to-date for YouTube changes)
  // eslint-disable-next-line global-require
  ytdl = require("@distube/ytdl-core");
} catch (error) {
  // Fallback for environments where the fork isn't installed
  // eslint-disable-next-line global-require
  ytdl = require("ytdl-core");
}

/**
 * Extract YouTube video duration in seconds
 * @param {string} url - YouTube video URL
 * @returns {Promise<number|null>} - Duration in seconds or null if failed
 */
async function getYouTubeDuration(url) {
  try {
    if (!url || !ytdl.validateURL(url)) {
      console.log("⚠️ Invalid YouTube URL:", url);
      return null;
    }

    console.log("🎥 Fetching YouTube video info for:", url);
    const info = await ytdl.getInfo(url);
    const durationSeconds = parseInt(info.videoDetails.lengthSeconds);

    console.log(
      `✅ YouTube video duration: ${durationSeconds}s (${(durationSeconds / 60).toFixed(2)} minutes)`
    );
    return durationSeconds;
  } catch (error) {
    console.error("❌ Error fetching YouTube duration:", error.message);
    return null;
  }
}

/**
 * Check if URL is a YouTube video
 * @param {string} url - Video URL
 * @returns {boolean}
 */
function isYouTubeUrl(url) {
  if (!url) return false;
  return ytdl.validateURL(url);
}

module.exports = {
  getYouTubeDuration,
  isYouTubeUrl,
};
