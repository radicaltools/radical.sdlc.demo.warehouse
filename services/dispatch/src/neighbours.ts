// The real calls to the stock service and the carrier.

import type { Booking, CarrierStatus, DeliveryAddress, ParcelStatus, Reservation } from '@warehouse/contracts'
import { CarrierDown, type Neighbours } from './dispatcher.js'

const carrierStatuses: readonly string[] = ['in-transit', 'out-for-delivery', 'delivered', 'lost']

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
    async book(reservation, deliveryAddress) {
      try {
        // Without an address the body is what it was before: the address is added only when the dispatch gave one.
        const parcel = { reference: reservation.id, lines: reservation.lines, ...(deliveryAddress ? { deliveryAddress } : {}) }
        const response = await fetch(`${carrierUrl}/parcels`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parcel),
        })
        if (!response.ok) throw new Error(`The carrier answered ${response.status}`)
        const answer = (await response.json()) as { trackingNumber: string; estimatedDeliveryDate?: unknown }
        // The date is kept as the carrier gave it; a missing or null date is null, and does not fail the booking.
        const estimatedDeliveryDate = typeof answer.estimatedDeliveryDate === 'string' ? answer.estimatedDeliveryDate : null
        return { trackingNumber: answer.trackingNumber, estimatedDeliveryDate } satisfies Booking
      } catch (error) {
        throw new CarrierDown((error as Error).message)
      }
    },
    async parcelStatus(trackingNumber) {
      try {
        const response = await fetch(`${carrierUrl}/parcels/${encodeURIComponent(trackingNumber)}`)
        if (!response.ok) throw new Error(`The carrier answered ${response.status}`)
        const answer = (await response.json()) as { status?: unknown; deliveredAt?: unknown }
        const status = answer.status
        if (typeof status !== 'string' || !carrierStatuses.includes(status)) throw new Error(`The carrier answered the status ${String(status)}`)
        // The delivery time is kept as the carrier gave it; a missing one is null, and the dispatcher nulls it for any status but delivered.
        const deliveredAt = typeof answer.deliveredAt === 'string' ? answer.deliveredAt : null
        return { status: status as CarrierStatus, deliveredAt } satisfies ParcelStatus
      } catch (error) {
        throw new CarrierDown((error as Error).message)
      }
    },
  }
}
