import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }
  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }
  componentDidCatch(err: unknown) { console.error('App error:', err) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0b', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <h1 style={{ color: '#ef4444', marginBottom: 12 }}>Something went wrong</h1>
            <p style={{ color: '#a1a1aa', marginBottom: 16 }}>{this.state.message}</p>
            <button onClick={() => location.reload()} style={{ padding: '8px 16px', background: '#22c55e', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
