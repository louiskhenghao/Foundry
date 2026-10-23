# ADR-0071: Memory — a Hindsight server the person runs remembers what a repository's goals did and taught; Foundry retains and reflects itself, and shares the bank with the person's own sessions

**Status:** accepted · 2026-10-23 · builds on ADR-0016, ADR-0040, ADR-0050 and ADR-0064

## Context

A folder's Learnings (ADR-0040) are a notebook of thirty lines. They are written once, when a goal ends, by a session
that reads the goal's record and returns the whole notebook again; they reach Clarify, the planner and every attempt,
and the person's own sessions through an exported skill (ADR-0050). That is a ceiling as much as a feature. The
thirty lines must hold everything a folder has taught; what does not fit is dropped. The reviewers, the second
opinion and the merger get nothing. What an attempt tried before it failed, why a review refused a task, how a Brief
was corrected in a Revise round — the Learnings session reads it once, keeps a line or not, and the rest is gone.
Nothing in Foundry gets better at a repository over time beyond that notebook.

Hindsight is an open-source (MIT) memory server for agents. `retain` stores text and extracts facts, entities and
time from it with an LLM; `recall` searches by meaning, keyword, graph and time at once; `reflect` answers a question
over the whole store rather than returning memories. A background worker keeps consolidating facts into
observations, mental models and knowledge pages, so the store improves without anyone editing it. Its own
coding-agent integration gives every coding CLI one bank per repository and reports fewer corrections per task, but
it is wired the way a CLI plugin is wired: three hooks in the person's global Claude Code settings, a user-scope MCP
server and a skill, in every session on the machine, with the vendor's cloud as the default server and whole session
transcripts written back. It knows nothing of Foundry's record — the Brief, the Decisions, the reviews — and cannot
be switched per folder or per goal from Foundry.

Running Hindsight is a choice. It needs a process of its own (an embedded PostgreSQL by default, so nothing to
install beside it, but 1.5–2 GB of memory and about 215 MB of models on first start), and an LLM of its own for
extraction and reflection, with a key or a subscription sign-in. Not every person who runs Foundry wants that; the
ones who do run it already, on this computer or on a server of theirs.

Foundry's own rules bound the design. Foundry drives coding agents and calls no model API itself (ADR-0001). MCP
servers are installed at user scope through the agent's own CLI and allowed per session; a Foundry-only
configuration was rejected because it hides the server from the person's own sessions (ADR-0016). Antigravity keeps
its MCP servers itself and takes none from Foundry (ADR-0064). And the glossary says a Learning is not memory: the
Context Provider decides what code a session sees, Learnings are what was learned by doing.

## Decision

- **Memory is an extension the person turns on.** On the Extensions page, under MCP servers, a **Hindsight** card
  takes the address of a server the person runs (`memory.url`) and an optional bearer token (`memory.token`, a secret
  setting), tests the connection, and shows the commands that start a server locally. Foundry bundles no server in its
  image; the Docker install may run one beside it: `install.sh --with hindsight` (or a yes when the installer asks)
  adds Hindsight as a compose profile, `memory`, with an LLM key of the person's in `hindsight.env` next to the
  compose file, and points Foundry at it through `HINDSIGHT_API_URL`. From source the person runs one themselves.
  The vendor's cloud is an address like any other and never a default. With the card empty nothing described here
  happens, and Learnings work as before.
- **Foundry does the wiring, not Hindsight's installer.** Foundry's engine retains and reflects through Hindsight's
  HTTP API with its TypeScript client. The MCP server is installed at user scope like a catalog server (ADR-0016):
  the multi-bank endpoint, with the token as a header for Claude Code and as an environment variable Codex reads;
  worker sessions are allowed it and told their bank, so an attempt may ask the memory itself mid-way. Read-only
  roles get text, not tools. Antigravity sessions get text only.
- **One bank per repository, named as Hindsight's own integration names it**: `coding-agent::` followed by the name
  of the repository's main worktree folder. The person's own sessions in that repository, wired by Hindsight's
  installer, write and read the same bank, so there is one brain, not two. Foundry creates a missing bank with a
  mission for a coding project and never changes the settings of a bank that exists. A bank Foundry makes ready also
  gets the five knowledge pages Hindsight's own integration keeps — component map, core concepts, conventions and
  patterns, key decisions and rationale, initiatives — by name and with the same questions, each refreshed hourly at a
  minute of its own; a page that exists is left alone, and a server without pages is no reason to stop. Everything
  Foundry writes is tagged with its source (`source:foundry`, `source:learnings`, `source:transcript`, `source:git`,
  `source:person`), its goal and its stage, so it can be told apart and filtered.
