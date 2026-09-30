import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LanguageProvider } from './i18n'
import './style.css'

const root = createRoot(document.getElementById('root'))
root.render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
)
