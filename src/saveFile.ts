/** The File System Access save dialog, which TypeScript's DOM types do not include yet. */
type SaveFilePicker = (
  this: Window,
  options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  },
) => Promise<FileSystemFileHandle>

const picker = (): SaveFilePicker | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker

export const hasSavePicker = (): boolean => typeof picker() === 'function'

/**
 * Opens the system save dialog for an mp4 named `suggestedName`. Call it straight from the click,
 * before any `await`: the dialog needs the click's user activation.
 */
export function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle> {
  const show = picker()
  if (!show) return Promise.reject(new Error('This browser has no save dialog'))
  return show.call(window, {
    suggestedName,
    types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
  })
}
