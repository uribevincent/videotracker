
import Parser from "rss-parser";
import * as cheerio from "cheerio";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "VideoTracker/1.0"
  }
});

const FEED_URL = "https://rmz.cr/feed/s";

function cleanTitle(title) {
  return title
    .replace(/^\s*(?:\[[^\]]*\]\s*)+/, "")
    .trim();
}

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseEpisode(title) {
  const cleaned = cleanTitle(title);

  const match = cleaned.match(
    /^(.+?)\s+S(\d{1,2})E(\d{1,3})\b(.*)$/i
  );

  if (!match) return null;

  const seriesTitle = match[1].trim();
  const season = Number(match[2]);
  const episode = Number(match[3]);

  const remainder = match[4]
    .replace(
      /\b(480p|720p|1080p|2160p|WEB-DL|WEBRip|BluRay|HEVC|x265|x264|H264|H265|RMTeam|AAC|DDP5?\.?1|Proper|REPACK)\b.*$/i,
      ""
    )
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const seriesKey = normalize(seriesTitle);

  const episodeKey =
    `${seriesKey}:s${String(season).padStart(2, "0")}` +
    `e${String(episode).padStart(2, "0")}`;

  return {
    seriesId: seriesKey,
    seriesKey,
    seriesTitle,
    season,
    episode,
    episodeTitle: remainder || `Épisode ${episode}`,
    episodeKey
  };
}

function getQuality(title) {
  const value = title.toLowerCase();

  if (
    value.includes("720p") &&
    (value.includes("x265") || value.includes("hevc"))
  ) {
    return {
      rank: 1,
      label: "720p x265"
    };
  }

  if (value.includes("1080p")) {
    return {
      rank: 2,
      label: "1080p"
    };
  }

  return null;
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
        "User-Agent": "Mozilla/5.0 (compatible; VideoTracker/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });

    console.log("Publication status:", response.status);
    console.log("Publication URL:", response.url);

    if (!response.ok) {
      console.error("Publication HTTP error:", response.status);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let result = null;

    // Recherche du titre ClicknUpload.
    $("h4.links").each((_, heading) => {
      const label = $(heading).text().trim();

      if (!/click\s*n\s*upload/i.test(label)) {
        return;
      }

      // Le pre.links est situé après le h4.
      const linkBlock = $(heading)
        .nextAll("pre.links")
        .first();

      linkBlock.find("a[href]").each((_, element) => {
        const href = $(element).attr("href");

        if (!href) return;

        try {
          const url = new URL(href, response.url);

          if (
            url.protocol === "https:" &&
            /(^|\.)clicknupload\./i.test(url.hostname)
          ) {
            result = url.href;
          }
        } catch {
          // URL invalide
        }
      });
    });

    console.log(
      "ClicknUpload result:",
      result || "NOT FOUND"
    );

    if (!result) {
      console.log(
        "Page title:",
        $("title").text().trim()
      );

      console.log(
        "ClicknUpload headings:",
        $("h4.links")
          .map((_, el) => $(el).text().trim())
          .get()
      );
    }

    return result;

  } catch (error) {
    console.error(
      "ClicknUpload extraction error:",
      error.message
    );

    return null;
  }
}


export async function getPublications() {
  const feed = await parser.parseURL(FEED_URL);

  const candidates = [];

  for (const item of feed.items || []) {
    const title = item.title || "";

    if (!isRMTeam(title)) continue;

    const parsed = parseEpisode(title);
    const quality = getQuality(title);
    const sourceUrl = item.link || "";

    if (
      !parsed ||
      !quality ||
      !sourceUrl ||
      !isAllowedPublicationUrl(sourceUrl)
    ) {
      continue;
    }

    candidates.push({
      ...parsed,
      id: parsed.episodeKey,
      title,
      quality: quality.label,
      qualityRank: quality.rank,
      publishedAt: item.isoDate || item.pubDate || null,
      sourceUrl,
      clicknuploadUrl: null
    });
  }

  // Une seule version par épisode.
  const episodes = new Map();

  for (const item of candidates) {
    const current = episodes.get(item.episodeKey);

    if (
      !current ||
      item.qualityRank < current.qualityRank
    ) {
      episodes.set(item.episodeKey, item);
    }
  }

  const selected = [...episodes.values()];

  // Recherche des liens par lots.
  const enriched = [];

  for (let i = 0; i < selected.length; i += 3) {
    const batch = selected.slice(i, i + 3);

    const results = await Promise.all(
      batch.map(async item => ({
        ...item,
        clicknuploadUrl:
          await getClicknuploadLink(item.sourceUrl)
      }))
    );

    enriched.push(...results);
  }

  return enriched;
}
