# Memory

> English · [中文](./memory.zh.md)

[Learnings](./learnings.md) are the thirty lines Foundry keeps per project folder. **Memory** is the long version: a [Hindsight](https://github.com/vectorize-io/hindsight) server you run keeps everything a folder's goals did, decided, were refused and wrote, consolidates it in the background, and answers each stage of a goal before it starts — what earlier work in this repository says about this task, this plan, this review. Your own Claude Code or Codex sessions in the same repository share the bank. It is optional: nothing here runs until you set a server up.

## What it needs

Hindsight is open source (MIT). It runs as a process of its own with an embedded database, so there is nothing else to install, and it needs an LLM of its own to extract facts from what it is given: a key for OpenAI, Anthropic, Gemini, Groq or another provider, or a subscription sign-in. Count on 1.5–2 GB of memory for it, and about 215 MB of models downloaded on its first start. Its LLM's cost is yours and is not in Foundry's ledger; Foundry itself makes no model call for Memory.

**A sign-in you already have.** A server on this computer can use the Claude Code or Codex sign-in that Foundry's goals already run on, instead of a key. `HINDSIGHT_API_LLM_PROVIDER=claude-code` spawns your `claude` for each extraction and answer (install the server with that provider's extra: `uv tool install --with claude-agent-sdk hindsight-api`, or `pip install hindsight-api claude-agent-sdk`); `HINDSIGHT_API_LLM_PROVIDER=openai-codex` reads a Codex sign-in from `CODEX_HOME` — give it a folder of its own, `CODEX_HOME=~/.hindsight/codex codex login`, so the server and your terminal never refresh the same token. Hindsight's docs mark both as for your own use. Two things follow. These calls count against your plan's usage: the first use of a folder extracts its last 300 commits, one call each, so lower **Seed a new folder from** on the card if that matters. And an answer takes a minute or more rather than seconds: set **Wait for an answer** on the card to 90–120 s, or let the stages take the memories themselves (below). The Docker install's Hindsight cannot reach the `claude` on your computer; the installer asks for a key.

## Setting it up

1. **Start a server.** With the Docker install, run the one-line installer again with `--with hindsight` (or answer yes when it asks): it starts Hindsight beside Foundry as a compose profile, keeps the LLM key you give it in `hindsight.env` next to the compose file, and points Foundry at it — steps 2 and 3 below are then only the connection of a coding agent. Otherwise, on this computer with Docker, the full image carries its database and models (3.7–9 GB); the card below has the command to copy. Or with Python: `pip install hindsight-api`, then `hindsight-api` with the same `HINDSIGHT_API_LLM_*` variables. The server listens on port 8888 and its console on 9999.
2. **Open Extensions → MCP servers** and find the **Memory · Hindsight** card. Enter the address (`http://127.0.0.1:8888` for a server on this computer) and the bearer token if the server asks for one, press **Test**, then **Save**. The card then reads **connected** with the server's version. **Write each attempt's transcript to the bank** is on by default; **Wait for an answer** (20 s) and **Seed a new folder from** (300 commits) are explained below.
3. **Connect the coding agent.** **Connect Claude Code** (or **Connect Codex** on the Codex tab) puts the server into that coding agent's own configuration, allowed in goals: a worker can then ask the memory itself mid-way, and is told which bank is its folder's. Foundry asks the bank before every stage either way. Antigravity takes no MCP servers from Foundry: its goals get what Memory recalls as text only. For Codex, Foundry hands the token to its sessions as `HINDSIGHT_API_TOKEN`; export it in your own shell for your own sessions.

**Turn off** on the card stops everything; the Learnings you have are unaffected. **Settings → Skills** points here.

## What is remembered

For every folder that is a git repository and is not left out, Foundry writes into its bank:

- **When a goal ends** done, over-delivered or failed: its record, the same one the Learnings session reads — what was asked and understood, the Decisions, each task and the attempts that failed, where it stopped for you and what you answered, the warnings, the final review. A cancelled goal writes nothing.
- **The folder's Learnings** whenever they change, in place of the notebook written before — so a Learning you write is also the surest correction of a wrong memory.
- **Each revision of a Brief** before you approved it, what a **second opinion** proposed, each **task review's verdict** with its reasons, and each **replan's** reason: the evidence of where Foundry's understanding, plan or work was off.
- **Each attempt's transcript** in compact form — your task, the agent's words, one line per tool call without arguments or outputs, what failed calls said — while the card's switch is on. It is most of what the server's LLM reads, which is what the switch is for.
- **The folder's recent commits** (the last 300 messages) the first time Memory is used there, so a bank is not empty on the first goal; skipped when the bank already holds documents, for example from your own sessions.
- **What you decide**, from every folder, into a bank of your own, `foundry::person`: your **Yours, everywhere** notebook, the Decisions of each Brief you approve, what you answer when a goal stops for you, what you say at a milestone — each tagged with the repository it came from. Clarify asks this bank beside the folder's. A folder you left out writes nothing there either.

A bank Foundry makes also gets the five knowledge pages Hindsight's own integration keeps — component map, core concepts, conventions and patterns, key decisions and rationale, initiatives — which the server rewrites every hour from what the bank holds and reads first when it answers. The values of the keys Foundry keeps are blanked out of everything before it is sent.

## What goals get

Before every attempt, before Clarify (the planner is given the same answer), before a replan, a task review and the goal review, Foundry asks the bank one question about the work at hand and gives the answer to the session under **What Memory recalls**, beside the folder's Learnings, at most 1,500 characters. The card's **Wait for an answer** (20 s) is how long a stage waits for that answer; past it, the stage is given the memories themselves that bear on the question — found without a model, in well under a second — and goes on, the section saying so. A server that is down costs a goal nothing but that wait; a bank with nothing in it yet is not asked at all. Like Learnings, it is a starting point: where the code says otherwise, the code wins.

## Seeing it

- A goal's page says **Memory: 3/4 recalled · wrote back 6** under its facts (or that the server did not answer). **Remembered** on its Overview tab opens what each stage was told, in the bank's words — marked **the memories themselves** where the answer did not come in time — and how many documents the goal wrote back. **Activity** lists each ask and each write.
- A folder's card on the **Learnings** page shows its bank (`coding-agent::<folder>`) and a **Memory** switch: off, that folder's goals neither read nor write the bank. The **Yours, everywhere** card shows your own bank, `foundry::person`.
- Hindsight's own console (port 9999 of the server) shows the banks, their memories and what the consolidation made of them.

## One bank per repository

A folder's bank is named after its repository's main folder, `coding-agent::<name>`, as Hindsight's own coding-agent integration names it. Wire your terminal's Claude Code to the same server (`npx @vectorize-io/hindsight-coding-agents install claude-code`) and your own sessions and Foundry's goals share one memory. Two clones under the same folder name share a bank; a clone under another name has its own, while its Learnings follow the path, as before. A wrong memory from either side reaches the other until a later fact contradicts it: Hindsight ranks newer facts higher, and the Learnings you write are retained.

## Costs and privacy

Everything a goal does goes to the server you set up: on this computer by default, elsewhere only where you point it. Hindsight's cloud is an address like any other, never a default. Its LLM pays for extraction and for every answer; Foundry adds no model cost of its own. A [Transfer](./moving-to-a-new-computer.md) carries no memory: the store is the server's.
