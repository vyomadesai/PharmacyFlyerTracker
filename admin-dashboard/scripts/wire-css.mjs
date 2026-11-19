import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');

function wire(pagePath, cssFile) {
  const full = path.join(appDir, pagePath);
  let src = fs.readFileSync(full, 'utf8');
  const cssImport = `import './${path.basename(cssFile)}';`;

  if (!src.includes(cssImport)) {
    const m = src.match(/^(import[^\n]+\n(?:import[^\n]+\n)*)/);
    src = m ? src.replace(m[0], `${m[0]}${cssImport}\n`) : `${cssImport}\n${src}`;
  }

  src = src.replace(/\n\s*<style jsx global>\{`[\s\S]*?`\}<\/style>/g, '');
  src = src.replace(/\n\s*<style jsx>\{`[\s\S]*?`\}<\/style>/g, '');

  fs.writeFileSync(full, src);
  const left = (src.match(/<style jsx/g) || []).length;
  console.log(`Wired ${pagePath} (${left} styled-jsx blocks remaining)`);
}

wire('map/page.tsx', 'map/map.css');
wire('npi-registery/page.tsx', 'npi-registery/npi-registery.css');
