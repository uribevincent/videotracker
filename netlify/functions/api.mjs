
import { getStore } from "@netlify/blobs";
import { getPublications } from "./scraper.mjs";

const store = getStore("videotracker");

const EMPTY_STATE = {
  followed: [],
  newItems: [],
  lastRefresh: null
};

async function readState() {
  return (
    await store.get("state", { type: "json" })
  ) || EMPTY_STATE;
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

    // 1. Lecture du catalogue
    if (request.method === "GET" && action === "state") {
      return json(await readState());
    }

    if (request.method !== "POST") {
      return json({ error: "Méthode non autorisée" }, 405);
    }

    const state = await readState();

    // 2. Actualisation du flux XML
    if (action === "refresh") {
      console.log("VideoTracker: démarrage du parsing");

      const publications = await getPublications();

      console.log(
        `VideoTracker: ${publications.length} publications trouvées`
      );

      const followedKeys = new Set(
        state.followed.map(item => item.contentKey)
      );

      // Actualise les informations des vidéos suivies
      const updatedFollowed = state.followed.map(old => {
        const updated = publications.find(
          item => item.contentKey === old.contentKey
        );

        return updated
          ? {
              ...old,
              ...updated,
              followedAt: old.followedAt
            }
          : old;
      });

      // Évite de proposer les vidéos déjà cataloguées
      const newItems = publications.filter(
        item => !followedKeys.has(item.contentKey)
      );

      const updatedState = {
        followed: updatedFollowed,
        newItems,
        lastRefresh: new Date().toISOString()
      };

      await saveState(updatedState);

      return json(updatedState);
    }

    // 3. Ajout au catalogue
    if (action === "follow") {
      const body = await request.json();
      const { id } = body;

      const item = state.newItems.find(
        entry => entry.id === id
      );

      if (!item) {
        return json({
          error: "Publication introuvable"
        }, 404);
      }

      const alreadyFollowed = state.followed.some(
        entry => entry.contentKey === item.contentKey
      );

      if (!alreadyFollowed) {
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

    // 4. Suppression du catalogue
    if (action === "unfollow") {
      const body = await request.json();
      const { contentKey } = body;

      state.followed = state.followed.filter(
        item => item.contentKey !== contentKey
      );

      await saveState(state);

      return json(state);
    }

    return json({
      error: "Action inconnue",
      action
    }, 404);

  } catch (error) {
    console.error("VideoTracker API error:", error);

    return json({
      error: error.message || "Erreur serveur"
    }, 500);
  }
}
