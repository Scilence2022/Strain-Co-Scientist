import type {
  Campaign,
  CampaignSnapshot,
  ExperimentalResult,
  LabContext,
  StrainDesign
} from './domain'
import { EVIDENCE_GRADE_LABELS, INTERVENTION_LABELS, RESULT_OUTCOME_LABELS } from './domain'
import { hostDisplayName } from './hosts'

export const METRIC_LABELS = {
  titer: 'Titer',
  rate: 'Production rate',
  yield: 'Yield',
  tolerance: 'Tolerance',
  other: 'Other phenotype'
}
export const METRIC_UNITS = {
  titer: 'g/L',
  rate: 'g/L/h',
  yield: 'g/g substrate',
  tolerance: '',
  other: ''
}

export function labContextLines(lab?: LabContext): string[] {
  if (!lab) return []
  return [
    `Primary metric: ${METRIC_LABELS[lab.metric]}`,
    lab.baselineValue !== undefined ? `Baseline: ${lab.baselineValue} ${lab.unit ?? ''}` : '',
    lab.targetValue !== undefined ? `Success target: ${lab.targetValue} ${lab.unit ?? ''}` : '',
    lab.baselineStrain ? `Reference strain: ${lab.baselineStrain}` : '',
    lab.carbonSource ? `Carbon source: ${lab.carbonSource}` : '',
    lab.cultureMode ? `Culture format: ${lab.cultureMode}` : '',
    lab.medium ? `Medium: ${lab.medium}` : '',
    lab.conditions ? `Culture conditions: ${lab.conditions}` : '',
    lab.assay ? `Assay: ${lab.assay}` : '',
    lab.bottlenecks ? `Known bottlenecks / previous attempts: ${lab.bottlenecks}` : ''
  ].filter(Boolean)
}

export function canShortlist(d: StrainDesign): boolean {
  return d.status === 'active' || d.status === 'flagged'
}

export function predictionLabel(d: StrainDesign): string {
  const p = d.quantPrediction
  if (!p || p.relativeChange === undefined) return 'No quantified prediction'
  return `${p.direction === 'decrease' ? '−' : '+'}${Math.round(Math.abs(p.relativeChange) * 100)}% ${METRIC_LABELS[p.metric].toLowerCase()} (predicted)`
}

/** Recorded results with opposing conclusions must remain visible to the scientist. */
export function hasConflictingResults(results: ExperimentalResult[]): boolean {
  const recorded = results.filter((r) => r.status === 'recorded')
  return (
    recorded.some((r) => r.outcome === 'refuted') &&
    recorded.some((r) => r.outcome === 'confirmed' || r.outcome === 'partial')
  )
}

export function designGaps(d: StrainDesign, results: ExperimentalResult[]): string[] {
  return [
    !canShortlist(d) ? 'Review required before shortlisting' : '',
    !d.citations.length ? 'No references supplied' : '',
    !d.experimentalPlan.some((s) => s.phase === 'test') ? 'Test plan not specified' : '',
    !d.quantPrediction?.baselineNote ? 'Prediction baseline not specified' : '',
    hasConflictingResults(results) ? 'Conflicting results — compare conditions and replicates' : ''
  ].filter(Boolean)
}

