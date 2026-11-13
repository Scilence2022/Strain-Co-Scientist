# Strain Co-Scientist

A TypeScript **Electron desktop application** that implements the multi-agent
**Co-Scientist** architecture (Gottweis et al., *Nature* 2026), adapted from
biomedical hypothesis generation to the **rational engineering of industrial
microbial strains**. Give it a product target, a host, and constraints; a team
of specialized agents then generates, peer-reviews, debates, ranks, evolves, and
synthesizes concrete strain-design strategies — with a clean, professional
monitoring & management UI.

![Strain Co-Scientist — Research monitor (advanced view)](docs/screenshots/01_dashboard.png)

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

### Closing the loop — experimental-results feedback (DBTL "Learn")

The wet-lab path is **closed**, not just flagged. The scientist records an
`ExperimentalResult` (outcome + measured-vs-baseline value + observations)
against a whole design or one of its target hypotheses. The result flows back
through the engine within its recorded scope:

- **Authoritative evidence grade** — a design's results derive an evidence grade
  (`measured-confirmed > measured-partial > predicted-only > measured-refuted`)
  that is the top-level ranking key (`compareDesigns`): a design that *worked in
  the lab* always outranks one that merely argues well, while Elo still orders
  the unmeasured frontier. The Elo math is untouched, so the deterministic
  ladder replay is preserved — measured outcomes enter only as a pure function
  of persisted data.
- **Anchored reasoning** — measured results are injected into tournament match
  prompts with their target, controls and conditions. They drive a
  **calibration** review and **empirical refinement** in the same host and
  pathway. Whole-design outcomes drive the design evidence grade.
- **Prediction calibration** — each design commits to a structured
  `QuantPrediction`; a per-cycle `CalibrationProfile` (signed bias, MAE,
  Spearman, Brier, per-intervention-class bias) feeds back into agent prompts so
  the system measurably learns to predict better.
- **Asynchronous re-opening** — results recorded weeks later on a terminated
  campaign can drive a results-informed round when the scientist re-opens it
  (`reopenCampaign`). The cycle budget bounds automatic processing.

