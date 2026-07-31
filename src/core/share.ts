import * as Y from 'yjs'
import { deflateSync, inflateSync } from 'fflate'

/**
 * Sealed share links.
 *
 * A share link is a frozen snapshot, not access to the live document. That is
 * the whole security model here: a public viewer receives bytes and has no
 * channel to send an operation back, so "read-only" is a property of the
 * transport rather than a flag the UI is trusted to honour.
 *
 * Sealing works on a copy so that excluding a section removes it from the
 * payload without touching the live trip. It does not need to compact:
 * `Y.encodeStateAsUpdate` already emits current state rather than an operation
 * log, and Yjs collects deleted content on its own.
 */

export interface SealOptions {
  /** Sections to strip from the bytes entirely, rather than hide in the UI. */
  exclude?: readonly string[]
}

/** The publishable bytes for a trip. */
export function seal(doc: Y.Doc, opts: SealOptions = {}): Uint8Array {
  // Work on a copy — stripping a section must not touch the live trip.
  const flat = new Y.Doc()
  Y.applyUpdate(flat, Y.encodeStateAsUpdate(doc))

  for (const root of opts.exclude ?? []) {
    // Clearing the shared type removes the content from the snapshot bytes.
    // Excluded sections must not merely be hidden: anyone can read a URL
    // fragment, so hiding in CSS would publish the budget to the world.
    const map = flat.getMap(root)
    flat.transact(() => {
      for (const key of [...map.keys()]) map.delete(key)
    })
  }

  return Y.encodeStateAsUpdate(flat)
}

/** Encode a sealed snapshot for a URL fragment. */
export function encodeSnapshot(update: Uint8Array): string {
  return toBase64Url(deflateSync(update, { level: 9 }))
}

export function decodeSnapshot(token: string): Uint8Array {
  return inflateSync(fromBase64Url(token))
}

export function docFromSnapshot(token: string): Y.Doc {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, decodeSnapshot(token))
  return doc
}

/**
 * Build the shareable URL.
 *
 * The snapshot rides in the fragment rather than the query string, so it is
 * never sent to a server or written to an access log — the trip stays between
 * the people holding the link.
 */
export function shareUrl(doc: Y.Doc, base: string, opts: SealOptions = {}): string {
  const token = encodeSnapshot(seal(doc, opts))
  const url = new URL(base)
  url.hash = `/s/${token}`
  return url.toString()
}

/**
 * Fragments are not formally length-limited, but proxies and chat clients
 * start mangling links past a few tens of kilobytes. Past this we tell the
 * user to export instead of silently handing them a truncated link.
 */
export const SHARE_URL_SOFT_LIMIT = 32_000

export function isShareable(url: string): boolean {
  return url.length <= SHARE_URL_SOFT_LIMIT
}

/* -------------------------------------------------------------------------- */
/* base64url                                                                  */
/* -------------------------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
