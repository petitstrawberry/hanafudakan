import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { APP_VERSION, RELEASES } from "../lib/releases";
import type { Release } from "../lib/releases";
import "../announcements.css";
export function ReleaseMeta({ release }: { release: Release }) {
  return <div className="release-meta"><span>v{release.version}</span><span>{release.date ? <time dateTime={release.date}>{release.date}</time> : "公開準備中"}</span></div>;
}
export function ReleaseContent({ release }: { release: Release }) {
  return <>{release.sections.map(section => <section className="release-section" key={section.title}><h3>{section.title}</h3><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</>;
}
export default function Announcements() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const change = () => setHash(location.hash); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  const selected = RELEASES.find(release => hash === `#announcements/${release.version}`);
  return <section className="inner-page announcements-page">
    <div className="eyebrow">NEWS FROM THE SALON</div>
    <h1>{selected ? "更新の詳細" : "お知らせ"}</h1>
    <p className="page-intro">花札館の変化を、いつでも。現在のバージョンは v{APP_VERSION} です。</p>
    {selected ? <>
      <a className="button secondary compact" href="#announcements"><ArrowLeft size={16} />一覧に戻る</a>
      <article className="release-detail"><ReleaseMeta release={selected} /><h2>{selected.title}</h2><p>{selected.summary}</p><ReleaseContent release={selected} /></article>
    </> : <div className="release-list">{RELEASES.map(release => <article key={release.version}>
      <ReleaseMeta release={release} /><h2>{release.title}</h2><p>{release.summary}</p>
      <a className="button secondary compact" href={`#announcements/${release.version}`}>変更点を読む<ArrowRight size={16} /></a>
    </article>)}</div>}
  </section>;
}
