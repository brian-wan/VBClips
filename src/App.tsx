import { useCallback, useEffect, useReducer, useRef } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import type { Clip } from './lib/clips'
import { routeOf, routeReducer, type AppState, type Route } from './lib/route'
import type { SourceMeta } from './lib/session'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'

/** A source with its picked file; the duration has already been read from the file. */
export type LoadedSource = { meta: SourceMeta; file: File }

export type EditorInput = { sources: LoadedSource[]; clips: Clip[]; playhead: number }

const reducer = routeReducer<EditorInput>
const initialState = (): AppState<EditorInput> => ({
  route: routeOf(window.location.pathname),
  input: null,
  error: null,
})

function writeRoute(route: Route, replace = false) {
  if (replace) window.history.replaceState(null, '', route)
  else window.history.pushState(null, '', route)
}

export default function App() {
  const [{ route, input, error }, dispatch] = useReducer(reducer, undefined, initialState)
  /** The open editor's save, run before Back leaves it so Home reads the latest session. */
  const saveEditor = useRef<(() => void) | null>(null)

  useEffect(() => {
    const onPop = () => {
      const next = routeOf(window.location.pathname)
      if (next !== '/edit') saveEditor.current?.()
      dispatch({ type: 'pop', route: next })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const needsRedirect = route === '/edit' && !input
  useEffect(() => {
    if (needsRedirect) {
      writeRoute('/', true)
      dispatch({ type: 'pop', route: '/' })
    }
  }, [needsRedirect])

  const open = useCallback((next: EditorInput) => {
    dispatch({ type: 'open', input: next })
    writeRoute('/edit')
  }, [])

  const exit = useCallback(() => {
    dispatch({ type: 'exit' })
    writeRoute('/')
  }, [])

  const fail = useCallback((message: string) => {
    dispatch({ type: 'fail', message })
    writeRoute('/', true)
  }, [])

  const setError = useCallback(
    (message: string | null) => dispatch({ type: 'setError', message }),
    [],
  )

  const registerSave = useCallback((save: (() => void) | null) => {
    saveEditor.current = save
  }, [])

  if (route === '/edit' && input) {
    return (
      <ErrorBoundary onHome={exit}>
        <Editor {...input} onExit={exit} onError={fail} registerSave={registerSave} />
      </ErrorBoundary>
    )
  }
  return <Home onOpen={open} error={error} onError={setError} />
}
