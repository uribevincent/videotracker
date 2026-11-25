
import { useEffect, useState } from "react";
import {
  RefreshCw,
  Film,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Trash2,
  Clock,
  CheckCircle2,
  Inbox,
  ChevronDown,
  ChevronRight,
  Tv
} from "lucide-react";

type Episode = {
  id: string;
  episodeKey: string;
  seriesId: string;
  seriesTitle: string;
  season: number;
  episode: number;
  episodeTitle: string;
  title: string;
  quality: string;
  qualityRank: number;
  publishedAt: string | null;
  sourceUrl: string;
  clicknuploadUrl: string | null;
};

type Season = {
  number: number;
  episodes: Episode[];
};

type Series = {
  id: string;
  title: string;
  followedAt: string | null;
  seasons: Season[];
};

type State = {
  followed: Series[];
  newItems: Series[];
  lastRefresh: string | null;
};

const emptyState: State = {
  followed: [],
  newItems: [],
  lastRefresh: null
};

async function api(action: string, data?: object) {
  const isRead = action === "state";

  const response = await fetch(
    `/.netlify/functions/api?action=${action}`,
    {
      method: isRead ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: isRead ? undefined : JSON.stringify(data || {})
    }
  );

  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Réponse invalide (${response.status}): ${text.slice(0, 150)}`
    );
  }

  if (!response.ok) {
    throw new Error(result.error || "Erreur API");
  }

  return result as State;
}

function episodeCount(series: Series) {
  if (!Array.isArray(series?.seasons)) {
    return 0;
  }

  return series.seasons.reduce(
    (total, season) =>
      total + (season.episodes?.length || 0),
    0
  );
}

function formatDate(date: string | null) {
  if (!date) return "";

  const parsed = new Date(date);

  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString("fr-FR");
}

export default function App() {
  const [state, setState] = useState<State>(emptyState);
  const [tab, setTab] = useState<"new" | "followed">("new");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);

  async function loadState() {
    try {
      const result = await api("state");

setState({
  followed: Array.isArray(result.followed)
    ? result.followed.filter(item =>
        Array.isArray(item.seasons)
      )
    : [],
  newItems: Array.isArray(result.newItems)
    ? result.newItems.filter(item =>
        Array.isArray(item.seasons)
      )
    : [],
  lastRefresh: result.lastRefresh || null
});
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Erreur de chargement"
      );
    } finally {
      setInitialLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      setState(await api("refresh"));
      setExpanded([]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Erreur Refresh"
      );
    } finally {
      setLoading(false);
    }
  }

  async function follow(seriesId: string) {
    try {
      setState(await api("follow", { seriesId }));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Erreur"
      );
    }
  }

  async function unfollow(seriesId: string) {
    if (!window.confirm("Retirer cette série du catalogue ?")) {
      return;
    }

    try {
      setState(await api("unfollow", { seriesId }));
      setExpanded(current =>
        current.filter(id => id !== seriesId)
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Erreur"
      );
    }
  }

  function toggleSeries(id: string) {
    setExpanded(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id]
    );
  }

  useEffect(() => {
    loadState();
  }, []);

  const items = tab === "new"
    ? state.newItems
    : state.followed;

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-icon">
            <Film size={25} />
          </div>

          <div>
            <h1>VideoTracker</h1>
            <p>Mon catalogue personnel</p>
          </div>
        </div>

        <button
          className="refresh"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw
            size={18}
            className={loading ? "spin" : ""}
          />
          <span>
            {loading ? "Analyse..." : "Refresh"}
          </span>
        </button>
      </header>

      <section className="stats">
        <div className="stat-card">
          <Inbox />
          <strong>{state.newItems.length}</strong>
          <span>Nouvelles séries</span>
        </div>

        <div className="stat-card">
          <BookmarkCheck />
          <strong>{state.followed.length}</strong>
          <span>Séries suivies</span>
        </div>
      </section>

      <nav className="tabs">
        <button
          className={tab === "new" ? "active" : ""}
          onClick={() => setTab("new")}
        >
          Nouveaux
          <span>{state.newItems.length}</span>
        </button>

        <button
          className={tab === "followed" ? "active" : ""}
          onClick={() => setTab("followed")}
        >
          Suivis
          <span>{state.followed.length}</span>
        </button>
      </nav>

      {error && (
        <div className="error">{error}</div>
      )}

      {state.lastRefresh && (
        <p className="last-refresh">
          <Clock size={14} />
          Dernière actualisation :{" "}
          {new Date(state.lastRefresh).toLocaleString("fr-FR")}
        </p>
      )}

      <section className="video-list">
        {initialLoading ? (
          <div className="empty">
            <RefreshCw className="spin" size={32} />
            <h2>Chargement du catalogue...</h2>
          </div>
        ) : (
          <>
            {items.map(series => {
              const isExpanded = expanded.includes(series.id);
              const count = episodeCount(series);

              return (
                <article
                  className="video-card series-card"
                  key={series.id}
                >
                  <button
                    className="video-icon series-toggle"
                    onClick={() => toggleSeries(series.id)}
                    aria-label="Afficher les épisodes"
                  >
                    <Tv size={25} />
                  </button>

                  <div className="video-content">
                    <div
                      className="series-heading"
                      onClick={() => toggleSeries(series.id)}
                    >
                      <div>
                        <h2>{series.title}</h2>

                        <div className="video-meta">
                          <span>
                            {count} épisode{count > 1 ? "s" : ""}
                          </span>
                          <span>
                            {series.seasons.length} saison
                            {series.seasons.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {isExpanded
                        ? <ChevronDown size={21} />
                        : <ChevronRight size={21} />
                      }
                    </div>

                    <div className="video-actions">
                      {tab === "new" ? (
                        <button
                          className="follow-button"
                          onClick={() => follow(series.id)}
                        >
                          <Bookmark size={16} />
                          Suivre cette série
                        </button>
                      ) : (
                        <button
                          className="remove-button"
                          onClick={() => unfollow(series.id)}
                          aria-label="Retirer cette série"
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>

                    {tab === "followed" && (
                      <div className="followed-label">
                        <CheckCircle2 size={14} />
                        Dans mon catalogue
                      </div>
                    )}

                    {isExpanded && (
                      <div className="season-list">
                        {series.seasons.map(season => (
                          <div
                            className="season"
                            key={season.number}
                          >
                            <h3>
                              Saison {season.number}
                            </h3>

                            {season.episodes.map(episode => (
                              <div
                                className="episode"
                                key={episode.episodeKey}
                              >
                                <div className="episode-info">
                                  <strong>
                                    S{String(season.number).padStart(2, "0")}
                                    E{String(episode.episode).padStart(2, "0")}
                                  </strong>

                                  <span>
                                    {episode.episodeTitle}
                                  </span>

                                  <div className="video-meta">
                                    <span className="quality">
                                      {episode.quality}
                                    </span>

                                    {episode.publishedAt && (
                                      <span>
                                        {formatDate(episode.publishedAt)}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {episode.clicknuploadUrl ? (
                                  <a
                                    className="download-link"
                                    href={episode.clicknuploadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink size={15} />
                                    Télécharger
                                  </a>
                                ) : (
                                  <a
                                    className="source-link"
                                    href={episode.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink size={15} />
                                    Publication
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {items.length === 0 && (
              <div className="empty">
                <Film size={42} />

                <h2>
                  {tab === "new"
                    ? "Aucune nouvelle série"
                    : "Ton catalogue est vide"}
                </h2>

                <p>
                  {tab === "new"
                    ? "Appuie sur Refresh pour rechercher les nouveautés."
                    : "Ajoute des séries depuis l'onglet Nouveaux."}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <footer>
        VideoTracker · Catalogue personnel
      </footer>
    </main>
  );
}
