import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../src/pages/LoginPage.tsx';
import { PeopleList } from '../src/pages/settings/AccessCard.tsx';

test('the people with a token are listed with when they last used it and a Revoke; no one means Access is off (ADR-0061)', () => {
  const h = renderToStaticMarkup(<PeopleList people={[{ id: 'p_1', name: 'Ada', createdAt: '2026-10-01T10:00:00Z', lastUsedAt: new Date(Date.now() - 120_000).toISOString() }, { id: 'p_2', name: 'Bob', createdAt: '2026-10-20T10:00:00Z', lastUsedAt: null }]} onRevoke={() => {}} />);
  expect(h).toContain('Ada');
  expect(h).toContain('since 2026-10-01');
  expect(h).toContain('last used');
  expect(h).toContain('Bob');
  expect(h).toContain('never used');
  expect(h.match(/Revoke/g)).toHaveLength(2);
  expect(renderToStaticMarkup(<PeopleList people={[]} onRevoke={() => {}} />)).toContain('Access is off');
});

test('the sign-in page asks for the token and says where one comes from', () => {
  const h = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/login?next=%2Fgoals%2Fg1']}>
      <LoginPage />
    </MemoryRouter>,
  );
  expect(h).toContain('Sign in');
  expect(h).toContain('Access token');
  expect(h).toContain('placeholder="fnd_…"');
  expect(h).toContain('Settings → Access');
});
