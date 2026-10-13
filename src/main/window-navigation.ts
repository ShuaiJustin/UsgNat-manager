import { URL } from 'node:url';

export const DEV_SERVER_ORIGIN = 'http://localhost:5174';

/** 仅允许导航到应用自身页面：开发模式为 Vite 源，生产模式为打包的 index.html。 */
export const isAllowedAppNavigation = (
  targetUrl: string,
  devMode: boolean,
  appIndexUrl: string
): boolean => {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (devMode) {
    return target.origin === DEV_SERVER_ORIGIN;
  }

  const appIndex = new URL(appIndexUrl);
  return (
    target.protocol === 'file:' &&
    target.host === appIndex.host &&
    decodeURIComponent(target.pathname).toLowerCase() ===
      decodeURIComponent(appIndex.pathname).toLowerCase()
  );
};
