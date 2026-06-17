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

// Named cluster palettes the scientist can switch between. Index = cluster id.
const PALETTES: Record<string, string[]> = {
  vivid: ['#1a9e91', '#2e72d2', '#6b5ec4', '#c4861a', '#2a9e58', '#c4443a', '#2496ae', '#a8599a'],
  cool: ['#2e72d2', '#2496ae', '#6b5ec4', '#1a9e91', '#3a86c4', '#5b6ed6', '#2a9e8c', '#7a5ec4'],
  warm: ['#c4443a', '#c4861a', '#d8694a', '#b0593a', '#c46a1a', '#a8492a', '#c4554a', '#d89a3a'],
  pastel: ['#6fcabf', '#86aef0', '#a99fe0', '#e0c074', '#7fd0a0', '#e89a92', '#8fd0dd', '#d3a3c8']
}
const PALETTE_KEYS = Object.keys(PALETTES)

type NodeShape = 'circle' | 'square' | 'triangle' | 'diamond'
const SHAPES: { key: NodeShape; glyph: string; label: string }[] = [
  { key: 'circle', glyph: '●', label: 'Circle' },
  { key: 'square', glyph: '■', label: 'Square' },
  { key: 'triangle', glyph: '▲', label: 'Triangle' },
  { key: 'diamond', glyph: '◆', label: 'Diamond' }
]

const FONT_MIN = 7
const FONT_MAX: number = 48
const FONT_DEFAULT = 9.5

const SIZE_MIN = 0.5
const SIZE_MAX: number = 6
const SIZE_DEFAULT = 1

// Starting swatches for the (auto) colour pickers — these match the dark theme
// defaults so the picker opens on a sensible colour rather than black.
const DEFAULT_LABEL_SWATCH = '#9bacbb'
const DEFAULT_BG_SWATCH = '#e8edf2'

