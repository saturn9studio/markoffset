const fs = require('fs');
const https = require('https');
const path = require('path');

const COMMONMARK_SPEC_URL = process.env.COMMONMARK_SPEC_URL ?? 'https://spec.commonmark.org/0.31.2/spec.json';
const GFM_SPEC_URL = process.env.GFM_SPEC_URL ?? 'https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt';
const GFM_EXTENSIONS_URL = process.env.GFM_EXTENSIONS_URL ?? 'https://raw.githubusercontent.com/github/cmark-gfm/master/test/extensions.txt';

const specDir = path.join(__dirname, '..', 'test', 'spec');

async function main() {
  const [commonmarkSpec, gfmSpec, gfmExtensions] = await Promise.all([
    fetchText(COMMONMARK_SPEC_URL),
    fetchText(GFM_SPEC_URL),
    fetchText(GFM_EXTENSIONS_URL),
  ]);

  writeJson('spec.json', JSON.parse(commonmarkSpec));
  writeJson('gfm.json', parseGfmSpec(gfmSpec));
  writeJson('gfm-extensions.json', parseGfmSpec(gfmExtensions));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: HTTP ${response.statusCode}`));
          response.resume();
          return;
        }

        response.setEncoding('utf8');
        let body = '';
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(specDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function parseGfmSpec(src) {
  const lines = src.replace(/\r\n/g, '\n').split(/(?<=\n)/);
  const tests = [];
  let section = '';
  let example = 1;
  let state = 'text';
  let markdown = [];
  let html = [];
  let extensions = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith(`${'`'.repeat(32)} example`)) {
      state = 'markdown';
      markdown = [];
      html = [];
      extensions = trimmed.slice(32 + ' example'.length).split(/\s+/).filter(Boolean);
      continue;
    }

    if (trimmed === '`'.repeat(32)) {
      state = 'text';

      if (!extensions.includes('disabled')) {
        tests.push({
          markdown: markdown.join('').replace(/→/g, '\t'),
          html: html.join('').replace(/→/g, '\t'),
          example,
          section,
          extensions,
        });
      }

      example += 1;
      continue;
    }

    if (trimmed === '.' && state === 'markdown') {
      state = 'html';
      continue;
    }

    if (state === 'markdown') {
      markdown.push(line);
      continue;
    }

    if (state === 'html') {
      html.push(line);
      continue;
    }

    const heading = trimmed.match(/^#+ (.+)$/);
    if (heading) section = heading[1].trim();
  }

  return tests;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
