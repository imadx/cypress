import execa from 'execa'
import path from 'path'
import os from 'os'
import Debug from 'debug'
import type { GitInfo } from '@packages/types'

const debug = Debug('cypress:server:git')

// matches <timestamp> <when> <author>
// $ git log -1 --pretty=format:%ci %ar %an <file>
// eg '2021-09-14 13:43:19 +1000 2 days ago Lachlan Miller
const GIT_LOG_REGEXP = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [-+].+?)\s(.+ago)\s(.*)/
const GIT_LOG_COMMAND = `git log -1 --pretty="format:%ci %ar %an"`

const getInfoWindows = async (absolutePaths: readonly string[]) => {
  const paths = absolutePaths.map((x) => path.resolve(x)).join(',')
  const cmd = `FOR %x in (${paths}) DO (${GIT_LOG_COMMAND} %x)`
  const result = await execa(cmd, { shell: true })

  const split = result.stdout
  .split('\r\n') // windows uses CRLF for carriage returns
  .filter((str) => !str.includes('git log')) // windows stdout contains [cmd,output]. So we remove the code containing the executed command, `git log`

  // windows returns a leading carriage return, remove it
  const [, ...stdout] = split

  if (stdout.length !== absolutePaths.length) {
    debug('stdout', stdout)
    throw Error(`Expect result array to have same length as input. Input: ${absolutePaths.length} Output: ${stdout.length}`)
  }

  return stdout
}

const getInfoPosix = async (absolutePaths: readonly string[]) => {
  const paths = absolutePaths.map((x) => path.resolve(x)).join(',')
  const cmd = `for file in {${paths}}; do echo $(${GIT_LOG_COMMAND} $file); done`

  const result = await execa(cmd, { shell: true })
  const stdout = result.stdout.split('\n')

  if (stdout.length !== absolutePaths.length) {
    debug('stdout', stdout)
    throw Error(`Expect result array to have same length as input. Input: ${absolutePaths.length} Output: ${stdout.length}`)
  }

  debug('stdout for git info', stdout)

  return stdout
}

export const getGitInfo = async (absolutePaths: readonly string[]): Promise<Map<string, GitInfo>> => {
  try {
    const stdout = await (
      os.platform() === 'win32'
        ? getInfoWindows(absolutePaths)
        : getInfoPosix(absolutePaths)
    )
    const output: Map<string, GitInfo> = new Map()

    for (let i = 0; i < absolutePaths.length; i++) {
      const file = absolutePaths[i]
      const info = stdout[i].match(GIT_LOG_REGEXP)

      if (info && info[1] && info[2] && info[3]) {
        output.set(file, {
          lastModifiedTimestamp: info[1],
          lastModifiedHumanReadable: info[2],
          author: info[3],
        })
      }
    }

    return output
  } catch (e) {
    debug('Error getting git info: %s', e.message)

    // does not have git installed,
    // file is not under source control
    // ... etc ...
    // just return an empty map
    return new Map()
  }
}
