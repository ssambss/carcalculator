// The advert link on a card is read out of the notes, where the watcher writes
// the listing's address as the first line.

import { describe, expect, it } from 'vitest'

import { advertOf } from '../src/advert'

describe('the advert link', () => {
  it('reads the watcher\'s first line, and leaves the rest of the notes to show', () => {
    const notes = [
      'https://www.nettiauto.com/polestar/2/14899145',
      'Long Range Dual Motor · Musta · Espoo',
      'Lisätty Discord-reaktiosta.',
    ].join('\n')
    expect(advertOf(notes)).toEqual({
      url: 'https://www.nettiauto.com/polestar/2/14899145',
      host: 'nettiauto.com',
      notes: 'Long Range Dual Motor · Musta · Espoo\nLisätty Discord-reaktiosta.',
    })
  })

  it('finds an address typed into a sentence, without the full stop after it', () => {
    const advert = advertOf('Dealer listing at https://example.fi/cars/42. Ask about tires.')
    expect(advert?.url).toBe('https://example.fi/cars/42')
    // Not a line of its own, so the sentence stays as written.
    expect(advert?.notes).toBe('Dealer listing at https://example.fi/cars/42. Ask about tires.')
  })

  it('has nothing to link when the notes hold no web address', () => {
    expect(advertOf('')).toBeNull()
    expect(advertOf('Test drive on Friday, nettiauto 14899145')).toBeNull()
    expect(advertOf('ftp://example.fi/file')).toBeNull()
  })
})
