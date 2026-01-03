import { create } from 'zustand';

export type LanguageType = 'zh-CN' | 'en-US';

interface AppState {
  // 界面缩放
  scale: string;
  setScale: (scale: string) => void;

  // 语言
  language: LanguageType;
  setLanguage: (lang: LanguageType) => void;

  // 初始化配置（从electron加载）
  initializeFromConfig: (config: Partial<AppState>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // 默认值
  scale: '100',
  language: 'zh-CN',

  // 缩放相关方法
  setScale: (scale) => {
    set({ scale });
    // 应用缩放到HTML根元素（使用zoom属性实现整体界面缩放）
    const zoomValue = parseFloat(scale) / 100;
    document.documentElement.style.zoom = zoomValue.toString();
  },

  // 语言相关方法
  setLanguage: (language) => set({ language }),

  // 初始化配置
  initializeFromConfig: (config) => {
    set(config);
    // 应用缩放
    if (config.scale) {
      const zoomValue = parseFloat(config.scale) / 100;
      document.documentElement.style.zoom = zoomValue.toString();
    }
  },
}));
