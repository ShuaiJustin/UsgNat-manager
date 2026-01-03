import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';

// 配置 i18n
i18n
  .use(initReactI18next) // 传递 i18n 实例给 react-i18next
  .init({
    resources: {
      'zh-CN': {
        translation: zhCN,
      },
      'en-US': {
        translation: enUS,
      },
    },
    lng: 'zh-CN', // 默认语言
    fallbackLng: 'zh-CN', // 回退语言
    interpolation: {
      escapeValue: false, // React 已经安全地转义了
    },
    react: {
      useSuspense: false, // 禁用 Suspense 模式
    },
  });

export default i18n;
