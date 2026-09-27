// F26: pair this device with the gateway once. Verification runs before anything is stored.
import { useState, type FormEvent } from 'react'
import { KeyRound, Link2, Loader2 } from 'lucide-react'
import { useMutation } from '../../lib/async'
import { defaultBaseUrl } from '../../lib/pairing'
import { checkUrl, lastBaseUrl, verifyPairing } from './pairing'
import './server.css'

export function PairingScreen() {
  const [url, setUrl] = useState(() => lastBaseUrl() ?? defaultBaseUrl())
  const [token, setToken] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const { state, mutate } = useMutation(verifyPairing)
  const loading = state.status === 'loading'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const baseUrl = url.trim().replace(/\/+$/, '')
    const bad = checkUrl(baseUrl)
    setUrlError(bad)
    if (bad || !token.trim()) return
    void mutate({ baseUrl, token: token.trim() })
  }

  return (
    <main className="pair">
      <form className="pair__card card stack" onSubmit={submit} noValidate>
        <div className="stack pair__head">
          <span className="label label--spot">Pair this device</span>
          <h1>Connect to your <em>Mac</em></h1>
          <p>
            Soniyo runs on your Mac. Enter its Tailscale Serve address and the owner token once;
            they are stored on this device only.
          </p>
        </div>

        <label className="field">
          <span className="label">Gateway URL</span>
          <input className="input mono" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off"
            spellCheck={false} placeholder="https://<mac>.<tailnet>.ts.net" value={url}
            onChange={e => setUrl(e.target.value)} aria-invalid={urlError ? true : undefined}
            aria-describedby="pair-url-help" required />
          <span id="pair-url-help" className={urlError ? 'field__error' : 'field__help'}>
            {urlError ?? <>On the Mac, <span className="mono">tailscale serve status</span> shows it: https://&lt;mac&gt;.&lt;tailnet&gt;.ts.net</>}
          </span>
        </label>

        <label className="field">
          <span className="label">Owner token</span>
          <input className="input mono" type="password" autoComplete="current-password" value={token}
            onChange={e => setToken(e.target.value)} required />
          <span className="field__help">From <span className="mono">SONIYO_OWNER_TOKEN</span> in the gateway's env file.</span>
        </label>

        <div className="row">
          <button type="submit" className="btn btn--brand" disabled={loading || !token.trim() || !url.trim()}>
            {loading ? <Loader2 size={16} className="spin" aria-hidden /> : <Link2 size={16} aria-hidden />}
            {loading ? 'Checking…' : 'Pair'}
          </button>
          {state.status === 'success' && <span className="badge badge--spot" role="status">Paired</span>}
        </div>

        {state.status === 'error' && (
          <div className="state state--error" role="alert">
            <div className="row">
              <KeyRound size={18} aria-hidden />
              <strong className="state__title">
                {state.error.kind === 'unauthorized' ? 'Token rejected'
                  : state.error.kind === 'unreachable' ? 'Mac unreachable' : 'Not a Soniyo gateway'}
              </strong>
            </div>
            <p>{state.error.message}</p>
          </div>
        )}
      </form>
    </main>
  )
}
