import type {
  Campaign,
  ExperimentalResult,
  ReviewType,
  StrainDesign,
  EvolutionStrategy
} from '@shared/domain'
import {
  CRITERIA_KEYS,
  CRITERION_LABELS,
  DEFAULT_TOURNAMENT_CONFIG,
  EVIDENCE_GRADE_LABELS,
  EVOLUTION_STRATEGY_LABELS,
  RESULT_OUTCOME_LABELS
} from '@shared/domain'
import { HOST_PRESETS } from '@shared/hosts'
import { effectiveHost, engineeringScope, formatHost, hostKey, resultScopeLabel,
  METABOLIC_TARGET_CATEGORIES, METABOLIC_TARGET_LABELS, COFACTORS, PATHWAY_EVIDENCE_LABELS } from '@shared/engineering'
import { labContextLines } from '@shared/workbench'

/**
 * Strain-engineering-adapted prompt library. Each builder mirrors a strategy
 * from the Co-Scientist paper (Methods + Supplementary), retargeted from
 * biomedical hypotheses to concrete strain-design strategies.
 *
 * Every generation/evolution prompt asks for strict JSON so the engine can
 * parse designs deterministically; the schema is described inline.
 */

export const SYSTEM_PREAMBLE = `You are an agent in Strain Co-Scientist, a multi-agent system for the rational engineering of industrial microbial strains, adapted from Google's Co-Scientist (Nature 2026).

Your domain is metabolic and strain engineering: improving titer, rate, and yield (TRY) of target products, broadening substrate range, improving tolerance/robustness, and reducing byproducts in industrial host organisms.

You reason like an expert metabolic engineer. You ground claims in pathway biochemistry, enzyme kinetics, cofactor/redox balance, thermodynamics (e.g. ΔG, MDF), regulation (transcriptional/allosteric/feedback), genetic tractability of the host, and metabolic burden. You propose concrete genetic interventions (knockouts, overexpression, knockdowns, promoter/RBS tuning, heterologous pathways, transporter and cofactor engineering, dynamic regulation, enzyme engineering) with a clear mechanism and a Design-Build-Test-Learn (DBTL) plan.

Make the proposal useful to a wet-lab metabolic engineer: separate measured findings, literature claims and predictions. Do not invent assay data or treat model confidence as experimental validation. In each DBTL plan, identify the reference strain and controls, readouts for production and growth/byproducts, confounders from culture conditions, and a decision rule tied to the stated success target. Start with a minimal discriminating experiment before combining many edits. State missing information explicitly. Interpret experimental results at their recorded scope: whole-design outcomes describe the combined strain and target feedback addresses a named hypothesis. In citation notes, describe relevance and host/condition differences; a supplied citation alone is not verification.

You honour the default criteria: alignment with the goal, plausibility (metabolic/thermodynamic feasibility), novelty, testability (genetic tractability + assay availability), host compatibility (burden/toxicity/stability), and safety/biosafety. You never propose unsafe, dual-use, or biosafety-violating work.`

function hostBlock(campaign: Campaign): string {
  const host = effectiveHost(campaign)
  const preset = HOST_PRESETS[host.preset]
  const scope = engineeringScope(campaign)
  const pathway = scope?.pathway
  const lines = [
    `Host / chassis: ${formatHost(host)}`,
    `  Lineage: ${preset.lineage}`,
    `  Strengths: ${preset.strengths}`,
    `  Engineering idioms to prefer: ${preset.toolingNotes}`
  ]
  if (host.notes) lines.push(`  Scientist host notes: ${host.notes}`)
  if (pathway) {
    lines.push(
      `Scientist-selected pathway: ${pathway.title}. ${pathway.summary}`,
      `Pathway evidence: ${PATHWAY_EVIDENCE_LABELS[pathway.evidence]} (${pathway.source} supplied). ${pathway.limitations}`,
      ...((pathway.citations ?? []).map((c) => `  Pathway reference: ${c.title} ${c.url ?? ''} ${c.note ?? ''}`))
    )
  }
  if (scope) {
    lines.push(`Use this host for target proposals. Set the JSON chassis field to exactly "${formatHost(host)}". Keep the selected pathway fixed when present.`)
  }
  return lines.join('\n')
}

