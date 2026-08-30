import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ViewerApp } from './ViewerApp.tsx'

// A ?view=<gist-id> link opens the token-free read-only shared view
function getViewGistId(): string | null {
  const id = new URLSearchParams(window.location.search).get('view')
  return id && /^[a-z0-9]{6,64}$/i.test(id) ? id : null
}

const viewGistId = getViewGistId()

createRoot(document.getElementById('root')!).render(
  <StrictMode>{viewGistId ? <ViewerApp gistId={viewGistId} /> : <App />}</StrictMode>,
)

/*
 * Register the service worker, so the app opens without a connection.
 *
 * Production only: in dev it would serve a cached bundle over the one Vite just
 * rebuilt, which is the most confusing possible failure. Deliberately after
 * render and unawaited - nothing on screen should wait on it, and a browser
 * that refuses (private mode, an unsupported one) simply gets the app online,
 * which is what it had before.
 *
 * The policy lives in public/sw.js, where the comments explain why HTML is
 * network-first and assets are not.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Nothing to do and nothing to tell the user: they have a working app.
    })
  })
}
