import { HelpCircle } from 'lucide-react';
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { headingAnchor } from '@foundry/core/browser';
import { api } from '../api.ts';
import { ButtonGroup, Empty, PageHeader, Select, buttonClass, cn, navItemClass } from '../ui.tsx';

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
    void api.guide().then((r) => setPages(r.pages)).catch(() => setPages([]));
  }, []);
  useEffect(() => {
    // switching page or language quickly must not let a slower, older answer replace the newer one
    let current = true;
    setPage(null);
    setErr(null);
    void api
      .guidePage(slug, lang)
      .then((p) => current && setPage(p))
      .catch((e) => current && setErr(e.body?.error ?? e.message));
    return () => {
      current = false;
    };
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
      return <img src={`/api/guide/images/${encodeURIComponent(file)}`} alt={alt ?? ''} loading="lazy" className="rounded border border-line my-3 max-w-full" />;
    },
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const h = href ?? '';
      if (/^https?:|^mailto:/.test(h)) return <a href={h} target="_blank" rel="noreferrer">{children}</a>;
      if (h.startsWith('#')) return <a href={h}>{children}</a>;
      // another guide page: ./approving-the-brief.md#milestones (or its .zh twin) → /help/approving-the-brief#milestones; README is the first page, "index"
      const m = h.match(/^(?:\.\/)?([a-z0-9-]+|README)(?:\.zh)?\.md(#.*)?$/);
      if (m) return <Link to={`/help/${m[1] === 'README' ? 'index' : m[1]}${m[2] ?? ''}`}>{children}</Link>;
      // operator and contributor docs are not bundled in the app: name them instead of linking nowhere
      return (
        <span title={`${h} — in the Foundry repository`} className="underline decoration-dotted">
          {children}
        </span>
      );
    },
  };
  // the page's own language switcher line ("> English · [中文](…)") is replaced by the toggle above
  const body = page?.markdown.replace(/^>\s*(English|\[English\]).*\n/m, '') ?? '';
  // its first line ("# Title") heads the page as every page's title does; the article is the rest, in the Markdown styles
  const title = body.match(/^#[ \t]+(.+)\n/)?.[1]?.trim() ?? null;
  const markdown = title ? body.replace(/^#[ \t]+.+\n/, '') : body;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 flex gap-8">
      <aside className="hidden md:block w-56 shrink-0">
        {/* level with the page's title (the page's top padding), pinned there while the page scrolls */}
        <div className="sticky top-9 space-y-0.5">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex items-center gap-2.5 text-[12.5px] font-extrabold caps text-ink">
              <HelpCircle size={14} aria-hidden="true" />
              Guide
            </span>
            <span className="ml-auto">
              <ButtonGroup<Lang>
                label="Language"
                value={lang}
                onChange={setLang}
                options={[
                  { id: 'en', label: 'EN' },
                  { id: 'zh', label: '中文' },
                ]}
              />
            </span>
          </div>
          {(pages ?? []).map((p, i) => (
            <Link key={p.slug} to={`/help/${p.slug}`} className={navItemClass(p.slug === slug)}>
              <span className="mono mr-2 text-[11px] text-ink-faint">{i + 1}</span>
              {lang === 'zh' && p.zh ? p.zh : p.title}
            </Link>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="md:hidden flex items-center gap-2 mb-5">
          <Select className="flex-1" value={slug} onChange={(e) => nav(`/help/${e.target.value}`)}>
            {(pages ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {lang === 'zh' && p.zh ? p.zh : p.title}
              </option>
            ))}
          </Select>
          <button type="button" className={buttonClass('default', 'sm', 'shrink-0')} onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        </div>
        {err ? <Empty>{err}</Empty> : !page ? <div className="text-ink-faint text-sm">…</div> : (
          <>
            {title && <PageHeader title={<span id={headingAnchor(title)} className="scroll-mt-16">{title}</span>} />}
            {lang === 'zh' && page.lang === 'en' && <div className="mb-4 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink-soft">这一页还没有中文版，下面是英文原文。</div>}
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
    <a href={`/help/${to}`} target="_blank" rel="noreferrer" title={label ?? 'Open the guide for this (new tab)'} className={cn('inline-flex items-center text-ink-faint hover:text-ink align-middle font-normal', className)} aria-label={label ?? 'help'}>
      <HelpCircle size={14} />
    </a>
  );
}
