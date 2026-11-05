// Books the carrier for a held reservation, once per idempotency key, and has
// the stock service take the goods off the shelf. A carrier that was booked is
// not booked again when the stock service failed after it.

import type { Booking, CarrierStatus, Dispatched, DispatchStatus, Reservation } from '@warehouse/contracts'

export interface Neighbours {
  /** The reservation, or undefined when there is none. Throws when stock cannot be reached. */
  reservation(id: string): Promise<Reservation | undefined>
  markDispatched(id: string): Promise<void>
  /** The tracking number and the estimated delivery date, or null. Throws CarrierDown when the carrier cannot be reached. */
  book(reservation: Reservation): Promise<Booking>
  /** The carrier's status of a parcel. Throws CarrierDown when the carrier does not answer with a known status. */
  parcelStatus(trackingNumber: string): Promise<CarrierStatus>
}

export class UnknownReservation extends Error {}
export class NotHeld extends Error {}
export class CarrierDown extends Error {}
/** The reservation is unknown or not dispatched: it has no carrier status. */
export class NotDispatched extends Error {}
/** The reservation is dispatched, but its tracking number was lost in a restart of this process. */
export class TrackingLost extends Error {}

export class Dispatcher {
  private byKey = new Map<string, Dispatched>()
  /** The dispatches still running, by key: a second call with the key waits for the first. */
  private inFlight = new Map<string, Promise<Dispatched>>()
  /** The carrier bookings, by reservation, as promises: a call that comes while one is made shares it. */
  private booked = new Map<string, Promise<Booking>>()
  /** The booking of each dispatched reservation, kept in the process as the keys are: a restart loses it. */
  private bookings = new Map<string, Booking>()

  constructor(private neighbours: Neighbours) {}

  /** The carrier's status of a dispatched reservation. Asks the carrier and changes nothing. */
  async status(reservationId: string): Promise<DispatchStatus> {
    const reservation = await this.neighbours.reservation(reservationId)
    if (!reservation || reservation.status !== 'dispatched') throw new NotDispatched(`${reservationId} is not dispatched`)
    const booking = this.bookings.get(reservationId)
    if (!booking) throw new TrackingLost(`The tracking number of ${reservationId} was lost in a restart`)
    const { trackingNumber, estimatedDeliveryDate } = booking
    const status = await this.neighbours.parcelStatus(trackingNumber)
    return { reservationId, trackingNumber, estimatedDeliveryDate, status }
  }

  dispatch(key: string, reservationId: string): Promise<Dispatched> {
    const known = this.byKey.get(key)
    if (known) return Promise.resolve(known)
    const running = this.inFlight.get(key)
    if (running) return running
    const attempt = this.run(key, reservationId)
    this.inFlight.set(key, attempt)
    const done = () => { this.inFlight.delete(key) }
    attempt.then(done, done)
    return attempt
  }

  private async run(key: string, reservationId: string): Promise<Dispatched> {
    const reservation = await this.neighbours.reservation(reservationId)
    if (!reservation) throw new UnknownReservation(`No reservation ${reservationId}`)
    if (reservation.status !== 'held') throw new NotHeld(`A ${reservation.status} reservation cannot be dispatched`)
    let booking = this.booked.get(reservationId)
    if (!booking) {
      // Stored before the first await, so a call that comes meanwhile shares this booking.
      booking = this.neighbours.book(reservation)
      this.booked.set(reservationId, booking)
      booking.catch(() => { this.booked.delete(reservationId) })
    }
    const { trackingNumber, estimatedDeliveryDate } = await booking
    await this.neighbours.markDispatched(reservationId)
    this.bookings.set(reservationId, { trackingNumber, estimatedDeliveryDate })
    const dispatched = { reservationId, trackingNumber, estimatedDeliveryDate }
    this.byKey.set(key, dispatched)
    return dispatched
  }
}
