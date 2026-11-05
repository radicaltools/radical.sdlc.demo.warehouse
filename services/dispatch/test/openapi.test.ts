// The dispatch service's OpenAPI description: another system's client relies on it, so an
// addition is checked here and nothing that was there may go.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Responses = Record<string, { description?: string; content?: { 'application/json'?: { schema?: { required?: string[] } } } }>
interface Api { paths: Record<string, Record<string, { responses: Responses }>> }

const api = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as Api

describe('openapi', () => {
  it('describes GET /dispatches/{reservationId} with 200, 404 and 503', () => {
    const get = api.paths['/dispatches/{reservationId}']?.get
    expect(get).toBeDefined()
    expect(Object.keys(get!.responses).sort()).toEqual(['200', '404', '503'])
    expect(get!.responses['200'].content?.['application/json']?.schema?.required).toEqual(['reservationId', 'trackingNumber', 'estimatedDeliveryDate', 'status'])
  })
  it('describes the 201 of POST /dispatches with the tracking number and the estimated delivery date', () => {
    const created = api.paths['/dispatches']?.post?.responses['201']
    expect(created?.content?.['application/json']?.schema?.required).toEqual(['reservationId', 'trackingNumber', 'estimatedDeliveryDate'])
  })
  it('removes and renames nothing of the pinned description', () => {
    // The operation and answers of the version before the addition (1.0.0), which clients rely on.
    const post = api.paths['/dispatches']?.post
    expect(post).toBeDefined()
    expect(Object.keys(post!.responses).sort()).toEqual(['201', '400', '404', '409', '503'])
  })
})
