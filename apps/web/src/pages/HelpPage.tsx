import { HelpCircle } from 'lucide-react';
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { headingAnchor } from '@foundry/core/browser';
import { api } from '../api.ts';
import { Empty, cn } from '../ui.tsx';

type Lang = 'en' | 'zh';
const LANG_KEY = 'foundry.guide.lang';
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {}
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const textOf = (n: ReactNode): string => Children.toArray(n).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : '')).join('');

/** The user guide (docs/guide), bundled with this install, in English or 中文. */
export function HelpPage() {
  const { slug = 'index' } = useParams();
  const { hash } = useLocation();
  const nav = useNavigate();
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [pages, setPages] = useState<{ slug: string; title: string; zh: string | null }[] | null>(null);
  const [page, setPage] = useState<{ markdown: string; lang: Lang } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
  };
  useEffect(() => {
    void api.guide().then((r) => setPages(r.pages)).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    setPage(null);
    setErr(null);
    void api.guidePage(slug, lang).then(setPage).catch((e) => setErr(e.body?.error ?? e.message));
  }, [slug, lang]);
  // after the page renders, go to the heading the link asked for
  useEffect(() => {
    if (!page) return;
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    const el = id ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [page, hash]);

  const heading =
    (Tag: 'h1' | 'h2' | 'h3') =>
    ({ children }: { children?: ReactNode }) => (
      <Tag id={headingAnchor(textOf(children))} className="scroll-mt-16">
        {children}
      </Tag>
    );
  const components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      const file = (src ?? '').split('/').pop() ?? '';
      return <img src={`/api/guide/images/${encodeURIComponent(file)}`} alt={alt ?? ''} loading="lazy" className="rounded border border-zinc-800 my-3 max-w-full" />;
    },
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const h = href ?? '';
      if (/^https?:|^mailto:/.test(h)) return <a href={h} target="_blank" rel="noreferrer">{children}</a>;
      if (h.startsWith('#')) return <a href={h}>{children}</a>;
      // another guide page: ./approving-the-brief.md#milestones (or its .zh twin) → /help/approving-the-brief#milestones
      const m = h.match(/^(?:\.\/)?([a-z0-9-]+)(?:\.zh)?\.md(#.*)?$/);
      if (m) return <Link to={`/help/${m[1]}${m[2] ?? ''}`}>{children}</Link>;
      // operator and contributor docs are not bundled in the app: name them instead of linking nowhere
      return (
        <span title={`${h} — in the Foundry repository`} className="underline decoration-dotted">
          {children}
        </span>
      );
    },
  };
  // the page's own language switcher line ("> English · [中文](…)") is replaced by the toggle above
  const markdown = page?.markdown.replace(/^>\s*(English|\[English\]).*\n/m, '') ?? '';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 flex gap-6">
      <aside className="hidden md:block w-56 shrink-0">
        <div className="sticky top-16 space-y-1 text-sm">
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle size={15} className="text-zinc-400" />
            <span className="text-zinc-200 font-medium">Guide</span>
            <div className="ml-auto flex rounded border border-zinc-700 overflow-hidden text-[11px]">
              {(['en', 'zh'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} className={cn('px-2 py-0.5', lang === l ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')}>
                  {l === 'en' ? 'EN' : '中文'}
                </button>
              ))}
            </div>
          </div>
          {(pages ?? []).map((p, i) => (
            <Link key={p.slug} to={`/help/${p.slug}`} className={cn('block rounded px-2 py-1', p.slug === slug ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}>
              <span className="text-zinc-600 mr-1.5">{i + 1}</span>
              {lang === 'zh' && p.zh ? p.zh : p.title}
            </Link>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="md:hidden flex items-center gap-2 mb-3">
          <select className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm" value={slug} onChange={(e) => nav(`/help/${e.target.value}`)}>
            {(pages ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {lang === 'zh' && p.zh ? p.zh : p.title}
              </option>
            ))}
          </select>
          <button type="button" className="text-xs border border-zinc-700 rounded px-2 py-1" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        </div>
        {err ? <Empty>{err}</Empty> : !page ? <div className="text-zinc-500 text-sm">…</div> : (
          <>
            {lang === 'zh' && page.lang === 'en' && <div className="text-xs text-amber-300 mb-2">这一页还没有中文版，下面是英文原文。</div>}
            <article className="md guide text-[15px] leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components as never}>
                {markdown}
              </ReactMarkdown>
            </article>
          </>
        )}
      </main>
    </div>
  );
}

/** A small "?" that opens the guide at the page and heading that explain the screen it sits on. */
export function HelpLink({ to, label, className }: { to: string; label?: string; className?: string }) {
  // a new tab: following it must never throw away a half-filled form or an unsaved Brief edit
  return (
    <a href={`/help/${to}`} target="_blank" rel="noreferrer" title={label ?? 'Open the guide for this (new tab)'} className={cn('inline-flex items-center text-zinc-500 hover:text-zinc-200 align-middle font-normal', className)} aria-label={label ?? 'help'}>
      <HelpCircle size={14} />
    </a>
  );
}
