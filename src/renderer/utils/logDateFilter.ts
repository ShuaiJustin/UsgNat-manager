import dayjs, { type Dayjs } from 'dayjs';

export const matchesLogDateRange = (
  createdAt: string | Date,
  range: readonly [Dayjs | null, Dayjs | null]
): boolean => {
  const [startDate, endDate] = range;
  if (!startDate || !endDate) {
    return true;
  }

  const timestamp = dayjs(createdAt).valueOf();
  return (
    timestamp >= startDate.startOf('day').valueOf() && timestamp <= endDate.endOf('day').valueOf()
  );
};
