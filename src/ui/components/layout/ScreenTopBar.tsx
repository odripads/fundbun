import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { TopBar, type TopBarProps } from './TopBar'

/** The element above <main> where the top bar lives; AppFrame provides it. */
export const TopBarSlotContext = createContext<HTMLElement | null>(null)

/**
 * For screens whose route has `topBar: false` (e.g. chat): renders a TopBar in the shell's top-bar slot,
 * above <main>, so it sticks and spans the full width exactly like the shell's own bar.
 */
export function ScreenTopBar(props: TopBarProps) {
  const slot = useContext(TopBarSlotContext)
  return slot ? createPortal(<TopBar {...props} />, slot) : <TopBar {...props} />
}
