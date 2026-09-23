import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { subscribeMusic, type MusicTrack } from "../lib/music";

/** Fixed footer slot: metadata changes never resize or cover the board. */
export default function MusicNowPlaying() {
  const [track, setTrack] = useState<MusicTrack | null>(null);
  useEffect(() => subscribeMusic(setTrack), []);
  return <div className="music-now-playing" role="status" aria-live="polite" aria-atomic="true">
    {track && <a key={track.url || track.title} href="/music/credits.html" target="_blank" rel="noreferrer"
      title={`再生中：${track.title} — ${track.artist}（音源クレジット）`}>
      <Music2 size={12} aria-hidden="true" />
      <span className="music-track-title">{track.title}</span>
      <span className="music-track-artist">{track.artist}</span>
    </a>}
  </div>;
}
