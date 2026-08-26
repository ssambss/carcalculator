import { useEffect, useState } from 'react'
import type { SyncConfig } from '../sync'

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error'

interface Props {
  config: SyncConfig | null
  status: SyncStatus
  error: string
  onConnect: (token: string) => Promise<void>
  onSyncNow: () => void
  onDisconnect: () => void
  onClose: () => void
}

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=gist&description=Car+TCO+sync'

const STATUS_LABEL: Record<SyncStatus, string> = {
  off: 'Not connected',
  syncing: 'Syncing…',
  synced: 'Synced',
  error: 'Sync error',
}

export function SyncDialog({
  config,
  status,
  error,
  onConnect,
  onSyncNow,
  onDisconnect,
  onClose,
}: Props) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [connectError, setConnectError] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function connect() {
    const t = token.trim()
    if (!t) return
    setBusy(true)
    setConnectError('')
    try {
      await onConnect(t)
      setToken('')
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-narrow">
        <div className="modal-head">
          <div className="modal-title display">Sync via GitHub</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M5 5l10 10" />
              <path d="M15 5L5 15" />
            </svg>
          </button>
        </div>

        {config ? (
          <>
            <p className="dialog-text">
              Your cars and assumptions sync to a private gist on your GitHub account —
              changes made on one device appear on the others.
            </p>
            <div className="preview-row">
              <span className="preview-main display">{STATUS_LABEL[status]}</span>
              {status === 'error' && <span className="preview-side">· {error}</span>}
            </div>
            <a
              className="dialog-text"
              href={`https://gist.github.com/${config.gistId}`}
              target="_blank"
              rel="noreferrer"
            >
              View the data gist on GitHub ↗
            </a>
            <div className="modal-footer">
              <button className="btn" onClick={onDisconnect}>
                Disconnect
              </button>
              <button className="btn btn-primary" onClick={onSyncNow}>
                Sync now
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-text">
              Syncs your cars and assumptions to a <strong>private gist</strong> on your
              GitHub account, so the data survives browser resets and follows you between
              phone and desktop.
            </p>
            <ol className="dialog-steps">
              <li>
                <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                  Create a GitHub token ↗
                </a>{' '}
                — a classic token with only the <code>gist</code> scope (the link
                preselects it).
              </li>
              <li>Paste the token below and connect. Repeat once per device.</li>
            </ol>
            <label className="field">
              <span className="field-label">GitHub token</span>
              <span className="field-input-wrap">
                <input
                  type="password"
                  value={token}
                  placeholder="ghp_…"
                  onChange={(e) => setToken(e.target.value)}
                />
              </span>
              {connectError && <span className="field-hint field-error">{connectError}</span>}
            </label>
            <p className="dialog-text dialog-muted">
              The token stays in this browser and is used only to read and write the data
              gist.
            </p>
            <div className="modal-footer">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={connect}
                disabled={busy || !token.trim()}
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
