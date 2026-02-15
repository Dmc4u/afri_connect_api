function isVimeoUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    const host = String(url.hostname || "").toLowerCase();
    return host.endsWith("vimeo.com") || host.endsWith("player.vimeo.com");
  } catch {
    return false;
  }
}

async function getVimeoDuration(vimeoUrl, { timeoutMs = 8000 } = {}) {
  if (!isVimeoUrl(vimeoUrl)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Vimeo oEmbed typically returns `duration` in seconds for public videos.
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
      String(vimeoUrl || "")
    )}`;

    const res = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const duration = Math.ceil(Number(data?.duration || 0));
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  isVimeoUrl,
  getVimeoDuration,
};
