import { describe, expect, it } from 'vitest'
import { routeOf, routeReducer, type AppState } from './route'

const home: AppState<string> = { route: '/', input: null, error: null }
const editing: AppState<string> = { route: '/edit', input: 'game', error: null }

describe('routeReducer', () => {
  it('opens the editor with its input and clears an earlier error', () => {
    expect(routeReducer({ ...home, error: 'bad file' }, { type: 'open', input: 'game' })).toEqual(
      editing,
    )
  })

  it('treats Back out of the editor like the Home button', () => {
    const back = routeReducer(editing, { type: 'pop', route: '/' })
    expect(back).toEqual(routeReducer(editing, { type: 'exit' }))
    expect(back).toEqual(home)
  })

  it('leaves Forward to the editor with no input, so the app redirects home', () => {
    const back = routeReducer(editing, { type: 'pop', route: '/' })
    expect(routeReducer(back, { type: 'pop', route: '/edit' })).toEqual({
      route: '/edit',
      input: null,
      error: null,
    })
  })

  it('goes home with the message when the editor fails', () => {
    expect(routeReducer(editing, { type: 'fail', message: 'Cannot play' })).toEqual({
      route: '/',
      input: null,
      error: 'Cannot play',
    })
  })

  it('reads only /edit as the editor', () => {
    expect(routeOf('/edit')).toBe('/edit')
    expect(routeOf('/')).toBe('/')
    expect(routeOf('/elsewhere')).toBe('/')
  })
})
