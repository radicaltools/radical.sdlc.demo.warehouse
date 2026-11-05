// What the warehouse's services say over HTTP (ADR Services talk over HTTP).
// Types only: no service gets behaviour from here. Other systems read the
// OpenAPI descriptions of the services instead.

export interface ReservationLine { sku: string; quantity: number }

/** POST /reservations on the stock service, with an Idempotency-Key header. */
export interface ReserveRequest { lines: ReservationLine[] }

export type ReservationStatus = 'held' | 'dispatched' | 'released' | 'returned'
export interface Reservation { id: string; lines: ReservationLine[]; status: ReservationStatus }

/** A line a reservation asked more of than is available. */
export interface ShortLine { sku: string; requested: number; available: number }
/** The answer 409 of POST /reservations. */
export interface ShortAnswer { error: string; short: ShortLine[] }

/** GET /stock/{sku} on the stock service. `available` is `onHand` minus `held`. */
export interface Availability { sku: string; available: number; onHand: number; held: number }

/** An entry of GET /stock/{sku}/reservations on the stock service: a held reservation and the quantity of the SKU it holds. */
export interface HeldReservation { id: string; quantity: number }

/** GET /stock on the stock service: the whole stock, sorted by SKU. */
export type StockList = Availability[]

/** POST /stock/receipts on the stock service. */
export interface Receipt { sku: string; quantity: number }

/** POST /reservations/{id}/return on the stock service, with an Idempotency-Key header and no body. */

/** POST /dispatches on the dispatch service, with an Idempotency-Key header. */
export interface DispatchRequest { reservationId: string }
export interface Dispatched { reservationId: string; trackingNumber: string }

/** The carrier's status of a parcel, as its GET /parcels/{trackingNumber} reports it. */
export type CarrierStatus = 'in-transit' | 'delivered' | 'lost'
/** GET /dispatches/{reservationId} on the dispatch service: the tracking number and the carrier's status of a dispatched reservation. */
export interface DispatchStatus { reservationId: string; trackingNumber: string; status: CarrierStatus }

export interface ErrorBody { error: string }
