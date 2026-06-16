import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum
} from 'd3-force'
import type { StrainDesign } from '@shared/domain'

interface Node extends SimulationNodeDatum {
  id: string
  cluster: number
  elo: number
  title: string
  status: string
}

interface Transform {
  k: number
  x: number
  y: number
}

const CLUSTER_COLORS = [
  '#3fb6a8',
  '#5b8def',
  '#8a7fd6',
  '#d8a64a',
  '#4fb477',
  '#d4685f',
  '#5fb6c9',
  '#c77fb0'
]

// Internal SVG coordinate space; the canvas scales this to fit its container.
const W = 960
const H = 600
const MIN_K = 0.2
const MAX_K = 6

/**
 * Force-directed cluster map of the active designs. Colour = proximity cluster,
 * radius = Elo. Designs in the same cluster are linked, surfacing the structure
 * of the explored hypothesis space.
 *
 * The view auto-fits every node on load, and supports wheel-zoom, drag-to-pan
 * and explicit zoom controls so dense maps stay legible.
 */
export function ProximityGraph({
  designs,
  selectedId,
  onSelect
}: {
  designs: StrainDesign[]
  selectedId: string | null
  onSelect: (id: string) => void
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [tf, setTf] = useState<Transform>({ k: 1, x: 0, y: 0 })
  const [grabbing, setGrabbing] = useState(false)
  // Pan gesture bookkeeping; null when not dragging.
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)

  const sig = useMemo(
    () => designs.map((d) => `${d.id}:${d.clusterId ?? 0}:${d.elo}`).join('|'),
    [designs]
  )

  // Compute a transform that frames all node bounds (incl. labels) within W×H.
  const fit = useCallback((ns: Node[]): Transform => {
    if (!ns.length) return { k: 1, x: 0, y: 0 }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of ns) {
      const r = radius(n.elo)
      minX = Math.min(minX, (n.x ?? 0) - r)
      maxX = Math.max(maxX, (n.x ?? 0) + r)
      minY = Math.min(minY, (n.y ?? 0) - r)
      maxY = Math.max(maxY, (n.y ?? 0) + r + 18) // label sits below the node
    }
    const pad = 48
    const cw = Math.max(1, maxX - minX)
    const ch = Math.max(1, maxY - minY)
    const k = clamp(Math.min((W - pad * 2) / cw, (H - pad * 2) / ch), MIN_K, MAX_K)
    return {
      k,
      x: (W - k * (minX + maxX)) / 2,
      y: (H - k * (minY + maxY)) / 2
    }
  }, [])

  useEffect(() => {
    const ns: Node[] = designs.map((d) => ({
      id: d.id,
      cluster: d.clusterId ?? 0,
      elo: d.elo,
      title: d.title,
      status: d.status
    }))
    // Link designs that share a cluster (chain within each cluster).
    const byCluster = new Map<number, Node[]>()
    for (const n of ns) {
      if (!byCluster.has(n.cluster)) byCluster.set(n.cluster, [])
      byCluster.get(n.cluster)!.push(n)
    }
    const links: { source: string; target: string }[] = []
    for (const group of byCluster.values()) {
      for (let i = 1; i < group.length; i++) {
        links.push({ source: group[0].id, target: group[i].id })
      }
    }
    const sim = forceSimulation(ns)
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide<Node>().radius((n) => radius(n.elo) + 6))
      .force(
        'link',
        forceLink(links)
          .id((n: any) => n.id)
          .distance(70)
          .strength(0.25)
      )
      .stop()
    for (let i = 0; i < 240; i++) sim.tick()
    setNodes([...ns])
    setTf(fit(ns))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // Convert a client-space point to internal SVG coordinates.
  const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: W / 2, y: H / 2 }
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H
    }
  }

  // Zoom by `factor`, keeping the SVG point (cx, cy) anchored under the cursor.
  const zoomAround = (cx: number, cy: number, factor: number) => {
    setTf((t) => {
      const k = clamp(t.k * factor, MIN_K, MAX_K)
      const f = k / t.k
      return { k, x: cx - f * (cx - t.x), y: cy - f * (cy - t.y) }
    })
  }

  const zoomByButton = (factor: number) => zoomAround(W / 2, H / 2, factor)

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const p = toSvg(e.clientX, e.clientY)
    zoomAround(p.x, p.y, Math.exp(-e.deltaY * 0.0015))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // Only the background pans; ignore the right button. We deliberately do
    // NOT capture the pointer here — capturing on pointerdown would retarget
    // the trailing `click` to the <svg>, swallowing node clicks. Capture is
    // taken only once an actual drag begins (see onPointerMove).
    if (e.button !== 0) return
    drag.current = { px: e.clientX, py: e.clientY, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    if (!d.moved && Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) {
      d.moved = true
      setGrabbing(true)
      try {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported / already active */
      }
    }
    if (!d.moved) return
    const dx = ((e.clientX - d.px) / rect.width) * W
    const dy = ((e.clientY - d.py) / rect.height) * H
    d.px = e.clientX
    d.py = e.clientY
    setTf((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.moved) {
      try {
        ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
      } catch {
        /* capture may already be gone */
      }
    }
    drag.current = null
    setGrabbing(false)
  }

  if (!designs.length) {
    return <div className="empty">No active designs to map yet.</div>
  }

  return (
    <div className="graph-wrap">
      <svg
        ref={svgRef}
        className={`graph-canvas${grabbing ? ' grabbing' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: 'grab' }}
      >
        <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
          {nodes.map((n) => {
            const sel = n.id === selectedId
            const color = CLUSTER_COLORS[n.cluster % CLUSTER_COLORS.length]
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? W / 2},${n.y ?? H / 2})`}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  // Suppress the click that ends a pan drag.
                  if (drag.current?.moved) return
                  onSelect(n.id)
                }}
              >
                <circle
                  r={radius(n.elo)}
                  fill={color}
                  fillOpacity={sel ? 0.95 : 0.55}
                  stroke={sel ? 'var(--node-stroke-selected)' : color}
                  strokeWidth={sel ? 2 : 1}
                />
                <text
                  y={radius(n.elo) + 12}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="var(--text-muted)"
                >
                  {n.title.length > 24 ? `${n.title.slice(0, 23)}…` : n.title}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="graph-controls">
        <button
          className="graph-zoom-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomByButton(1.3)}
        >
          +
        </button>
        <button
          className="graph-zoom-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomByButton(1 / 1.3)}
        >
          −
        </button>
        <button
          className="graph-zoom-btn"
          title="Fit to view"
          aria-label="Fit to view"
          onClick={() => setTf(fit(nodes))}
          style={{ fontSize: 13 }}
        >
          ⤢
        </button>
        <div className="graph-zoom-level">{Math.round(tf.k * 100)}%</div>
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function radius(elo: number): number {
  return 7 + Math.max(0, Math.min(18, (elo - 1180) / 12))
}
