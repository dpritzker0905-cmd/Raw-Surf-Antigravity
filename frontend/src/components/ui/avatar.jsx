import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "../../lib/utils"

const Avatar = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props} />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef(({ className, src, objectFit = "cover", ...props }, ref) => {
  const getFullUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('data:')) return url;
    if (url.startsWith('http')) return url;
    return `${process.env.REACT_APP_BACKEND_URL || ''}${url}`;
  };

  // objectFit: "cover" (default — fills circle, crops edges — best for headshots)
  //            "contain" (fits entire image inside circle — best for logos)
  const fitClass = objectFit === "contain" ? "object-contain" : "object-cover";

  return (
    <AvatarPrimitive.Image
      ref={ref}
      src={getFullUrl(src)}
      className={cn(`aspect-square h-full w-full ${fitClass}`, className)}
      {...props} 
    />
  );
})
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props} />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
