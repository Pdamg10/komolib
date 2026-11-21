#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();

const SCAN_TARGETS = [
  'AGENTS.md',
  'context',
  'workflow',
  'docs/standards',
  '.ai-adapters',
];

const KNOWN_PREFIXES = [
  'AGENTS.md',
  'context/',
  'workflow/',
  'docs/',
  'scripts/',
  '.ai-adapters/',
  '.cursor/',
  '.github/',
  'src/',
  'server/',
  'android/',
  'public/',
  'netlify.toml',
  'vite.config.ts',
  'capacitor.config.ts',
  'package.json',
];

function collectMarkdownFiles(entryPath, out = []) {
  const full = path.resolve(ROOT_DIR, entryPath);
  if (!fs.existsSync(full)) return out;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (full.endsWith('.md')) out.push(full);
    return out;
  }
  for (const item of fs.readdirSync(full, { withFileTypes: true })) {
    const child = path.join(full, item.name);
    if (item.isDirectory()) {
      collectMarkdownFiles(child, out);
    } else if (item.isFile() && item.name.endsWith('.md')) {
      out.push(child);
    }
  }
  return out;
}

function isPlaceholderPath(candidate) {
  return (
    candidate.includes('{') ||
    candidate.includes('}') ||
    candidate.includes('<') ||
    candidate.includes('>') ||
    candidate.includes('*') ||
    candidate.includes('YYYY') ||
    candidate.includes('example') ||
    candidate.includes('...') ||
    /(^|\/)\.env(\.|$)/.test(candidate) ||
    candidate.startsWith('server/storage')
  );
}

function extractCandidates(content, filePath) {
  const candidates = [];
  const lines = content.split(/\r?\n/);
  let inCodeFence = false;

  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

    // 1. Inline backtick paths: `path/to/file.ext`
    const backtickRe = /`([^`\s]+)`/g;
    let m;
    while ((m = backtickRe.exec(line)) !== null) {
      const raw = m[1].replace(/[.,;:)]+$/, '');
      if (
        KNOWN_PREFIXES.some((p) => raw === p || raw.startsWith(p)) &&
        !isPlaceholderPath(raw)
      ) {
        candidates.push({ ref: raw, line: idx + 1, relativeToFile: false });
      }
    }

    // 2. Markdown table cells referencing lessons/... or reports/...
    const relRe = /\b((?:lessons|reports)\/[a-zA-Z0-9._/-]+\.md)\b/g;
    while ((m = relRe.exec(line)) !== null) {
      const raw = m[1];
      if (!isPlaceholderPath(raw)) {
        candidates.push({ ref: raw, line: idx + 1, relativeToFile: true });
      }
    }

    // 3. Markdown links [text](relative/path)
    const linkRe = /\[[^\]]+\]\(([^)\s]+)\)/g;
    while ((m = linkRe.exec(line)) !== null) {
      const raw = m[1].split('#')[0];
      if (
        raw &&
        !/^(https?:|mailto:|file:|#)/i.test(raw) &&
        !isPlaceholderPath(raw)
      ) {
        candidates.push({ ref: raw, line: idx + 1, relativeToFile: true });
      }
    }
  });

  // Deduplicate per file + line + ref
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${filePath}:${c.line}:${c.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveRef(ref, sourceFile, relativeToFile) {
  const cleaned = ref.replace(/\/+$/, '');
  const rootCandidate = path.resolve(ROOT_DIR, cleaned);
  if (fs.existsSync(rootCandidate)) return { ok: true, resolved: rootCandidate };

  if (relativeToFile) {
    const localCandidate = path.resolve(path.dirname(sourceFile), cleaned);
    if (fs.existsSync(localCandidate)) return { ok: true, resolved: localCandidate };
  }

  return { ok: false, resolved: rootCandidate };
}

function validateRefs({ fix }) {
  const files = [];
  for (const target of SCAN_TARGETS) {
    collectMarkdownFiles(target, files);
  }

  const broken = [];
  let checkedCount = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const refs = extractCandidates(content, filePath);
    for (const item of refs) {
      checkedCount += 1;
      const result = resolveRef(item.ref, filePath, item.relativeToFile);
      if (!result.ok) {
        broken.push({
          file: path.relative(ROOT_DIR, filePath),
          line: item.line,
          ref: item.ref,
        });
      }
    }
  }

  if (broken.length > 0) {
    process.stderr.write(
      `[FAIL] AIEF ref validation found ${broken.length} broken reference(s) across ${files.length} files (${checkedCount} refs checked):\n`
    );
    for (const b of broken) {
      process.stderr.write(`  - ${b.file}:${b.line} -> ${b.ref}\n`);
    }
    if (fix) {
      process.stderr.write(
        'Note: no automatic rewrite applied for missing targets; create the target file or update the reference.\n'
      );
    }
    process.exit(1);
  }

  process.stdout.write(
    `[PASS] AIEF refs valid (${checkedCount} references checked across ${files.length} markdown files).\n`
  );
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const sub = args[1];

  if (cmd === 'validate' && sub === 'refs') {
    validateRefs({ fix: args.includes('--fix') });
    return;
  }

  if (cmd === 'help' || cmd === '-h' || cmd === '--help' || !cmd) {
    process.stdout.write(
      [
        'KomoLib AIEF helper (scripts/aief.mjs)',
        '',
        'Usage:',
        '  node scripts/aief.mjs validate refs [--fix]',
      ].join('\n') + '\n'
    );
    return;
  }

  process.stderr.write(`Unsupported AIEF command: ${args.join(' ')}\n`);
  process.exit(1);
}

main();