export function goalContext(campaign: Campaign): string {
  const objectiveLabels: Record<string, string> = {
    'increase-titer': 'increase product titer',
    'increase-rate': 'increase production rate',
    'increase-yield': 'increase product yield',
    'broaden-substrate': 'broaden substrate range',
    'improve-tolerance': 'improve tolerance/robustness',
    'reduce-byproduct': 'reduce byproduct formation',
    'improve-stability': 'improve genetic/phenotypic stability',
    other: 'achieve the stated objective'
  }
  return `RESEARCH GOAL
Product target: ${campaign.productTarget}
Objective: ${objectiveLabels[campaign.objective] ?? campaign.objective}
${hostBlock(campaign)}

Full goal statement:
${campaign.goal}

LAB REFERENCE CONTEXT (scientist supplied):
${labContextLines(campaign.labContext).join("\n") || "Not supplied. Identify missing reference conditions; do not invent measured baselines."}
${hostKey(effectiveHost(campaign)) === hostKey(campaign.host) ? '' : 'The selected host differs from the project brief. Apply reference observations to this host only when the scientist supplied a matching strain and conditions.'}

Constraints:
- Available genetic tools: ${campaign.constraints.availableTools.join(', ') || 'standard toolkit'}
- Forbidden interventions: ${campaign.constraints.forbiddenInterventions.join(', ') || 'none specified'}
- Biosafety level: ${campaign.constraints.biosafety}
- ${campaign.constraints.onlyNovel ? 'Only propose demonstrably NOVEL designs (not already published).' : 'Novel and established designs are both acceptable; prefer novel where possible.'}
${campaign.constraints.regulatoryNotes ? `- Regulatory notes: ${campaign.constraints.regulatoryNotes}` : ''}

Desirable attributes / preferences:
${campaign.preferences || '(none specified)'}`
}

const DESIGN_JSON_SCHEMA = `Return STRICT JSON (no prose outside the JSON) shaped as:
{
  "title": "short imperative title",
  "summary": "one-paragraph summary categorising the core idea",
  "chassis": "the specific chassis this design targets",
  "interventions": [
    { "type": "knockout|overexpression|knockdown|promoter-swap|rbs-tuning|heterologous-pathway|transporter-engineering|cofactor-balancing|dynamic-regulation|enzyme-engineering|other",
      "targets": ["gene/operon names"],
      "details": "what is done and why, at the molecular level" }
  ],
  "metabolicTargets": [
    { "name": "specific bottleneck or target named in the proposal",
      "category": "${METABOLIC_TARGET_CATEGORIES.join('|')}",
      "cofactors": ["applicable species from ${COFACTORS.join(', ')}; omit when irrelevant"],
      "hypothesis": "expected causal link to the stated objective and conditions",
      "readout": "target-specific measurement, control and what would support the hypothesis",
      "limitation": "principal uncertainty or tradeoff" }
  ],
  "mechanism": "the mechanistic rationale: why this should improve the objective (flux, redox, thermodynamics, regulation)",
  "predictedEffect": "qualitative predicted effect on titer/rate/yield and the reasoning",
  "quantPrediction": { "metric": "titer|rate|yield|tolerance|other", "direction": "increase|decrease", "relativeChange": <fraction vs baseline, e.g. 0.3 for +30%>, "confidence": <0-1>, "baselineNote": "what the change is measured against" },
  "experimentalPlan": [ { "phase": "design|build|test|learn", "description": "..." } ],
  "risks": ["metabolic burden, toxicity, genetic instability, biosafety, etc."],
  "novelty": <integer 0-10>,
  "citations": [ { "title": "...", "url": "...", "note": "..." } ]
}`

// ---------------------------------------------------------------------------
// Supervisor — parse goal into a research-plan configuration
// ---------------------------------------------------------------------------

export function parseGoalPrompt(campaign: Campaign): string {
  return `${goalContext(campaign)}

TASK: Parse this research goal into a structured research-plan configuration for a strain-engineering campaign.

Return STRICT JSON:
{
  "restatedGoal": "a crisp restatement of the objective",
  "focusAreas": ["3-6 distinct engineering focus areas / strategy families to explore"],
  "derivedConstraints": ["constraints implied by the goal/host that designs must honour"],
  "evaluationRubric": "a short rubric describing what a high-quality design looks like for THIS goal",
  "recommendedChassis": "${effectiveHost(campaign).preset === 'agnostic' ? 'recommend the best chassis for this product and justify briefly' : 'leave empty string'}"
}`
}

