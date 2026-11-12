import { describe, expect, it } from 'vitest'

import { calloutOfCamera, calloutOfSource } from '../src/map/callouts.ts'
import { viewsOf } from '../src/pictures.ts'
import { aCamera, aView, at } from './support/content.ts'

describe('what a source says when it is clicked', () => {
  it('is its name and what it is', () => {
    expect(calloutOfSource({ kind: 'watercourse', name: 'Trèbes' })).toEqual({
      title: 'Trèbes',
      lines: ["Station cours d'eau"],
    })
  })

  it('names an ouvrage an ouvrage', () => {
    expect(calloutOfSource({ kind: 'structure', name: 'Seuil de Puichéric' }).lines).toEqual([
      'Ouvrage',
    ])
  })

  it('names a rain gauge a rain gauge', () => {
    expect(calloutOfSource({ kind: 'rain-gauge', name: 'Pezens' }).lines).toEqual(['Pluviomètre'])
  })
})

describe('what a camera says when it is clicked', () => {
  const camera = aCamera()
  const views = viewsOf([aView({ at: '2019-10-22T06:00:00.000Z' })])

  it('is its commune, and when the picture on the map was taken', () => {
    expect(calloutOfCamera(camera, views, at('2019-10-22T08:00:00.000Z'))).toEqual({
      title: 'Mailhac',
      lines: ['Webcam', 'Vue du 22/10/2019 08:00.'],
    })
  })

  /** Copied as it stands today: one with no view of the period may not have existed then. */
  it('says a camera the replay holds no view of is as it stands today', () => {
    expect(
      calloutOfCamera(aCamera('308', 'Trèbes'), views, at('2019-10-22T08:00:00.000Z')),
    ).toEqual({
      title: 'Trèbes',
      lines: [
        'Webcam',
        'Aucune image dans ce rejeu. Position et état d’aujourd’hui : rien n’indique que cette caméra existait à la date du rejeu.',
      ],
    })
  })

  it('says the camera had not looked yet, rather than nothing', () => {
    expect(calloutOfCamera(camera, views, at('2019-10-21T00:00:00.000Z')).lines[1]).toBe(
      'Aucune vue avant cet instant.',
    )
  })
})
