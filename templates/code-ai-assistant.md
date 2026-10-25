---
name: AI assistant inside the app
summary: A chat assistant grounded in your product's own data that can take actions on the user's behalf, with streaming, guardrails, cost limits and an evaluation set.
nature: code
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: product
    label: The product it lives in
    example: Pantry, a shared shopping-list app
  - key: tasks
    label: What the assistant does
    type: textarea
    help: The jobs it should handle, as a user would ask for them; which of them change data.
    example: |
      Answer questions about what is on the lists and what was bought ("do we have coffee?").
      Add, tick off or move items when asked ("put oat milk on the weekend list").
      Plan a week of meals from what is in the cupboard and add the missing items — after the user confirms.
  - key: data
    label: What it may read
    type: textarea
    help: The data it is grounded in and the boundaries: only the user's own, never other households'.
    example: The user's households, lists, items and purchase history; the recipe library; never another household's data, never payment details.
  - key: provider
    label: The model
    type: choice
    options: [the Claude API, the OpenAI API, a local model through Ollama, not decided — propose one with the trade-offs]
    default: not decided — propose one with the trade-offs
  - key: guardrails
    label: Guardrails
    type: textarea
    help: What it must never do or say; what needs confirmation; what to do when unsure.
    example: Never delete a list; confirm before adding more than five items or spending anything; refuse medical and allergy advice beyond the labels on file; say "I don't know" rather than guess a price.
  - key: stack
    label: Stack
    type: choice
    options: [whatever the repository already uses, a new service beside the app with its own API, inside the existing backend]
    default: whatever the repository already uses
---

# An AI assistant inside {{product}}

## What it does
{{tasks}}

## What it may read
{{data}}

## The model
{{provider}}

## Guardrails
{{guardrails}}

## Stack
{{stack}}

## Already decided
- Tool use, not free text: every action is a typed tool with validated arguments and an authorisation check in the application code, never in the prompt; destructive and spending actions ask the user first.
- Grounding by retrieval over the user's own data with the user's permissions applied at query time; the assistant cites what it used, and the UI shows it.
- Streaming responses with a stop button; a per-user daily budget and a per-request token cap, with usage recorded.
- An evaluation set of at least thirty real-shaped conversations (happy paths, refusals, injection attempts, ambiguous asks) runs in CI against a fixed model version; a change that lowers the pass rate does not merge.
- Prompt-injection defences: tool results and retrieved text are data, never instructions; the system prompt and tool list are not revealed on request.
- Conversations are stored with the user's data, deletable with the account, and never used for training.
- The milestone script asks a grounded question, requests an action, and shows the confirmation step.
