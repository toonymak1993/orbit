type DiscordMarkProps = {
  size: number
  className?: string
}

export function DiscordMark({ size, className }: DiscordMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      focusable="false"
      aria-hidden="true"
    >
      <path d="M19.54 5.34A16.3 16.3 0 0 0 15.44 4l-.5 1.02a15.2 15.2 0 0 0-5.87 0L8.56 4a16.4 16.4 0 0 0-4.1 1.35C1.87 9.2 1.17 12.96 1.52 16.67a16.5 16.5 0 0 0 5.03 2.54l1.24-1.7a12.4 12.4 0 0 1-1.94-.96l.48-.37c3.74 1.74 7.8 1.74 11.5 0l.49.37c-.62.4-1.27.72-1.95.97l1.24 1.7a16.5 16.5 0 0 0 5.03-2.54c.41-4.3-.7-8.03-3.1-11.33ZM8.5 14.5c-1.12 0-2.04-1.03-2.04-2.3 0-1.27.9-2.3 2.04-2.3 1.15 0 2.06 1.04 2.04 2.3 0 1.27-.9 2.3-2.04 2.3Zm7 0c-1.12 0-2.04-1.03-2.04-2.3 0-1.27.9-2.3 2.04-2.3 1.15 0 2.06 1.04 2.04 2.3 0 1.27-.89 2.3-2.04 2.3Z" />
    </svg>
  )
}
