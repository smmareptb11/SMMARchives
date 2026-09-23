import { once } from 'node:events'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { Express } from 'express'

/**
 * Sends a path exactly as written, which `fetch` will not do.
 *
 * The URL standard resolves `.` and `..` — `%2e` included — before a request
 * leaves the client, so a traversal expressed through `fetch` never reaches
 * the server and a test written with it proves nothing. An attacker does not
 * use `fetch`.
 */
export async function rawGet(
  base: string,
  path: string,
): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(base)
  return new Promise((settle, fail) => {
    const sent = request({ host: hostname, port, path, method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.once('error', fail)
      // A response cut after its headers ends without `end`, and waiting for
      // one would hang until the test times out saying nothing.
      res.once('close', () => {
        if (res.complete) settle({ status: res.statusCode ?? 0, body })
        else fail(new Error('the response was cut short'))
      })
    })
    sent.once('error', fail)
    sent.end()
  })
}

/**
 * Runs the application on an ephemeral port for the length of one test.
 *
 * A real socket rather than an injected request, so a test exercises the same
 * path a client takes — status, headers and body alike.
 */
export async function withServer<T>(app: Express, use: (base: string) => Promise<T>): Promise<T> {
  // Bound to the address the test then calls. `listen(0)` alone takes the IPv6
  // wildcard, and a process already holding that port number over IPv4 answers
  // in our place instead of the bind failing — a foreign status code arriving
  // from nowhere, once in a hundred runs.
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  try {
    return await use(`http://127.0.0.1:${port}`)
  } finally {
    // `close` waits for connections to go away, and `fetch` keeps its socket
    // alive for seconds after the body is read. Without this, a test that
    // reads a response pays that wait before the next one starts.
    server.closeAllConnections()
    await new Promise<void>((settle, fail) => {
      server.close((error) => (error === undefined ? settle() : fail(error)))
    })
  }
}
