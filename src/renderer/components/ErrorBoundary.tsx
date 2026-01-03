import React from 'react';
import { Alert, Button } from 'antd';

interface State {
  hasError: boolean;
  error?: any;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    // 这里记录到控制台，便于快速定位
    // 注意：生产环境可接入到日志系统
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
                  {String(this.state.error?.message || this.state.error || '未知错误')}
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
    return this.props.children as any;
  }
}

export default ErrorBoundary;