- **One bank for the person.** `foundry::person` holds what the person decided, answered and asked for across every
  folder, in their words: their everywhere notebook (ADR-0055), the Decisions of each Brief they approve, what they
  say when a goal stops for them, what they say at a milestone — each tagged with the repository it came from.
  Clarify asks it beside the folder's bank, under *What Memory recalls about the person*. A folder left out keeps its
  goals' words out of it too.
- **What is retained.** When a goal ends done, over-delivered or failed: the goal's record (the one the Learnings
  session reads — prompt, Brief understanding, Decisions, tasks and hints, failed attempts, escalations and answers,
  warnings, final review) and the notebook the Learnings session returned. Every `learnings.set`, including the
  person's edits, so a correction they type outranks what was learned. Each Revise round's change to the Brief, each
  task review's verdict with its reasons, and each replan's reason — the evidence of where Foundry's own
  understanding, plan or work was wrong. Each attempt's transcript in compact form — the person's and the agent's
  turns, and one action line per tool use naming the tool and its target, without arguments or outputs — the shape
  Hindsight's integration writes, so the bank consolidates both alike; `memory.retainTranscripts` (on) turns it off.
  When a folder first joins, its recent commit messages (`memory.seedCommits`, 300), one document per commit keyed by
  its hash, skipped when the bank already holds documents. A cancelled goal teaches nothing, as under ADR-0040.
  Values of the secrets Foundry keeps are scrubbed from everything before it is sent.
- **What is read.** Before every attempt, one `reflect` with the task and its area as the question, at low budget,
  cut to 1,500 characters, given to the session under *What Memory recalls* beside the notebook; before Clarify, the
  planner, a replan, a task review and the goal review, the same with their question. Twenty seconds without an
  answer and the stage goes on without one. Not the second opinion, the merger, the documenter or Browser QA: their
  question is the current change, not the folder's past. Where the code says otherwise, the code wins, as with
  Learnings.
- **Switches and visibility.** The extension is on or off for the instance; a folder can be left out
  (`memory.excludedFolders`) from its card on the Learnings page, which also shows the folder's bank. There is no
  switch per goal. A server that cannot be reached costs a run nothing but the attempt: the goal runs without memory
  and its page says so. The goal page shows, folded, what was recalled at each stage and how many memories the goal
  wrote back, from two goal events, `memory.recalled` and `memory.retained`. A write that fails is a warning on the
  goal and is not retried.
- **Learnings stay.** Memory is unbounded and consolidated by the server; the notebook is thirty lines the person can
  read and edit, given to every prompt whether the extension is on or not. The glossary distinguishes three things:
  the Context Provider (what code a session sees), Learnings (the folder's notebook) and Memory (the long-term store
  a Hindsight server keeps).
- **Foundry still calls no model.** Extraction, consolidation and reflection run in the server with the LLM the
  person configured there; their cost is theirs and is not in Foundry's ledger.

## Consequences

- A goal with the extension on costs Foundry no model call more; each reflecting stage waits up to twenty seconds. The
  person's Hindsight LLM pays for extraction and reflection, and transcripts are most of it — hence their switch.
- One bank for Foundry and the terminal means one set of mistakes too: a wrong fact from either side reaches the
  other until something contradicts it. A later fact outranks an earlier one in Hindsight; the person's Learnings
  edits are retained, so the Learnings page is where a wrong memory is corrected from Foundry's side.
- The bank follows the folder's name, as Hindsight has it: two repositories whose folders share a name share a bank;
  a repository cloned under another name gets another bank, while its Learnings follow the path (ADR-0040). The
  goal's worktrees resolve to the main folder, so a task never writes to a bank of its own.
- Removing the Hindsight server from Foundry removes it from the person's own sessions too, as for every user-scope
  server (ADR-0016). Unlike other servers' keys, which Foundry passes on and forgets (ADR-0016), the token is kept as a
  secret setting, because Foundry calls the server itself. Claude Code gets it as a header of the server's
  configuration; Codex reads it from an environment variable (`HINDSIGHT_API_TOKEN`) that Foundry sets for its
  sessions and the person sets in their own shell.
- Everything a goal did goes to the configured server: on this computer by default, elsewhere only where the person
  points. A Transfer (ADR-0030) carries no memory; the store is the server's.
- The Docker image is unchanged; the compose profile pulls Hindsight's own image (3.7–9 GB) only when chosen, on the
  same computer as Foundry, and updating it is the person's (`docker compose pull hindsight`, then `up -d`). Its API
  is on loopback, open, as Hindsight's own default is: the person's terminal shares the banks without a token.
- Antigravity goals remember less: they are told what Memory recalls but cannot ask it mid-way.
- A bank Foundry made reads the same as one the person's terminal made: the name, the mission, the five pages.
- The person's bank gathers their words from every folder in one place, on the server they chose; a folder left out
  keeps its goals' words out of it as well.
