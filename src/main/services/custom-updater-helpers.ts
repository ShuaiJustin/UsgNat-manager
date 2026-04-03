import { URL } from 'node:url';

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
};

export const getUpdateCheckIntervalMs = (checkFrequency: string): number => {
  if (checkFrequency === 'weekly') {
    return WEEKLY_INTERVAL_MS;
  }

  return DAILY_INTERVAL_MS;
};

export const buildLatestVersionApiUrl = (serverUrl: string): string =>
  new URL('api/versions/latest', ensureTrailingSlash(serverUrl)).href;

export const resolveUpdateAssetUrl = (assetUrl: string, serverUrl: string): string => {
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
    return assetUrl;
  }

  return new URL(assetUrl, ensureTrailingSlash(serverUrl)).href;
};

export const createSetupInstallerFileName = (version: string): string =>
  `USG-NAT-Manager-Setup-${version}.exe`;

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);
