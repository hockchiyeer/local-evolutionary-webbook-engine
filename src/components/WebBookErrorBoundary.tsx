import React from "react";

interface WebBookErrorBoundaryProps {
  children: React.ReactNode;
  key?: React.Key;
}

interface WebBookErrorBoundaryState {
  hasError: boolean;
}

export class WebBookErrorBoundary extends React.Component<WebBookErrorBoundaryProps, WebBookErrorBoundaryState> {
  declare props: WebBookErrorBoundaryProps;
  declare state: WebBookErrorBoundaryState;

  constructor(props: WebBookErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  static getDerivedStateFromError(): WebBookErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: unknown) {
    console.error("WebBook rendering failed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full rounded-[24px] border border-[#d7b2b2] bg-[#fff8f8] p-8 text-[#7a2727] shadow-[8px_8px_0px_0px_rgba(127,29,29,0.12)]">
          <h3 className="text-lg font-semibold">The WebBook could not be rendered safely.</h3>
          <p className="mt-3 text-sm leading-relaxed">
            The generated chapter structure appears malformed or incomplete. The rest of the app is still running,
            so you can launch the search again or export the current result for inspection.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
