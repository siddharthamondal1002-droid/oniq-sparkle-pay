/**
 * Blast radius limiter for globally-mounted widgets.
 *
 * Anything rendered in AppShell (banners, prompts, watchers) sits above every
 * authenticated route, so a single throw inside one of them takes the whole
 * app to the root error boundary. That trade is never worth it for a prompt or
 * a banner: if it fails, it should disappear, not break the app.
 *
 * The error is still reported (console + Lovable error capture) with the mount
 * name, so a device-specific failure is diagnosable instead of silent.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

type Props = { name: string; children: ReactNode; fallback?: ReactNode };
type State = { failed: boolean };

export class SafeMount extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[SafeMount:${this.props.name}]`, error, info.componentStack);
    reportLovableError(error, {
      boundary: "safe_mount",
      mount: this.props.name,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
