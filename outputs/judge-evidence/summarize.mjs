import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  console.log('='.repeat(70));
  console.log(f);
  console.log('repo:', r.repo.full, '| lang:', r.repo.language, '| stars:', r.repo.stars);
  console.log('scope:', JSON.stringify(r.scope));
  console.log('cost:', JSON.stringify(r.cost));
  console.log('signalQuality:', JSON.stringify(r.signalQuality, null, 1));
  console.log('risk:', JSON.stringify(r.risk, null, 1));
  console.log('hotspots top8:', JSON.stringify(r.hotspots.slice(0,8)));
  console.log('abandoned:', r.abandoned.length, JSON.stringify(r.abandoned, null, 1));
  console.log('rejected:', (r.abandonedRejected||[]).length, JSON.stringify((r.abandonedRejected||[]).slice(0,6)));
  console.log('globalReverts:', (r.globalReverts||[]).length, JSON.stringify((r.globalReverts||[]).slice(0,6)));
  console.log('thrash:', JSON.stringify((r.thrash||[]).slice(0,6)));
  console.log('otherKeys:', Object.keys(r).join(','));
}
