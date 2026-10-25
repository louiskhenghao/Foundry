---
name: Public API with keys, limits and docs
summary: A versioned public API for your product — authentication by key, rate limits, pagination, webhooks, an OpenAPI description, a reference site and a client library.
nature: code
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: product
    label: The product behind the API
    example: Orbit, subscription analytics for online shops
  - key: resources
    label: The resources
    type: textarea
    help: The things the API exposes and what each may do (read, create, change, delete); the relations between them.
    example: |
      Shops (read), their subscriptions (read, cancel) and invoices (read, download the PDF).
      Metrics (read): MRR, churn and active shops by day, with a date range.
      Webhooks (create, list, delete): subscription.created, subscription.cancelled, invoice.paid.
  - key: consumers
    label: Who calls it
    help: The developers and systems that will use it, and from where.
    example: Our customers' own back-ends and a few partner integrations; servers only, no browsers.
  - key: style
    label: Style
    type: choice
    options: [REST with JSON, GraphQL, REST and a GraphQL layer on top]
    default: REST with JSON
  - key: limits
    label: Limits and plans
    type: textarea
    required: false
    help: Rate limits, quotas, what differs between plans.
    example: 600 requests a minute per key by default, 60 for the free plan; metrics endpoints count double; a burst of 50.
  - key: stack
    label: Stack
    type: choice
    options: [whatever the repository already uses, a separate API service, inside the existing backend]
    default: whatever the repository already uses
  - key: sdk
    label: Client library
    type: choice
    options: [TypeScript only, TypeScript and Python, none for now]
    default: TypeScript only
---

# A public API for {{product}}

## The resources
{{resources}}

## Who calls it
{{consumers}}

## Style
{{style}}

## Limits and plans
{{limits}}

## Stack
{{stack}}

## Client library
{{sdk}}

## Already decided
- Versioned in the path (`/v1`), with a written deprecation policy; nothing in `v1` changes incompatibly after release, additive changes only.
- API keys are created and revoked in the product's settings, shown once, stored hashed, scoped to a shop and to read or write; every request logs the key id, the endpoint and the outcome.
- Rate limiting by key with standard headers (`RateLimit-*`, `Retry-After`) and a 429 body that says when to try again; limits are configuration, not code.
- Cursor pagination everywhere, consistent error bodies (a code, a message, a request id), idempotency keys on every create, ISO dates in UTC, money in minor units with a currency.
- Webhooks are signed, retried with backoff for a day, and each delivery is visible to the customer with its response; a replay button exists.
- The OpenAPI document is generated from the code (or the code from it), validated in CI, and renders a reference site with runnable examples; the client library is generated from the same document and published with the API's version.
- Contract tests run against a seeded database; the milestone script creates a key, lists a resource with pagination, hits the rate limit and receives a webhook.
