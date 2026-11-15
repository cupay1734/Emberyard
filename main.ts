// EMBERYARD — handover program for the make.fun threejs-fps-02 bounty.
//
// What this does, in order:
//   1. works out where the finished entry has to land (the grader mounts it
//      at /output; a local run points MAKEFUN_OUTPUT_DIR somewhere instead);
//   2. copies the playable game (game/, static ES modules, no build step)
//      and the maker's screenshots (screenshots/) next to that destination;
//   3. asks the vendored make.fun library to summarise the copied tree into
//      dossier.json — the document the judge actually reads — and writes it
//      beside the copies, so the scorer can rebuild it and compare bytes.
//
// Node 22, standard library only, erasable TypeScript: `node main.ts` runs
// it as-is. To play the game itself, serve the repo with `node serve.ts`.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Caps fixed by the bounty's gate: 160 KiB of source text in the dossier,
// at most 4 screenshots of at most 256 KiB each, and game/ capped at 993
// entries / 48 MiB so the whole output stays inside its 1,000-entry room.
const GATE_CAPS = {
  text_max_bytes: 163_840,
  screenshots: { max: 4, max_bytes: 262_144 },
  game_max_files: 993,
  game_max_bytes: 50_331_648,
};

function copyTree(name: string): void {
  const from = join(repoDir, name);
  if (existsSync(from)) {
    cpSync(from, join(outputDir, name), { recursive: true });
  }
}

mkdirSync(outputDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outputDir, GATE_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);
console.log(`EMBERYARD handed in: dossier.json (${dossier.length} bytes) written to ${outputDir}`);
