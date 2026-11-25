
import { getStore } from "@netlify/blobs";
import {
  getPublications,
  getClicknuploadLink
} from "./scraper.mjs";

const store = getStore("videotracker");

const EMPTY_STATE = {
  followed: [],
  newItems: [],
  lastRefresh: null
};

async function readState() {
  const saved = await store.get("state", {
    type: "json"
  });

  return {
    ...EMPTY_STATE,
    ...(saved || {}),
    followed: saved?.followed || [],
    newItems: saved?.newItems || []
  };
}

async function saveState(state) {
  await store.setJSON("state", state);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function groupBySeries(episodes) {
  const groups = new Map();

  for (const episode of episodes) {
    let series = groups.get(episode.seriesId);

    if (!series) {
      series = {
        id: episode.seriesId,
        title: episode.seriesTitle,
        followedAt: null,
        seasons: []
      };

      groups.set(episode.seriesId, series);
    }

    let season = series.seasons.find(
      item => item.number === episode.season
    );

    if (!season) {
      season = {
        number: episode.season,
        episodes: []
      };

      series.seasons.push(season);
    }

    season.episodes.push(episode);
  }

  return [...groups.values()].map(series => ({
    ...series,
    seasons: series.seasons
      .sort((a, b) => a.number - b.number)
      .map(season => ({
        ...season,
        episodes: season.episodes.sort(
          (a, b) => a.episode - b.episode
        )
      }))
  }));
}


function mergeSeries(oldSeries, newSeries) {
  const merged = new Map();

  for (const season of oldSeries.seasons || []) {
    for (const episode of season.episodes || []) {
      merged.set(episode.episodeKey, episode);
    }
  }

  for (const season of newSeries.seasons || []) {
    for (const episode of season.episodes || []) {
      const previous = merged.get(episode.episodeKey);

      if (!previous) {
        merged.set(episode.episodeKey, episode);
        continue;
      }

      const previousIsBetter =
        (previous.qualityRank || 99) <
        (episode.qualityRank || 99);

      const bestVersion = previousIsBetter
        ? previous
        : episode;

      merged.set(episode.episodeKey, {
        ...previous,
        ...episode,

        // Conserver la meilleure qualité.
        ...(previousIsBetter ? {
          title: previous.title,
          quality: previous.quality,
          qualityRank: previous.qualityRank,
          sourceUrl: previous.sourceUrl
        } : {}),

        // Ne jamais perdre un lien déjà récupéré.
        clicknuploadUrl:
          episode.clicknuploadUrl ||
          previous.clicknuploadUrl ||
          null,

        episodeTitle:
          episode.episodeTitle ||
          previous.episodeTitle
      });
    }
  }

  const seasons = groupBySeries(
    [...merged.values()]
  ).flatMap(series => series.seasons);

  return {
    ...oldSeries,
    title: newSeries.title || oldSeries.title,
    seasons,
    followedAt: oldSeries.followedAt
  };
}


async function repairSeriesLinks(seriesList) {
  const updated = seriesList.map(series => ({
    ...series,
    seasons: (series.seasons || []).map(season => ({
      ...season,
      episodes: [...(season.episodes || [])]
    }))
  }));

  const tasks = [];

  for (let s = 0; s < updated.length; s++) {
    for (let se = 0; se < updated[s].seasons.length; se++) {
      for (
        let e = 0;
        e < updated[s].seasons[se].episodes.length;
        e++
      ) {
        const episode =
          updated[s].seasons[se].episodes[e];

        if (!episode.clicknuploadUrl && episode.sourceUrl) {
          tasks.push({
            episode,
            update(link) {
              if (link) {
                updated[s].seasons[se].episodes[e] = {
                  ...episode,
                  clicknuploadUrl: link
                };
              }
            }
          });
        }
      }
    }
  }

  let repaired = 0;
  let unavailable = 0;

  // Trois requêtes simultanées maximum.
  for (let i = 0; i < tasks.length; i += 3) {
    const batch = tasks.slice(i, i + 3);

    await Promise.all(
      batch.map(async task => {
        try {
          const link = await getClicknuploadLink(
            task.episode.sourceUrl
          );

          if (link) {
            task.update(link);
            repaired++;
          } else {
            unavailable++;
          }
        } catch (error) {
          console.error(
            "Repair error:",
            task.episode.title,
            error.message
          );

          unavailable++;
        }
      })
    );
  }

  return {
    series: updated,
    attempted: tasks.length,
    repaired,
    unavailable
  };
}


export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (
      request.method === "GET" &&
      action === "state"
    ) {
      return json(await readState());
    }

    if (request.method !== "POST") {
      return json({
        error: "Méthode non autorisée"
      }, 405);
    }

    const state = await readState();

    // REFRESH
    if (action === "refresh") {
      const publications = await getPublications();
      const discovered = groupBySeries(publications);

      const followedMap = new Map(
        state.followed.map(series => [
          series.id,
          series
        ])
      );

      const newSeries = [];

      for (const series of discovered) {
        const existing = followedMap.get(series.id);

        if (existing) {
          followedMap.set(
            series.id,
            mergeSeries(existing, series)
          );
        } else {
          newSeries.push(series);
        }
      }

      const updatedState = {
        followed: [...followedMap.values()],
        newItems: newSeries,
        lastRefresh: new Date().toISOString()
      };

      await saveState(updatedState);

      return json(updatedState);
    }

    const body = await request.json();

    // REPAIR LINKS
    if (action === "repair-links") {
      console.log("Starting link repair...");

      const followedResult = await repairSeriesLinks(
        state.followed
      );

      const newResult = await repairSeriesLinks(
        state.newItems
      );

      state.followed = followedResult.series;
      state.newItems = newResult.series;

      await saveState(state);

      const summary = {
        attempted:
          followedResult.attempted +
          newResult.attempted,

        repaired:
          followedResult.repaired +
          newResult.repaired,

        unavailable:
          followedResult.unavailable +
          newResult.unavailable
      };

      console.log("Repair completed:", summary);

      return json({
        ...state,
        repairSummary: summary
      });
    }

    // FOLLOW : ajouter une série complète
    if (action === "follow") {
      const series = state.newItems.find(
        item => item.id === body.seriesId
      );

      if (!series) {
        return json({
          error: "Série introuvable"
        }, 404);
      }

      const existing = state.followed.find(
        item => item.id === series.id
      );

      if (existing) {
        state.followed = state.followed.map(
          item => item.id === series.id
            ? mergeSeries(item, series)
            : item
        );
      } else {
        state.followed.push({
          ...series,
          followedAt: new Date().toISOString()
        });
      }

      state.newItems = state.newItems.filter(
        item => item.id !== series.id
      );

      await saveState(state);

      return json(state);
    }

    // UNFOLLOW : retirer une série complète
    if (action === "unfollow") {
      state.followed = state.followed.filter(
        item => item.id !== body.seriesId
      );

      await saveState(state);

      return json(state);
    }

    return json({
      error: "Action inconnue",
      action
    }, 404);

  } catch (error) {
    console.error("VideoTracker API:", error);

    return json({
      error: error.message || "Erreur serveur"
    }, 500);
  }
}