/** Export actual proposal and recorded evidence, without inventing a lab protocol. */
export function experimentBrief(snapshot: CampaignSnapshot, designs: StrainDesign[]): string {
  const c = snapshot.campaign
  const lines = [
    `# Experiment brief — ${c.title}`,
    '',
    `Host: ${hostDisplayName(c.host.preset, c.host.customName)} ${c.host.strainBackground ?? ''}`,
    `Product: ${c.productTarget}`,
    `Goal: ${c.goal}`,
    '',
    '## Reference conditions (scientist supplied)',
    ...labContextLines(c.labContext).map((s) => `- ${s}`),
    ...(c.labContext ? [] : ['Not specified.']),
    '',
    `Available tools: ${c.constraints.availableTools.join(', ') || 'Not specified'}`,
    `Excluded interventions: ${c.constraints.forbiddenInterventions.join(', ') || 'None specified'}`,
    `Preferences: ${c.preferences || 'None specified'}`,
    '',
    'Planning aid: verify strain identity, constructs, reference conditions and controls before building. Predictions and listed references require scientific review.',
    ''
  ]
  for (const d of designs) {
    const results = snapshot.results.filter((r) => r.designId === d.id)
    lines.push(
      `## ${d.title}`,
      `Design ID: ${d.id}`,
      `Chassis: ${d.chassis || 'Not specified'}`,
      `Evidence: ${EVIDENCE_GRADE_LABELS[d.evidence ?? 'predicted-only']}`,
      '',
      d.summary,
      '',
      '### Proposed changes',
      ...d.interventions.map(
        (iv) => `- ${INTERVENTION_LABELS[iv.type]} — ${iv.targets.join(', ')}: ${iv.details}`
      ),
      '',
      '### Mechanism and prediction',
      d.mechanism,
      d.predictedEffect,
      predictionLabel(d),
      `Prediction reference: ${d.quantPrediction?.baselineNote || 'Not specified'}`,
      '',
      '### Proposed DBTL plan',
      ...(d.experimentalPlan.length
        ? d.experimentalPlan.map((s) => `- ${s.phase}: ${s.description}`)
        : ['Not specified.']),
      '',
      '### Risks and evidence gaps',
      ...d.risks.map((r) => `- ${r}`),
      ...designGaps(d, results).map((r) => `- ${r}`),
      '',
      '### Reviews',
      ...snapshot.reviews
        .filter((r) => r.designId === d.id)
        .map(
          (r) =>
            `- ${r.author} (${r.verdict}): ${r.narrative}\n${r.evidence.map((e) => `  - ${e}`).join('\n')}`
        ),
      '',
      '### Recorded results',
      ...(results.length
        ? results.map(
            (r) =>
              `- [${r.status}] ${RESULT_OUTCOME_LABELS[r.outcome]}; ${r.metric ?? 'metric unspecified'}; measured ${r.measuredValue ?? '—'} vs reference ${r.baselineValue ?? '—'} ${r.unit ?? ''}; n=${r.replicates ?? 'unspecified'}; run=${r.runLabel ?? 'unspecified'}; strain=${r.strainLabel ?? 'unspecified'}; conditions=${r.conditions ?? 'unspecified'}. ${r.observations}`
          )
        : ['No measurements recorded.']),
      '',
      '### References supplied with proposal',
      ...d.citations.map(
        (r) => `- ${r.title}${r.url ? ` (${r.url})` : ''}${r.note ? ` — ${r.note}` : ''}`
      ),
      ''
    )
  }
  return lines.join('\n')
}

export function resultsCsv(snapshot: CampaignSnapshot): string {
  const cell = (value: unknown): string => {
    const raw = String(value ?? '')
    // Keep free text inert when opened in spreadsheet applications.
    const safe = /^[\s]*[=+@-]/.test(raw) && typeof value !== 'number' ? `'${raw}` : raw
    return `"${safe.replace(/"/g, '""')}"`
  }
  const header = [
    'Campaign',
    'Design ID',
    'Design',
    'Run',
    'Strain',
    'Recorded at',
    'Outcome',
    'Status',
    'Metric',
    'Measured',
    'Reference',
    'Unit',
    'Replicates',
    'Conditions',
    'Observations',
    'Author'
  ]
  const rows = snapshot.results.map((r) => [
    snapshot.campaign.title,
    r.designId,
    snapshot.designs.find((d) => d.id === r.designId)?.title ?? '',
    r.runLabel,
    r.strainLabel,
    new Date(r.createdAt).toISOString(),
    r.outcome,
    r.status,
    r.metric,
    r.measuredValue,
    r.baselineValue,
    r.unit,
    r.replicates,
    r.conditions,
    r.observations,
    r.author
  ])
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
}

export function exportName(campaign: Campaign, suffix: string): string {
  return `${campaign.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').slice(0, 70) || 'strain-project'}-${suffix}`
}
