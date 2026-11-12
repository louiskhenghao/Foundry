import { describe, expect, test } from 'bun:test';
import { ATTACHMENT_LIMITS, attachmentMaxBytes, designReferences, isDesignCandidate, isMediaAttachment, unreadableDesignLink, unreadableDesignLinks, unreadableDesignLinksIn } from './attachment.ts';

describe('what an attachment may weigh (ADR-0077)', () => {
  test('audio and video, by mime or by name, get the media cap; everything else the 25 MB one', () => {
    expect(attachmentMaxBytes({ name: 'ref.mp4', mime: 'video/mp4' })).toBe(ATTACHMENT_LIMITS.maxMediaFileBytes);
    expect(attachmentMaxBytes({ name: 'track.wav', mime: null })).toBe(ATTACHMENT_LIMITS.maxMediaFileBytes);
    expect(attachmentMaxBytes({ name: 'song', mime: 'audio/mpeg' })).toBe(ATTACHMENT_LIMITS.maxMediaFileBytes);
    expect(attachmentMaxBytes({ name: 'brief.pdf', mime: 'application/pdf' })).toBe(ATTACHMENT_LIMITS.maxFileBytes);
    expect(attachmentMaxBytes({ name: 'frame.png', mime: 'image/png' })).toBe(ATTACHMENT_LIMITS.maxFileBytes);
    expect(isMediaAttachment({ name: 'notes.txt', mime: 'text/plain' })).toBe(false);
  });
});

describe('design references (ADR-0093)', () => {
  test('a picture, an HTML page or a zip may be the design; documents, text and links may not', () => {
    expect(isDesignCandidate({ kind: 'file', name: 'home.png', mime: 'image/png' })).toBe(true);
    expect(isDesignCandidate({ kind: 'file', name: 'Landing page.html', mime: 'text/html' })).toBe(true);
    expect(isDesignCandidate({ kind: 'file', name: 'design-export.zip', mime: 'application/zip' })).toBe(true);
    expect(isDesignCandidate({ kind: 'file', name: 'export.zip', mime: null })).toBe(true);
    expect(isDesignCandidate({ kind: 'file', name: 'spec.pdf', mime: 'application/pdf' })).toBe(false);
    expect(isDesignCandidate({ kind: 'file', name: 'notes.md', mime: 'text/markdown' })).toBe(false);
    expect(isDesignCandidate({ kind: 'link', name: 'figma.com/file/x', mime: null })).toBe(false);
  });
  test('designReferences keeps the attachments marked as the design, in order', () => {
    const atts = [{ id: 'a', design: true }, { id: 'b' }, { id: 'c', design: false }, { id: 'd', design: true }];
    expect(designReferences(atts).map((a) => a.id)).toEqual(['a', 'd']);
  });
  test('links to design tools behind a sign-in are named by their tool; other links are not', () => {
    expect(unreadableDesignLink('https://claude.ai/public/artifacts/abc-123')).toBe('Claude');
    expect(unreadableDesignLink('https://www.figma.com/design/XYZ/Landing?node-id=1-2')).toBe('Figma');
    expect(unreadableDesignLink('https://www.canva.com/design/DAF/edit')).toBe('Canva');
    expect(unreadableDesignLink('https://framer.com/projects/x')).toBe('Framer');
    expect(unreadableDesignLink('https://example.com/claude.ai')).toBeNull();
    expect(unreadableDesignLink('https://docs.anthropic.com/claude')).toBeNull();
    expect(unreadableDesignLink('not a url')).toBeNull();
  });
  test('unreadableDesignLinksIn finds such links in a goal description, once each', () => {
    const text = 'Build it like this mockup: https://claude.ai/public/artifacts/abc-123, see also https://github.com/x/y and (https://www.figma.com/file/Q/App). Again https://claude.ai/public/artifacts/abc-123.';
    expect(unreadableDesignLinksIn(text)).toEqual([
      { url: 'https://claude.ai/public/artifacts/abc-123', tool: 'Claude' },
      { url: 'https://www.figma.com/file/Q/App', tool: 'Figma' },
    ]);
    expect(unreadableDesignLinksIn('no links here')).toEqual([]);
  });
});

test('unreadableDesignLinks reads a goal\'s description and its link attachments, once each', () => {
  const links = unreadableDesignLinks({ prompt: 'see https://claude.ai/public/artifacts/a1', attachments: [{ kind: 'link', url: 'https://www.figma.com/file/Q' }, { kind: 'link', url: 'https://claude.ai/public/artifacts/a1' }, { kind: 'file', url: null }] });
  expect(links).toEqual([{ url: 'https://claude.ai/public/artifacts/a1', tool: 'Claude' }, { url: 'https://www.figma.com/file/Q', tool: 'Figma' }]);
  expect(unreadableDesignLinks({ prompt: null, attachments: null })).toEqual([]);
});
