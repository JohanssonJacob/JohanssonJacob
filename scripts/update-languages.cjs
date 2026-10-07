// Reads language byte totals through your existing GitHub CLI sign-in.
// Only aggregate percentages are written to public assets.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const root = path.resolve(__dirname,'..');
const owner = 'JohanssonJacob';
const colors = {'TypeScript':'#3178c6','JavaScript':'#f1e05a','Java':'#b07219','HTML':'#e34c26','CSS':'#9274ce','SCSS':'#c6538c','Shell':'#89e051','Python':'#3572a5','Kotlin':'#a97bff','Others':'#7e8594'};
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

function api(endpoint, paginated=false) {
  return new Promise((resolve,reject) => {
    const args = ['api', ...(paginated ? ['--paginate','--slurp'] : []), endpoint];
    execFile('gh',args,{maxBuffer:20*1024*1024,windowsHide:true},(err,stdout) => {
      if (err) return reject(new Error('GitHub metadata request failed. Check sign-in and repository access.'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid GitHub API response')); }
    });
  });
}

function svg(entries, totalBytes, repoCount, privateCount, dark, date) {
  const bg = dark ? '#171b23' : '#eeeee8';
  const ink = dark ? '#f4f3ed' : '#171920';
  const muted = dark ? '#a8adb9' : '#525a69';
  const border = dark ? '#353943' : '#d2d5ca';
  const rows = Math.ceil(entries.length/2);
  const height = 160 + rows*36;
  let x = 32;
  const segments = entries.map(([language,bytes]) => {
    const width = 536 * bytes / totalBytes;
    const piece = `<rect x="${x.toFixed(3)}" y="81" width="${width.toFixed(3)}" height="12" fill="${colors[language] || '#7e8594'}"/>`;
    x += width;
    return piece;
  }).join('');
  const legend = entries.map(([language,bytes],i) => {
    const lx = 32 + (i%2)*280;
    const ly = 128 + Math.floor(i/2)*36;
    return `<circle cx="${lx+5}" cy="${ly-6}" r="5" fill="${colors[language] || '#7e8594'}"/><text x="${lx+20}" y="${ly}" font-family="Segoe UI,Arial,sans-serif" font-size="20" fill="${ink}">${escape(language)} <tspan fill="${muted}">${(100*bytes/totalBytes).toFixed(2)}%</tspan></text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}" viewBox="0 0 600 ${height}" role="img" aria-labelledby="title desc"><title id="title">Most used languages</title><desc id="desc">${escape(entries.map(([l,b])=>`${l}: ${(100*b/totalBytes).toFixed(2)}%`).join(', '))}. Language bytes across ${repoCount} owned repositories, including ${privateCount} private repositories. Updated ${date}.</desc><defs><clipPath id="bar"><rect x="32" y="81" width="536" height="12" rx="6"/></clipPath></defs><rect x=".5" y=".5" width="599" height="${height-1}" rx="14" fill="${bg}" stroke="${border}"/><text x="32" y="47" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="700" fill="${dark ? '#d8f582' : '#496914'}">Most used languages</text><g clip-path="url(#bar)">${segments}</g>${legend}<text x="32" y="${height-23}" font-family="Segoe UI,Arial,sans-serif" font-size="14" fill="${muted}">Public + private · Language bytes · Updated ${date}</text></svg>`;
}

(async () => {
  const viewer = await api('user');
  if (viewer.login.toLowerCase() !== owner.toLowerCase()) throw new Error('Sign in as JohanssonJacob before generating private repository statistics.');
  const repos = (await api('user/repos?affiliation=owner&per_page=100',true)).flat().filter(r=>r.owner.login.toLowerCase()===owner.toLowerCase());
  const totals = {};
  // A small concurrency limit avoids bursts against the GitHub API.
  let next = 0;
  await Promise.all(Array.from({length:Math.min(4,repos.length)},async () => {
    while (next < repos.length) {
      const repo = repos[next++];
      const languages = await api(`repos/${repo.full_name}/languages`);
      for (const [language,bytes] of Object.entries(languages)) totals[language] = (totals[language]||0) + bytes;
    }
  }));
  let entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const totalBytes = entries.reduce((sum,[,bytes])=>sum+bytes,0);
  if (!totalBytes) throw new Error('No language data returned; existing cards were preserved.');
  if (entries.length>8) entries = [...entries.slice(0,7),['Others',entries.slice(7).reduce((sum,[,bytes])=>sum+bytes,0)]];
  const privateCount = repos.filter(r=>r.private).length;
  const date = new Date().toISOString().slice(0,10);
  for (const theme of ['dark','light']) fs.writeFileSync(path.join(root,'assets',`languages-${theme}.svg`),svg(entries,totalBytes,repos.length,privateCount,theme==='dark',date));
  console.log(JSON.stringify({repositories:repos.length,privateRepositories:privateCount,languagePercentages:entries.map(([language,bytes])=>({language,percent:Number((100*bytes/totalBytes).toFixed(2))}))}));
})().catch(err=>{ console.error(err.message); process.exit(1); });
