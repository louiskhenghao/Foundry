import { describe, expect, test } from 'bun:test';
import { ATTACHMENT_LIMITS, attachmentMaxBytes, isMediaAttachment } from './attachment.ts';

describe('what an attachment may weigh (ADR-0076)', () => {
  test('audio and video, by mime or by name, get the media cap; everything else the 25 MB one', () => {
    expect(attachmentMaxBytes({ name: 'ref.mp4', mime: 'video/mp4' })).toBe(ATTACHMENT_LIMITS.maxMediaFileBytes);
    expect(attachmentMaxBytes({ name: 'track.wav', mime: null })).toBe(ATTACHMENT_LIMITS.maxMediaFileBytes);
    expect(attachmentMaxBytes({ name: 'song', mime: 'audio/mpeg' })).toBe(ATTACHMENT_LIMITS.maxMediaFileBytes);
    expect(attachmentMaxBytes({ name: 'brief.pdf', mime: 'application/pdf' })).toBe(ATTACHMENT_LIMITS.maxFileBytes);
    expect(attachmentMaxBytes({ name: 'frame.png', mime: 'image/png' })).toBe(ATTACHMENT_LIMITS.maxFileBytes);
    expect(isMediaAttachment({ name: 'notes.txt', mime: 'text/plain' })).toBe(false);
  });
});
