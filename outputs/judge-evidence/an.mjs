import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const p = JSON.parse(readFileSync(f, 'utf8'));
  const a = p.analysis;
  console.log('='.repeat(72));
  console.log(f, '| repo:', p.report.repo.full);
  console.log('available:', a.available, '| reason:', a.reason ?? '-');
  console.log('modelStatus:', JSON.stringify(a.modelStatus, null, 1));
  console.log('durationMs:', JSON.stringify(a.durationMs ?? a.timings ?? null));
  console.log('evidenceAudit:', JSON.stringify(a.evidenceAudit, null, 1));
  if (a.narrative) {
    console.log('--- narrative.headline:', a.narrative.headline);
    console.log('--- narrative.narrative:', a.narrative.narrative);
    console.log('--- turningPoints:', JSON.stringify(a.narrative.turningPoints, null, 1));
  }
  if (a.hypotheses) console.log('--- hypotheses:', JSON.stringify(a.hypotheses, null, 1));
  if (a.appraisal) console.log('--- appraisal:', JSON.stringify(a.appraisal, null, 1));
  console.log('analysis keys:', Object.keys(a).join(','));
}
