
import Parser from "rss-parser";
import * as cheerio from "cheerio";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "VideoTracker/1.0"
  }
});

const BASE_URL = "https://rmz.cr";
const FEED_URL = `${BASE_URL}/feed/s`;
const MAX_PAGES = 20;

function cleanTitle(title) {
  return title.replace(/^\s*(?:\[[^\]]*\]\s*)+/, "").trim();
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
  const match = cleaned.match(/^(.+?)\s+S(\d{1,2})E(\d{1,3})\b(.*)$/i);

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
    return { rank: 1, label: "720p x265" };
  }

  if (value.includes("1080p")) {
    return { rank: 2, label: "1080p" };
  }

  return null;
}

function isRMTeam(title) {
  return /rmteam/i.test(title);
}

function allowedUrl(value) {
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

function absoluteUrl(value) {
  try {
    const url = new URL(value, BASE_URL);
    return allowedUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

// Extraction ClicknUpload depuis une publication.
export async function getClicknuploadLink(pageUrl) {
  if (!allowedUrl(pageUrl)) return null;

  try {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 VideoTracker/1.0",
        "Referer": BASE_URL
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.log("Publication inaccessible:", response.status, pageUrl);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    let result = null;

    $("h4.links").each((_, heading) => {
      if (result) return;

      if (!/click\s*n\s*upload/i.test($(heading).text())) {
        return;
      }

      const container = $(heading).parent();

      container.find("a[href]").each((_, element) => {
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
          // URL invalide
        }
      });
    });

    return result;
  } catch (error) {
    console.error("Erreur extraction:", error.message);
    return null;
  }
}

// Extraction des publications d'une page HTML.
function extractPage(html) {
  const $ = cheerio.load(html);
  const items = [];

  $(".blog-post").each((_, element) => {
    const post = $(element);

    const link = post.find("h3 > a").first();
    const title = link.text().trim();
    const sourceUrl = absoluteUrl(link.attr("href"));

    if (!title || !sourceUrl || !isRMTeam(title)) return;

    const dateDay = post.find(".bloglist-date .month-day").first().text().trim();
    const dateYear = post.find(".bloglist-date .year").first().text().trim();

    let publishedAt = null;

    if (dateDay && dateYear) {
      const [month, day] = dateDay.split("/");
      publishedAt = `${dateYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    items.push({
      title,
      sourceUrl,
      publishedAt
    });
  });

  return items;
}

// Récupération des pages HTML.
async function getHtmlPage(page) {
  const url = page === 1
    ? `${BASE_URL}/l/s/`
    : `${BASE_URL}/l/s/${page}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 VideoTracker/1.0",
      "Referer": BASE_URL
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Page ${page}: HTTP ${response.status}`);
  }

  const html = await response.text();

  if (
    html.includes("Just a moment...") ||
    html.includes("challenge-platform")
  ) {
    throw new Error(`Page ${page}: blocage Cloudflare`);
  }

  return html;
}

async function getAllPublications() {
  const publications = new Map();

  // RSS en première source.
  try {
    const feed = await parser.parseURL(FEED_URL);

    for (const item of feed.items || []) {
      if (!isRMTeam(item.title || "")) continue;

      const sourceUrl = absoluteUrl(item.link);
      if (!sourceUrl) continue;

      publications.set(sourceUrl, {
        title: item.title,
        sourceUrl,
        publishedAt: item.isoDate || item.pubDate || null
      });
    }

    console.log("RSS:", publications.size, "publications");
  } catch (error) {
    console.error("Erreur RSS:", error.message);
  }

  // Pagination HTML.
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const html = await getHtmlPage(page);
      const items = extractPage(html);

      console.log(`Page ${page}: ${items.length} publications`);

      if (items.length === 0) break;

      for (const item of items) {
        publications.set(item.sourceUrl, item);
      }

    } catch (error) {
      console.error("Pagination interrompue:", error.message);
      break;
    }
  }

  return [...publications.values()];
}

export async function getPublications() {
  const candidates = await getAllPublications();
  const episodes = new Map();

  for (const item of candidates) {
    if (!isRMTeam(item.title)) continue;

    const parsed = parseEpisode(item.title);
    const quality = getQuality(item.title);

    if (!parsed || !quality) continue;

    const candidate = {
      ...parsed,
      id: parsed.episodeKey,
      title: item.title,
      quality: quality.label,
      qualityRank: quality.rank,
      publishedAt: item.publishedAt,
      sourceUrl: item.sourceUrl,
      clicknuploadUrl: null
    };

    const current = episodes.get(candidate.episodeKey);

    if (
      !current ||
      candidate.qualityRank < current.qualityRank
    ) {
      episodes.set(candidate.episodeKey, candidate);
    }
  }

  const selected = [...episodes.values()];
  const enriched = [];

  console.log("Épisodes uniques:", selected.length);

  // Trois requêtes simultanées maximum.
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

  const found = enriched.filter(item => item.clicknuploadUrl).length;

  console.log(
    `Résultat final: ${enriched.length} épisodes, ${found} liens ClicknUpload`
  );

  return enriched;
}
