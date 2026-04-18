import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "../../lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * DialogContent
 *
 * LAYOUT SYSTEM:
 * ─ Mobile  (< sm): Bottom sheet from below TopNav to above BottomNav.
 *   Uses .dialog-safe-bottom CSS class (not inline style!) so the @media
 *   rule can override bottom:auto on desktop without specificity fights.
 *
 * ─ Desktop (≥ sm): Centered modal, max-h-[85vh].
 *
 * SCROLLABILITY — why it works:
 *   DialogContent itself is display:flex flex-col + overflow:hidden + max-h.
 *   That makes it the flex formatting context at the height-constrained level.
 *   Children:
 *     • DialogHeader  — shrink-0 (never squished)
 *     • .modal-body   — flex:1 min-h:0 overflow-y:auto  ← the scroll viewport
 *     • DialogFooter  — shrink-0 (always visible)
 *
 *   The critical piece is min-h:0 on .modal-body. Without it, a flex child
 *   will refuse to shrink below its content size, defeating overflow:auto.
 *
 * USAGE:
 *   <DialogContent>
 *     <DialogHeader>…</DialogHeader>
 *     <div className="modal-body px-4 py-4 space-y-4">
 *       …scrollable content…
 *     </div>
 *     <DialogFooter>…</DialogFooter>
 *   </DialogContent>
 */
const DialogContent = React.forwardRef(({ className, children, overlayClassName, hideCloseButton, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // ── Shared base ────────────────────────────────────────────────
        "fixed z-50 border bg-background shadow-2xl duration-200 p-0",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",

        // ── Flex column: DialogContent IS the flex container ───────────
        // overflow-hidden here clips content that exceeds max-h.
        // Children use shrink-0 (header/footer) and flex-1 min-h-0 (body).
        // Do NOT add a nested flex wrapper — nested h-full on a fixed
        // element resolves to 100vh, not the parent's max-h, breaking scroll.
        "flex flex-col overflow-hidden",

        // ── Mobile: full-width bottom sheet ───────────────────────────
        // .dialog-safe-bottom class (in index.css) sets bottom to
        // var(--safe-bottom) which clears the BottomNav + Create button.
        // It uses a CSS class (not inline style) so the sm @media rule
        // can properly reset it to `auto` for the desktop centered layout.
        "left-0 right-0 w-full",
        "top-14 rounded-t-2xl rounded-b-none",
        "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",

        // ── Desktop: centered modal ────────────────────────────────────
        // sm:inset-auto clears left/right/top/bottom set above.
        // sm:max-h-[85vh] caps height; flex-col + overflow-hidden above
        // make the .modal-body the scroll viewport (not the whole dialog).
        "sm:inset-auto",
        "sm:left-1/2 sm:top-1/2",
        "sm:-translate-x-1/2 sm:-translate-y-1/2",
        "sm:w-full sm:max-w-lg",
        "sm:max-h-[85vh]",
        "sm:rounded-xl",
        "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]",
        "sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",

        // CSS class for bottom positioning (overridable via @media in index.css)
        "dialog-safe-bottom",

        className
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-full p-1.5 bg-zinc-800/80 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground z-10"
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

/**
 * DialogHeader — Sticky top, blurred background, never scrolls away.
 * shrink-0 prevents it from being compressed by flex layout.
 */
const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      "sticky top-0 z-10 shrink-0",
      "flex flex-col space-y-1",
      "px-4 pt-5 pb-3 sm:px-6 sm:pt-6",
      "bg-background/95 backdrop-blur-sm",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

/**
 * DialogFooter — Sticky bottom, always visible above fold.
 * shrink-0 prevents compression. safe-area-inset padding for notch devices.
 */
const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      "sticky bottom-0 z-10 shrink-0",
      "flex flex-col-reverse sm:flex-row sm:justify-end gap-2",
      "px-4 pt-3 sm:px-6 sm:pt-4",
      "border-t border-border/50",
      "bg-background/95 backdrop-blur-sm",
      className
    )}
    style={{
      paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
    }}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
