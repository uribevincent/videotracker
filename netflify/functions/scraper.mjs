import Parser from "rss-parser";
import * as cheerio from "cheerio";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "VideoTracker/1.0"
  }
});

const FEED_URL = "https://rmz.cr/feed/s";

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\b(rmteam|720p|1080p|2160p|x265|x264|hevc|h264|h265)\b/gi, " ")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getQuality(title) {
  const value = title.toLowerCase();

  if (
    value.includes("720p") &&
    (value.includes("x265") || value.includes("hevc"))
  ) {
    return 1;
  }

  if (value.includes("1080p")) {
    return 2;
  }

  return 99;
}

function isRMTeam(title) {
  return /rmteam/i.test(title);
}

function isAllowedPublicationUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "rmz.cr" ||
        url.hostname.endsWith(".rmz.cr"))
    );
  } catch {
    return false;
  }
}

async function getClicknuploadLink(pageUrl) {
  if (!isAllowedPublicationUrl(pageUrl)) {
    return null;
  }

  try {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "VideoTracker/1.0"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    let result = null;

    $("a[href]").each((_, element) => {
      if (result) return;

      const href = $(element).attr("href");
      if (!href) return;

      try {
        const url = new URL(href, pageUrl);

        if (
          url.protocol === "https:" &&
          /(^|\.)clicknupload\./i.test(url.hostname)
        ) {
          result = url.href;
        }
      } catch {
        // Ignore invalid links
      }
    });

    return result;
  } catch (error) {
    console.error("Publication page error:", error.message);
    return null;
  }
}

export async function getPublications() {
  const feed = await parser.parseURL(FEED_URL);

  const candidates = (feed.items || [])
    .map((item) => {
      const title = item.title || "";

      return {
        id: String(item.guid || item.link || title),
        title,
        sourceUrl: item.link || "",
        publishedAt: item.isoDate || item.pubDate || null,
        quality: getQuality(title),
        contentKey: normalizeTitle(title)
      };
    })
    .filter((item) =>
      isRMTeam(item.title) &&
      item.sourceUrl &&
      isAllowedPublicationUrl(item.sourceUrl) &&
      item.quality !== 99
    );

  // Regroupe les versions d'un même contenu.
  const groups = new Map();

  for (const item of candidates) {
    const current = groups.get(item.contentKey);

    if (!current || item.quality < current.quality) {
      groups.set(item.contentKey, item);
    }
  }

  const selected = [...groups.values()];

  // Limite les requêtes simultanées vers les pages source.
  const enriched = [];

  for (let i = 0; i < selected.length; i += 3) {
    const batch = selected.slice(i, i + 3);

    const results = await Promise.all(
      batch.map(async (item) => ({
        ...item,
        qualityLabel:
          item.quality === 1 ? "720p x265" : "1080p",
        clicknuploadUrl:
          await getClicknuploadLink(item.sourceUrl)
      }))
    );

    enriched.push(...results);
  }

  return enriched;
}