// ---------------------------------------------------------------------------
// Generation agent
// ---------------------------------------------------------------------------

export type GenerationStrategy =
  | 'literature'
  | 'debate'
  | 'assumptions'
  | 'expansion'

export function generationPrompt(
  campaign: Campaign,
  strategy: GenerationStrategy,
  opts: {
    count: number
    literature?: string
    metaFeedback?: string
    existingTitles?: string[]
    empiricalPriors?: string
  }
): string {
  const strategyInstructions: Record<GenerationStrategy, string> = {
    literature: `Strategy — Literature-grounded exploration. Use the literature evidence below to ground your reasoning. Synthesise prior findings into NOVEL design strategies rather than restating them.`,
    debate: `Strategy — Simulated scientific debate. Internally simulate a debate between (a) a flux/pathway engineer, (b) a regulation/dynamics specialist, and (c) a fermentation/host-physiology expert. Surface the strongest design that survives their critique.`,
    assumptions: `Strategy — Iterative assumption decomposition. Identify testable intermediate assumptions that, if true, unlock a large improvement; aggregate them into a coherent design.`,
    expansion: `Strategy — Research expansion. Review the existing design titles and the meta-review feedback, then deliberately explore UNDER-EXPLORED regions of the design space (different intervention classes, different pathway nodes, different regulation logic).`
  }

  return `${goalContext(campaign)}

${strategyInstructions[strategy]}
${opts.literature ? `\nLITERATURE EVIDENCE:\n${opts.literature}\n` : ''}
${opts.metaFeedback ? `\nMETA-REVIEW FEEDBACK (apply selectively, do not overfit):\n${opts.metaFeedback}\n` : ''}
${opts.empiricalPriors ? `\nEMPIRICAL PRIORS FROM THIS CAMPAIGN'S WET-LAB RESULTS (compare controls and conditions before generalizing):\n${opts.empiricalPriors}\n` : ''}
${opts.existingTitles?.length ? `\nEXISTING DESIGN TITLES (avoid duplicating these):\n- ${opts.existingTitles.join('\n- ')}\n` : ''}

TASK: Generate ${opts.count} distinct, concrete strain-design strategies for this goal. Each must be mechanistically grounded and experimentally testable in the specified host.
Assess NADH/NADPH balance, regeneration of relevant cofactors, rate-limiting reactions, precursor supply, competing flux and compartment/transport constraints. Distribute plausible hypotheses across designs. Include only applicable targets and distinguish the intervention from the causal evidence needed to validate it. Describe growth, burden or essentiality tradeoffs when applicable.

Return STRICT JSON: an array of ${opts.count} objects, each shaped as:
${DESIGN_JSON_SCHEMA}`
}

// ---------------------------------------------------------------------------
// Reflection agent — review modes
// ---------------------------------------------------------------------------

export function reviewPrompt(
  campaign: Campaign,
  design: StrainDesign,
  type: ReviewType,
  literature?: string,
  geneEvidence?: string,
  results?: ExperimentalResult[]
): string {
  const modeInstructions: Record<ReviewType, string> = {
    initial: `INITIAL REVIEW (no external tools). Quickly assess correctness, quality, novelty, and a preliminary safety check. Aim to discard flawed, trivial, or unsafe designs. Be decisive.`,
    full: `FULL REVIEW (with literature). Evaluate correctness, quality, and novelty using the literature evidence. Scrutinise assumptions and reasoning; judge novelty against what is already known.`,
    'deep-verification': `DEEP VERIFICATION REVIEW. Decompose the design into its constituent assumptions and sub-assumptions. Independently evaluate each for correctness. Identify any invalidating element and whether it is fundamental to the design or fixable during refinement.`,
    observation: `OBSERVATION REVIEW. Determine whether this design could explain or exploit known long-tail observations/phenomena in the host's metabolism that existing designs do not. Note any such observations.`,
    simulation: `SIMULATION REVIEW. Mentally simulate the mechanism and the proposed experiment step-by-step (flux rerouting, cofactor balance, expected phenotype). Identify failure scenarios and where the design could break.`,
    tournament: `TOURNAMENT REVIEW. Using recurring issues seen across the campaign, re-review this design focusing on the most common failure modes.`,
    expert: `EXPERT REVIEW.`,
    calibration: `CALIBRATION REVIEW. Interpret each recorded result in its scope and batch conditions. Compare whole-design observations against comparable design predictions. For target-specific feedback, assess the named hypothesis and suggest a discriminating follow-up. A production phenotype alone cannot establish which intervention caused the effect. A target result alone cannot validate or refute the whole design.`
  }

  return `${goalContext(campaign)}

DESIGN UNDER REVIEW:
${designToText(design, results)}
${literature ? `\nLITERATURE EVIDENCE:\n${literature}\n` : ''}
${geneEvidence ? `\nGENOMIC EVIDENCE (CodeXomics):\n${geneEvidence}\n` : ''}

You are the Reflection agent acting as a rigorous peer reviewer.
${modeInstructions[type]}

Score each criterion 0-10 where relevant: ${Object.values(CRITERION_LABELS).join(', ')}.

Return STRICT JSON:
{
  "scores": { "alignment": n, "effectiveness": n, "plausibility": n, "novelty": n, "testability": n, "hostCompatibility": n, "safety": n },
  "verdict": "pass|revise|reject",
  "narrative": "the review, with specific, actionable critique",
  "evidence": ["concrete evidence points used (cite literature/genomic facts where used)"]
}`
}

