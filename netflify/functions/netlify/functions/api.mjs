
import { getStore } from "@netlify/blobs";

const store = getStore("videotracker");

export default async function handler(request) {
  try {
    const url = new URL(request.url);

    if (url.searchParams.get("action") === "state") {
      const state = await store.get("state", {
        type: "json"
      });

      return Response.json(state || {
        followed: [],
        newItems: [],
        lastRefresh: null
      });
    }

    return Response.json({
      error: "Action inconnue"
    }, { status: 404 });

  } catch (error) {
    console.error(error);

    return Response.json({
      error: error.message
    }, { status: 500 });
  }
}
