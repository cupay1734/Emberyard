// The DOM HUD: health, armour, ammo, money, the round clock and score, alive counts,
// a kill feed, objective and channel progress, a minimap, the buy menu and the menu /
// pause / match-end overlay. It never touches the simulation; main.js pushes state in
// and reads clicks out.
const OVERLAY_COPY = {
  start: {
    title: 'EMBERYARD',
    copy: 'A round-based tactical FPS in a dusk kiln yard. Your teal squad carries the charge: plant it at site A or B and defend it, or wipe out the ember defenders. They will try to stop you — and after a plant, to defuse. First to 7 rounds.',
    action: 'Enter the yard',
  },
  paused: {
    title: 'Paused',
    copy: 'The round is live. Click to jump back in.',
    action: 'Resume',
  },
  buyPause: {
    title: 'Buy phase over',
    copy: 'The round is live. Click to jump in.',
    action: 'Jump in',
  },
  matchoverAttack: {
    title: 'Yard taken',
    copy: 'Your squad wins the match.',
    action: 'Play again',
  },
  matchoverDefense: {
    title: 'Yard lost',
    copy: 'The defenders win the match. The kiln keeps its secrets.',
    action: 'Play again',
  },
};

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const scoreboard = el('scoreboard');
  const buyOverlay = el('buy-overlay');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const buyTimer = el('buy-timer');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const progressWrap = el('progress-wrap');
  const progressFill = el('progress-fill');
  const progressLabel = el('progress-label');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');
  let bannerTimer = 0;
  let hitTimer = 0;
  let last = {};
  let mapStatic = null;

  function changed(key, value) {
    if (last[key] === value) return false;
    last[key] = value;
    return true;
  }

  return {
    setHealth(hp, armor) {
      const key = `${hp}|${armor}`;
      if (!changed('hp', key)) return;
      el('health-num').textContent = String(Math.max(0, Math.ceil(hp)));
      el('health-fill').style.width = `${Math.max(0, hp)}%`;
      el('health-fill').style.background = hp <= 30 ? 'var(--ember)' : 'var(--teal)';
      el('armor-tag').hidden = !armor;
    },
    setAmmo(mag, reserve, weaponName) {
      if (!changed('ammo', `${mag}|${reserve}|${weaponName}`)) return;
      el('ammo-mag').textContent = String(mag);
      el('ammo-reserve').textContent = `/ ${reserve}`;
      el('weapon-name').textContent = weaponName;
      el('ammo').classList.toggle('empty', mag === 0);
    },
    setGrenades(count) {
      if (!changed('gren', count)) return;
      el('grenades').textContent = `Frag × ${count} (G)`;
    },
    setMoney(value) {
      if (!changed('money', value)) return;
      el('money').textContent = `$${value}`;
    },
    setClock(seconds, round, phase) {
      const text = `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
      if (!changed('clock', `${text}|${round}|${phase}`)) return;
      const timer = el('timer');
      timer.textContent = text;
      timer.classList.toggle('urgent', seconds <= 10 && (phase === 'live' || phase === 'planted'));
      timer.classList.toggle('planted', phase === 'planted');
      el('round-num').textContent = `Round ${round}`;
    },
    setScores(attack, defense, aliveAttack, aliveDefense) {
      if (!changed('scores', `${attack}|${defense}|${aliveAttack}|${aliveDefense}`)) return;
      el('score-attack').textContent = String(attack);
      el('score-defense').textContent = String(defense);
      el('alive-attack').textContent = '●'.repeat(aliveAttack) + '○'.repeat(Math.max(0, 5 - aliveAttack));
      el('alive-defense').textContent = '●'.repeat(aliveDefense) + '○'.repeat(Math.max(0, 5 - aliveDefense));
    },
    objective(text) {
      if (!changed('objective', text)) return;
      el('objective').textContent = text;
    },
    chargeTag(text) {
      if (!changed('charge', text)) return;
      const tag = el('charge-tag');
      tag.hidden = !text;
      tag.textContent = text ?? '';
    },
    banner(big, sub = '', holdMs = 2600) {
      bannerTitle.textContent = big;
      bannerSub.textContent = sub;
      bannerEl.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        bannerEl.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      bannerEl.hidden = true;
    },
    progress(fraction, label) {
      if (fraction === null || fraction === undefined) {
        if (!changed('progress', 'off')) return;
        progressWrap.hidden = true;
        return;
      }
      changed('progress', 'on');
      progressWrap.hidden = false;
      progressFill.style.width = `${Math.round(fraction * 100)}%`;
      progressLabel.textContent = label;
    },
    hitMarker(killed) {
      const marker = el('hitmarker');
      marker.classList.add('on');
      marker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => marker.classList.remove('on', 'kill'), killed ? 220 : 100);
    },
    damageFlash() {
      const flash = el('damage-flash');
      flash.style.opacity = '0.55';
      setTimeout(() => {
        flash.style.opacity = '0';
      }, 60);
    },
    kill(killerName, victimName, killerTeam, headshot) {
      const feed = el('killfeed');
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.textContent = killerName;
      k.className = killerTeam === 'attack' ? 'team-teal' : 'team-ember';
      const v = document.createElement('span');
      v.textContent = victimName;
      v.className = killerTeam === 'attack' ? 'team-ember' : 'team-teal';
      row.append(k, document.createTextNode(headshot ? ' ⌖ ' : ' ▸ '), v);
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => row.remove(), 5000);
    },
    // ---- buy menu ------------------------------------------------------------
    showBuy({ money, items, timerText, onBuy, onReady }) {
      buyMoney.textContent = `$${money}`;
      buyTimer.textContent = timerText;
      buyItems.replaceChildren();
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.disabled = item.owned || !item.afford;
        const name = document.createElement('span');
        name.textContent = item.name;
        const price = document.createElement('b');
        price.textContent = item.owned ? 'OWNED' : `$${item.price}`;
        const hint = document.createElement('small');
        hint.textContent = item.hint;
        button.append(name, price, hint);
        button.addEventListener('click', () => onBuy(item.id));
        buyItems.append(button);
      }
      el('buy-ready').onclick = onReady;
      buyOverlay.hidden = false;
    },
    refreshBuyMoney(money, timerText) {
      buyMoney.textContent = `$${money}`;
      buyTimer.textContent = timerText;
    },
    hideBuy() {
      buyOverlay.hidden = true;
    },
    buyVisible() {
      return !buyOverlay.hidden;
    },
    // ---- overlay ---------------------------------------------------------------
    showOverlay(mode, rows) {
      const text = OVERLAY_COPY[mode];
      title.textContent = text.title;
      copy.textContent = text.copy;
      play.textContent = text.action;
      if (rows) {
        scoreboard.hidden = false;
        scoreboard.replaceChildren();
        for (const row of rows) {
          const tr = document.createElement('tr');
          for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.append(td);
          }
          scoreboard.append(tr);
        }
      } else {
        scoreboard.hidden = true;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    overlayVisible() {
      return !overlay.hidden;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    // ---- minimap ---------------------------------------------------------------
    setMapStatic(colliders) {
      mapStatic = document.createElement('canvas');
      mapStatic.width = minimap.width;
      mapStatic.height = minimap.height;
      const c = mapStatic.getContext('2d');
      c.fillStyle = '#14161a';
      c.fillRect(0, 0, mapStatic.width, mapStatic.height);
      c.fillStyle = '#2c323a';
      for (const box of colliders) {
        if (box.max.y < 2) continue;
        const x = ((box.min.x + 24) / 48) * mapStatic.width;
        const z = ((box.min.z + 24) / 48) * mapStatic.height;
        const w = ((box.max.x - box.min.x) / 48) * mapStatic.width;
        const h = ((box.max.z - box.min.z) / 48) * mapStatic.height;
        c.fillRect(x, z, Math.max(1.5, w), Math.max(1.5, h));
      }
    },
    drawMinimap({ player, allies, enemies, sites, chargePos }) {
      if (!mapStatic) return;
      mapCtx.drawImage(mapStatic, 0, 0);
      const px = (x) => ((x + 24) / 48) * minimap.width;
      const pz = (z) => ((z + 24) / 48) * minimap.height;
      mapCtx.fillStyle = '#ff7a29';
      mapCtx.font = 'bold 11px system-ui';
      for (const site of sites) {
        mapCtx.beginPath();
        mapCtx.arc(px(site.center.x), pz(site.center.z), 11, 0, Math.PI * 2);
        mapCtx.strokeStyle = '#ff7a29';
        mapCtx.stroke();
        mapCtx.fillText(site.id, px(site.center.x) - 3.5, pz(site.center.z) + 4);
      }
      if (chargePos) {
        mapCtx.fillStyle = '#ffd166';
        mapCtx.fillRect(px(chargePos.x) - 2.5, pz(chargePos.z) - 2.5, 5, 5);
      }
      const dot = (x, z, colour, r = 3) => {
        mapCtx.fillStyle = colour;
        mapCtx.beginPath();
        mapCtx.arc(px(x), pz(z), r, 0, Math.PI * 2);
        mapCtx.fill();
      };
      for (const a of allies) dot(a.x, a.z, '#2ec4b6', 2.6);
      for (const e of enemies) dot(e.x, e.z, '#ff7a29', 2.6);
      // The player is a heading wedge at the centre of their own attention.
      mapCtx.save();
      mapCtx.translate(px(player.x), pz(player.z));
      mapCtx.rotate(-player.yaw); // canvas up rotated by -yaw points along (-sin yaw, -cos yaw)
      mapCtx.fillStyle = '#ece7db';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -5.5);
      mapCtx.lineTo(3.6, 4);
      mapCtx.lineTo(-3.6, 4);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