// ---------------------------------------------------------------------------
// Ranking agent — pairwise scientific-debate match
// ---------------------------------------------------------------------------

/** One-line gloss per criterion to steer the judge's scoring. */
const CRITERION_GUIDANCE: Record<string, string> = {
  alignment: 'fit to the stated goal and constraints',
  effectiveness: 'expected magnitude of improvement in the target phenotype (titer/rate/yield) if the modification works — how impactful is the chosen target',
  plausibility: 'metabolic/thermodynamic feasibility — is the mechanism likely to work at all',
  novelty: 'how non-obvious vs. known approaches',
  testability: 'genetic tractability + assay availability in this host',
  hostCompatibility: 'metabolic burden, toxicity, genetic stability',
  safety: 'biosafety / dual-use risk'
}

export function matchPrompt(
  campaign: Campaign,
  a: StrainDesign,
  b: StrainDesign,
  mode: 'debate' | 'single-turn',
  resultsA?: ExperimentalResult[],
  resultsB?: ExperimentalResult[]
): string {
  const cfg = campaign.tournamentConfig ?? DEFAULT_TOURNAMENT_CONFIG
  const weights = cfg.weights
  // Only the dimensions the scientist actually weights are judged.
  const judged = CRITERIA_KEYS.filter((k) => (weights[k] ?? 0) > 0)
  const rubric = judged
    .map((k) => `  - ${CRITERION_LABELS[k]} (weight ${weights[k]}): ${CRITERION_GUIDANCE[k]}`)
    .join('\n')
  const scoresExample = `{ ${judged.map((k) => `"${k}": <integer 0-10>`).join(', ')} }`
  const style =
    mode === 'debate'
      ? `Conduct a concise multi-turn scientific debate (2-3 exchanges) for THIS goal and host, then score.`
      : `Do a single-turn comparison for THIS goal and host, then score.`

  return `${goalContext(campaign)}

You are the Ranking agent running a tournament match. Compare the two candidate designs for this goal and host. ${style} Avoid positional bias — judge on merits, not order.

Score BOTH designs 0-10 on each weighted criterion below. The system decides the winner deterministically from the weighted totals, so score honestly and independently — do NOT pre-pick a winner. Weights reflect this campaign's priorities (higher weight = more decisive); for strain engineering, effectiveness of the modification target typically dominates.

Weight comparable whole-design measurements above predictions. Use target results for their named hypotheses and batch conditions. Attribute a causal effect only when controls isolate the target.

WEIGHTED CRITERIA:
${rubric}

DESIGN A:
${designToText(a, resultsA)}

DESIGN B:
${designToText(b, resultsB)}

Return STRICT JSON:
{
  "scoresA": ${scoresExample},
  "scoresB": ${scoresExample},
  "transcript": "the debate / comparison reasoning",
  "rationale": "one-paragraph justification grounded in the per-criterion scores"
}`
}

