import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

/**
 * Chat scrolling that respects the reader. The page scrolls the window on phones and the device screen on
 * desktop, so everything goes through scrollIntoView (works for any scroll container) and an
 * IntersectionObserver on an end sentinel (accounts for clipping ancestors).
 *  - first open: jump to the latest message;
 *  - the user sends: bring their message to the top so the reply reads from its start;
 *  - a new reply while the user is reading history: don't move — show "Jump to latest" instead.
 */
export function useChatScroll(messageIds: string[], lastUserId: string | null, enabled = true) {
  const endRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  const [unread, setUnread] = useState(false)
  const reduced = useReducedMotion()
  const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth'
  const prevCount = useRef(messageIds.length)
  const prevUser = useRef(lastUserId)

  useEffect(() => {
    const el = endRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => {
        atBottomRef.current = entry.isIntersecting
        setAtBottom(entry.isIntersecting)
        if (entry.isIntersecting) setUnread(false)
      },
      { rootMargin: '0px 0px 140px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // after the shell's own "scroll to top on navigation" (a parent effect that runs after ours)
  const initial = useRef(enabled)
  useEffect(() => {
    if (!initial.current) return
    const id = requestAnimationFrame(() => endRef.current?.scrollIntoView?.({ block: 'end' }))
    return () => cancelAnimationFrame(id)
  }, [])

  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior })
    setUnread(false)
  }, [behavior])

  useLayoutEffect(() => {
    const count = messageIds.length
    const grew = count > prevCount.current
    const userSent = lastUserId !== null && lastUserId !== prevUser.current
    prevCount.current = count
    prevUser.current = lastUserId
    if (!grew) return
    if (userSent) {
      const el = document.getElementById(`msg-${lastUserId}`)
      if (el?.scrollIntoView) el.scrollIntoView({ block: 'start', behavior })
      else scrollToEnd()
      return
    }
    if (atBottomRef.current) {
      const newest = document.getElementById(`msg-${messageIds[count - 1]}`)
      newest?.scrollIntoView?.({ block: 'nearest', behavior })
    } else {
      setUnread(true)
    }
  }, [messageIds, lastUserId, behavior, scrollToEnd])

  return { endRef, atBottom, unread, scrollToEnd }
}
