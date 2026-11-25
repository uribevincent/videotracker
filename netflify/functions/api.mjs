
import { getStore } from "@netlify/blobs";
import { getPublications } from "./scraper.mjs";

const store = getStore({
  name: "videotracker",
  region: "eu-central-1"
});

const emptyState = {
  followed: [],
  newItems: [],
  lastRefresh: null
};

async function readState() {
  return await store.get("state", { type: "json" }) || emptyState;
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

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (request.method === "GET" && action === "state") {
      return json(await readState());
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const state = await readState();

    if (action === "refresh") {
      const publications = await getPublications();

      const followedKeys = new Set(
        state.followed.map(item => item.contentKey)
      );

      const followed = state.followed.map(old => {
        const updated = publications.find(
          item => item.contentKey === old.contentKey
        );

        return updated
          ? { ...old, ...updated, followedAt: old.followedAt }
          : old;
      });

      const newItems = publications.filter(
        item => !followedKeys.has(item.contentKey)
      );

      const updatedState = {
        followed,
        newItems,
        lastRefresh: new Date().toISOString()
      };

      await saveState(updatedState);

      return json(updatedState);
    }

    if (action === "follow") {
      const { id } = await request.json();

      const item = state.newItems.find(
        item => item.id === id
      );

      if (!item) {
        return json({ error: "Publication introuvable" }, 404);
      }

      if (!state.followed.some(
        followed => followed.contentKey === item.contentKey
      )) {
        state.followed.push({
          ...item,
          followedAt: new Date().toISOString()
        });
      }

      state.newItems = state.newItems.filter(
        entry => entry.contentKey !== item.contentKey
      );

      await saveState(state);
      return json(state);
    }

    if (action === "unfollow") {
      const { contentKey } = await request.json();

      state.followed = state.followed.filter(
        item => item.contentKey !== contentKey
      );

      await saveState(state);
      return json(state);
    }

    return json({ error: "Action inconnue" }, 404);

  } catch (error) {
    console.error(error);

    return json({
      error: error.message || "Erreur serveur"
    }, 500);
  }
}
