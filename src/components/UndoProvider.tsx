import type { ReactNode } from 'react'
import { UndoContext, useUndoController } from '../undo'

/** Above the app, so every calculator can offer an undo and the app shows it. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const undo = useUndoController()
  return <UndoContext.Provider value={undo}>{children}</UndoContext.Provider>
}
