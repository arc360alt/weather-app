import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import Home      from './Home.jsx'
import App       from './App.jsx'
import MobileNav from './components/MobileNav.jsx'
import './app.css'
import './home.css'

function Root() {
  const getRoute = () => {
    const path = window.location.pathname
    if (path === '/radar' || path === '/radar/') return 'radar'
    return 'home'
  }

  const [route, setRoute] = useState(getRoute)

  useEffect(() => {
    const onPop = () => setRoute(getRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const goTo = (path) => {
    window.history.pushState({}, '', path)
    setRoute(getRoute())
  }

  const handleNavigate = (dest) => {
    if (dest === 'home')  goTo('/')
    if (dest === 'radar') goTo('/radar')
  }

  return (
    <>
      {route === 'radar'
        ? <App onBack={() => goTo('/')} />
        : <Home onOpenRadar={() => goTo('/radar')} />
      }
      <MobileNav launched={route === 'radar'} onNavigate={handleNavigate} />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)