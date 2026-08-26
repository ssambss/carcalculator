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
