import { describe, expect, it } from 'vitest'

import { historyAt, inkOn } from '../src/events/history.ts'
import { aCrossing, aReport, aStation, aThreshold, at } from './support/content.ts'

const stations = [aStation(84, 'Trèbes')]
const crossing = aCrossing({
  id: 'c',
  sourceId: 84,
  title: 'Trèbes — Alerte',
  color: '#ffa500',
  from: '2019-10-22T06:00:00.000Z',
  to: '2019-10-22T12:00:00.000Z',
  crossing: aThreshold({ label: 'Alerte', natureIsFallback: true }),
})
const report = aReport({
  id: 'r',
  from: '2019-10-22T08:00:00.000Z',
  description: 'Eau sur la chaussée.',
  media: ['events/r/a.jpg'],
})

describe('the history at an instant', () => {
  /** What had happened by then, and nothing yet to come. */
  it('holds the events begun by the instant read, oldest first', () => {
    expect(
      historyAt([report, crossing], stations, at('2019-10-22T07:00:00.000Z')).map((one) => one.id),
    ).toEqual(['c'])
    expect(
      historyAt([report, crossing], stations, at('2019-10-22T09:00:00.000Z')).map((one) => one.id),
    ).toEqual(['c', 'r'])
  })

  it('holds nothing before the first event', () => {
    expect(historyAt([crossing], stations, at('2019-10-22T05:00:00.000Z'))).toEqual([])
  })

  it('says a crossing by its threshold, in its colour, and by its station', () => {
    const [entry] = historyAt([crossing], stations, at('2019-10-22T07:00:00.000Z'))

    expect(entry).toMatchObject({
      kind: 'crossing',
      badge: { label: 'Alerte', colour: '#ffa500' },
      who: 'Trèbes',
      sourceId: 84,
      assumed: true,
    })
  })

  /** A report with no place is in the history alone: the map has nowhere to draw it. */
  it('says a report by who wrote it, its first photo, and that it has no place', () => {
    const [entry] = historyAt([report], stations, at('2019-10-22T09:00:00.000Z'))

    expect(entry).toMatchObject({
      kind: 'report',
      badge: { label: 'Photo' },
      description: 'Eau sur la chaussée.',
      who: 'Signalé par Agent SMMAR · sans lieu',
      photo: 'events/r/a.jpg',
    })
  })

  it('sets the event last begun apart for twenty minutes of reading', () => {
    expect(historyAt([crossing], stations, at('2019-10-22T06:10:00.000Z'))[0]?.latest).toBe(true)
    expect(historyAt([crossing], stations, at('2019-10-22T06:30:00.000Z'))[0]?.latest).toBe(false)
  })

  it('tells an event over from one under way', () => {
    expect(historyAt([crossing], stations, at('2019-10-22T11:00:00.000Z'))[0]?.over).toBe(false)
    expect(historyAt([crossing], stations, at('2019-10-22T12:00:00.000Z'))[0]?.over).toBe(true)
  })

  /** Its end is the last instant measured, which may fall well short of the period's. */
  it('keeps a crossing that never came back below under way to the end', () => {
    const unended = { ...crossing, crossing: aThreshold({ stillActiveAtEnd: true }) }

    expect(historyAt([unended], stations, at('2019-10-22T18:00:00.000Z'))[0]?.over).toBe(false)
  })
})

describe('what is written on a threshold colour', () => {
  /** White on a bright yellow is all but unreadable. */
  it('is dark on a light colour, white on a dark one', () => {
    expect(inkOn('#ffff00')).toBe('#1c2833')
    expect(inkOn('#ff0000')).toBe('#ffffff')
  })
})
