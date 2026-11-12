type SkeletonProps = {
  size?: number
  width?: number
  height?: number
  className?: string
}

export function Skeleton({ size, width, height, className }: SkeletonProps) {
  const blockWidth = width ?? size ?? 84
  const blockHeight = height ?? size ?? 16

  return (
    <span
      aria-hidden="true"
      className={`skeleton-loading${className ? ` ${className}` : ''}`}
      style={{ width: blockWidth, height: blockHeight }}
    />
  )
}
