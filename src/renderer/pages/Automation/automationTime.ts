import dayjs, { type Dayjs } from 'dayjs';

export const parseScheduledTime = (value: unknown): Dayjs | null => {
  if (!value) {
    return null;
  }

  if (dayjs.isDayjs(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    const matchedTime = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmedValue);

    if (matchedTime) {
      const [, hour, minute] = matchedTime;
      return dayjs().hour(Number(hour)).minute(Number(minute)).second(0).millisecond(0);
    }

    const parsedValue = dayjs(trimmedValue);
    return parsedValue.isValid() ? parsedValue : null;
  }

  return null;
};

export const formatScheduledTime = (value: unknown): string | undefined => {
  const parsedValue = parseScheduledTime(value);
  return parsedValue ? parsedValue.format('HH:mm') : undefined;
};
