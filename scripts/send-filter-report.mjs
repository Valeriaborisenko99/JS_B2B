import fs from 'node:fs';
import https from 'node:https';

const REPORT_FILE = process.env.REPORT_FILE || 'playwright-report.json';
const WEBHOOK = process.env.MATTERMOST_WEBHOOK;

if (!WEBHOOK) {
  console.error('MATTERMOST_WEBHOOK не задан');
  process.exit(1);
}

if (!fs.existsSync(REPORT_FILE)) {
  console.error(`Отчёт не найден: ${REPORT_FILE}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));

function collectFilterSections(suites, acc = []) {
  for (const suite of suites) {
    const hasTests = suite.specs && suite.specs.length > 0;
    if (hasTests) {
      acc.push(suite);
    }
    if (suite.suites) {
      collectFilterSections(suite.suites, acc);
    }
  }
  return acc;
}

const sections = collectFilterSections(report.suites || []);

const dateStr = new Date(report.stats?.startTime || Date.now()).toLocaleDateString('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function getStdoutLines(spec) {
  const result = spec.tests?.[0]?.results?.[0];
  if (!result?.stdout) return [];
  return result.stdout
    .map((chunk) => chunk.text || '')
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('✅'));
}

const lines = [];
lines.push(`### Автотест "Туры с перелетом" — фильтры`);
lines.push(`Дата: ${dateStr}`);
lines.push('');

let passedAll = 0;
let failedAll = 0;
let skippedAll = 0;

for (const section of sections) {
  lines.push(`${section.title}`);
  for (const spec of section.specs) {
    const status = spec.tests?.[0]?.status;
    if (status === 'skipped' || status === 'pending') {
      skippedAll++;
      continue;
    }
    const stepLines = getStdoutLines(spec);
    if (spec.ok) {
      passedAll++;
      if (stepLines.length > 0) {
        for (const step of stepLines) {
          lines.push(step);
        }
      } else {
        lines.push(`✅ ${spec.title}`);
      }
    } else {
      failedAll++;
      lines.push(`❌ ${spec.title}`);
    }
  }
  lines.push('');
}

lines.push(`**Итог: ${passedAll} passed, ${failedAll} failed${skippedAll > 0 ? `, ${skippedAll} skipped` : ''}**`);

const message = lines.join('\n');

if (process.env.DEBUG_PRINT) console.log(message);

const data = JSON.stringify({ text: message });
const url = new URL(WEBHOOK);

const req = https.request(
  {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Отчёт отправлен в Mattermost');
      } else {
        console.error('Ошибка Mattermost:', res.statusCode, body);
        process.exit(1);
      }
    });
  }
);

req.on('error', (err) => {
  console.error('Ошибка отправки в Mattermost:', err.message);
  process.exit(1);
});

req.write(data);
req.end();
