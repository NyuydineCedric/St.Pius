import { useEffect, useState } from "react";
import { authHeaders, apiUrl } from "../utils/api";

// Student photos live in a private Supabase bucket and are served by the
// backend at /api/students/{id}/photo, which requires the bearer token. A
// plain <img src> can't send that header, so this fetches the bytes and hands
// the <img> an object URL instead.
//
// Older records (and the desktop file store) still carry an inline
// "data:image/..." URL. Those need no fetching and are passed straight
// through, so both storage styles render through one component.

// Object URLs are cached per source for the lifetime of the page. Without
// this, a class list re-rendering would refetch every photo, and revoking a
// URL still in use by a mounted <img> would blank it out.
const cache = new Map();

function isRemote(src) {
  return typeof src === "string" && src.startsWith("/api/");
}

export default function AuthImage({ src, alt, className, fallback = null }) {
  const [fetched, setFetched] = useState(null);
  const [failed, setFailed] = useState(false);

  // Derived during render rather than stored, so switching between students
  // shows the right photo immediately instead of one render late.
  const resolved = !src ? null : isRemote(src) ? cache.get(src) || fetched : src;

  useEffect(() => {
    setFailed(false);
    setFetched(null);
    // Inline data URLs and already-cached object URLs are resolved during
    // render, so there is nothing to do here.
    if (!src || !isRemote(src)) return;
    if (cache.has(src)) {
      setFetched(cache.get(src));
      return;
    }

    let cancelled = false;
    // Must go through apiUrl — on Vercel a bare `/api/...` fetch hits the
    // SPA host, which returns index.html (200) and produces a broken <img>.
    fetch(apiUrl(src), { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        const type = res.headers.get("content-type") || "";
        if (!type.startsWith("image/")) throw new Error("not an image");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        cache.set(src, url);
        setFetched(url);
      })
      .catch(() => {
        // A missing or unreachable photo shows the placeholder rather than a
        // broken-image icon — a photo is never load-bearing on these screens.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolved || failed) return fallback;
  return <img src={resolved} alt={alt} className={className} />;
}
