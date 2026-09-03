// Sonner mounts its toast list in a portal outside the React tree, so it never
// inherits <html dir> or the theme class. Pass both explicitly — otherwise
// Arabic toasts render left-aligned with the close affordance on the wrong
// side, and a light-mode screen gets a dark toast.
import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";
import { useDir } from "@/lib/i18n/direction";
import { getThemeMode, type ThemeMode } from "@/lib/theme";

export function DirectionalToaster(props: React.ComponentProps<typeof Sonner>) {
  const dir = useDir();
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<{ mode?: ThemeMode }>).detail?.mode;
      setMode(next === "dark" ? "dark" : "light");
    };
    window.addEventListener("oniq:theme-changed", onChange);
    return () => window.removeEventListener("oniq:theme-changed", onChange);
  }, []);
  return <Sonner dir={dir} theme={mode} {...props} />;
}