const PREF = {
  shape: 'graph-shape',
  font: 'graph-font',
  palette: 'graph-palette',
  size: 'graph-size',
  labelColor: 'graph-label-color',
  bg: 'graph-bg-color'
}

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode) — prefs just won't persist */
  }
}

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
  // Display preferences (persisted to localStorage).
  const [shape, setShape] = useState<NodeShape>(
    () => readPref(PREF.shape, 'circle') as NodeShape
  )
  const [labelFont, setLabelFont] = useState<number>(() => {
    const n = Number(readPref(PREF.font, String(FONT_DEFAULT)))
    return Number.isFinite(n) ? clamp(n, FONT_MIN, FONT_MAX) : FONT_DEFAULT
  })
  const [palette, setPalette] = useState<string>(() => {
    const p = readPref(PREF.palette, 'vivid')
    return PALETTES[p] ? p : 'vivid'
  })
  const [sizeScale, setSizeScale] = useState<number>(() => {
    const n = Number(readPref(PREF.size, String(SIZE_DEFAULT)))
    return Number.isFinite(n) ? clamp(n, SIZE_MIN, SIZE_MAX) : SIZE_DEFAULT
  })
  // Empty string = "auto" (fall back to the theme's CSS variable).
  const [labelColor, setLabelColor] = useState<string>(() => readPref(PREF.labelColor, ''))
  const [bgColor, setBgColor] = useState<string>(() => readPref(PREF.bg, ''))
  const colors = PALETTES[palette] ?? PALETTES.vivid
  const pickShape = (s: NodeShape): void => {
    setShape(s)
    writePref(PREF.shape, s)
  }
  const pickFont = (n: number): void => {
    setLabelFont(n)
    writePref(PREF.font, String(n))
  }
  const pickPalette = (p: string): void => {
    setPalette(p)
    writePref(PREF.palette, p)
  }
  const pickSize = (n: number): void => {
    setSizeScale(n)
    writePref(PREF.size, String(n))
  }
  const pickLabelColor = (c: string): void => {
    setLabelColor(c)
    writePref(PREF.labelColor, c)
  }
  const pickBgColor = (c: string): void => {
    setBgColor(c)
    writePref(PREF.bg, c)
  }
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
      // Use the widest shape extent (diamond reaches ~1.3r) so no node clips.
      const r = radius(n.elo) * 1.3 * sizeScale
      minX = Math.min(minX, (n.x ?? 0) - r)
      maxX = Math.max(maxX, (n.x ?? 0) + r)
      minY = Math.min(minY, (n.y ?? 0) - r)
      maxY = Math.max(maxY, (n.y ?? 0) + r + labelFont + 6) // label sits below
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
  }, [labelFont, sizeScale])

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
      <div className="graph-toolbar">
        <div className="graph-tool">
          <span className="graph-tool-label">Shape</span>
          <div className="graph-seg" role="group" aria-label="Node shape">
            {SHAPES.map((s) => (
              <button
                key={s.key}
                className={shape === s.key ? 'on' : ''}
                title={s.label}
                aria-label={s.label}
                aria-pressed={shape === s.key}
                onClick={() => pickShape(s.key)}
              >
                {s.glyph}
              </button>
            ))}
          </div>
        </div>
        <div className="graph-tool">
          <span className="graph-tool-label">Size</span>
          <input
            className="graph-range"
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={0.1}
            value={sizeScale}
            aria-label="Node size"
            onChange={(e) => pickSize(Number(e.target.value))}
          />
        </div>
        <div className="graph-tool">
          <span className="graph-tool-label">Label</span>
          <input
            className="graph-range"
            type="range"
            min={FONT_MIN}
            max={FONT_MAX}
            step={0.5}
            value={labelFont}
            aria-label="Label font size"
            onChange={(e) => pickFont(Number(e.target.value))}
          />
          <input
            className="graph-color"
            type="color"
            value={labelColor || DEFAULT_LABEL_SWATCH}
            title="Label color"
            aria-label="Label color"
            onChange={(e) => pickLabelColor(e.target.value)}
          />
          {labelColor && (
            <button
              className="graph-reset"
              title="Reset label color"
              aria-label="Reset label color"
              onClick={() => pickLabelColor('')}
            >
              ↺
            </button>
          )}
        </div>
        <div className="graph-tool">
          <span className="graph-tool-label">Colors</span>
          <select
            className="graph-select"
            value={palette}
            aria-label="Cluster color palette"
            onChange={(e) => pickPalette(e.target.value)}
          >
            {PALETTE_KEYS.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="graph-tool">
          <span className="graph-tool-label">Background</span>
          <input
            className="graph-color"
            type="color"
            value={bgColor || DEFAULT_BG_SWATCH}
            title="Background color"
            aria-label="Background color"
            onChange={(e) => pickBgColor(e.target.value)}
          />
          {bgColor && (
            <button
              className="graph-reset"
              title="Reset background color"
              aria-label="Reset background color"
              onClick={() => pickBgColor('')}
            >
              ↺
            </button>
          )}
        </div>
      </div>
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
        style={{ cursor: 'grab', ...(bgColor ? { background: bgColor } : null) }}
      >
        <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
          {nodes.map((n) => {
            const sel = n.id === selectedId
            const color = colors[n.cluster % colors.length]
            const r = radius(n.elo) * sizeScale
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
                {renderShape(shape, r, {
                  fill: color,
                  fillOpacity: sel ? 1 : 0.85,
                  stroke: sel ? 'var(--node-stroke-selected)' : color,
                  strokeWidth: sel ? 2 : 1
                })}
                <text
                  y={shapeBottom(shape, r) + labelFont + 2}
                  textAnchor="middle"
                  fontSize={labelFont}
                  fill={labelColor || 'var(--text-muted)'}
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

interface ShapeProps {
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
}

/** Render a node marker centred at the origin for the chosen shape. */
function renderShape(shape: NodeShape, r: number, p: ShapeProps): JSX.Element {
  switch (shape) {
    case 'square':
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} {...p} />
    case 'triangle':
      return <polygon points={`0,${-r * 1.3} ${r * 1.15},${r * 0.75} ${-r * 1.15},${r * 0.75}`} {...p} />
    case 'diamond':
      return <polygon points={`0,${-r * 1.3} ${r * 1.3},0 0,${r * 1.3} ${-r * 1.3},0`} {...p} />
    default:
      return <circle r={r} {...p} />
  }
}

/** Vertical extent below the node centre, so labels clear the marker. */
function shapeBottom(shape: NodeShape, r: number): number {
  if (shape === 'diamond') return r * 1.3
  if (shape === 'triangle') return r * 0.75
  return r
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function radius(elo: number): number {
  return 7 + Math.max(0, Math.min(18, (elo - 1180) / 12))
}
