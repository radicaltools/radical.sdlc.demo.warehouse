// The real calls to the stock service and the carrier.

import type { CarrierStatus, Reservation } from '@warehouse/contracts'
import { CarrierDown, type Neighbours } from './dispatcher.js'

const carrierStatuses: readonly string[] = ['in-transit', 'delivered', 'lost']

export function neighboursAt(stockUrl: string, carrierUrl: string): Neighbours {
  return {
    async reservation(id) {
      const response = await fetch(`${stockUrl}/reservations/${encodeURIComponent(id)}`)
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`Stock answered ${response.status}`)
      return (await response.json()) as Reservation
    },
    async markDispatched(id) {
      const response = await fetch(`${stockUrl}/reservations/${encodeURIComponent(id)}/dispatch`, { method: 'POST' })
      if (!response.ok) throw new Error(`Stock answered ${response.status}`)
    },
    async book(reservation) {
      try {
        const response = await fetch(`${carrierUrl}/parcels`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reference: reservation.id, lines: reservation.lines }),
        })
        if (!response.ok) throw new Error(`The carrier answered ${response.status}`)
        return ((await response.json()) as { trackingNumber: string }).trackingNumber
      } catch (error) {
        throw new CarrierDown((error as Error).message)
      }
    },
    async parcelStatus(trackingNumber) {
      try {
        const response = await fetch(`${carrierUrl}/parcels/${encodeURIComponent(trackingNumber)}`)
        if (!response.ok) throw new Error(`The carrier answered ${response.status}`)
        const status = ((await response.json()) as { status?: unknown }).status
        if (typeof status !== 'string' || !carrierStatuses.includes(status)) throw new Error(`The carrier answered the status ${String(status)}`)
        return status as CarrierStatus
      } catch (error) {
        throw new CarrierDown((error as Error).message)
      }
    },
  }
}
