// Sonner mounts its toast list in a portal outside the React tree, so it never
// inherits <html dir>. Pass dir explicitly — otherwise Arabic toasts render
// left-aligned with the close affordance on the wrong side.
import { Toaster as Sonner } from "sonner";
import { useDir } from "@/lib/i18n/direction";

export function DirectionalToaster(props: React.ComponentProps<typeof Sonner>) {
  const dir = useDir();
  return <Sonner dir={dir} {...props} />;
}
