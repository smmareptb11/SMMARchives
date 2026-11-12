import { text } from 'node:stream/consumers'

import { keyed, pipedPassword } from './password-input.ts'
import { hashPassword } from './password.ts'

/**
 * Prints the value of `ADMIN_PASSWORD_HASH` for a password read from the
 * terminal without echo, or from a pipe. Never from an argument, which the
 * shell's history would keep.
 */
async function main(): Promise<void> {
  const password = process.stdin.isTTY ? await askTwice() : pipedPassword(await text(process.stdin))
  if (password === '') throw new Error('an empty password protects nothing')
  process.stdout.write(`${await hashPassword(password)}\n`)
}

async function askTwice(): Promise<string> {
  const password = await ask('Mot de passe : ')
  if ((await ask('Confirmation : ')) !== password) throw new Error('the two entries differ')
  return password
}

function ask(prompt: string): Promise<string> {
  process.stderr.write(prompt)
  const { stdin } = process
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  stdin.resume()
  let typed = ''

  return new Promise((settle, fail) => {
    const onData = (chunk: string) => {
      for (const key of chunk) {
        const next = keyed(typed, key)
        if ('interrupted' in next) return finish(() => fail(new Error('interrupted')))
        if ('done' in next) return finish(() => settle(next.done))
        typed = next.typed
      }
    }
    const finish = (then: () => void) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
      then()
    }
    stdin.on('data', onData)
  })
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
