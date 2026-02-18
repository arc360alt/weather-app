import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Home from './Home.jsx'
import App  from './App.jsx'
import './app.css'

function Root() {
  const skipHome = new URLSearchParams(window.location.search).has('launch')
  const [launched, setLaunched] = useState(skipHome)
  return launched ? <App /> : <Home onLaunch={() => setLaunched(true)} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)