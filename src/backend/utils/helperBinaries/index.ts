import { libraryManagerMap } from '../../storeManagers'

async function getLegendaryVersion(): Promise<string> {
  const { stdout, error, abort } = await libraryManagerMap[
    'legendary'
  ].runRunnerCommand(
    {
      subcommand: undefined,
      '--version': true
    },
    {
      abortId: 'legendary-version'
    }
  )

  if (error ?? abort) return 'invalid'

  // Sample output:
  // legendary version "0.20.33", codename "Undue Alarm"
  // 1st capturing group matches the version, 2nd the codename
  const matches = stdout.match(/"([\d.]*)".*"(.*)"$/m)
  const version = matches?.[1]
  const codename = matches?.[2]
  if (!version || !codename) return 'invalid'
  return `${version} ${codename}`
}

export { getLegendaryVersion }
