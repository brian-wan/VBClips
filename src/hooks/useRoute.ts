import { useCallback, useEffect, useState } from 'react'

export type Route = '/' | '/edit'

function readRoute(): Route {
  return window.location.pathname === '/edit' ? '/edit' : '/'
}

export function useRoute(): [Route, (route: Route, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', next)
    else window.history.pushState(null, '', next)
    setRoute(next)
  }, [])

  return [route, navigate]
}
