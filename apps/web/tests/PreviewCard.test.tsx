import { expect, test } from 'bun:test';
import { viewerAddress } from '../src/pages/goal/PreviewCard.tsx';

test('the CAD Viewer chip names the viewer by its address, never by the path of the model it opens', () => {
  expect(viewerAddress('http://localhost:4178/?file=/Users/me/Library/Application%20Support/Foundry/g1/_goal/artifacts/frame_assembly.step')).toBe('localhost:4178');
  expect(viewerAddress('http://localhost:4178')).toBe('localhost:4178');
  expect(viewerAddress('not a url')).toBe('not a url');
});
