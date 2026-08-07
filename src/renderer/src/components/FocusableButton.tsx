import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { motion } from 'framer-motion'

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
>

type Props = NativeButtonProps & {
  variant?: 'solid' | 'ghost'
}

export const FocusableButton = forwardRef<HTMLButtonElement, Props>(function FocusableButton(
  { variant = 'solid', className = '', children, ...rest },
  ref
) {
  const base =
    variant === 'solid'
      ? 'bg-accent text-black font-semibold'
      : 'bg-white/5 text-text border border-white/10'

  return (
    <motion.button
      ref={ref}
      data-focusable
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`rounded-full px-6 py-3 text-sm transition-shadow ${base} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  )
})
