import { useState } from 'react'

export function ExportButton({
  name,
  contents,
  label,
  csv = false,
  disabled = false
}: {
  name: string
  contents: () => string
  label: string
  csv?: boolean
  disabled?: boolean
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const exportFile = async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await window.api.exportFile({
        defaultName: name,
        contents: contents(),
        filters: [{ name: csv ? 'CSV' : 'Markdown', extensions: [csv ? 'csv' : 'md'] }]
      })
      if (result.ok) setMessage('Exported')
      else if (!result.cancelled) setMessage(result.message || 'Export failed')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="export-control">
      <button className="btn btn-sm" disabled={disabled || busy} onClick={() => void exportFile()}>
        {busy ? 'Exporting…' : label}
      </button>
      {message && (
        <span role="status" className="hint">
          {message}
        </span>
      )}
    </div>
  )
}
