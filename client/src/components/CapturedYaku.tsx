import type { CSSProperties } from "react";
import { cardImage, cards, type CardKind } from "../lib/cards";
import { useCardSkin } from "../lib/cardSkin";
import type { YakuStatus } from "../lib/yakuStatus";
import "../captured-yaku.css";

interface CapturedYakuProps {
  playerIndex: number;
  playerName: string;
  captured: number[];
  statuses: YakuStatus[];
  self?: boolean;
  spectator?: boolean;
  assist: boolean;
  onRoleSelect: (id: string) => void;
  selectedRoleId?: string;
}

const groups: { kind: CardKind; label: string; roles: string[] }[] = [
  { kind: "bright", label: "光", roles: ["goko", "shiko", "ame-shiko", "sanko"] },
  {
    kind: "animal",
    label: "たね",
    roles: ["inoshikacho", "hanami", "tsukimi", "tane"],
  },
  { kind: "ribbon", label: "短冊", roles: ["akatan", "aotan", "tan"] },
  { kind: "chaff", label: "かす", roles: ["kasu"] },
];

export default function CapturedYaku({
  playerIndex,
  playerName,
  captured,
  statuses,
  self = false,
  spectator = false,
  assist,
  onRoleSelect,
  selectedRoleId,
}: CapturedYakuProps) {
  const { skin } = useCardSkin();
  return (
    <section
      className={`captured-yaku ${self ? "captured-yaku-self" : "captured-yaku-opponent"}`}
      data-capture-player={playerIndex}
      data-role-player={playerIndex}
      aria-label={`${playerName}の取り札と役`}
    >
      <div className="captured-yaku-owner">
        <span>{spectator ? `${playerIndex + 1}番手` : self ? "あなた" : "相手"}の取り札</span>
        <span>{playerName}</span>
      </div>
      <div className="captured-yaku-groups">
        {groups.map((group) => {
          // A sake cup is displayed once, with the animals. Its extra chaff
          // contribution belongs to role scoring rather than physical piles.
          const pile = captured
            .filter((id) => cards[id]?.kind === group.kind)
            .sort((left, right) => left - right);
          return (
            <div
              key={group.kind}
              className={`captured-yaku-group captured-yaku-${group.kind}`}
              data-capture-kind={group.kind}
            >
              <h3>{group.label}</h3>
              <div
                className={`captured-yaku-scroll ${pile.length ? "" : "captured-yaku-empty"}`}
                aria-label={`${group.label}の取り札`}
              >
                {pile.length ? (
                  <div
                    className="captured-yaku-fan"
                    style={{
                      "--pile-count": pile.length,
                      "--pile-gap-count": Math.max(1, pile.length - 1),
                    } as CSSProperties}
                  >
                    {pile.map((id, index) => (
                      <span
                        key={id}
                        className="captured-yaku-card"
                        data-captured-card-id={id}
                        style={{ "--pile-index": index } as CSSProperties}
                        tabIndex={0}
                        onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
                        aria-label={`${cards[id].month}月・${cards[id].name}`}
                        title={`${cards[id].month}月・${cards[id].name}`}
                      >
                        <img
                          src={cardImage(id, skin)}
                          alt={`${cards[id].month}月・${cards[id].name}`}
                          draggable={false}
                        />
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="captured-yaku-vacant" aria-label="まだ札がありません" />
                )}
              </div>
              <div className="captured-yaku-roles">
                {group.roles.map((id) => {
                  const role = statuses.find((candidate) => candidate.id === id);
                  if (!role) return null;
                  const near = role.state === "possible" && role.required - role.have === 1;
                  const stateLabel =
                    role.state === "complete"
                      ? `成立・${role.points}文`
                      : role.state === "impossible"
                        ? "成立不可"
                        : role.state === "upgraded"
                          ? "上位役へ発展"
                          : near
                            ? "あと1枚"
                            : "成立可能";
                  return (
                    <button
                      type="button"
                      key={id}
                      data-yaku-id={id}
                      data-yaku-state={role.state}
                      className={`captured-yaku-role is-${role.state}${near ? " is-near" : ""}${selectedRoleId === id ? " is-selected" : ""}`}
                      onClick={() => onRoleSelect(id)}
                      disabled={!assist}
                      aria-label={`${role.name}、${stateLabel}。${role.reason}`}
                      aria-expanded={assist ? selectedRoleId === id : undefined}
                      title={`${role.name}：${stateLabel}。${role.reason}`}
                    >
                      <span className="captured-yaku-role-name">{role.name}</span>
                      {role.state === "complete" && <span className="captured-yaku-role-mark" aria-hidden="true">✦</span>}
                      {near && <span className="captured-yaku-role-mark" aria-hidden="true">●</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
