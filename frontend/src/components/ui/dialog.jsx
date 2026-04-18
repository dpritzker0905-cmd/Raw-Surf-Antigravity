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
 * ─ Mobile  (< sm): Bottom sheet. Anchors top:56px, bottom:var(--safe-bottom).
 *   --safe-bottom is set by BottomNav's ResizeObserver (see index.css + BottomNav.js).
 *   This guarantees the modal footer always clears the BottomNav + Create button.
 *
 * ─ Desktop (≥ sm): Centered modal. sm:max-h-[90vh] with sticky header/footer
 *   and a flex-1 scrollable body — no content ever cut off.
 *
 * USAGE PATTERN inside DialogContent:
 *   <DialogHeader>…</DialogHeader>          ← sticky top
 *   <div className="modal-body px-4 py-4">  ← flex-1, scrolls
 *     …content…
 *   </div>
 *   <DialogFooter>…</DialogFooter>          ← sticky bottom
 */
const DialogContent = React.forwardRef(({ className, children, overlayClassName, hideCloseButton, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // ── Shared ───────────────────────────────────────────────────
        "fixed z-50 border bg-background shadow-2xl duration-200 p-0 overflow-hidden",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",

        // ── Mobile: full-width bottom sheet ──────────────────────────
        // top:56px = below TopNav. bottom uses --safe-bottom (dynamic)
        // so footer never hides under the BottomNav / Create button.
        "left-0 right-0 w-full",
        "top-14 rounded-t-2xl rounded-b-none",
        "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",

        // ── Desktop: centered modal ───────────────────────────────────
        "sm:inset-auto",
        "sm:left-1/2 sm:top-1/2",
        "sm:-translate-x-1/2 sm:-translate-y-1/2",
        "sm:w-full sm:max-w-lg",
        "sm:max-h-[90vh]",
        "sm:rounded-xl",
        "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%]",
        "sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",

        className
      )}
      style={{
        // Mobile: bottom edge sits above the BottomNav + Create button protrusion
        bottom: 'var(--safe-bottom, 84px)',
      }}
      {...props}
    >
      {/*
        Inner flex column — header/body/footer each take their slice.
        `overflow:hidden` on this div + `overflow-y:auto` on .modal-body
        is what keeps header & footer pinned while only the content scrolls.
      */}
      <div className="flex flex-col h-full max-h-full overflow-hidden">
        {children}
      </div>
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
 * DialogHeader — Sticky top, blurred background, never scrolls out of view.
 */
const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      // Sticky so it always shows at the top even when body scrolls
      "sticky top-0 z-10",
      "flex flex-col space-y-1 shrink-0",
      "px-4 pt-5 pb-3 sm:px-6 sm:pt-6",
      // Subtle blur for a premium feel when content scrolls under it
      "bg-background/95 backdrop-blur-sm",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

/**
 * DialogFooter — Sticky bottom, blurred background, CTA buttons always visible.
 * Adding a top border and enough padding to clear the safe area on notch devices.
 */
const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      // Sticky so footer buttons always show regardless of scroll position
      "sticky bottom-0 z-10",
      "flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0",
      "px-4 pt-3 sm:px-6 sm:pt-4",
      "border-t border-border/50",
      "bg-background/95 backdrop-blur-sm",
      className
    )}
    style={{
      // Extra padding for devices with rounded corners / home indicators
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