// ---------------------------------------------------------------------------
// Evolution agent
// ---------------------------------------------------------------------------

export function evolutionPrompt(
  campaign: Campaign,
  parents: StrainDesign[],
  strategy: EvolutionStrategy,
  opts: {
    literature?: string
    metaFeedback?: string
    empiricalPriors?: string
    parentResults?: ExperimentalResult[]
  }
): string {
  const strategyInstructions: Record<EvolutionStrategy, string> = {
    'grounding-enhancement': `Improve the parent design by identifying its weaknesses, then strengthening it with literature-grounded detail and filling reasoning gaps.`,
    feasibility: `Improve coherence, practicality, and feasibility — rectify invalid assumptions and make the design more buildable and testable in the host.`,
    inspiration: `Create a NEW design inspired by the strongest ideas in the parent design(s), taken in a fresh direction.`,
    combination: `Combine the best aspects of the parent designs into a single, coherent new design.`,
    simplification: `Simplify the design for easier construction and testing while preserving the mechanism that drives the improvement.`,
    'out-of-box': `Move away from the parents and propose a divergent, out-of-the-box design that attacks the goal from an unconventional angle.`,
    'empirical-refinement': `Refine the design using the recorded results and controls. For each named target distinguish support, refutation, conflicting observations and untested assumptions. Propose a discriminating follow-up for uncertain or conflicting results. Attribute effects to individual edits only when the experiment isolates them.`
  }

  return `${goalContext(campaign)}

You are the Evolution agent. ${EVOLUTION_STRATEGY_LABELS[strategy]}: ${strategyInstructions[strategy]}
Produce a distinct design. Reassess the target hypotheses, their expected effects, and the readouts and limitations for the revised interventions.
${opts.literature ? `\nLITERATURE EVIDENCE:\n${opts.literature}\n` : ''}
${opts.metaFeedback ? `\nMETA-REVIEW FEEDBACK:\n${opts.metaFeedback}\n` : ''}
${opts.empiricalPriors ? `\nEMPIRICAL PRIORS FROM WET-LAB RESULTS (compare controls and conditions before generalizing):\n${opts.empiricalPriors}\n` : ''}

PARENT DESIGN(S):
${parents
  .map(
    (p, i) =>
      `--- Parent ${i + 1} ---\n${designToText(p, opts.parentResults?.filter((r) => r.designId === p.id))}`
  )
  .join('\n\n')}

Return STRICT JSON shaped as a single object:
${DESIGN_JSON_SCHEMA}`
}

// ---------------------------------------------------------------------------
// Meta-review agent
// ---------------------------------------------------------------------------

export function metaReviewPrompt(
  campaign: Campaign,
  topDesigns: StrainDesign[],
  reviewExcerpts: string[],
  matchPatterns: string[],
  calibrationNote?: string,
  resultsSummary?: string
): string {
  return `${goalContext(campaign)}

You are the Meta-review agent. Synthesise insights from the reviews, tournament debates, and any WET-LAB RESULTS of this campaign into (1) recurring critique patterns, (2) targeted feedback for each agent to apply next cycle (NO model retraining — this feedback is simply appended to prompts), and (3) a research overview that serves as an iterative DBTL roadmap for the scientist. Where experimental results exist, they are ground truth: anchor the roadmap on what has been validated/refuted, and use the calibration signal to tell the agents where their predictions are systematically off.

TOP-RANKED DESIGNS (evidence grade dominates rank; Elo breaks ties):
${topDesigns
  .map(
    (d, i) =>
      `#${i + 1} (Elo ${d.elo}${d.evidence && d.evidence !== 'predicted-only' ? `, ${EVIDENCE_GRADE_LABELS[d.evidence]}` : ''}): ${d.title} — ${d.summary}`
  )
  .join('\n')}
${resultsSummary ? `\nWET-LAB RESULTS SO FAR:\n${resultsSummary}\n` : ''}${calibrationNote ? `\nPREDICTION CALIBRATION (correct for these biases in agentFeedback):\n${calibrationNote}\n` : ''}
REVIEW EXCERPTS:
${reviewExcerpts.slice(0, 20).join('\n')}

