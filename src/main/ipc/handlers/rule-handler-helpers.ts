type RuleDeviceLike = {
  id: string;
  deviceId: string;
};

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isValidIPv4 = (ip: string): boolean => {
  const match = ip.match(IPV4_PATTERN);
  if (!match) {
    return false;
  }

  for (let index = 1; index <= 4; index += 1) {
    const octet = parseInt(match[index], 10);
    if (octet < 0 || octet > 255) {
      return false;
    }
  }

  return true;
};

export const assertBatchUpdateIPInput = ({
  deviceId,
  ruleIds,
  newIP,
}: {
  deviceId: string;
  ruleIds: readonly string[];
  newIP: string;
}): void => {
  if (!deviceId) {
    throw new Error('deviceId is required');
  }

  if (ruleIds.length === 0) {
    throw new Error('At least one rule must be selected');
  }

  if (!isValidIPv4(newIP)) {
    throw new Error(`Invalid IP address: ${newIP}`);
  }
};

export const getRuleIdsOutsideDevice = (
  rules: readonly RuleDeviceLike[],
  deviceId: string
): string[] => rules.filter((rule) => rule.deviceId !== deviceId).map((rule) => rule.id);
