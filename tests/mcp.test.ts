import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from './fixtures'

const state = vi.hoisted(() => ({ clients: [] as any[], gate: null as Promise<void> | null }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: class {
  close = vi.fn(async () => {})
  connect = vi.fn(async () => { if (state.gate) await state.gate })
  listTools = vi.fn(async () => ({ tools: [{ name: 'find_gene' }, { name: 'primer_design' }] }))
  callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'Found' }] }))
  constructor() { state.clients.push(this) }
} }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {} }))
import { McpConnection } from '../src/main/mcp/McpManager'
import { CodexomicsClient } from '../src/main/mcp/CodexomicsClient'

beforeEach(() => { state.clients.length = 0; state.gate = null })
describe('MCP connection lifecycle', () => {
  it('discovers a supported fallback before the first tool call', async () => {
    const conn = new McpConnection('Test', { enabled: true, url: 'http://localhost:3002' })
    expect(await new CodexomicsClient(conn).checkGene('test')).toMatchObject({ found: true })
    expect(state.clients[0].callTool.mock.calls[0][0].name).toBe('find_gene')
    await conn.close()
  })

  it('invalidates all callers sharing a connection when settings change', async () => {
    const gate = deferred<void>()
    state.gate = gate.promise
    const conn = new McpConnection('Test', { enabled: true, url: 'http://localhost:3002' })
    const first = conn.callText('find_gene', {})
    const second = conn.callText('find_gene', {})
    conn.updateConfig({ enabled: false, url: 'http://localhost:3002' })
    gate.resolve()
    const results = await Promise.allSettled([first, second])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(state.clients[0].callTool).not.toHaveBeenCalled()
    expect(state.clients[0].close).toHaveBeenCalledOnce()
    await conn.close()
  })

  it('preserves primer notes instead of replacing them with an undefined Tm', async () => {
    const conn = new McpConnection('Test', { enabled: true, url: 'http://localhost:3002' })
    await conn.availableTools()
    state.clients[0].callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: '[{"name":"Test primer","notes":"Test notes"}]' }] })
    expect(await new CodexomicsClient(conn).designPrimers('test')).toEqual([{ label: 'Test primer', sequence: undefined, detail: 'Test notes' }])
    await conn.close()
  })
})
