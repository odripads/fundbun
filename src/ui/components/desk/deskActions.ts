import { createContext, useContext } from 'react'

/** What a screen inside the desk shell can ask the shell to do. */
export interface DeskActions {
  /** open the "Add spending" sheet (the one the sidebar button opens) */
  addSpending: () => void
  /** that sheet is open: Bun answers a new purchase there, so toasts about it stay quiet */
  addingSpending: boolean
  /** open the side panel on Ask Bun and put the cursor in the message box */
  openChat: () => void
}

/** Provided by DeskShell; null in the phone layout (and when a screen is rendered on its own in a test). */
export const DeskActionsContext = createContext<DeskActions | null>(null)

export function useDeskActions(): DeskActions | null {
  return useContext(DeskActionsContext)
}