See `src/main/engine/learn/Calibration.ts` and the `Experiments` view.

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
npm run build        # production bundles into ./out
npm run dist         # package an installer (electron-builder)
npm run typecheck    # tsc for main, renderer, and tests
npm test             # offline regression tests (no API key required)
npm run check        # typecheck + tests + production build
```

### Reliability and development checks

Campaigns interrupted by an application restart are restored as **paused**;
queued and running tasks are marked cancelled. Resume starts a fresh worker only
after the previous worker has finished. Pause, stop, deletion, and application
shutdown cancel in-flight LLM requests and wait for workers before completing.
MCP HTTP requests have a 30-second deadline; LLM requests have a 120-second
deadline. A failed seed cycle stops with an error instead of spending the rest
of the campaign budget on repeated empty output.

Writes are serialized and use private temporary files plus atomic rename.
Failed snapshot writes remain pending for a later retry; settings take effect
only after they are saved successfully. Input validation and trusted-frame
checks protect the IPC boundary, and the renderer runs in Electron's sandbox.

The regression suite covers persistence failures, lifecycle races, renderer
snapshot/event synchronization, invalid model output, tournament draws and
replay, experimental-result disputes, calibration, and MCP reconfiguration.
GitHub Actions runs `npm run check` on pushes and pull requests. These checks use
mock providers and temporary data directories; they do not validate scientific
claims or replace a live integration test with your configured LLM/MCP servers.

Before running a campaign, open **Settings → Providers**, select a provider,
enter its credentials and enable it. **Refresh models** reads the account's
catalog using the current key and Base URL. Search the catalog, shortlist IDs
for **Model Selection**, or enter a model ID directly and set it for the high
or fast tier. **Save changes** applies the provider and routing settings.
Connection tests and model discovery work with the draft.

For **Zhongkeyu (中科云)**, use a token from its dashboard. The preset uses
`https://zhongkeyu.com/v1`. Select a chat model ID available to your token.
See the [Zhongkeyu API documentation](https://zhongkeyu.com/docs).

---

## Using Strain Co-Scientist

The default workspace follows a wet-lab decision process: **define the problem →
compare strategies → choose a small experimental batch → record results → refine**.
Engine telemetry remains available under **Research details**.

### 1. Define a research project

Open **Research projects → New project**. The three-step brief asks for:

1. **Research goal** — product or phenotype, primary improvement and a
   natural-language production problem.
2. **Experimental reference** — measurement, baseline and success target in a
   shared unit, reference strain, carbon source, culture format, medium,
   conditions, available assays and previous attempts. Unknown values can remain
   blank; the system does not invent a measured baseline.
3. **Lab constraints** — available engineering tools, excluded interventions,
   screening/build constraints and practical preferences. Choose focused,
   balanced or extended research; detailed budgets and comparison weights are
   under advanced settings.

**Save and choose host** opens **Host selection**. From **Research workbench**, use
**Edit** beside the experimental reference to add or revise structured context,
including on older projects. Pause running research before editing it. Changes
apply to future research; old design predictions and recorded batch values keep
their original context.

### 2. Select the host and compare pathways

Use **Host selection** to choose a chassis and enter the strain background.
Enter your own host or request model suggestions with rationale, limitations and
supplied references. Existing projects open with their saved host.

In **Metabolic pathways**, add routes manually or request suggestions for the
selected host. Compare estimated days to first experimental validation,
yield, and reaction count within a stated start and end boundary. Time to
validation is a planning estimate. Production rate is an experimental metric.
The comparison highlights best available values where units, estimate types and
assumptions match. Use the hypothesis filter to explore unvalidated routes and
inspect the cited evidence for reported routes.

Select a route to focus the next analysis. Switching host or route starts or
resumes research for that selection with its own cycle budget. Earlier designs
and their evidence remain available under **All project designs** and in the
experiment history. Projects without a pathway selection can still run
open-ended research.

### 3. Analyze targets and shortlist designs

Use **Settings** to configure a model provider and optional research
connections. **Start research** generates target hypotheses for the current
selection. **Metabolic targets** supports search, evidence and category filters,
and side-by-side design comparison. The categories cover NADH/NADPH balance,
cofactor regeneration (including NAD, NADP, CoA, SAM and FAD), rate-limiting
steps, precursor supply, competing flux, and organelle or compartment
engineering. Each structured target has a hypothesis, a readout and a
limitation. You can also add a target hypothesis when contributing a design
from **Scientist input**.

**Shortlist for lab** selects eligible candidates (reviewed proposals or expert
contributions) for experimental planning.
Draft, reviewing and rejected proposals cannot bypass review by being
shortlisted. A shortlist is a scientist's planning decision, not protocol approval.

Open a design from the workbench, strategies, experiment queue, roadmap or map:

- **Strategy & mechanism** — proposed changes, target hypotheses, readouts,
  uncertainties, and evidence for each target. Choose **Record target feedback**
  to open the result form for that hypothesis.
- **Evidence & reviews** — active and excluded results, conflicting conclusions,
  supplied references with relevance notes, review narratives and evidence.
- **Plan & record results** — proposed DBTL steps, construct suggestions and
  direct result entry. Model-generated sequences are labelled as suggestions.

A citation is a reference to inspect, not proof of validation. Elo is an AI
comparison score, not a success probability. Evidence labels summarize recorded
conclusions; inspect controls, replicates and culture conditions before drawing
scientific conclusions.

### 4. Plan a batch and record results

**Experiments & results** starts with the lab shortlist and highlights candidates
awaiting an active result. Choose **Record result** on a candidate, or select any
tested design in the recording form, including unsuccessful experiments.

There is no preselected successful outcome. The scientist explicitly records
confirmed, partial, refuted, inconclusive or build-failed. Add the experiment /
batch ID, tested strain ID, measured engineered and control values in a shared
unit, biological replicate count, actual conditions and observations. A paired
control value is entered explicitly rather than copied from the project's
historical baseline. Qualitative observations may omit both numerical values.
Failed saves preserve the form for retry.

Observed percentage changes are signed, without assuming an increase is always
desirable. A zero baseline is retained but has no relative percentage. Conflicting
active conclusions are highlighted. **Exclude from evidence** disputes a result;
restore it when resolved. Excluded records remain visible and in exports.

A result can address the whole design or an individual target hypothesis.
Whole-design results update the evidence grade and, for comparable phenotypes,
prediction calibration. Target feedback updates the evidence for the named
hypothesis. A combined-strain result alone cannot establish the contribution of
each edit. Resume or re-open research with the same host and pathway to bring
the observed outcomes and conditions into reviews and empirical refinement.

### 5. Take the plan to the bench

Export a **Markdown experiment brief** for the shortlist, a single design or a
comparison. It includes the research reference, constraints, proposed changes,
mechanism, predictions, DBTL plan, evidence gaps, reviews, result history and
supplied reference notes. Missing information is labelled rather than filled in
with a generated protocol.

Export **CSV result records** from Experiments & results for lab notebooks and
further analysis. Exports preserve batch/strain identity, measurement/control
values, units, replicates, actual conditions, observations, design host and
pathway, and the result scope.

Use **Scientist input** to refine the goal, contribute a design or provide an
expert review. The **Engineering roadmap** synthesizes the research; **Research
monitor**, **AI comparisons**, **Strategy map** and **Activity log** expose the
underlying computational details when needed.

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
