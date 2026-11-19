import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function normalizeCss(css) {
  css = css.replace(/^`\s*\n?/, '').replace(/\n?\s*`$/m, '');
  css = css.replace(/:global\(([^)]+)\)/g, '$1');
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

function extract(tsxPath, cssPath, scopeRoot, global = false) {
  const src = fs.readFileSync(path.join(root, tsxPath), 'utf8');
  const re = global
    ? /<style jsx global>\{`([\s\S]*?)`\}<\/style>/g
    : /<style jsx>\{`([\s\S]*?)`\}<\/style>/g;
  const blocks = [...src.matchAll(re)].map((m) => m[1]);
  if (!blocks.length) {
    console.warn(`Skip ${cssPath}: no styled-jsx blocks in ${tsxPath}`);
    return;
  }
  let css = normalizeCss(blocks.join('\n\n'));
  if (scopeRoot) {
    css = css.replace(/^(\s*)(button|input, select|input:focus|select:focus|select:disabled)/gm, `$1${scopeRoot} $2`);
  }
  fs.writeFileSync(path.join(root, cssPath), css.trim() + '\n');
  console.log(`Wrote ${cssPath} (${blocks.length} blocks, ${css.length} chars)`);
}

extract('app/workflow/page.tsx', 'app/workflow/workflow.css', '.wf-root');
extract('app/available-routes/page.tsx', 'app/available-routes/available-routes.css', null);
extract('app/map/page.tsx', 'app/map/map.css', null, true);
extract('app/npi-registery/page.tsx', 'app/npi-registery/npi-registery.css', null, true);
