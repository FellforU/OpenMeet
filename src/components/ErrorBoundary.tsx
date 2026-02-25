import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import i18n from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const t = i18n.t.bind(i18n);
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-8">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">{t("error.title")}</h2>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {this.state.error?.message}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("error.tryAgain")}
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("error.reloadApp")}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
