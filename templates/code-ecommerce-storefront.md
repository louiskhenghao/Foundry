---
name: E-commerce storefront
summary: A storefront that sells — catalogue, search, cart, checkout with a payment provider, orders and an admin — fast, accessible and ready for real customers.
nature: code
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: shop
    label: The shop
    help: What it sells and to whom, in a line.
    example: Hollow Hill Ceramics, hand-thrown tableware sold to households across Europe
  - key: catalogue
    label: The catalogue
    type: textarea
    help: Kinds of products, variants, how many, where the data lives today.
    example: About 120 products in six collections; variants by glaze and size; stock per variant; photos and copy in a spreadsheet and a folder today.
  - key: payments
    label: Payments
    type: choice
    options: [Stripe, PayPal, Stripe and PayPal, a provider to be chosen]
    default: Stripe
  - key: fulfilment
    label: Shipping and tax
    type: textarea
    help: Where you ship, how shipping is priced, how tax works for you.
    example: EU and UK; flat rate per country with free shipping over 120 €; prices include VAT, shown per country at checkout.
  - key: locales
    label: Languages and currencies
    required: false
    example: English and German; euro and pound
  - key: stack
    label: Stack
    type: choice
    options: [whatever the repository already uses, Next.js with a headless commerce API, a full-stack framework with its own database]
    default: whatever the repository already uses
  - key: admin
    label: What the shop owner manages
    type: textarea
    required: false
    help: What the admin must do without a developer.
    example: Add and edit products and stock, see and fulfil orders, print packing slips, set a discount code, see the day's sales.
---

# {{shop}}: an online storefront

## The catalogue
{{catalogue}}

## Payments
{{payments}}

## Shipping and tax
{{fulfilment}}

## Languages and currencies
{{locales}}

## Stack
{{stack}}

## What the shop owner manages
{{admin}}

## Already decided
- Money is handled as integer minor units with a currency everywhere; totals, tax and shipping are computed on the server and re-checked at payment; the payment provider's webhook, not the browser, confirms an order.
- Checkout works without an account, keeps the cart across sessions, and recovers from a failed payment without losing it; the whole flow passes an accessibility audit and works with a keyboard alone.
- Product pages are server-rendered with structured data (Product, Offer, breadcrumbs), real image sizes and alt text; Lighthouse performance ≥ 90 and SEO ≥ 95 on a mid-range phone.
- Stock is decremented once, atomically, when the payment is confirmed; overselling is impossible by construction, and a test proves it under concurrent checkouts.
- Orders, refunds and status changes are an append-only history; emails (confirmation, shipped, refund) are rendered from templates and previewed in the admin.
- Secrets live in the environment, PCI scope stays with the provider (hosted fields or redirect), and every form is rate-limited and validated on the server.
- The milestone script buys a product end to end with the provider's test cards, then shows the order in the admin.
