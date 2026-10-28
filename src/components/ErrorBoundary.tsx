import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application rendering failed', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-shell">
          <div className="status-box error" role="alert">
            Something went wrong while rendering this page. Refresh to try again.
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
