export const stats = {
  all: 0,
  skipp: 0,
  total: 0,
  success: 0,
  startBalance: 0,
  endBalance: 0,
  failed: 0,
  getRetry: 0,
  postRetry: 0,
  retry: 0,
  pointsSum: 0,
  solve: 0,
  highestPoints: 0,
  startTime: Date.now(),
  checkTimestamps: [],
};

export function addCheckTimestamp() {
  stats.checkTimestamps.push(Date.now());
}

export function getCPM() {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  stats.checkTimestamps = stats.checkTimestamps.filter((t) => t >= oneMinuteAgo);

  return stats.checkTimestamps.length;
}

export function getAveragePoints() {
  return stats.success > 0 ? Math.ceil(stats.pointsSum / stats.success) : 0;
}

export function getHighestPoint() {
  return stats.highestPoints;
}

export function getHitRate() {
  const processed = stats.success + stats.failed + stats.skipp;

  return processed > 0 ? `${((stats.success / processed) * 100).toFixed(3)}%` : "0.000%";
}

export function getETA() {
  const processed = stats.success + stats.failed + stats.skipp;
  const remaining = stats.total - processed;
  const cpm = getCPM();

  if (cpm <= 0 || remaining <= 0) return "N/A";

  const minutesLeft = Math.ceil(remaining / cpm);
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function getRecentHitsForRow(recentHits) {
  if (recentHits.length === 0) return [];

  return recentHits.map((hit, i) => {
    const [email, points] = hit.split(" | ");
    return [`${i + 1}.`, email, `${points} °`];
  });
}