TOURNAMENT DEBATE PATTERNS:
${matchPatterns.slice(0, 20).join('\n')}

Return STRICT JSON:
{
  "critiquePatterns": ["recurring issues seen across reviews/debates"],
  "agentFeedback": {
    "generation": "guidance to improve next generation pass",
    "reflection": "review angles that were missed and must be covered",
    "evolution": "which refinement strategies are paying off",
    "ranking": "any bias or comparison issues to correct"
  },
  "overview": {
    "summary": "executive summary of the campaign's engineering roadmap",
    "areas": [
      { "title": "research/engineering area", "justification": "why it matters", "exampleExperiments": ["concrete DBTL experiments"], "relatedDesigns": [<numbers of the TOP-RANKED DESIGNS above that belong to this area, e.g. 1, 3>] }
    ]
  },
  "suggestedExperts": [ { "name": "role/archetype (no real individuals required)", "expertise": "...", "rationale": "why consult them" } ]
}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function designToText(d: StrainDesign, results?: ExperimentalResult[]): string {
  const interventions = d.interventions
    .map((i) => `  - [${i.type}] ${i.targets.join(', ')}: ${i.details}`)
    .join('\n')
  const prediction = d.quantPrediction
    ? `\nQuantitative prediction: ${d.quantPrediction.direction} ${d.quantPrediction.metric}${
        typeof d.quantPrediction.relativeChange === 'number'
          ? ` by ~${Math.round(Math.abs(d.quantPrediction.relativeChange) * 100)}%`
          : ''
      }${typeof d.quantPrediction.confidence === 'number' ? ` (confidence ${d.quantPrediction.confidence})` : ''}`
    : ''
  const evidenceLine =
    d.evidence && d.evidence !== 'predicted-only'
      ? `\nEvidence grade: ${EVIDENCE_GRADE_LABELS[d.evidence]} (measured — outranks prediction)`
      : ''
  const measured = results?.length ? `\n${resultsToText(results, [d])}` : ''
  const targets = (d.metabolicTargets ?? []).map((target) =>
    `- ${target.name} (${METABOLIC_TARGET_LABELS[target.category]}${target.cofactors?.length ? `; ${target.cofactors.join(', ')}` : ''}): ${target.hypothesis} Readout: ${target.readout} Limitation: ${target.limitation}`
  )
  return `Title: ${d.title}
Summary: ${d.summary}
Chassis: ${d.chassis}
Pathway: ${d.engineeringScope?.pathway?.title ?? 'Unspecified'}
Metabolic target hypotheses:
${targets.join('\n') || '  (none specified)'}
Interventions:
${interventions || '  (none)'}
Mechanism: ${d.mechanism}
Predicted effect: ${d.predictedEffect}${prediction}
Risks: ${d.risks.join('; ') || 'none noted'}
Novelty (self/assessed): ${d.novelty}/10${evidenceLine}${measured}`
}

/** Render a design's wet-lab results as decisive, ground-truth evidence. */
export function resultsToText(results: ExperimentalResult[], designs: StrainDesign[] = []): string {
  const byId = new Map(designs.map((d) => [d.id, d]))
  const recorded = results.filter((r) => r.status === 'recorded')
  if (!recorded.length) return ''
  const lines = recorded.map((r) => {
    const design = byId.get(r.designId)
    const measurement = typeof r.measuredValue === 'number' && typeof r.baselineValue === 'number'
      ? ` [${r.metric ?? 'metric unspecified'}: ${r.measuredValue} vs control ${r.baselineValue} ${r.unit ?? ''}]`
      : ''
    const reps = r.replicates ? ` [n=${r.replicates}]` : ''
    return `  - ${design?.title ?? r.designId} · ${resultScopeLabel(r, design)} · ${RESULT_OUTCOME_LABELS[r.outcome]}${measurement}${reps}${r.runLabel ? ` [run: ${r.runLabel}]` : ''}${r.strainLabel ? ` [strain: ${r.strainLabel}]` : ''}${r.conditions ? ` [conditions: ${r.conditions}]` : ''}: ${r.observations}`
  })
  return `MEASURED RESULTS (interpret within the recorded scope and conditions):\n${lines.join('\n')}`
}
