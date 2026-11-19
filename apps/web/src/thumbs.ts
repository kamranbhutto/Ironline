import { useEffect, useState } from "react";

/**
 * Small snapshots of 3D models, taken by the viewer the first time a model is shown and kept in
 * this browser, so file strips and part cards show the real part instead of a generic icon.
 */
const key = (fileId: string) => `ironline-thumb:${fileId}`;
const EVENT = "ironline-thumb";

export function getThumb(fileId: string): string | null {
  try {
    return localStorage.getItem(key(fileId));
  } catch {
    return null;
  }
}

export function saveThumb(fileId: string, dataUrl: string) {
  try {
    localStorage.setItem(key(fileId), dataUrl);
  } catch {
    return; // Storage full or blocked: thumbnails are a nicety, the icon still shows.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: fileId }));
}

export function useThumb(fileId: string | undefined) {
  const [thumb, setThumb] = useState(() => (fileId ? getThumb(fileId) : null));
  useEffect(() => {
    if (!fileId) return setThumb(null);
    setThumb(getThumb(fileId));
    const onSaved = (e: Event) => (e as CustomEvent<string>).detail === fileId && setThumb(getThumb(fileId));
    window.addEventListener(EVENT, onSaved);
    return () => window.removeEventListener(EVENT, onSaved);
  }, [fileId]);
  return thumb;
}
