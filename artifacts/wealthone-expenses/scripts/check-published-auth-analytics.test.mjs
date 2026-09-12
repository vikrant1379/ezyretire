import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_FUNNEL_EVENTS,
  assertAuthFunnelEvents,
} from './check-published-auth-analytics.mjs';

const successfulEvents = AUTH_FUNNEL_EVENTS.map(({ name, data }) => ({
  name,
  data,
}));

test('accepts the three privacy-safe secure sign-in funnel events', () => {
  assert.doesNotThrow(() => assertAuthFunnelEvents(successfulEvents));
});

for (const missingEvent of AUTH_FUNNEL_EVENTS) {
  test(`identifies a missing ${missingEvent.boundary}`, () => {
    assert.throws(
      () => assertAuthFunnelEvents(
        successfulEvents.filter(({ name }) => name !== missingEvent.name),
      ),
      new RegExp(
        `${missingEvent.boundary} did not reach.*${missingEvent.name}`,
      ),
    );
  });
}

test('rejects analytics properties at any secure sign-in boundary', () => {
  assert.throws(
    () => assertAuthFunnelEvents([
      {
        ...successfulEvents[0],
        data: {
          request_kind: 'initial',
          email: 'unsafe@example.com',
        },
      },
      ...successfulEvents.slice(1),
    ]),
    /code request success included unapproved analytics data/,
  );
});

test('rejects an unapproved initial request kind', () => {
  assert.throws(
    () => assertAuthFunnelEvents([
      {
        ...successfulEvents[0],
        data: { request_kind: 'resend' },
      },
      ...successfulEvents.slice(1),
    ]),
    /code request success included unapproved analytics data/,
  );
});

test('rejects duplicate funnel events', () => {
  assert.throws(
    () => assertAuthFunnelEvents([...successfulEvents, successfulEvents[1]]),
    /code verification success reached.*2 times/,
  );
});