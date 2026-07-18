import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const textExtensions = new Set([
  '.css', '.cjs', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.svg',
  '.sql', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

const repositoryFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'buffer' },
)
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((file) => textExtensions.has(file.slice(file.lastIndexOf('.')).toLowerCase()));

const decoder = new TextDecoder('utf-8', { fatal: true });
const failures = [];

for (const file of repositoryFiles) {
  const bytes = readFileSync(file);
  const hasUtf16Bom = (bytes[0] === 0xff && bytes[1] === 0xfe)
    || (bytes[0] === 0xfe && bytes[1] === 0xff);

  try {
    const content = decoder.decode(bytes);
    if (hasUtf16Bom || content.includes('\u0000') || content.includes('\uFFFD')) {
      failures.push(file);
    }
  } catch {
    failures.push(file);
  }
}

if (failures.length > 0) {
  console.error('These files must be valid UTF-8 text without UTF-16 markers or replacement characters:');
  failures.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log(`Encoding check passed for ${repositoryFiles.length} text files.`);
