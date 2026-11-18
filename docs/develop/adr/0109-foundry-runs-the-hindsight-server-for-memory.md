# ADR-0109: Foundry runs the Hindsight server for Memory on this computer

**Status:** accepted · 2026-11-18 · builds on ADR-0072, ADR-0084 and ADR-0108

## Context

Memory (ADR-0072) needs a Hindsight server, and until now the person had to run one: with Docker, with pip, or beside
the 2.x Docker install through its compose profile. ADR-0108 removed the image and its compose file, so the one way to
get a server without a terminal went with them. Settling the move away from Docker on 2026-11-16, the person who owns
the project chose that Foundry should install and run the server itself, a subprocess it manages. A live run had
already shown what such a server needs on a Mac: `hindsight-api` with the Claude Agent SDK beside it, `claude-code` as
its LLM provider (a reflect took 85 s, a recall 40–70 ms), and its embedded Postgres (pg0).

Three facts about Hindsight 1.1.0 shape the design. It listens on 0.0.0.0 unless told otherwise. Its embedded
Postgres keeps its files in `~/.pg0/instances/<name>`, and Hindsight passes no data directory to pg0, so they cannot be
moved into Foundry's data folder. And when it is stopped as on Ctrl-C it stops that Postgres too, which otherwise runs
on as a daemon of its own.

## Decision

- **A setting, `memory.run`.** Off by default. On, Foundry runs the server and Memory uses it; `memory.url` (a server
  the person runs) is kept but not used. The Hindsight card offers both: *Foundry runs it* (*Run Hindsight here*) and
  *A server you run*.
- **Installed once, pinned.** uv makes a Python 3.12 environment at `<data folder>/python/hindsight`, beside the skills'
  environments (ADR-0084), and installs `hindsight-api` and `claude-agent-sdk` at versions Foundry pins and has tried
  together (1.1.0 and 0.2.173); a newer pin reinstalls it at the next start. On Linux, PyTorch's CPU build. About 2 GB.
  Without uv, or when the install fails, the card says why and **Try again** retries; nothing half-made is kept.
- **This computer only.** `127.0.0.1`, port 8888 or the next free one, kept in `<data folder>/hindsight/port` so the
  address the coding agents' MCP servers point at stays the same. No bearer token: nothing outside this computer
  reaches it.
- **A sign-in, not a key.** Its LLM is the Claude Code sign-in Foundry's goals use (`claude-code`, the config dir of
  Foundry's own sign-in, never an `ANTHROPIC_API_KEY` from Foundry's environment). Where Claude Code is not signed in
  and Codex is, it is `openai-codex` with a sign-in of the server's own in `<data folder>/hindsight/codex`, made from
  the card by device code: a Codex refresh token is good once, so the server never shares the CLI's. With neither, it
  does not start, and the card says so. Stages wait 120 s for an answer when the card turns it on (an answer through a
  CLI takes a minute or two); past it they take the memories themselves, as before.
- **Its database is named per data folder.** `pg0://foundry-<8 hex>`, the name kept in
  `<data folder>/hindsight/instance`: two Foundry installs on one computer (a checkout and the app) never share a
  database, and stopping one never stops the other's Postgres. A data folder moved on the same computer keeps its
  memories; one moved to another computer starts with none, as Transfer always did.
- **It lives and dies with Foundry.** It starts with the engine (in the background: the engine does not wait) and
  stops with it, asked to stop first so it stops its Postgres, killed with its process group past 15 s. It reads its
  stdin, which Foundry holds open: when Foundry is gone, however it went (`kill -9` included), the pipe closes and the
  server stops as on Ctrl-C. It writes its log itself (`<data folder>/hindsight/server.log`), so its last lines are
  there even then. A server an earlier start left running (its pid recorded beside the log, its command line naming
  this folder's launcher) is stopped before a new one starts. One that stops on its own is started again after a short
  wait; after three stops in ten minutes it is left stopped with its last line on the card.
- **The card follows it.** *installing*, *starting* (the first start downloads its models), *running* with its port and
  its LLM, *needs a sign-in*, or *stopped* with the reason and the log's last lines; *Where it keeps things* shows the
  environment and the database. *Turn off* stops it and keeps both.

## Consequences

- Memory works without a terminal, Docker or a key on any computer the app or the binary runs on, given uv (`foundry
  setup` installs it) and a coding agent's sign-in.
- Its memories are outside the data folder, in `~/.pg0/instances/foundry-…`: a backup of the data folder does not hold
  them, and removing Foundry leaves them until that folder is deleted. The card and the guide say where they are.
- An Intel Mac gets no PyTorch for this Python, so the install fails there with uv's reason; a server elsewhere is
  the way.
- The server uses Foundry's own Claude Code sign-in as it was when it started: an account switched in Foundry
  (ADR-0065) reaches it at its next start.
- Hindsight's usage counts against the person's plan, as ADR-0072 said of any sign-in, and is not in Foundry's ledger;
  Foundry itself still makes no model call (ADR-0001).
- The Hindsight version is pinned, and credited at that version on the Open source credits page, apart from what the
  release ships and what `foundry setup` installs.
