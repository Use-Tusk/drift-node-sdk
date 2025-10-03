export function shouldSample({
  samplingRate,
  isAppReady,
}: {
  samplingRate: number;
  isAppReady: boolean;
}): boolean {
  const random = Math.random();
  if (!isAppReady) {
    // We should still record if app is not ready
    return true;
  }
  return random < samplingRate;
}
