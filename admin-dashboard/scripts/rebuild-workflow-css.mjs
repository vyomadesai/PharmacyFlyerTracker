import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = path.join(root, '.next/server/chunks/ssr/app_workflow_page_tsx_1m6j8sa._.js.map');

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
  return css.trim();
}

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const src = map.sourcesContent[0];
const blocks = [...src.matchAll(/<style jsx>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);
let css = normalizeCss(blocks.join('\n\n'));

const planStyles = `
/* Plan card layout */
.wf-plan-card { overflow: visible; }
.wf-plan-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #fafbfc 0%, #fff 100%);
}
.wf-plan-step {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  box-shadow: 0 6px 14px -8px rgba(37, 99, 235, 0.8);
}
.wf-plan-intro { min-width: 0; }
.wf-section {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  overflow: visible;
}
.wf-section:last-child { border-bottom: none; }
.wf-section-label {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
}
.wf-campaign-fields { display: grid; gap: 8px; min-width: 0; }
.wf-campaign-row { overflow: visible; position: relative; z-index: 1; }
.wf-campaign-row:has(.wf-ms.is-open) { z-index: 100; }
.wf-custom-hours { display: grid; gap: 6px; }
.wf-build-wrap { display: grid; gap: 8px; }
.wf-ms.is-open { z-index: 100; }
.wf-ms-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(15, 23, 42, 0.18);
}
.wf-ms-footer button.wf-ms-clear,
.wf-ms-footer button.wf-ms-done {
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  font: inherit;
}
.wf-ms-footer button.wf-ms-clear {
  color: #64748b;
  font-weight: 700;
  font-size: 12px;
  padding: 5px 8px;
}
.wf-ms-footer button.wf-ms-done {
  background: #2563eb !important;
  color: #fff !important;
  border-radius: 7px !important;
  padding: 5px 14px !important;
  font-weight: 700 !important;
  font-size: 12px !important;
}
.wf-ms-footer button.wf-ms-done:hover { filter: brightness(1.05); }
`;

css = css
  .replace(
    /\.wf-card \{ background:#fff; border:1px solid #e6ecf6; border-radius:12px; padding:10px 12px; display:grid; gap:8px; box-shadow:0 8px 22px -22px rgba\(15,23,42,.5\); \}/,
    '.wf-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:0; display:grid; gap:0; box-shadow:0 1px 3px rgba(15,23,42,.06); width:100%; }'
  )
  .replace(
    /\.wf-card-title \{ margin:0; font-size:17px; font-weight:800; letter-spacing:-.01em; color:#0f172a; \}/,
    '.wf-card-title { margin:0; font-size:18px; font-weight:700; letter-spacing:-.02em; color:#0f172a; }'
  )
  .replace(
    /\.wf-card-sub   \{ margin:0; font-size:12px; color:#64748b; line-height:1.35; \}/,
    '.wf-card-sub { margin:6px 0 0; font-size:13px; color:#64748b; line-height:1.45; max-width:720px; }'
  );

css = `${css}\n${planStyles.trim()}\n`;
fs.writeFileSync(path.join(root, 'app/workflow/workflow.css'), css);
console.log(`workflow.css rebuilt (${css.length} chars)`);
