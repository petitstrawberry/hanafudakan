import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { trapEffects } from "../lib/hyperGame";
import { playSound } from "../lib/audio";
import type { TrapKind } from "../lib/types";

/** Visual reveal of the server's fixed draw; never rolls locally or sends a command. */
export default function TrapRoulette({ choices, remaining, animated, select }: {
  choices: TrapKind[];
  remaining: number;
  animated: boolean;
  select: (kind: TrapKind) => void;
}) {
  const [rolling, setRolling] = useState(true);
  useEffect(() => {
    const ticks = animated ? window.setInterval(() => playSound("deal"), 160) : undefined;
    const finish = window.setTimeout(() => { setRolling(false); playSound("click"); }, animated ? 1400 : 150);
    return () => { window.clearTimeout(finish); window.clearInterval(ticks); };
  }, [animated]);
  const names = Object.values(trapEffects).map(effect => effect.name);
  return <>
    <strong>罠ルーレット · 残り{remaining}回</strong>
    {rolling ? <div className={`trap-roulette ${animated ? "is-spinning" : ""}`} role="status" aria-label="罠ルーレット抽選演出">
      <div className="trap-roulette-reels" aria-hidden="true">{[0, 1].map(reel => <div className="trap-roulette-window" key={reel}>
        <div className="trap-roulette-strip" style={{ "--trap-stop": `${-(16 + names.indexOf(trapEffects[choices[reel]]?.name ?? names[0])) * 48}px` } as CSSProperties}>{[...names, ...names, ...names].map((name, index) => <span key={index}>{name}</span>)}</div>
      </div>)}</div>
      <small>8種類から2候補を公開…</small>
    </div> : <div className="trap-roulette-result" aria-label="罠ルーレット結果">
      <strong>2候補が決定！ どちらを仕掛ける？</strong>
      {choices.map(kind => <button key={kind} onClick={() => select(kind)} title={trapEffects[kind].description}>
        <b>{trapEffects[kind].name}</b><small>{trapEffects[kind].description}</small>
      </button>)}
    </div>}
  </>;
}
