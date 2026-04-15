import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"
import { useEffect } from "react"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  // Add click-to-dismiss behavior globally
  useEffect(() => {
    const handleClick = (event) => {
      const toastElement = event.target.closest('[data-sonner-toast]');
      if (toastElement) {
        const toastId = toastElement.getAttribute('data-sonner-toast');
        if (toastId) {
          toast.dismiss(toastId);
        }
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg cursor-pointer",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:text-foreground",
        },
        duration: 4000,
      }}
      {...props} />
  );
}

export { Toaster, toast }
