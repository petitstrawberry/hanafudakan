import type { CardSkin } from "./cardSkin";

export type CardKind = 'bright' | 'animal' | 'ribbon' | 'chaff';
export interface HanafudaCard { id: number; month: number; name: string; kind: CardKind }

export const MONTHS = ['松', '梅', '桜', '藤', '菖蒲', '牡丹', '萩', '芒', '菊', '紅葉', '柳', '桐'] as const;

const names = [
  '松に鶴', '松に赤短', '松のカス', '松のカス',
  '梅に鶯', '梅に赤短', '梅のカス', '梅のカス',
  '桜に幕', '桜に赤短', '桜のカス', '桜のカス',
  '藤に不如帰', '藤に短冊', '藤のカス', '藤のカス',
  '菖蒲に八橋', '菖蒲に短冊', '菖蒲のカス', '菖蒲のカス',
  '牡丹に蝶', '牡丹に青短', '牡丹のカス', '牡丹のカス',
  '萩に猪', '萩に短冊', '萩のカス', '萩のカス',
  '芒に月', '芒に雁', '芒のカス', '芒のカス',
  '菊に盃', '菊に青短', '菊のカス', '菊のカス',
  '紅葉に鹿', '紅葉に青短', '紅葉のカス', '紅葉のカス',
  '柳に小野道風', '柳に燕', '柳に短冊', '柳のカス',
  '桐に鳳凰', '桐のカス', '桐のカス', '桐のカス',
];
const brights = new Set([0, 8, 28, 40, 44]);
const animals = new Set([4, 12, 16, 20, 24, 29, 32, 36, 41]);
const ribbons = new Set([1, 5, 9, 13, 17, 21, 25, 33, 37, 42]);

export const cards: HanafudaCard[] = names.map((name, id) => ({
  id,
  month: Math.floor(id / 4) + 1,
  name,
  kind: brights.has(id) ? 'bright' : animals.has(id) ? 'animal' : ribbons.has(id) ? 'ribbon' : 'chaff',
}));

export function cardImage(id: number, skin: CardSkin = "recolored"): string {
  const directory = skin === "classic" ? "cards-classic" : "cards";
  return Number.isInteger(id) && id >= 0 && id < 48
    ? `/${directory}/${id}.svg`
    : `/${directory}/back.svg`;
}
