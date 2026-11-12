import type { Campaign, StrainDesign } from '@shared/domain'
import { inEngineeringScope } from '@shared/engineering'
import type { EngineContext } from '../context'

/**
 * Proximity agent. Computes a similarity graph over designs (cheaply and
 * deterministically, from intervention/target/text features) to support
 * de-duplication, similar-pair selection for the tournament, and a cluster map
 * for the UI. No LLM call required.
 */
export class ProximityAgent {
  constructor(private ctx: EngineContext) {}

  /** Feature set for a design: intervention types, targets, and content tokens. */
  private features(d: StrainDesign): Set<string> {
    const tokens = new Set<string>()
    for (const iv of d.interventions) {
      tokens.add(`type:${iv.type}`)
      for (const t of iv.targets) {
        for (const part of t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
          tokens.add(`tgt:${part}`)
        }
      }
    }
    for (const word of `${d.title} ${d.summary} ${d.mechanism}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((x) => x.length > 3)) {
      tokens.add(`w:${word}`)
    }
    return tokens
  }

  similarity(a: StrainDesign, b: StrainDesign): number {
    const fa = this.features(a)
    const fb = this.features(b)
    let inter = 0
    for (const t of fa) if (fb.has(t)) inter++
    const union = fa.size + fb.size - inter
    return union === 0 ? 0 : inter / union
  }

  /** Greedy threshold clustering; writes clusterId onto each design. */
  recluster(campaign: Campaign, threshold = 0.22): number {
    const designs = this.ctx.store
      .getDesigns(campaign.id)
      .filter((d) => inEngineeringScope(campaign, d) && (d.status === 'active' || d.status === 'flagged'))
    const clusters: StrainDesign[][] = []
    for (const d of designs) {
      let placed = false
      for (const cluster of clusters) {
        if (this.similarity(d, cluster[0]) >= threshold) {
          cluster.push(d)
          placed = true
          break
        }
      }
      if (!placed) clusters.push([d])
    }
    clusters.forEach((cluster, idx) => {
      for (const d of cluster) {
        if (d.clusterId !== idx) {
          d.clusterId = idx
          this.ctx.upsertDesign(d)
        }
      }
    })
    this.ctx.log(
      campaign.id,
      'proximity',
      'info',
      `Reclustered ${designs.length} designs into ${clusters.length} groups`
    )
    return clusters.length
  }

  /**
   * Pick the most-similar partner for a design (for a tournament match),
   * preferring an unmatched-but-close design.
   */
  closest(campaign: Campaign, design: StrainDesign, exclude: Set<string>): StrainDesign | null {
    const others = this.ctx.store
      .getDesigns(campaign.id)
      .filter((d) => inEngineeringScope(campaign, d) && d.id !== design.id && !exclude.has(d.id) && (d.status === 'active' || d.status === 'flagged'))
    let best: StrainDesign | null = null
    let bestSim = -1
    for (const o of others) {
      const sim = this.similarity(design, o)
      if (sim > bestSim) {
        bestSim = sim
        best = o
      }
    }
    return best
  }
}
