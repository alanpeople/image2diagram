import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'styles.css');
const jsPath = path.join(root, 'app.js');
const outputDir = path.join(root, 'dist');
const outputPath = path.join(outputDir, '公众号AI写作-单文件版.html');

let html = fs.readFileSync(indexPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

html = html
  .replace(/\s*<link rel="preconnect"[^>]+\/>/g, '')
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]+\/>/g, '')
  .replace(/\s*<link rel="stylesheet" href="\.\/styles\.css"\s*\/>/, () => `\n    <style>\n${css}\n    </style>`)
  .replace(/\s*<script type="module" src="\.\/app\.js"><\/script>/, () => `\n    <script>\n${js}\n    </script>`);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log(`单文件已生成：${path.relative(root, outputPath)}`);
