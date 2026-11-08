'use client'

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Building2, MapPin, TimerReset } from 'lucide-react'

type PointerPosition = {
  clientX: number
  clientY: number
}

const parallaxProperties = [
  '--phone-x', '--phone-y', '--phone-tilt-x', '--phone-tilt-y',
  '--mark-x', '--mark-y',
  '--letter-left-x', '--letter-left-y', '--letter-center-x', '--letter-center-y', '--letter-right-x', '--letter-right-y',
  '--card-a-x', '--card-a-y', '--card-b-x', '--card-b-y', '--scroll-mark-y', '--scroll-card-a', '--scroll-card-b',
  '--wheel-mark-y', '--wheel-card-a-y', '--wheel-card-b-y',
]

function onMediaQueryChange(query: MediaQueryList, listener: (event: MediaQueryListEvent) => void) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }

  // Older Safari exposes the MediaQueryList listener methods instead.
  query.addListener(listener)
  return () => query.removeListener(listener)
}

export function LandingHeroVisual() {
  const stageRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<PointerPosition | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const clearParallax = () => {
      if (!preference.matches) return
      pointerRef.current = null
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      const stage = stageRef.current
      parallaxProperties.forEach(property => stage?.style.removeProperty(property))
    }
    return onMediaQueryChange(preference, clearParallax)
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const scrollProperties = ['--scroll-mark-y', '--scroll-card-a', '--scroll-card-b']
    let frame: number | null = null
    let scrollEndTimer: number | null = null
    let wheelFallbackTimer: number | null = null
    let wheelEndTimer: number | null = null
    let pendingWheelDelta = 0
    let lastScrollAt = Number.NEGATIVE_INFINITY
    let wheelOffset = 0

    const clearWheelFallback = () => {
      wheelOffset = 0
      if (!stage) return
      stage.style.removeProperty('--wheel-mark-y')
      stage.style.removeProperty('--wheel-card-a-y')
      stage.style.removeProperty('--wheel-card-b-y')
      delete stage.dataset.wheelActive
      if (wheelEndTimer !== null) window.clearTimeout(wheelEndTimer)
      wheelEndTimer = null
    }

    const updateScrollParallax = () => {
      frame = null
      if (!stage) return
      if (reducedMotion.matches) {
        scrollProperties.forEach(property => stage.style.removeProperty(property))
        return
      }

      const bounds = stage.getBoundingClientRect()
      const progress = Math.max(0, Math.min(1, (window.innerHeight - bounds.top) / (window.innerHeight + bounds.height)))
      const offset = (progress - 0.5) * 120
      stage.style.setProperty('--scroll-mark-y', `${offset}px`)
      stage.style.setProperty('--scroll-card-a', `${offset * -1.25}px`)
      stage.style.setProperty('--scroll-card-b', `${offset * -0.9}px`)
    }

    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateScrollParallax)
    }

    const handleScroll = () => {
      lastScrollAt = performance.now()
      pendingWheelDelta = 0
      if (wheelFallbackTimer !== null) window.clearTimeout(wheelFallbackTimer)
      wheelFallbackTimer = null
      clearWheelFallback()
      if (stage && !reducedMotion.matches) {
        stage.dataset.scrollActive = 'true'
        if (scrollEndTimer !== null) window.clearTimeout(scrollEndTimer)
        scrollEndTimer = window.setTimeout(() => {
          delete stage.dataset.scrollActive
          scrollEndTimer = null
        }, 140)
      }
      scheduleUpdate()
    }

    const handleWheel = (event: WheelEvent) => {
      if (reducedMotion.matches || event.deltaY === 0) return
      const eventTime = performance.now()
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1)
      pendingWheelDelta += delta

      if (wheelFallbackTimer !== null) window.clearTimeout(wheelFallbackTimer)
      wheelFallbackTimer = window.setTimeout(() => {
        wheelFallbackTimer = null
        // Use wheel input only when it did not produce real scrolling (for example,
        // a desktop hero that already fits inside the viewport).
        const accumulatedDelta = pendingWheelDelta
        pendingWheelDelta = 0
        if (!stage || reducedMotion.matches || lastScrollAt >= eventTime) return
        wheelOffset = Math.max(-60, Math.min(60, wheelOffset + accumulatedDelta * 0.16))
        stage.style.setProperty('--wheel-mark-y', `${wheelOffset}px`)
        stage.style.setProperty('--wheel-card-a-y', `${wheelOffset * -1.25}px`)
        stage.style.setProperty('--wheel-card-b-y', `${wheelOffset * -0.9}px`)
        stage.dataset.wheelActive = 'true'
        if (wheelEndTimer !== null) window.clearTimeout(wheelEndTimer)
        wheelEndTimer = window.setTimeout(() => {
          if (stage) delete stage.dataset.wheelActive
          wheelEndTimer = null
        }, 220)
      }, 0)
    }

    const resetForPreference = () => {
      if (reducedMotion.matches && stage) {
        pendingWheelDelta = 0
        if (wheelFallbackTimer !== null) window.clearTimeout(wheelFallbackTimer)
        wheelFallbackTimer = null
        delete stage.dataset.scrollActive
        clearWheelFallback()
        if (scrollEndTimer !== null) window.clearTimeout(scrollEndTimer)
        scrollEndTimer = null
      }
      scheduleUpdate()
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    document.addEventListener('wheel', handleWheel, { capture: true, passive: true })
    // WebKit can report native touch scrolling through TouchEvents and the visual viewport.
    // Passive listeners preserve the browser's own vertical-pan behavior.
    document.addEventListener('touchmove', handleScroll, { capture: true, passive: true })
    window.visualViewport?.addEventListener('scroll', handleScroll, { passive: true })
    window.visualViewport?.addEventListener('resize', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })
    const unsubscribePreference = onMediaQueryChange(reducedMotion, resetForPreference)
    scheduleUpdate()

    return () => {
      window.removeEventListener('scroll', handleScroll)
      document.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('wheel', handleWheel, true)
      document.removeEventListener('touchmove', handleScroll, true)
      window.visualViewport?.removeEventListener('scroll', handleScroll)
      window.visualViewport?.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      unsubscribePreference()
      if (frame !== null) window.cancelAnimationFrame(frame)
      if (scrollEndTimer !== null) window.clearTimeout(scrollEndTimer)
      if (wheelFallbackTimer !== null) window.clearTimeout(wheelFallbackTimer)
      if (wheelEndTimer !== null) window.clearTimeout(wheelEndTimer)
    }
  }, [])

  function queueParallax(clientX: number, clientY: number) {
    const stage = stageRef.current
    if (!stage) return
    pointerRef.current = { clientX, clientY }

    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const current = pointerRef.current
      const target = stageRef.current
      if (!current || !target) return

      const bounds = target.getBoundingClientRect()
      const px = Math.max(-1, Math.min(1, ((current.clientX - bounds.left) / bounds.width - 0.5) * 2))
      const py = Math.max(-1, Math.min(1, ((current.clientY - bounds.top) / bounds.height - 0.5) * 2))
      const set = (property: string, value: string) => target.style.setProperty(property, value)
      set('--phone-x', `${px * 7}px`)
      set('--phone-y', `${py * 7}px`)
      set('--phone-tilt-x', `${-py * 4}deg`)
      set('--phone-tilt-y', `${px * 5}deg`)
      set('--mark-x', `${-px * 15}px`)
      set('--mark-y', `${-py * 16}px`)
      set('--letter-left-x', `${-px * 11}px`)
      set('--letter-left-y', `${-py * 12}px`)
      set('--letter-center-x', `${-px * 6}px`)
      set('--letter-center-y', `${-py * 8}px`)
      set('--letter-right-x', `${-px * 13}px`)
      set('--letter-right-y', `${-py * 10}px`)
      set('--card-a-x', `${px * 9}px`)
      set('--card-a-y', `${py * 8}px`)
      set('--card-b-x', `${px * -8}px`)
      set('--card-b-y', `${py * -7}px`)
    })
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || window.matchMedia('(max-width: 650px), (prefers-reduced-motion: reduce)').matches) return
    queueParallax(event.clientX, event.clientY)
  }

  function resetParallax() {
    pointerRef.current = null
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const stage = stageRef.current
    parallaxProperties.forEach(property => stage?.style.removeProperty(property))
  }

  return (
    <div
      ref={stageRef}
      className="hero-visual"
      onPointerMove={handlePointerMove}
      onPointerLeave={event => { if (event.pointerType === 'mouse') resetParallax() }}
    >
      <div className="hero-glass-emora" aria-hidden="true">
        <span className="hero-glass-e hero-glass-e-left">E</span>
        <span className="hero-glass-e hero-glass-e-center">E</span>
        <span className="hero-glass-e hero-glass-e-right">E</span>
      </div>
      <div className="phone-mockup">
        <div className="phone-top"><span>9:41</span><span className="phone-dynamic-island" aria-hidden="true"/><span>● ● ●</span></div>
        <div className="phone-content">
          <div className="avatar"> A </div>
          <h3>Good morning, Ali</h3>
          <p>You are within the Zayed branch area</p>
          <div className="attendance-ring"><strong>12:00</strong><span>Arrival Time</span></div>
          <button type="button">Sign in</button>
          <div className="mini-grid">
            <div><Building2 size={20}/><span>branch</span></div>
            <div><TimerReset size={20}/><span>shift</span></div>
            <div><MapPin size={20}/><span>location</span></div>
          </div>
        </div>
      </div>
      <div className="floating-card card-a"><span>Those present today</span><strong>287</strong><small>+12% عن أمس</small></div>
      <div className="floating-card card-b"><span>Accurate location</span><strong>8 m</strong><small>داخل النطاق</small></div>
    </div>
  )
}
