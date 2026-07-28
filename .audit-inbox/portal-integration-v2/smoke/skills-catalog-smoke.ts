import { buildSkillsCatalog, buildSkillDetail, packageSkill } from '../lib/http/skills-catalog.ts';

const cat = await buildSkillsCatalog();
console.log('count:', cat.count, 'error:', cat.error ?? 'none');
console.log('sample[0]:', JSON.stringify(cat.skills[0], null, 2));
const warned = cat.skills.filter(s => s.validation.length);
console.log('skills with warnings:', warned.length, '/', cat.count);
for (const s of warned.slice(0, 8)) console.log(`  ⚠ ${s.name}: ${s.validation.join(' | ')}`);

const detail = await buildSkillDetail('automation');
console.log('detail(automation):', JSON.stringify({ ...detail, bodyMarkdown: `[${detail?.bodyMarkdown.length ?? 0} chars]` }, null, 2).slice(0, 1200));
console.log('detail(bad name):', await buildSkillDetail('../etc'));
console.log('detail(missing):', await buildSkillDetail('no-such-skill'));

const pkg = await packageSkill('automation', new URL('./tmp-packages', import.meta.url).pathname);
console.log('package(automation):', JSON.stringify(pkg));
