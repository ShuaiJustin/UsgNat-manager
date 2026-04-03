import React from 'react';
import { Alert, Button } from 'antd';

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('渲染错误:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <Alert
            message="页面出现错误"
            description={
              <div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {this.state.error?.message || '未知错误'}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Button type="primary" onClick={this.handleReload}>
                    刷新页面
                  </Button>
                </div>
              </div>
            }
            type="error"
            showIcon
          />
        </div>
      );
    }

    return this.props.children ?? null;
  }
}

export default ErrorBoundary;
