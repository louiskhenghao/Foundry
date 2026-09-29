/**
 * Syntax highlighting for the file preview, loaded on first use so the app's first load stays light. Only the
 * languages a Foundry goal usually touches are registered; anything else is shown as plain text.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGS = { bash, c, cpp, csharp, css, dockerfile, go, graphql, ini, java, javascript, json, kotlin, less, makefile, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);

const BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonl: 'json', css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', astro: 'xml',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', sh: 'bash', bash: 'bash', zsh: 'bash', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
};
const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile' };

export function languageOf(fileName: string): string | null {
  const base = fileName.split('/').pop()!.toLowerCase();
  if (BY_NAME[base]) return BY_NAME[base]!;
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return BY_EXT[ext] ?? null;
}

/**
 * The text as highlighted HTML, one string per line. highlight.js spans can run across lines (a block comment, a
 * template string), so each line closes the spans still open at its end and the next line reopens them.
 */
export function highlightLines(text: string, lang: string | null): string[] | null {
  if (!lang || text.length > 500_000) return null;
  const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const token of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!token) continue;
    if (token === '\n') {
      lines.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (token.startsWith('<span')) open.push(token);
      else if (token === '</span>') open.pop();
      line += token;
    }
  }
  lines.push(line);
  return lines;
}
