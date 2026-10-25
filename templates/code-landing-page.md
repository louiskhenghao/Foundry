---
name: Marketing landing page with motion
summary: A launch page that sells one thing, with considered motion, measured conversions and top Lighthouse scores.
nature: code
settings:
  mode: simple
  interviewDepth: 2
inputs:
  - key: product
    label: The product
    help: What the page sells, in a line.
    example: Ledgerly, invoicing that chases late payers for you
  - key: audience
    label: Who it is for
    example: freelancers and two-person studios who send a dozen invoices a month
  - key: sections
    label: The sections
    type: textarea
    help: Top to bottom; the message of each and what it shows.
    example: |
      Hero: the one line, a sub-line, the sign-up button and a looping screen recording of a reminder going out.
      How it works: three steps with small illustrations that draw themselves as you scroll.
      Proof: three quotes and the numbers (days to get paid, before and after).
      Pricing: two plans, a toggle for yearly, the FAQ folded under it.
      Footer: sign-up again, contact, legal.
  - key: cta
    label: The call to action
    help: The words on the main button and where it leads.
    example: Start free — no card needed (to the sign-up page)
  - key: style
    label: Look and feel
    type: textarea
    help: Colours, type, references, what to avoid.
    example: Paper white, ink blue and one warm accent; big friendly type; calm motion — things settle, nothing bounces; no stock photos, no gradients.
  - key: measure
    label: What to measure
    type: textarea
    required: false
    help: Events and goals, and the analytics tool if you have one.
    example: Sign-up clicks by section, scroll depth, pricing toggle use; Plausible is already on the main site.
---

# A landing page for {{product}}

## Who it is for
{{audience}}

## The sections
{{sections}}

## The call to action
{{cta}}

## Look and feel
{{style}}

## What to measure
{{measure}}

## Already decided
- One page, one goal: every section leads to the same call to action, which is visible within the first screen on a phone.
- Motion has a reason: entrances on scroll are short and settle, `prefers-reduced-motion` removes them, nothing moves while the visitor reads, and no layout shifts (CLS 0).
- Lighthouse ≥ 95 on performance, accessibility, best practices and SEO on a mid-range phone; images in modern formats with real sizes; fonts self-hosted and swapped without a flash.
- Copy is written for the audience above, read aloud once, and fits the design at every width from 360 px up; the HTML is semantic and the page is a proper document without JavaScript.
- Open Graph and Twitter cards, a sitemap, structured data for the product and the FAQ.
- Events for the goals above fire through the analytics tool with no cookie banner needed; a tiny A/B switch for the headline is in place but off.
- The milestone script scrolls the page end to end at phone width and clicks the call to action.
