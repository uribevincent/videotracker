
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
  Inbox
} from "lucide-react";

type Video = {
  id: string;
  title: string;
  contentKey: string;
  qualityLabel: string;
  publishedAt: string | null;
  sourceUrl: string;
  clicknuploadUrl: string | null;
  followedAt?: string;
};

type State = {
  followed: Video[];
  newItems: Video[];
  lastRefresh: string | null;
};

const emptyState: State = {
  followed: [],
  newItems: [],
  lastRefresh: null
};

async function api(action: string, data?: object) {
  const response = await fetch(
    `/.netlify/functions/api?action=${action}`,
    {
      method: data ? "POST" : "GET",
      headers: data
        ? { "Content-Type": "application/json" }
        : {},
      body: data ? JSON.stringify(data) : undefined
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Erreur API");
  }

  return result;
}

export default function App() {
  const [state, setState] = useState<State>(emptyState);
  const [tab, setTab] = useState<"new" | "followed">("new");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadState() {
    try {
      setState(await api("state"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      const result = await api("refresh");
      setState(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function follow(id: string) {
    try {
      setState(await api("follow", { id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function unfollow(contentKey: string) {
    try {
      setState(await api("unfollow", { contentKey }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
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
          <span>{loading ? "Analyse..." : "Refresh"}</span>
        </button>
      </header>

      <section className="stats">
        <div className="stat-card">
          <Inbox />
          <strong>{state.newItems.length}</strong>
          <span>Nouveaux</span>
        </div>

        <div className="stat-card">
          <BookmarkCheck />
          <strong>{state.followed.length}</strong>
          <span>Suivis</span>
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
        {items.map(item => (
          <article className="video-card" key={item.id}>
            <div className="video-icon">
              <Film size={25} />
            </div>

            <div className="video-content">
              <h2>{item.title}</h2>

              <div className="video-meta">
                <span className="quality">
                  {item.qualityLabel}
                </span>

                {item.publishedAt && (
                  <span>
                    {new Date(item.publishedAt)
                      .toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>

              <div className="video-actions">
                {item.clicknuploadUrl ? (
                  <a
                    className="download-link"
                    href={item.clicknuploadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    Clicknupload
                  </a>
                ) : (
                  <a
                    className="source-link"
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    Voir la publication
                  </a>
                )}

                {tab === "new" ? (
                  <button
                    className="follow-button"
                    onClick={() => follow(item.id)}
                  >
                    <Bookmark size={16} />
                    Ajouter
                  </button>
                ) : (
                  <button
                    className="remove-button"
                    onClick={() => unfollow(item.contentKey)}
                    aria-label="Retirer du catalogue"
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
            </div>
          </article>
        ))}

        {items.length === 0 && (
          <div className="empty">
            <Film size={42} />
            <h2>
              {tab === "new"
                ? "Aucune nouvelle publication"
                : "Ton catalogue est vide"}
            </h2>
            <p>
              {tab === "new"
                ? "Appuie sur Refresh pour rechercher les nouveautés."
                : "Ajoute des publications depuis l'onglet Nouveaux."}
            </p>
          </div>
        )}
      </section>

      <footer>
        VideoTracker · Catalogue personnel
      </footer>
    </main>
  );
}
