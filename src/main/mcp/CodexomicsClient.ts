import type { McpConnection } from './McpManager'

export interface GeneEvidence {
  query: string
  found: boolean
  detail: string
}

export interface PrimerSuggestion {
  label: string
  sequence?: string
  detail: string
}

/**
 * Wraps a useful subset of the CodeXomics MCP tools (genomic grounding +
 * construct design). CodeXomics exposes ~95 tools; we discover what is
 * available at connect time and call the best match, degrading gracefully when
 * a tool or the server is absent.
 *
 * Because tool names can vary across CodeXomics releases, calls go through
 * `callBestMatch`, which picks the first available tool from a candidate list.
 */
export class CodexomicsClient {
  constructor(private conn: McpConnection) {}

  get available(): boolean {
    return this.conn.enabled
  }

  private async callBestMatch(
    candidates: string[],
    args: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.conn.enabled) return null
    try {
      const tools = await this.conn.availableTools()
      const name = candidates.find((candidate) => tools.includes(candidate))
      return name ? await this.conn.callText(name, args) : null
    } catch {
      return null
    }
  }

  /** Check whether a gene/locus exists and fetch any annotation/summary. */
  async checkGene(gene: string): Promise<GeneEvidence | null> {
    const raw = await this.callBestMatch(
      ['search_annotations', 'search_features', 'find_gene', 'get_feature_info'],
      { query: gene, name: gene }
    )
    if (raw == null) return null
    const found = raw.trim().length > 0 && !/no\s+(results|matches|features)/i.test(raw)
    return { query: gene, found, detail: raw.slice(0, 2000) }
  }

  /** Look up pathway context for a gene or pathway id. */
  async pathwayContext(target: string): Promise<string | null> {
    return this.callBestMatch(['get_pathway', 'search_pathway', 'pathway_info'], {
      query: target,
      id: target
    })
  }

  /** Design primers around a target (used to populate construct suggestions). */
  async designPrimers(target: string): Promise<PrimerSuggestion[] | null> {
    const raw = await this.callBestMatch(['design_primers', 'primer_design', 'design_primer'], {
      target,
      gene: target,
      region: target
    })
    if (raw == null) return null
    try {
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : parsed.primers ?? []
      return list.map((p: any, i: number) => ({
        label: p.name ?? p.label ?? `Primer ${i + 1} for ${target}`,
        sequence: p.sequence ?? p.seq,
        detail: p.notes ?? (p.tm != null ? `Tm ${p.tm}` : 'CodeXomics primer')
      }))
    } catch {
      return [{ label: `Primer design for ${target}`, detail: raw.slice(0, 800) }]
    }
  }

  /** Retrieve a protein/structure context (UniProt/AlphaFold/PDB families). */
  async proteinContext(target: string): Promise<string | null> {
    return this.callBestMatch(
      ['get_uniprot', 'uniprot_lookup', 'search_alphafold', 'get_protein_structure'],
      { query: target, id: target, accession: target }
    )
  }
}
