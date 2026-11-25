
import { getStore } from "@netlify/blobs";
import { getPublications } from "./scraper.mjs";

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

      // Conserve la meilleure version connue.
      if (
        !previous ||
        (episode.qualityRank || 99) <=
          (previous.qualityRank || 99)
      ) {
        merged.set(episode.episodeKey, episode);
      }
    }
  }

  return {
    ...oldSeries,
    title: newSeries.title || oldSeries.title,
    seasons: groupBySeries(
      [...merged.values()]
    ).flatMap(series => series.seasons),
    followedAt: oldSeries.followedAt
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
