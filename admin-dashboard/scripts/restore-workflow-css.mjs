import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upload =
  'C:/Users/healt/.cursor/projects/c-MDP-pharmacyFlyerTracker/uploads/c__MDP_pharmacyFlyerTracker_pharmacy-flyer-tracker-v2_admin-dashboard_app_workflow_page-L1-L1992-0.tsx';

function normalizeCss(css) {
  css = css.replace(/^`\s*\n?/, '').replace(/\n?\s*`$/m, '');
  css = css.replace(/:global\(([^)]+)\)/g, '$1');
  css = css.replace(/\n`\s*\n\s*`\s*\n/g, '\n\n');
  css = css.replace(/^`\s*$/gm, '');
  const lines = css.split('\n');
  const indent = lines
    .filter((l) => l.trim())
    .reduce((min, l) => {
      const m = l.match(/^(\s+)/);
      return m ? Math.min(min, m[1].length) : min;
    }, Infinity);
  if (Number.isFinite(indent) && indent > 0) {
    css = lines.map((l) => (l.startsWith(' '.repeat(indent)) ? l.slice(indent) : l)).join('\n');
  }
  return css.trim() + '\n';
}

const src = fs.readFileSync(upload, 'utf8');
const blocks = [...src.matchAll(/<style jsx>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);
const css = normalizeCss(blocks.join('\n\n'));
fs.writeFileSync(path.join(root, 'app/workflow/workflow.css'), css);
console.log(`workflow.css restored (${blocks.length} blocks, ${css.length} chars)`);
