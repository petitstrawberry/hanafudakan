const CARD_ASPECT = 240 / 380;

export type FieldLayout = {
  columns: number;
  rows: number;
  cardWidth: number;
  cardHeight: number;
  gap: number;
  width: number;
  height: number;
};

const nonNegativeFinite = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

// Keep a little spacing at normal sizes, but allow it to shrink with tiny cards.
const cardGap = (cardWidth: number) =>
  Math.min(10, Math.max(2, cardWidth * 0.14), cardWidth * 0.25);

const floorFraction = (value: number) =>
  value < Number.MAX_SAFE_INTEGER / 10_000
    ? Math.floor(value * 10_000) / 10_000
    : value;

/** Fit every field card, including a reserved landing slot, inside its bounds. */
export function fitFieldLayout(
  count: number,
  width: number,
  height: number,
  maxCardWidth = 64,
): FieldLayout {
  const total = Math.ceil(nonNegativeFinite(count));
  const availableWidth = nonNegativeFinite(width);
  const availableHeight = nonNegativeFinite(height);
  const maximum = nonNegativeFinite(maxCardWidth);
  const empty: FieldLayout = {
    columns: 1,
    rows: total,
    cardWidth: 0,
    cardHeight: 0,
    gap: 0,
    width: 0,
    height: 0,
  };
  if (!total || !availableWidth || !availableHeight || !maximum) return empty;

  let best = empty;
  let bestUnused = Infinity;
  let bestShapeDifference = Infinity;

  for (let columns = 1; columns <= total; columns += 1) {
    const rows = Math.ceil(total / columns);
    const fits = (cardWidth: number) => {
      const gap = cardGap(cardWidth);
      return (
        columns * cardWidth + (columns - 1) * gap <= availableWidth &&
        rows * (cardWidth / CARD_ASPECT) + (rows - 1) * gap <=
          availableHeight
      );
    };
    let lower = 0;
    let upper = Math.min(
      maximum,
      availableWidth / columns,
      (availableHeight * CARD_ASPECT) / rows,
    );
    if (fits(upper)) {
      lower = upper;
    } else {
      // Gap depends on card size; both occupied dimensions increase monotonically.
      for (let step = 0; step < 48; step += 1) {
        const middle = lower + (upper - lower) / 2;
        if (fits(middle)) lower = middle;
        else upper = middle;
      }
    }
    const cardWidth = floorFraction(lower);
    const cardHeight = cardWidth / CARD_ASPECT;
    const gap = floorFraction(cardGap(cardWidth));
    const gridWidth = columns * cardWidth + (columns - 1) * gap;
    const gridHeight = rows * cardHeight + (rows - 1) * gap;
    const unused = columns * rows - total;
    const shapeDifference = gridWidth && gridHeight
      ? Math.abs(
          Math.log(gridWidth / gridHeight) -
            Math.log(availableWidth / availableHeight),
        )
      : Infinity;
    if (
      cardWidth > best.cardWidth ||
      (cardWidth === best.cardWidth &&
        (unused < bestUnused ||
          (unused === bestUnused && shapeDifference < bestShapeDifference)))
    ) {
      best = {
        columns,
        rows,
        cardWidth,
        cardHeight,
        gap,
        width: gridWidth,
        height: gridHeight,
      };
      bestUnused = unused;
      bestShapeDifference = shapeDifference;
    }
  }
  return best;
}
