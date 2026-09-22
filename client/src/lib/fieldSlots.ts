export type FieldSlot = number | null;

/**
 * Keep a card's physical field slot after another card is captured.
 * Empty slots are intentional: the next landing card can reuse a hole without
 * moving every other card around the table.
 */
export function reconcileFieldSlots(
  slots: readonly FieldSlot[],
  field: readonly number[],
  temporary: number | null,
): FieldSlot[] {
  const next = [...slots];
  const active =
    temporary !== null && !field.includes(temporary)
      ? [...field, temporary]
      : [...field];
  const activeIds = new Set(active);

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== null && !activeIds.has(next[index]!)) next[index] = null;
  }
  for (const id of active) {
    if (next.includes(id)) continue;
    const empty = next.indexOf(null);
    if (empty >= 0) next[empty] = id;
    else next.push(id);
  }
  return next;
}

