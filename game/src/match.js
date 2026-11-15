// The match: rounds, the clock, the money and the charge. EMBERYARD is attack-sided
// for the player's team: every round the teal side carries a charge to site A or B,
// plants it and defends it; the ember side holds the sites, and after a plant races
// the 40-second fuse to defuse. First to 7 rounds, at most 12. This module owns the
// rules and the economy only; main.js owns actors, guns and rendering, and reads this
// module's events to drive the HUD and the sound.
import { WEAPONS, GRENADE_PRICE, GRENADE_MAX, ARMOR_PRICE } from './weapons.js';

export const BUY_SECONDS = 20;
export const ROUND_SECONDS = 115;
export const FUSE_SECONDS = 40;
export const PLANT_SECONDS = 3.2;
export const DEFUSE_SECONDS = 5;
export const END_SECONDS = 5.5;
export const ROUNDS_TO_WIN = 7;
export const MAX_ROUNDS = 12;
export const START_MONEY = 900;

const WIN_PAY = 2700;
const LOSS_PAY = 1900;
const KILL_PAY = 300;
const PLANT_PAY = 300;
const DEFUSE_PAY = 300;

export function createMatch(world) {
  const match = {
    phase: 'buy', // buy | live | planted | over | matchover
    phaseLeft: BUY_SECONDS,
    round: 0,
    scores: { attack: 0, defense: 0 },
    playerMoney: START_MONEY,
    winner: null, // of the round: 'attack' | 'defense'
    winReason: '',
    matchWinner: null,
    attackSite: world.sites[0],
    charge: {
      state: 'carried', // carried | dropped | planted | gone
      carrier: null,
      position: null,
      site: null,
      plantProgress: 0,
      defuseProgress: 0,
      channelActor: null,
    },
    events: [],
  };

  function emit(type, data = {}) {
    match.events.push({ type, ...data });
  }

  function teamMoney(team, amount, actors) {
    for (const actor of actors) {
      if (actor.team !== team) continue;
      if (actor.kind === 'player') match.playerMoney += amount;
      else actor.money += amount;
    }
  }

  function endRound(winner, reason, actors) {
    match.phase = 'over';
    match.phaseLeft = END_SECONDS;
    match.winner = winner;
    match.winReason = reason;
    match.scores[winner] += 1;
    teamMoney(winner, WIN_PAY, actors);
    teamMoney(winner === 'attack' ? 'defense' : 'attack', LOSS_PAY, actors);
    match.charge.state = 'gone';
    match.charge.channelActor = null;
    emit('round-end', { winner, reason });
    if (match.scores.attack >= ROUNDS_TO_WIN || match.scores.defense >= ROUNDS_TO_WIN || match.round >= MAX_ROUNDS) {
      match.matchWinner = match.scores.attack === match.scores.defense ? winner : match.scores.attack > match.scores.defense ? 'attack' : 'defense';
    }
  }

  match.startMatch = function startMatch(actors) {
    match.scores.attack = 0;
    match.scores.defense = 0;
    match.round = 0;
    match.playerMoney = START_MONEY;
    match.matchWinner = null;
    for (const actor of actors) {
      if (actor.kind === 'bot') {
        actor.money = START_MONEY;
        actor.weaponId = 'pistol';
        actor.armor = false;
        actor.kills = 0;
        actor.deaths = 0;
      }
    }
    match.startRound(actors);
  };

  match.startRound = function startRound(actors) {
    match.round += 1;
    match.phase = 'buy';
    match.phaseLeft = BUY_SECONDS;
    match.winner = null;
    match.winReason = '';
    match.attackSite = world.sites[0];
    match.charge.state = 'carried';
    match.charge.carrier = actors.find((a) => a.kind === 'player') ?? null;
    match.charge.position = null;
    match.charge.site = null;
    match.charge.plantProgress = 0;
    match.charge.defuseProgress = 0;
    match.charge.channelActor = null;
    emit('round-start', { round: match.round });
  };

  match.beginLive = function beginLive() {
    if (match.phase !== 'buy') return;
    match.phase = 'live';
    match.phaseLeft = ROUND_SECONDS;
    emit('live');
  };

  // Buying for the player. Bots buy for themselves (bots.js buyFor) at round start.
  match.buy = function buy(itemId, inv) {
    if (match.phase !== 'buy' && match.phase !== 'live') return 'phase';
    if (itemId === 'grenade') {
      if (inv.grenades >= GRENADE_MAX) return 'owned';
      if (match.playerMoney < GRENADE_PRICE) return 'funds';
      match.playerMoney -= GRENADE_PRICE;
      inv.grenades += 1;
      return 'ok';
    }
    if (itemId === 'armor') {
      if (inv.armor) return 'owned';
      if (match.playerMoney < ARMOR_PRICE) return 'funds';
      match.playerMoney -= ARMOR_PRICE;
      inv.armor = true;
      return 'ok';
    }
    const def = WEAPONS[itemId];
    if (!def) return 'unknown';
    if (inv.owned.has(itemId)) return 'owned';
    if (match.playerMoney < def.price) return 'funds';
    match.playerMoney -= def.price;
    inv.give(itemId);
    if (def.slot === 'primary') inv.switchTo(itemId);
    return 'ok';
  };

  match.onKill = function onKill(killer) {
    if (!killer) return;
    if (killer.kind === 'player') match.playerMoney += KILL_PAY;
    else if (killer.kind === 'bot') killer.money += KILL_PAY;
  };

  // Advance the rules one fixed step. `channels` lists who is channelling what this
  // step: [{ actor, kind: 'plant' | 'defuse', site }] from the player's keys and the
  // bots' AI. Positions and alive flags are read off the actors themselves.
  match.step = function step(dt, actors, channels) {
    const charge = match.charge;
    const player = actors.find((a) => a.kind === 'player');
    const attackAlive = actors.filter((a) => a.team === 'attack' && a.alive).length;
    const defenseAlive = actors.filter((a) => a.team === 'defense' && a.alive).length;

    if (match.phase === 'buy' || match.phase === 'over') {
      match.phaseLeft -= dt;
      if (match.phaseLeft <= 0) {
        if (match.phase === 'buy') match.beginLive();
        else if (match.matchWinner) {
          match.phase = 'matchover';
          emit('match-end', { winner: match.matchWinner });
        } else {
          emit('need-round-reset');
        }
      }
      return;
    }
    if (match.phase !== 'live' && match.phase !== 'planted') return;

    match.phaseLeft -= dt;

    // The attack site the bots make for: the site nearest the charge carrier.
    const carrierPos = charge.carrier?.body.position ?? player?.body.position;
    if (carrierPos) {
      match.attackSite = world.sites[0].center.distanceTo(carrierPos) <= world.sites[1].center.distanceTo(carrierPos)
        ? world.sites[0]
        : world.sites[1];
    }

    // Charge drop and pickup.
    if (charge.state === 'carried' && charge.carrier && !charge.carrier.alive) {
      charge.state = 'dropped';
      charge.position = charge.carrier.body.position.clone();
      charge.carrier = null;
      charge.plantProgress = 0;
      emit('charge-dropped');
    }
    if (charge.state === 'dropped') {
      for (const actor of actors) {
        if (actor.team === 'attack' && actor.alive && actor.body.position.distanceTo(charge.position) < 1.2) {
          charge.state = 'carried';
          charge.carrier = actor;
          charge.position = null;
          emit('charge-picked', { actor });
          break;
        }
      }
    }

    // Channelling: plant by the carrier inside a site, defuse by a defender at the
    // planted charge. Any interruption (death, moving off, letting go) resets it.
    charge.channelActor = null;
    if (charge.state === 'carried' && match.phase === 'live') {
      const attempt = channels.find((c) => c.kind === 'plant' && c.actor === charge.carrier && c.actor.alive);
      if (attempt && attempt.actor.body.position.distanceTo(attempt.site.center) < attempt.site.radius) {
        charge.channelActor = attempt.actor;
        charge.plantProgress += dt / PLANT_SECONDS;
        if (charge.plantProgress >= 1) {
          charge.state = 'planted';
          charge.site = attempt.site;
          charge.position = attempt.site.plant.clone();
          charge.carrier = null;
          charge.plantProgress = 0;
          match.phase = 'planted';
          match.phaseLeft = FUSE_SECONDS;
          if (attempt.actor.kind === 'player') match.playerMoney += PLANT_PAY;
          else attempt.actor.money += PLANT_PAY;
          emit('planted', { site: attempt.site, actor: attempt.actor });
        }
      } else {
        charge.plantProgress = 0;
      }
    }
    if (charge.state === 'planted') {
      const attempt = channels.find((c) => c.kind === 'defuse' && c.actor.team === 'defense' && c.actor.alive);
      if (attempt && attempt.actor.body.position.distanceTo(charge.position) < 1.7) {
        charge.channelActor = attempt.actor;
        charge.defuseProgress += dt / DEFUSE_SECONDS;
        if (charge.defuseProgress >= 1) {
          if (attempt.actor.kind === 'bot') attempt.actor.money += DEFUSE_PAY;
          emit('defused', { actor: attempt.actor });
          endRound('defense', 'The charge was defused', actors);
          return;
        }
      } else {
        charge.defuseProgress = 0;
      }
    }

    // Win conditions.
    if (match.phase === 'live') {
      if (defenseAlive === 0) return endRound('attack', 'Defenders eliminated', actors);
      if (attackAlive === 0) return endRound('defense', 'Attackers eliminated', actors);
      if (match.phaseLeft <= 0) return endRound('defense', 'Time expired', actors);
    } else if (match.phase === 'planted') {
      if (defenseAlive === 0) return endRound('attack', 'Defenders eliminated', actors);
      if (match.phaseLeft <= 0) {
        emit('detonated', { site: charge.site });
        return endRound('attack', 'The charge detonated', actors);
      }
    }
    return undefined;
  };

  match.drainEvents = function drainEvents() {
    const out = match.events;
    match.events = [];
    return out;
  };

  return match;
}
