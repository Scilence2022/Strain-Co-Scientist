# Strain Co-Scientist

A TypeScript **Electron desktop application** that implements the multi-agent
**Co-Scientist** architecture (Gottweis et al., *Nature* 2026), adapted from
biomedical hypothesis generation to the **rational engineering of industrial
microbial strains**. Give it a product target, a host, and constraints; a team
of specialized agents then generates, peer-reviews, debates, ranks, evolves, and
synthesizes concrete strain-design strategies — with a clean, professional
monitoring & management UI.

> Not a web service. A self-contained desktop workstation that stores everything
> locally.

---

## What it does

Given a strain-engineering goal (e.g. *"increase mevalonate titer in E. coli"*),
the system runs an asynchronous, self-improving loop that produces a ranked set
of **strain designs**, each with:

- concrete **interventions** (knockouts, overexpression, knockdowns, promoter/RBS
  tuning, heterologous pathways, transporter/cofactor engineering, dynamic
  regulation, enzyme engineering),
- a mechanistic rationale and predicted effect on titer/rate/yield,
- a **Design-Build-Test-Learn (DBTL)** experimental plan,
- construct/primer suggestions,
- risk and biosafety assessment,
- literature citations and an Elo-based quality ranking,
- and a synthesized **research overview** (engineering roadmap) for the scientist.

## Architecture — faithful to the paper, retargeted to strain engineering

Four components from the Co-Scientist paper:

1. **Natural-language I/O** — campaigns + an expert-in-the-loop surface.
2. **Asynchronous task framework** — a Supervisor manages a bounded-concurrency
   worker queue of agent tasks (`src/main/engine/TaskQueue.ts`,
   `src/main/engine/Supervisor.ts`).
3. **Specialized agents** (`src/main/engine/agents/`):
   - **Generation** — literature exploration, simulated scientific debate,
     assumption decomposition, research expansion.
   - **Reflection** — initial / full / deep-verification / observation /
     simulation / tournament reviews, with a biosafety gate.
   - **Ranking** — Elo tournament (init 1200) via pairwise scientific-debate
     matches (`src/main/engine/tournament/Elo.ts`).
   - **Proximity** — similarity graph + clustering for de-dup and match
     selection.
   - **Evolution** — six refinement strategies; always creates *new* designs
     that must re-earn their rank.
   - **Meta-review** — synthesizes recurring critique into per-agent feedback
     (improvement without backprop) and produces the final research overview.
4. **Persistent context memory** — atomic JSON store under Electron `userData`
   (`src/main/memory/Store.ts`); runs survive restarts.

The DBTL experiment loop is drawn from *Robin* (Ghareeb et al., *Nature* 2026),
and the scientist-in-the-loop "collaborator" framing from the biomedical AI
agents review (2024).

### Tech stack

- Electron + electron-vite, TypeScript end-to-end.
- React 18 + Zustand (renderer); custom CSS design system (no UI framework).
- `@anthropic-ai/sdk` (default LLM) with a tiered model strategy:
  **Opus 4.8** (`claude-opus-4-8`) for Generation/Reflection/Meta-review,
  **Sonnet 4.6** (`claude-sonnet-4-6`) for Ranking/Proximity/Evolution.
  All per-agent models are configurable in Settings. An OpenAI-compatible
  adapter is also included.
- `@modelcontextprotocol/sdk` streamable-HTTP client for grounding.
- `d3-force` for the proximity map; all other charts are hand-rolled SVG.

## Grounding via MCP (optional)

In **Settings → Grounding**, connect either or both servers (with a
*Test connection* button):

- **deep-research** (`/api/mcp`, streamable-http) — literature grounding for the
  Generation, Reflection, and Evolution agents.
- **CodeXomics** (`http://localhost:3002`) — gene existence/sequence checks,
  BLAST/UniProt/AlphaFold/pathway context, and primer/construct design.

When a server is unreachable, the corresponding agent step degrades gracefully
(the design is annotated rather than failing).

## Running

```bash
npm install
npm run dev          # launch the desktop app (electron-vite dev)
npm run build        # type-check-clean production build into ./out
npm run dist         # package an installer (electron-builder)
npm run typecheck    # tsc for both node and web projects
```

The agents call a live LLM. Open **Settings**, add an Anthropic API key (and,
optionally, the deep-research / CodeXomics MCP servers for grounding) before
running a campaign.

## The UI

A left-nav workstation shell with nine views:

| View | Purpose |
| --- | --- |
| **Dashboard** | Live system state: Elo-over-compute chart, design counts, agent utilization, strategy win-rates, worker queue, activity feed. |
| **Campaigns** | Create/configure campaigns (product, host, objective, constraints, compute budget) and control runs. |
| **Designs** | Ranked, filterable table + detail drawer (interventions, mechanism, DBTL plan, constructs, reviews, Elo sparkline, lineage). |
| **Tournament** | Match history with expandable scientific-debate transcripts. |
| **Proximity map** | d3-force cluster map of the explored design space. |
| **Research overview** | Meta-review roadmap, recurring critique patterns, suggested collaborators. |
| **Expert-in-the-loop** | Refine the goal, contribute your own design, write reviews, flag designs for the wet lab. |
| **Activity log** | Filterable structured event log. |
| **Settings** | LLM provider/models, MCP servers, engine, and safety configuration. |

## Repository layout

```
src/
  shared/        domain types, host presets, IPC contract (main <-> renderer)
  main/
    engine/      Supervisor, TaskQueue, agents/, tournament/, prompts/
    llm/         provider-agnostic client (Anthropic + OpenAI-compatible)
    mcp/         deep-research & CodeXomics MCP wrappers
    memory/      persistent context-memory store
    ipc/         typed ipcMain handlers
  preload/       contextBridge typed `window.api`
  renderer/      React UI (views/, components/, store/, styles/)
```

## Notes & scope

"Full functionality" here means the **complete architecture is operational
end-to-end** — all seven roles, the async queue, the Elo tournament, persistent
memory, MCP grounding, and the full monitoring UI — adapted for strain
engineering. Prompts are faithful adaptations of the paper's strategies rather
than a line-for-line reproduction of every supplementary-note prompt. The agents
require an Anthropic key; live literature/genomic grounding additionally requires
the user's deep-research and CodeXomics servers.
