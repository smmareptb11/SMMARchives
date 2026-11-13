import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'

import { App } from './App.tsx'
import './styles/index.css'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html holds no #root to mount on')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
