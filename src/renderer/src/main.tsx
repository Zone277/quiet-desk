import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import type { WindowKind } from '../../shared/ipc-contract'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root is missing')

function readWindowKind(): WindowKind {
  const value = document.documentElement.dataset.windowKind
  if (value === 'widget' || value === 'capture' || value === 'library') {
    return value
  }
  throw new Error('Renderer entry is missing a valid data-window-kind')
}

const windowKind = readWindowKind()

createRoot(root).render(
  <StrictMode>
    <App windowKind={windowKind} />
  </StrictMode>
)
