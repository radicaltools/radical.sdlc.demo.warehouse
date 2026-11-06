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

/** The address a parcel goes to, as the Shop gives it (the country a two-letter code such as PL). */
export interface DeliveryAddress { street: string; city: string; postalCode: string; country: string }
/** POST /dispatches on the dispatch service, with an Idempotency-Key header. The deliveryAddress is optional: a dispatch without it books the carrier as before. */
export interface DispatchRequest { reservationId: string; deliveryAddress?: DeliveryAddress }
/** The carrier's answer to a booking: the tracking number, and the estimated delivery date as the carrier gave it, or null when it gave none. */
export interface Booking { trackingNumber: string; estimatedDeliveryDate: string | null }
/** The answer 201 of POST /dispatches on the dispatch service. */
export interface Dispatched { reservationId: string; trackingNumber: string; estimatedDeliveryDate: string | null }

/** The carrier's status of a parcel, as its GET /parcels/{trackingNumber} reports it. */
export type CarrierStatus = 'in-transit' | 'out-for-delivery' | 'delivered' | 'lost'
/** The carrier's status of a parcel, and the date and time it was delivered as the carrier gave it (or null when it gave none). */
export interface ParcelStatus { status: CarrierStatus; deliveredAt: string | null }
/** GET /dispatches/{reservationId} on the dispatch service: the tracking number, the estimated delivery date (or null), the carrier's status of a dispatched reservation, and the delivery date and time (or null unless delivered). */
export interface DispatchStatus { reservationId: string; trackingNumber: string; estimatedDeliveryDate: string | null; status: CarrierStatus; deliveredAt: string | null }

export interface ErrorBody { error: string }
