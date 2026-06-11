/** Fixed anchor positions (percent of the table area) for up to 6 seats. */
export interface Pos {
  x: number
  y: number
}

const ANCHORS: Pos[] = [
  { x: 50, y: 92 }, // seat 0 — bottom center
  { x: 12, y: 75 }, // seat 1 — bottom left
  { x: 12, y: 25 }, // seat 2 — top left
  { x: 50, y: 8 }, // seat 3 — top center
  { x: 88, y: 25 }, // seat 4 — top right
  { x: 88, y: 75 }, // seat 5 — bottom right
]

export function seatPos(seat: number): Pos {
  return ANCHORS[((seat % ANCHORS.length) + ANCHORS.length) % ANCHORS.length]
}

/** Where a player's street bet sits: between the seat and the table center. */
export function betPos(seat: number): Pos {
  const p = seatPos(seat)
  return { x: 50 + (p.x - 50) * 0.52, y: 50 + (p.y - 50) * 0.48 }
}

/** Dealer button disc: just inside the seat, nudged clockwise. */
export function buttonPos(seat: number): Pos {
  const p = seatPos(seat)
  // Perpendicular nudge so the button doesn't overlap the bet chip.
  const dx = (p.x - 50) * 0.66
  const dy = (p.y - 50) * 0.66
  const len = Math.hypot(dx, dy) || 1
  return { x: 50 + dx + (-dy / len) * 7, y: 50 + dy + (dx / len) * 11 }
}

/** Pixel vector from a bet chip toward the pot (for the sweep-in exit animation). */
export function towardPotPx(seat: number): Pos {
  const p = betPos(seat)
  return { x: ((50 - p.x) / 100) * 640, y: ((42 - p.y) / 100) * 360 }
}
