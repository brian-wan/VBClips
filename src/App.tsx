import { useCallback, useEffect, useState } from 'react'
import { useRoute } from './hooks/useRoute'
import type { Clip } from './lib/clips'
import type { SourceMeta } from './lib/session'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'

/** A source with its picked file; the duration has already been read from the file. */
export type LoadedSource = { meta: SourceMeta; file: File }

export type EditorInput = { sources: LoadedSource[]; clips: Clip[]; playhead: number }

export default function App() {
  const [route, navigate] = useRoute()
  const [input, setInput] = useState<EditorInput | null>(null)
  const [error, setError] = useState<string | null>(null)

  const needsRedirect = route === '/edit' && !input
  useEffect(() => {
    if (needsRedirect) navigate('/', { replace: true })
  }, [needsRedirect, navigate])

  const open = useCallback(
    (next: EditorInput) => {
      setError(null)
      setInput(next)
      navigate('/edit')
    },
    [navigate],
  )

  const exit = useCallback(() => {
    setInput(null)
    navigate('/')
  }, [navigate])

  const fail = useCallback(
    (message: string) => {
      setError(message)
      setInput(null)
      navigate('/', { replace: true })
    },
    [navigate],
  )

  if (route === '/edit' && input) {
    return <Editor {...input} onExit={exit} onError={fail} />
  }
  return <Home onOpen={open} error={error} onError={setError} />
}
