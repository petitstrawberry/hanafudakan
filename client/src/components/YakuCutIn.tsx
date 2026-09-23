import type { CSSProperties } from "react";
import { cardImage } from "../lib/cards";
import { useCardSkin } from "../lib/cardSkin";
import {
  yakuAnnouncementDuration,
  type YakuAnnouncement,
} from "../lib/yakuAnnouncements";
import "../yaku-cutin.css";

interface YakuCutInProps {
  announcement: YakuAnnouncement;
  playerName: string;
  sequenceKey: string | number;
  reducedMotion: boolean;
}

/** A single queue entry. The table owns sequencing and dismissal. */
export function YakuCutIn({
  announcement,
  playerName,
  sequenceKey,
  reducedMotion,
}: YakuCutInProps) {
  const { skin } = useCardSkin();
  const { name, points, delta, cardIds, theme, kind } = announcement;
  const increment = kind === "increment";
  const duration = yakuAnnouncementDuration(announcement, reducedMotion);
  return (
    <div
      key={sequenceKey}
      className={`yaku-cut-in yaku-theme-${theme}${increment ? " is-increment" : ""}${reducedMotion ? " is-reduced" : ""}`}
      data-kind={kind}
      data-yaku-name={name}
      data-sequence={sequenceKey}
      style={{ "--cutin-duration": `${duration}ms` } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="yaku-cut-in-announcement">
        {playerName}の{name}、
        {increment ? `${delta}文追加、合計${points}文` : `${points}文`}
      </span>
      {increment ? (
        <div className="yaku-increment-badge" aria-hidden="true">
          <span className="yaku-cut-in-player">{playerName}</span>
          <strong className="yaku-increment-name">{name}</strong>
          <b className="yaku-increment-value">+{delta}文</b>
        </div>
      ) : (
        <div className="yaku-cut-in-stage" aria-hidden="true">
          <div className="yaku-cut-in-aura" />
          <div className="yaku-cut-in-ribbon" />
          <div className="yaku-cut-in-orbit" />
          <div className="yaku-cut-in-moon" />
          <div className="yaku-cut-in-particles">
            {Array.from({ length: 14 }, (_, index) => (
              <i
                key={index}
                style={
                  {
                    "--particle-index": index,
                    "--particle-x": `${7 + ((index * 19) % 86)}%`,
                    "--particle-y": `${9 + ((index * 31) % 78)}%`,
                    "--particle-turn": `${index * 43}deg`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="yaku-cut-in-content">
            <span className="yaku-cut-in-player">{playerName}</span>
            <h2 className="yaku-cut-in-title">{name}</h2>
            <div
              className="yaku-cut-in-cards"
              style={{ "--card-count": cardIds.length } as CSSProperties}
            >
              {cardIds.map((id, index) => (
                <img
                  className="yaku-cut-in-card"
                  key={id}
                  src={cardImage(id, skin)}
                  alt=""
                  draggable="false"
                  style={
                    {
                      "--card-index": index,
                      "--card-angle": `${(index - (cardIds.length - 1) / 2) * Math.min(8, 26 / Math.max(1, cardIds.length - 1))}deg`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="yaku-cut-in-points">
              <b>{points}</b><span>文</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
