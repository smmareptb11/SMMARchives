import { ReportCollector, exitCodeFor, windowOf } from '@smmarchives/shared'
import { describe, expect, it } from 'vitest'

import { fetchWebcamImages } from '../src/sources/ceneau/images.ts'
import { fetchWebcamPositions } from '../src/sources/ceneau/webcams.ts'
import { LizmapClient } from '../src/sources/lizmap/client.ts'
import { fetchStub, fixture, type StubbedResponse } from './support/fixtures.ts'

const CONFIG = { baseUrl: 'https://crise.test' }

function client(routes: Record<string, StubbedResponse>) {
  const fetch = fetchStub(routes)
  return {
    client: new LizmapClient({ config: CONFIG, fetch, minIntervalMs: 0 }),
    fetch,
    collector: new ReportCollector('fetch:webcams', {}),
  }
}

describe('which cameras are kept', () => {
  it('keeps the five Ceneau ones and no other', async () => {
    const options = client({ TYPENAME: { json: fixture('lizmap/webcam.json') } })
    const webcams = await fetchWebcamPositions(options)

    expect(webcams.map((webcam) => webcam.code)).toEqual(['606', '550', '215', '564', '649'])
  })

  /**
   * The cameras of the other sources have no station code, which is normal for
   * a live feed. Reporting them would bury the defects that matter.
   */
  it('skips the other sources quietly', async () => {
    const options = client({ TYPENAME: { json: fixture('lizmap/webcam.json') } })
    await fetchWebcamPositions(options)

    expect(options.collector.seal().fallbacks).toEqual([])
  })

  it('trims the strings, so a join does not fail on a newline', async () => {
    const options = client({ TYPENAME: { json: fixture('lizmap/webcam.json') } })
    const webcams = await fetchWebcamPositions(options)

    expect(webcams.find((webcam) => webcam.code === '550')).toMatchObject({
      commune: 'Villegailhenc',
      url: 'https://media.ceneau.test/consult/station/550',
    })
  })

  it('reads the point geometry as WGS84, without reprojecting', async () => {
    const options = client({ TYPENAME: { json: fixture('lizmap/webcam.json') } })
    const webcams = await fetchWebcamPositions(options)

    expect(webcams.find((webcam) => webcam.code === '215')?.position).toEqual({
      lon: 2.827846933,
      lat: 43.303131876,
    })
  })
})

describe('the images of a camera', () => {
  /**
   * Derived from the fixture rather than written down: re-recording the fixture
   * from the live source is the normal way to refresh it, and must not turn
   * into a failing test.
   */
  const PICTURE_DATES = (
    fixture('ceneau/images-215.json') as { pictures: { date: string }[] }
  ).pictures.map((picture) => picture.date)
  const OLDEST_FIRST = [...PICTURE_DATES].sort()

  const images = (
    routes: Record<string, StubbedResponse> = {},
    window?: ReturnType<typeof windowOf>,
  ) => {
    const options = client({
      getMedia: { json: fixture('ceneau/images-215.json') },
      ...routes,
    })
    return fetchWebcamImages({
      ...options,
      codes: ['215'],
      window,
      now: new Date(OLDEST_FIRST.at(-1)!),
    }).then((result) => ({ ...result, report: options.collector.seal(), ...options }))
  }

  it('normalises the ISO dates and keeps the ready-made thumbnail', async () => {
    const { images: found } = await images()

    expect(found.map((image) => image.at)).toEqual(PICTURE_DATES)
    expect(found[0]?.code).toBe('215')
    expect(found[0]?.thumbUri).toContain('/thumbs/')
  })

  it('returns links and downloads nothing: freezing the replay is not its job', async () => {
    const { fetch } = await images()

    expect(fetch.calls.some((call) => call.includes('media.ceneau.test'))).toBe(false)
  })

  it('crops to the requested window', async () => {
    const window = windowOf(OLDEST_FIRST[1]!, OLDEST_FIRST.at(-1)!)
    const { images: found } = await images({}, window)

    expect(found.map((image) => image.at)).toEqual(
      PICTURE_DATES.filter((date) => date >= OLDEST_FIRST[1]!),
    )
    expect(found.length).toBeLessThan(PICTURE_DATES.length)
  })
})

describe('a period older than Ceneau keeps its images', () => {
  it('says so explicitly rather than returning a silently empty layer', async () => {
    const options = client({ getMedia: { json: { id: '215', pictures: [] } } })
    const { images, beyondRetention } = await fetchWebcamImages({
      ...options,
      codes: ['215'],
      window: windowOf('2018-10-15T00:00:00Z', '2018-10-16T00:00:00Z'),
      now: new Date('2026-09-09T18:00:00Z'),
    })
    const report = options.collector.seal()

    expect(images).toEqual([])
    expect(beyondRetention).toBe(true)
    expect(report.fallbacks).toMatchObject([
      { subject: 'requested window', applied: 'no image can exist for this period' },
    ])
    expect(exitCodeFor(report)).toBe(0)
  })

  it('is not triggered by a window reaching into the future', async () => {
    const options = client({ getMedia: { json: fixture('ceneau/images-215.json') } })
    const { beyondRetention } = await fetchWebcamImages({
      ...options,
      codes: ['215'],
      window: windowOf('2026-09-09T00:00:00Z', '2026-09-10T00:00:00Z'),
      now: new Date('2026-09-09T18:00:00Z'),
    })

    expect(beyondRetention).toBe(false)
  })
})
