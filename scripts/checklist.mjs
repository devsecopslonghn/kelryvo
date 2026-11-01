import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const checklist = new URL('../CHECKLIST.md', import.meta.url);

export function parseChecklist(source) {
  const entries = [];
  const ids = new Set();
  let current;
  for (const line of source.split('\n')) {
    if (/^- \[/.test(line)) {
      const match = /^- \[([ x])\] \*\*([A-Z][A-Z0-9]*) — (.+?):\*\*\s*(.*)$/.exec(line);
      if (!match || ids.has(match[2])) throw new Error('Invalid or duplicate checklist entry');
      ids.add(match[2]);
      current = { id: match[2], completed: match[1] === 'x', title: match[3], detail: match[4] };
      entries.push(current);
    } else if (current && /^  \S/.test(line)) {
      current.detail += ` ${line.trim()}`;
    } else {
      current = undefined;
    }
  }
  if (!entries.length || entries.some(entry => !entry.detail.trim())) throw new Error('Checklist entries must describe their outcome');
  return entries;
}

export async function checklistReport(command) {
  if (!['validate', 'status', 'next'].includes(command)) throw new Error('Usage: checklist.mjs validate|status|next');
  const entries = parseChecklist(await readFile(checklist, 'utf8'));
  if (command === 'validate') return { checklist: 'CHECKLIST.md', valid: true };
  const pending = entries.filter(entry => !entry.completed);
  const authority = 'Checklist status does not authorize Oracle access, execution or deployment.';
  return command === 'next'
    ? { checklist: 'CHECKLIST.md', next: pending[0] ?? null, authority }
    : { checklist: 'CHECKLIST.md', completed: entries.filter(entry => entry.completed), pending, authority };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: checklist.mjs validate|status|next');
    console.log(JSON.stringify(await checklistReport(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
