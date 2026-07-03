// Heroic used this to fetch latest versions of wine/proton/gptk and
// anticheat data. UEAssistant doesn't use Wine or anticheat runtimes,
// so there's nothing to fetch here anymore. Kept as a no-op so callers
// don't need to change.
export const fetchLastestReleases = () => {
  // no-op
}
