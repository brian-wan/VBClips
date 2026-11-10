export type Route = '/' | '/edit'

export type AppState<Input> = { route: Route; input: Input | null; error: string | null }

export type AppAction<Input> =
  | { type: 'open'; input: Input }
  | { type: 'exit' }
  | { type: 'fail'; message: string }
  | { type: 'setError'; message: string | null }
  /** The browser's Back or Forward moved to `route`. */
  | { type: 'pop'; route: Route }

export function routeOf(pathname: string): Route {
  return pathname === '/edit' ? '/edit' : '/'
}

/**
 * Which screen shows and what the editor was opened with. Leaving `/edit` by any path, the Home
 * button or the browser's Back, drops the editor's input, so a later Forward finds nothing to
 * reopen and lands on Home instead of a stale editor.
 */
export function routeReducer<Input>(
  state: AppState<Input>,
  action: AppAction<Input>,
): AppState<Input> {
  switch (action.type) {
    case 'open':
      return { route: '/edit', input: action.input, error: null }
    case 'exit':
      return { ...state, route: '/', input: null }
    case 'fail':
      return { route: '/', input: null, error: action.message }
    case 'setError':
      return { ...state, error: action.message }
    case 'pop':
      return action.route === '/edit'
        ? { ...state, route: '/edit' }
        : { ...state, route: action.route, input: null }
  }
}
