import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
// Per-feature stylesheets. One file per owner so parallel work never collides in styles.css.
import './styles/compare.css'
import './styles/research.css'
import './styles/docs.css'

createRoot(document.getElementById('root')).render(<App />)
