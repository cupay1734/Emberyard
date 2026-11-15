// EMBERYARD's look plan, in one place: a dusk industrial yard in charcoal and bone,
// lit by one ember accent. Team colours are functional, not decorative: ember marks
// the defending side and the objective, teal marks the player's own side.
export const PALETTE = {
  canvas: '#101216', // sky / page background
  surface: '#1d2126', // dark structures
  concrete: '#565d66', // mid walls and ground detail
  bone: '#ece7db', // light surfaces, friendly kit
  muted: '#98a0a8', // secondary text and metal
  ember: '#ff7a29', // accent: objective, enemy team, warnings
  teal: '#2ec4b6', // player team
  ground: '#33373d', // yard floor
};

export function color(name) {
  return PALETTE[name];
}
