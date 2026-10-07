// Publish only an aggregate badge, never private repository names or commit data.
const fs = require('fs');
const path = require('path');
const {execFile} = require('child_process');
const root = path.resolve(__dirname,'..');
const owner = 'JohanssonJacob';

function api(endpoint, {paginated=false, selector, allowEmpty=false} = {}) {
  return new Promise((resolve,reject) => {
    const args = ['api', ...(paginated ? ['--paginate',...(!selector ? ['--slurp'] : [])] : []), endpoint, ...(selector ? ['--jq',selector] : [])];
    execFile('gh',args,{maxBuffer:30*1024*1024,windowsHide:true},(err,stdout,stderr) => {
      if (err) {
        if (allowEmpty && /\(HTTP 409\)/.test(stderr)) return resolve([]);
        const status = stderr.match(/\(HTTP \d+\)/)?.[0] || '(CLI request failed)';
        return reject(new Error(`A repository history request failed ${status}. Check read-only Contents access; the existing badge was preserved.`));
      }
      try {
        if (selector) {
          const hashes = stdout.trim() ? stdout.trim().split(/\r?\n/) : [];
          if (hashes.some(hash=>!/^[a-f0-9]{40}$/.test(hash))) throw new Error('Invalid hash');
          resolve(hashes);
        } else resolve(JSON.parse(stdout));
      } catch { reject(new Error('Invalid GitHub API response; the existing badge was preserved.')); }
    });
  });
}

function badge(count, repoCount, privateRepoCount, branches, date) {
  const labelWidth = 164;
  const valueWidth = String(count).length*7+14;
  const width = labelWidth+valueWidth;
  const label = 'Commits (public + private)';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-labelledby="title desc"><title id="title">${label}: ${count}</title><desc id="desc">Unique commits authored by ${owner}, with no date filter, across ${branches} current branches of ${repoCount} accessible repositories, including ${privateRepoCount} private repositories. Shared commit hashes count once. Updated ${date}.</desc><defs><clipPath id="clip"><rect width="${width}" height="20" rx="3"/></clipPath><linearGradient id="shine" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient></defs><g clip-path="url(#clip)"><rect width="${labelWidth}" height="20" fill="#20252e"/><rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#79c0ff"/><rect width="${width}" height="20" fill="url(#shine)"/></g><g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${labelWidth/2}" y="14" fill="#fff">${label}</text><text x="${labelWidth+valueWidth/2}" y="14" fill="#111318">${count}</text></g></svg>`;
}

async function update() {
  const viewer = await api('user');
  if (viewer.login.toLowerCase()!==owner.toLowerCase()) throw new Error('Sign in as JohanssonJacob before generating private commit statistics.');
  const repos = (await api('user/repos?affiliation=owner,collaborator,organization_member&per_page=100',{paginated:true})).flat();
  if (!repos.some(repo=>repo.private)) throw new Error('No private repositories are accessible. The existing public-plus-private badge was preserved.');
  const commits = new Set();
  const privateCommits = new Set();
  let branchCount = 0;
  let completed = 0;
  let next = 0;
  await Promise.all(Array.from({length:Math.min(3,repos.length)},async () => {
    while(next<repos.length) {
      const repo = repos[next++];
      const heads = await api(`repos/${repo.full_name}/branches?per_page=100`,{paginated:true,selector:'.[] | .commit.sha',allowEmpty:true});
      branchCount += heads.length;
      // Identical branch tips have identical histories; count their history once.
      for (const head of new Set(heads)) {
        const ids = await api(`repos/${repo.full_name}/commits?author=${owner}&sha=${head}&per_page=100`,{paginated:true,selector:'.[] | .sha'});
        for (const id of ids) {
          commits.add(id);
          if (repo.private) privateCommits.add(id);
        }
      }
      completed++;
      if (completed%10===0) console.log(`Checked ${completed} of ${repos.length} repositories.`);
    }
  }));
  const privateRepos = repos.filter(r=>r.private).length;
  const date = new Date().toISOString().slice(0,10);
  fs.writeFileSync(path.join(root,'assets','badge-commits.svg'),badge(commits.size,repos.length,privateRepos,branchCount,date));
  console.log(JSON.stringify({uniqueAuthoredCommits:commits.size,repositories:repos.length,privateRepositories:privateRepos,currentBranches:branchCount,commitsPresentInPrivateRepositories:privateCommits.size}));
}

if (require.main === module) update().catch(err=>{ console.error(err.message); process.exit(1); });
